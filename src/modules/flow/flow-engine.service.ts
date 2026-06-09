import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Flow } from './entities/flow.entity';
import { FlowExecutionState } from './entities/flow-execution-state.entity';
import { SessionService } from '../session/session.service';
import { createLogger } from '../../common/services/logger.service';
import { IncomingMessage } from '../../engine/interfaces/whatsapp-engine.interface';
import {
  FlowGraph,
  FlowNode,
  FlowScope,
  TriggerDef,
  ConditionRule,
  CaptureValidation,
} from './dto/flow-graph.types';

/** One outbound message produced by the engine (sent live, or collected in a dry-run). */
interface OutboundRecord {
  kind: 'text' | 'image' | 'audio';
  chatId: string;
  text?: string;
  media?: string;
  mimetype?: string;
  caption?: string;
}

interface ButtonItem {
  id: string;
  label: string;
  value?: string;
}

/** Result of simulating a single inbound message (used by the /test endpoint). */
export interface DryRunResult {
  matchedFlow: boolean;
  flowId?: string;
  flowName?: string;
  executedNodes: string[];
  outbound: OutboundRecord[];
  parkedAt?: string | null;
  status: 'no-match' | 'parked' | 'completed' | 'aborted';
}

const MAX_STEPS = 50;
const MAX_DELAY_MS = 10_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class FlowEngineService {
  private readonly logger = createLogger('FlowEngineService');

  /** Per-(session,chat) promise chain so two fast inbound messages can't double-advance the FSM. */
  private queues = new Map<string, Promise<unknown>>();

  constructor(
    @InjectRepository(Flow, 'data')
    private readonly flowRepo: Repository<Flow>,
    @InjectRepository(FlowExecutionState, 'data')
    private readonly runRepo: Repository<FlowExecutionState>,
    @Inject(forwardRef(() => SessionService))
    private readonly sessionService: SessionService,
  ) {}

  // ===========================================================================
  // Public entry point — called from SessionService.onMessage (fire-and-forget)
  // ===========================================================================

  async handleInbound(sessionId: string, message: IncomingMessage): Promise<void> {
    // v1: ignore our own outgoing messages and group chats.
    if (message.fromMe || message.isGroup) return;
    const chatId = message.from;
    if (!chatId) return;

    const key = `${sessionId}:${chatId}`;
    const prev = this.queues.get(key) ?? Promise.resolve();
    const result = prev.then(
      () => this.process(sessionId, chatId, message),
      () => this.process(sessionId, chatId, message),
    );
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(key, tail);
    void tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return result;
  }

  private async process(sessionId: string, chatId: string, message: IncomingMessage): Promise<void> {
    const normalized = (message.body ?? '').trim().toLowerCase();

    let run = await this.runRepo.findOne({ where: { sessionId, chatId, status: 'active' } });

    // Expire abandoned parked runs.
    if (run && run.expiresAt && run.expiresAt.getTime() < Date.now()) {
      run.status = 'expired';
      await this.runRepo.save(run);
      run = null;
    }

    if (run) {
      const flow = await this.flowRepo.findOne({ where: { id: run.flowId } });
      if (!flow || !flow.enabled) {
        run.status = 'aborted';
        await this.runRepo.save(run);
        run = null;
      } else {
        // Global escape keyword aborts the active run.
        if (flow.escapeKeyword && normalized === flow.escapeKeyword.trim().toLowerCase()) {
          run.status = 'aborted';
          await this.runRepo.save(run);
          this.logger.debug('Flow run aborted by escape keyword', { flowId: flow.id, chatId });
          return;
        }
        try {
          await this.resume(flow, run, message, normalized);
        } catch (err) {
          await this.failRun(run, err);
        }
        return;
      }
    }

    // No active run → trigger matching.
    const match = await this.matchFlow(sessionId, chatId, normalized);
    if (!match) return;

    const newRun = this.runRepo.create({
      flowId: match.id,
      sessionId,
      chatId,
      currentNodeId: null,
      status: 'active',
      variables: {},
      stepCount: 0,
      lastInteractionAt: new Date(),
      expiresAt: new Date(Date.now() + (match.runTtlHours || 24) * 3600_000),
    });

    const startNode = this.startNodeAfterTrigger(match.graph);
    try {
      await this.executeForward(match, newRun, startNode, message, null);
    } catch (err) {
      await this.failRun(newRun, err);
    }
  }

  // ===========================================================================
  // Trigger matching
  // ===========================================================================

  private async matchFlow(sessionId: string, chatId: string, normalized: string): Promise<Flow | null> {
    const flows = (await this.flowRepo.find({ where: { enabled: true } })).filter(f =>
      this.scopeIncludes(f.scope, sessionId),
    );

    const candidates: Array<{ flow: Flow; trigger: TriggerDef }> = [];
    for (const flow of flows) {
      for (const trigger of flow.triggers ?? []) {
        candidates.push({ flow, trigger });
      }
    }
    candidates.sort((a, b) => a.trigger.priority - b.trigger.priority);

    // Compute first-contact lazily (only if a welcome trigger is in play).
    let firstContact: boolean | null = null;
    const needsFirstContact = candidates.some(c => c.trigger.matchType === 'welcome');
    if (needsFirstContact) {
      firstContact = (await this.runRepo.count({ where: { sessionId, chatId } })) === 0;
    }

    for (const { flow, trigger } of candidates) {
      if (this.triggerMatches(trigger, normalized, firstContact)) {
        return flow;
      }
    }
    return null;
  }

  private triggerMatches(trigger: TriggerDef, normalized: string, firstContact: boolean | null): boolean {
    const keywords = (trigger.keywords ?? []).map(k => k.trim().toLowerCase()).filter(Boolean);
    switch (trigger.matchType) {
      case 'exact':
        return keywords.includes(normalized);
      case 'contains':
        return keywords.some(k => normalized.includes(k));
      case 'welcome':
        return firstContact === true;
      case 'any':
        return normalized.length > 0;
      case 'default':
        return true; // lowest-priority catch-all
      default:
        return false;
    }
  }

  private scopeIncludes(scope: FlowScope, sessionId: string): boolean {
    if (!scope || scope.type === 'all') return true;
    return Array.isArray(scope.sessionIds) && scope.sessionIds.includes(sessionId);
  }

  // ===========================================================================
  // Resume a parked run with the contact's reply
  // ===========================================================================

  private async resume(
    flow: Flow,
    run: FlowExecutionState,
    message: IncomingMessage,
    normalized: string,
  ): Promise<void> {
    const graph = flow.graph;
    const node = run.currentNodeId ? this.nodeById(graph, run.currentNodeId) : null;
    const reply = message.body ?? '';

    if (!node) {
      await this.completeRun(run);
      return;
    }

    if (node.type === 'wait_for_reply') {
      const data = node.data as { variableName?: string; validation?: CaptureValidation; retryText?: string };
      if (!this.validateCapture(reply, data.validation)) {
        await this.dispatch(run.sessionId, { kind: 'text', chatId: run.chatId, text: data.retryText || 'Sorry, that does not look right. Please try again.' }, null);
        await this.park(run, node.id, flow);
        return;
      }
      if (data.variableName) run.variables[data.variableName] = reply;
      const next = this.nextTarget(graph, node.id, undefined);
      await this.executeForward(flow, run, next, message, reply);
      return;
    }

    if (node.type === 'buttons') {
      const data = node.data as { text?: string; items?: ButtonItem[] };
      const items = data.items ?? [];
      const choice = this.matchButtonChoice(items, normalized);
      if (!choice) {
        await this.dispatch(run.sessionId, { kind: 'text', chatId: run.chatId, text: this.renderButtonsMenu(data.text, items) }, null);
        await this.park(run, node.id, flow);
        return;
      }
      const next = this.nextTarget(graph, node.id, choice.id);
      await this.executeForward(flow, run, next, message, reply);
      return;
    }

    // Parked on a non-input node (shouldn't normally happen) → continue forward.
    const next = this.nextTarget(graph, node.id, undefined);
    await this.executeForward(flow, run, next, message, reply);
  }

  // ===========================================================================
  // Forward execution — runs nodes until it parks on input or ends
  // ===========================================================================

  private async executeForward(
    flow: Flow,
    run: FlowExecutionState,
    startNodeId: string | null,
    message: IncomingMessage,
    lastReply: string | null,
    dry?: OutboundRecord[],
    executedNodes?: string[],
  ): Promise<void> {
    const graph = flow.graph;
    let nodeId: string | null = startNodeId;
    const reply = lastReply ?? message.body ?? '';

    while (nodeId) {
      if (++run.stepCount > MAX_STEPS) {
        this.logger.warn('Flow exceeded max steps, aborting', { flowId: flow.id, chatId: run.chatId });
        run.status = 'aborted';
        if (!dry) await this.runRepo.save(run);
        return;
      }
      const node = this.nodeById(graph, nodeId);
      if (!node) break;
      executedNodes?.push(node.id);

      switch (node.type) {
        case 'send_text': {
          const text = this.interpolate(String((node.data as { text?: string }).text ?? ''), run.variables);
          await this.dispatch(run.sessionId, { kind: 'text', chatId: run.chatId, text }, dry);
          nodeId = this.nextTarget(graph, node.id, undefined);
          break;
        }
        case 'send_image': {
          const d = node.data as { mediaUrl?: string; mediaBase64?: string; mimetype?: string; caption?: string };
          await this.dispatch(
            run.sessionId,
            {
              kind: 'image',
              chatId: run.chatId,
              media: d.mediaUrl || d.mediaBase64 || '',
              mimetype: d.mimetype || 'image/jpeg',
              caption: d.caption ? this.interpolate(d.caption, run.variables) : undefined,
            },
            dry,
          );
          nodeId = this.nextTarget(graph, node.id, undefined);
          break;
        }
        case 'send_audio': {
          const d = node.data as { mediaUrl?: string; mediaBase64?: string; mimetype?: string };
          await this.dispatch(
            run.sessionId,
            { kind: 'audio', chatId: run.chatId, media: d.mediaUrl || d.mediaBase64 || '', mimetype: d.mimetype || 'audio/mpeg' },
            dry,
          );
          nodeId = this.nextTarget(graph, node.id, undefined);
          break;
        }
        case 'set_variable': {
          const d = node.data as { name?: string; value?: string };
          if (d.name) run.variables[d.name] = this.interpolate(String(d.value ?? ''), run.variables);
          nodeId = this.nextTarget(graph, node.id, undefined);
          break;
        }
        case 'delay': {
          const seconds = Number((node.data as { seconds?: number }).seconds ?? 0);
          if (!dry && seconds > 0) {
            await new Promise(r => setTimeout(r, Math.min(seconds * 1000, MAX_DELAY_MS)));
          }
          nodeId = this.nextTarget(graph, node.id, undefined);
          break;
        }
        case 'condition': {
          nodeId = this.evaluateCondition(graph, node, run, reply);
          break;
        }
        case 'jump': {
          nodeId = String((node.data as { targetNodeId?: string }).targetNodeId ?? '') || null;
          break;
        }
        case 'buttons': {
          const d = node.data as { text?: string; items?: ButtonItem[] };
          await this.dispatch(run.sessionId, { kind: 'text', chatId: run.chatId, text: this.renderButtonsMenu(d.text, d.items ?? []) }, dry);
          if (!dry) await this.park(run, node.id, flow);
          else run.currentNodeId = node.id;
          return; // park: wait for the contact's choice
        }
        case 'wait_for_reply': {
          if (!dry) await this.park(run, node.id, flow);
          else run.currentNodeId = node.id;
          return; // park: wait for the contact's reply
        }
        case 'trigger': {
          nodeId = this.nextTarget(graph, node.id, undefined);
          break;
        }
        case 'end': {
          if (!dry) await this.completeRun(run);
          else run.status = 'completed';
          return;
        }
        default: {
          nodeId = this.nextTarget(graph, node.id, undefined);
          break;
        }
      }
    }

    // Ran out of edges → treat as completed.
    if (!dry) await this.completeRun(run);
    else run.status = 'completed';
  }

  // ===========================================================================
  // Dry-run (for the /flows/:id/test endpoint)
  // ===========================================================================

  async dryRun(flow: Flow, sessionId: string, from: string, body: string): Promise<DryRunResult> {
    const normalized = body.trim().toLowerCase();
    const result: DryRunResult = { matchedFlow: false, executedNodes: [], outbound: [], status: 'no-match' };

    // Check this flow's own triggers (scoped to the given session).
    if (!this.scopeIncludes(flow.scope, sessionId)) return result;
    const triggerHit = (flow.triggers ?? []).some(t => this.triggerMatches(t, normalized, true));
    if (!triggerHit) return result;

    result.matchedFlow = true;
    result.flowId = flow.id;
    result.flowName = flow.name;

    const run = this.runRepo.create({
      flowId: flow.id,
      sessionId,
      chatId: from,
      currentNodeId: null,
      status: 'active',
      variables: {},
      stepCount: 0,
    });
    const message: IncomingMessage = {
      id: 'dry-run',
      from,
      to: sessionId,
      chatId: from,
      body,
      type: 'chat',
      timestamp: Math.floor(Date.now() / 1000),
      fromMe: false,
      isGroup: false,
    };
    const startNode = this.startNodeAfterTrigger(flow.graph);
    await this.executeForward(flow, run, startNode, message, null, result.outbound, result.executedNodes);
    result.parkedAt = run.currentNodeId;
    result.status = run.status === 'completed' ? 'completed' : run.currentNodeId ? 'parked' : 'completed';
    return result;
  }

  // ===========================================================================
  // Outbound dispatch (live send via engine, or dry-run collection)
  // ===========================================================================

  private async dispatch(sessionId: string, rec: OutboundRecord, dry: OutboundRecord[] | null | undefined): Promise<void> {
    if (dry) {
      dry.push(rec);
      return;
    }
    const engine = this.sessionService.getEngine(sessionId);
    if (!engine) {
      this.logger.warn('Session not connected — cannot send flow reply', { sessionId, chatId: rec.chatId });
      throw new Error(`Session ${sessionId} not connected`);
    }
    if (rec.kind === 'text') {
      await engine.sendTextMessage(rec.chatId, rec.text ?? '');
    } else if (rec.kind === 'image') {
      await engine.sendImageMessage(rec.chatId, {
        mimetype: rec.mimetype ?? 'image/jpeg',
        data: rec.media ?? '',
        caption: rec.caption,
      });
    } else if (rec.kind === 'audio') {
      await engine.sendAudioMessage(rec.chatId, { mimetype: rec.mimetype ?? 'audio/mpeg', data: rec.media ?? '' });
    }
  }

  // ===========================================================================
  // Run-state persistence helpers
  // ===========================================================================

  private async park(run: FlowExecutionState, nodeId: string, flow: Flow): Promise<void> {
    run.currentNodeId = nodeId;
    run.status = 'active';
    run.lastInteractionAt = new Date();
    run.expiresAt = new Date(Date.now() + (flow.runTtlHours || 24) * 3600_000);
    await this.runRepo.save(run);
  }

  private async completeRun(run: FlowExecutionState): Promise<void> {
    run.status = 'completed';
    run.currentNodeId = null;
    run.lastInteractionAt = new Date();
    await this.runRepo.save(run);
  }

  private async failRun(run: FlowExecutionState, err: unknown): Promise<void> {
    this.logger.error('Flow run failed', err instanceof Error ? err.message : String(err), {
      flowId: run.flowId,
      chatId: run.chatId,
    });
    try {
      run.status = 'aborted';
      if (run.id) await this.runRepo.save(run);
    } catch {
      /* ignore secondary failure */
    }
  }

  // ===========================================================================
  // Graph helpers
  // ===========================================================================

  private nodeById(graph: FlowGraph, id: string): FlowNode | null {
    return (graph.nodes ?? []).find(n => n.id === id) ?? null;
  }

  private startNodeAfterTrigger(graph: FlowGraph): string | null {
    const trigger = (graph.nodes ?? []).find(n => n.type === 'trigger');
    if (!trigger) return null;
    return this.nextTarget(graph, trigger.id, undefined);
  }

  private nextTarget(graph: FlowGraph, nodeId: string, handle: string | undefined): string | null {
    const edges = (graph.edges ?? []).filter(
      e => e.source === nodeId && (handle === undefined || (e.sourceHandle ?? null) === handle),
    );
    return edges[0]?.target ?? null;
  }

  private evaluateCondition(graph: FlowGraph, node: FlowNode, run: FlowExecutionState, lastReply: string): string | null {
    const data = node.data as { rules?: ConditionRule[]; defaultHandle?: string };
    const rules = data.rules ?? [];
    const defHandle = data.defaultHandle ?? 'else';
    for (const r of rules) {
      const raw = r.var ? run.variables[r.var] : lastReply;
      const sv = raw == null ? '' : String(raw);
      const target = String(r.value ?? '');
      let ok = false;
      switch (r.op) {
        case 'equals':
          ok = sv.trim().toLowerCase() === target.trim().toLowerCase();
          break;
        case 'contains':
          ok = sv.toLowerCase().includes(target.toLowerCase());
          break;
        case 'isEmpty':
          ok = sv.trim() === '';
          break;
        case 'gt':
          ok = parseFloat(sv) > parseFloat(target);
          break;
        case 'lt':
          ok = parseFloat(sv) < parseFloat(target);
          break;
      }
      if (ok) return this.nextTarget(graph, node.id, r.handle);
    }
    return this.nextTarget(graph, node.id, defHandle);
  }

  private matchButtonChoice(items: ButtonItem[], normalized: string): ButtonItem | null {
    if (/^\d+$/.test(normalized)) {
      const n = parseInt(normalized, 10);
      if (n >= 1 && n <= items.length) return items[n - 1];
    }
    for (const it of items) {
      const label = (it.label ?? '').trim().toLowerCase();
      const value = (it.value ?? '').trim().toLowerCase();
      if (label && (normalized === label || normalized.includes(label))) return it;
      if (value && normalized === value) return it;
    }
    return null;
  }

  private renderButtonsMenu(text: string | undefined, items: ButtonItem[]): string {
    const lines = [text, ...items.map((it, i) => `${i + 1}. ${it.label}`)].filter(Boolean) as string[];
    return lines.join('\n');
  }

  private validateCapture(reply: string, validation?: CaptureValidation): boolean {
    const v = reply.trim();
    if (v === '') return false;
    if (validation === 'number') return /^-?\d+(\.\d+)?$/.test(v);
    if (validation === 'email') return EMAIL_RE.test(v);
    return true;
  }

  private interpolate(text: string, variables: Record<string, unknown>): string {
    return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => {
      const val = variables[k];
      return val == null ? '' : String(val);
    });
  }
}
