import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import { Flow } from './entities/flow.entity';
import { FlowExecutionState } from './entities/flow-execution-state.entity';
import { CreateFlowDto, UpdateFlowDto, ListRunsQueryDto } from './dto';
import { FlowGraph, FlowNode, TriggerDef, TriggerMatchType, TRIGGER_PRIORITY, FlowRunStatus } from './dto/flow-graph.types';
import { createLogger } from '../../common/services/logger.service';

@Injectable()
export class FlowService {
  private readonly logger = createLogger('FlowService');

  constructor(
    @InjectRepository(Flow, 'data')
    private readonly flowRepo: Repository<Flow>,
    @InjectRepository(FlowExecutionState, 'data')
    private readonly runRepo: Repository<FlowExecutionState>,
  ) {}

  async findAll(): Promise<Flow[]> {
    return this.flowRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<Flow> {
    const flow = await this.flowRepo.findOne({ where: { id } });
    if (!flow) {
      throw new NotFoundException(`Flow ${id} not found`);
    }
    return flow;
  }

  async create(dto: CreateFlowDto): Promise<Flow> {
    const graph = (dto.graph ?? { nodes: [], edges: [] }) as FlowGraph;
    this.validateGraph(graph);

    const flow = this.flowRepo.create({
      name: dto.name,
      description: dto.description ?? null,
      enabled: dto.enabled ?? true,
      scope: dto.scope,
      graph,
      triggers: this.extractTriggers(graph),
      escapeKeyword: dto.escapeKeyword ?? null,
      runTtlHours: dto.runTtlHours ?? 24,
    });

    const saved = await this.flowRepo.save(flow);
    this.logger.log(`Flow created: ${saved.name}`, { flowId: saved.id, action: 'flow_created' });
    return saved;
  }

  /**
   * Duplicate an existing flow into a new, independent copy. The copy is created
   * **disabled** so it can't fire on the same triggers as the original until the
   * operator has reviewed and enabled it. The graph and scope are deep-cloned so
   * the two flows never share mutable references.
   */
  async duplicate(id: string): Promise<Flow> {
    const source = await this.findOne(id);
    const graph = JSON.parse(JSON.stringify(source.graph ?? { nodes: [], edges: [] })) as FlowGraph;
    const scope = JSON.parse(JSON.stringify(source.scope ?? { type: 'all' }));

    const copy = this.flowRepo.create({
      name: `${source.name} (copy)`.slice(0, 255),
      description: source.description ?? null,
      enabled: false,
      scope,
      graph,
      triggers: this.extractTriggers(graph),
      escapeKeyword: source.escapeKeyword ?? null,
      runTtlHours: source.runTtlHours ?? 24,
    });

    const saved = await this.flowRepo.save(copy);
    this.logger.log(`Flow duplicated: ${saved.name}`, {
      flowId: saved.id,
      sourceFlowId: source.id,
      action: 'flow_duplicated',
    });
    return saved;
  }

  async update(id: string, dto: UpdateFlowDto): Promise<Flow> {
    const flow = await this.findOne(id);

    if (dto.name !== undefined) flow.name = dto.name;
    if (dto.description !== undefined) flow.description = dto.description ?? null;
    if (dto.enabled !== undefined) flow.enabled = dto.enabled;
    if (dto.scope !== undefined) flow.scope = dto.scope;
    if (dto.escapeKeyword !== undefined) flow.escapeKeyword = dto.escapeKeyword ?? null;
    if (dto.runTtlHours !== undefined) flow.runTtlHours = dto.runTtlHours;
    if (dto.graph !== undefined) {
      const graph = dto.graph as FlowGraph;
      this.validateGraph(graph);
      flow.graph = graph;
      flow.triggers = this.extractTriggers(graph);
    }

    const saved = await this.flowRepo.save(flow);
    this.logger.log(`Flow updated: ${saved.name}`, { flowId: saved.id, action: 'flow_updated' });
    return saved;
  }

  async setEnabled(id: string, enabled: boolean): Promise<Flow> {
    const flow = await this.findOne(id);
    flow.enabled = enabled;
    return this.flowRepo.save(flow);
  }

  async delete(id: string): Promise<void> {
    const result = await this.flowRepo.delete(id);
    if (!result.affected) {
      throw new NotFoundException(`Flow ${id} not found`);
    }
  }

  async listRuns(flowId: string, query: ListRunsQueryDto): Promise<FlowExecutionState[]> {
    await this.findOne(flowId);
    const where: FindOptionsWhere<FlowExecutionState> = { flowId };
    if (query.status) {
      where.status = query.status as FlowRunStatus;
    }
    return this.runRepo.find({
      where,
      order: { updatedAt: 'DESC' },
      take: query.limit ?? 50,
      skip: query.offset ?? 0,
    });
  }

  async resetRuns(flowId: string, chatId?: string): Promise<number> {
    await this.findOne(flowId);
    const where: FindOptionsWhere<FlowExecutionState> = { flowId, status: 'active' };
    if (chatId) {
      where.chatId = chatId;
    }
    const result = await this.runRepo.update(where, { status: 'aborted' });
    return result.affected ?? 0;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Pull the denormalized trigger defs out of the graph's trigger node(s) so the
   * engine can match inbound messages without scanning the whole graph.
   */
  extractTriggers(graph: FlowGraph): TriggerDef[] {
    const triggerNodes = (graph.nodes ?? []).filter(n => n.type === 'trigger');
    return triggerNodes.map((n: FlowNode) => {
      const matchType = ((n.data?.matchType as TriggerMatchType) ?? 'any') as TriggerMatchType;
      const rawKeywords = n.data?.keywords;
      const keywords = Array.isArray(rawKeywords)
        ? rawKeywords.map(k => String(k).trim().toLowerCase()).filter(Boolean)
        : [];
      return { matchType, keywords, priority: TRIGGER_PRIORITY[matchType] ?? 30 };
    });
  }

  /**
   * Structural validation of a flow graph. Empty graphs (drafts) are allowed.
   */
  validateGraph(graph: FlowGraph): void {
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      throw new BadRequestException('graph must contain nodes[] and edges[]');
    }
    if (graph.nodes.length === 0) {
      return; // draft / empty canvas is allowed
    }

    const ids = new Set<string>();
    for (const n of graph.nodes) {
      if (!n.id || !n.type) {
        throw new BadRequestException('every node requires an id and type');
      }
      if (ids.has(n.id)) {
        throw new BadRequestException(`duplicate node id: ${n.id}`);
      }
      ids.add(n.id);
    }

    const triggers = graph.nodes.filter(n => n.type === 'trigger');
    if (triggers.length === 0) {
      throw new BadRequestException('flow must have a trigger (start) node');
    }
    if (triggers.length > 1) {
      throw new BadRequestException('flow must have exactly one trigger node');
    }

    for (const e of graph.edges) {
      if (!ids.has(e.source)) {
        throw new BadRequestException(`edge references missing source node: ${e.source}`);
      }
      if (!ids.has(e.target)) {
        throw new BadRequestException(`edge references missing target node: ${e.target}`);
      }
    }

    for (const n of graph.nodes) {
      if (n.type === 'wait_for_reply' && !n.data?.variableName) {
        throw new BadRequestException(`wait_for_reply node "${n.id}" requires a variableName`);
      }
      if (n.type === 'buttons') {
        const items = n.data?.items;
        if (!Array.isArray(items) || items.length === 0) {
          throw new BadRequestException(`buttons node "${n.id}" requires at least one item`);
        }
      }
    }
  }
}
