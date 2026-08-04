import { Injectable, Logger, OnModuleInit, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Campaign,
  CampaignStatus,
  RecipientStatus,
  CampaignRecipient,
  CampaignMessage,
  CampaignOptions,
  CampaignProgress,
} from './entities/campaign.entity';
import { CreateCampaignDto } from './dto';
import { CustomerListService, CustomerListSummary } from './customer-list.service';
import { SessionService } from '../session/session.service';
import { MessageAckService } from '../../common/services/message-ack.service';
import { IWhatsAppEngine, MessageResult } from '../../engine/interfaces/whatsapp-engine.interface';

/** Campaign row without the (large) recipients array, for list views. */
export type CampaignSummary = Omit<Campaign, 'recipients'>;

const DEFAULT_OPTIONS: CampaignOptions = {
  delayBetweenMessages: 20000,
  randomizeDelay: true,
  randomizeExtraMs: 15000,
  stopOnError: false,
  skipAlreadySent: true,
};

// whatsapp-web.js ack levels.
const ACK_DELIVERED = 2;
const ACK_READ = 3;

@Injectable()
export class CampaignService implements OnModuleInit {
  private readonly logger = new Logger(CampaignService.name);

  /** campaignId -> keep-running flag (false signals pause/cancel to the loop). */
  private readonly processing = new Map<string, boolean>();
  /** Live entity while a run is processing — single source of truth shared with ack updates. */
  private readonly activeCampaigns = new Map<string, Campaign>();
  /** waMessageId -> where to apply an incoming ack. */
  private readonly msgIndex = new Map<string, { campaignId: string; index: number }>();
  /** campaignId -> resolver that wakes an in-progress interruptible delay early. */
  private readonly wakeups = new Map<string, () => void>();
  /** campaignId -> the running loop's promise, so exactly one loop runs per campaign. */
  private readonly loopPromises = new Map<string, Promise<void>>();

  constructor(
    @InjectRepository(Campaign, 'data')
    private readonly campaignRepository: Repository<Campaign>,
    private readonly sessionService: SessionService,
    private readonly customerListService: CustomerListService,
    private readonly messageAck: MessageAckService,
  ) {}

  onModuleInit(): void {
    // Runs are driven by an in-process loop; any that were RUNNING before a
    // restart can't still be running — park them as PAUSED so they can resume.
    void this.campaignRepository
      .update({ status: CampaignStatus.RUNNING }, { status: CampaignStatus.PAUSED })
      .catch(err => this.logger.warn(`Failed to reset running campaigns: ${String(err)}`));

    // Best-effort delivery/read tracking from WhatsApp acks.
    this.messageAck.onAck((messageId, ack) => {
      void this.handleAck(messageId, ack).catch(err =>
        this.logger.debug(`Ack handling error for ${messageId}: ${String(err)}`),
      );
    });
  }

  // ── Creation ────────────────────────────────────────────────────────────

  async create(dto: CreateCampaignDto): Promise<Campaign> {
    const list = await this.customerListService.findOne(dto.listId);

    const session = await this.sessionService.findOne(dto.sessionId);
    const engine = this.sessionService.getEngine(dto.sessionId);
    if (!engine) {
      throw new BadRequestException(`Session '${session.name}' is not connected`);
    }

    if (!list.recipients?.length) {
      throw new BadRequestException('This list has no recipients');
    }

    const message: CampaignMessage = {
      text: dto.message.text ?? '',
      media: dto.message.media
        ? {
            kind: dto.message.media.kind,
            url: dto.message.media.url,
            base64: dto.message.media.base64,
            mimetype: dto.message.media.mimetype,
            filename: dto.message.media.filename,
            caption: dto.message.media.caption,
          }
        : null,
    };
    if (!message.text.trim() && !message.media) {
      throw new BadRequestException('Provide message text or a media attachment');
    }

    const options: CampaignOptions = {
      delayBetweenMessages: dto.options?.delayBetweenMessages ?? DEFAULT_OPTIONS.delayBetweenMessages,
      randomizeDelay: dto.options?.randomizeDelay ?? DEFAULT_OPTIONS.randomizeDelay,
      randomizeExtraMs: dto.options?.randomizeExtraMs ?? DEFAULT_OPTIONS.randomizeExtraMs,
      stopOnError: dto.options?.stopOnError ?? DEFAULT_OPTIONS.stopOnError,
      skipAlreadySent: dto.options?.skipAlreadySent ?? DEFAULT_OPTIONS.skipAlreadySent,
    };

    // Which numbers were already reached in a previous run of this list?
    const alreadySent = options.skipAlreadySent ? await this.getAlreadySentJids(dto.listId) : new Set<string>();

    let skipped = 0;
    const recipients: CampaignRecipient[] = list.recipients.map(r => {
      const skip = alreadySent.has(r.jid);
      if (skip) skipped++;
      return {
        name: r.name,
        phone: r.phone,
        jid: r.jid,
        status: skip ? RecipientStatus.SKIPPED : RecipientStatus.PENDING,
      };
    });

    const progress: CampaignProgress = {
      total: recipients.length,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      pending: recipients.length - skipped,
      skipped,
      cancelled: 0,
    };

    const campaign = this.campaignRepository.create({
      listId: list.id,
      listName: list.name,
      sessionId: session.id,
      sessionName: session.name,
      name: dto.name?.trim() || `${list.name} — ${this.stamp()}`,
      message,
      status: CampaignStatus.RUNNING,
      options,
      progress,
      recipients,
      currentIndex: 0,
      startedAt: null,
      completedAt: null,
    });

    const saved = await this.campaignRepository.save(campaign);
    await this.customerListService.touchLastCampaign(list.id).catch(() => undefined);
    this.logger.log(
      `Created campaign "${saved.name}" (${saved.id}): ${progress.pending} to send, ${skipped} skipped`,
    );

    // Fire-and-forget drip loop (in-process; no queue/Redis dependency).
    this.startLoop(saved.id);

    return saved;
  }

  /**
   * Start the drip loop for a campaign, guaranteeing at most one loop runs per
   * campaign at a time. The guard on `loopPromises` (set synchronously) closes
   * the pause→resume race where a second loop could otherwise be spawned.
   */
  private startLoop(campaignId: string): void {
    if (this.loopPromises.has(campaignId)) return; // a loop is already active
    const promise = this.process(campaignId)
      .catch(err => this.logger.error(`Campaign ${campaignId} loop error: ${String(err)}`))
      .finally(() => this.loopPromises.delete(campaignId));
    this.loopPromises.set(campaignId, promise);
  }

  // ── Drip processing ─────────────────────────────────────────────────────

  private async process(campaignId: string): Promise<void> {
    const campaign = await this.campaignRepository.findOne({ where: { id: campaignId } });
    if (!campaign) return;

    // Guard against a cancel/complete that landed in the tiny window between the
    // caller saving the row and this async loop reading it back.
    if (
      campaign.status === CampaignStatus.CANCELLED ||
      campaign.status === CampaignStatus.COMPLETED ||
      campaign.status === CampaignStatus.FAILED
    ) {
      return;
    }

    this.processing.set(campaignId, true);
    this.activeCampaigns.set(campaignId, campaign);

    campaign.status = CampaignStatus.RUNNING;
    if (!campaign.startedAt) campaign.startedAt = new Date();
    await this.campaignRepository.save(campaign);

    // Rebuild the ack lookup from persisted state so delivery/read acks for
    // messages sent before a restart/resume still land (msgIndex is in-memory).
    (campaign.recipients ?? []).forEach((r, idx) => {
      if (r.messageId) this.msgIndex.set(r.messageId, { campaignId, index: idx });
    });

    const engine = this.sessionService.getEngine(campaign.sessionId);
    if (!engine) {
      campaign.status = CampaignStatus.FAILED;
      campaign.completedAt = new Date();
      await this.finish(campaign);
      return;
    }

    try {
      for (let i = campaign.currentIndex; i < campaign.recipients.length; i++) {
        if (!this.processing.get(campaignId)) {
          this.logger.log(`Campaign ${campaign.id} interrupted at index ${i}`);
          break;
        }

        const recipient = campaign.recipients[i];
        campaign.currentIndex = i + 1;

        // Skipped recipients are recorded but never sent (no delay for them).
        if (recipient.status === RecipientStatus.SKIPPED) continue;

        try {
          const result = await this.sendOne(engine, recipient, campaign.message);
          recipient.status = RecipientStatus.SENT;
          recipient.messageId = result.id || undefined;
          recipient.sentAt = new Date().toISOString();
          campaign.progress.sent++;
          campaign.progress.pending--;
          if (result.id) this.rememberMessageId(result.id, campaignId, i);
        } catch (err) {
          recipient.status = RecipientStatus.FAILED;
          recipient.error = err instanceof Error ? err.message : String(err);
          campaign.progress.failed++;
          campaign.progress.pending--;
          this.logger.warn(`Campaign ${campaign.id}: failed ${recipient.jid}: ${recipient.error}`);
          if (campaign.options.stopOnError) {
            campaign.status = CampaignStatus.FAILED;
            break;
          }
        }

        // Persist after every send so currentIndex is always accurate — a
        // crash/resume then re-sends at most the single in-flight message.
        // (Sends are spaced seconds apart, so per-message writes are cheap.)
        await this.campaignRepository.save(campaign);

        // Space out sends to reduce ban risk (skip the wait after the last one
        // or when interrupted). The delay is interruptible so pause/cancel take
        // effect promptly instead of after a full delay window.
        // (A stopOnError failure always breaks above, so we never reach here in
        // a FAILED state.)
        const moreToGo = i < campaign.recipients.length - 1;
        if (moreToGo && this.processing.get(campaignId)) {
          await this.interruptibleSleep(campaignId, this.calculateDelay(campaign.options));
        }
      }
    } finally {
      if (this.processing.get(campaignId)) {
        // Natural completion path (not paused/cancelled).
        if (campaign.status !== CampaignStatus.FAILED) {
          const done = campaign.progress.pending <= 0;
          if (done) {
            campaign.status =
              campaign.progress.sent === 0 && campaign.progress.failed > 0
                ? CampaignStatus.FAILED
                : CampaignStatus.COMPLETED;
          }
        }
        if (campaign.status !== CampaignStatus.RUNNING) campaign.completedAt = new Date();
      } else if ((campaign.status as CampaignStatus) === CampaignStatus.CANCELLED) {
        // Cancelled mid-run (cancel() mutates this same live object from another
        // async context, which TS's flow analysis can't see — hence the cast):
        // now that the in-flight send is done and no more will happen, move the
        // untouched pending recipients into `cancelled`.
        this.reconcileCancelled(campaign);
      }
      await this.finish(campaign);
      this.logger.log(
        `Campaign ${campaign.id} -> ${campaign.status}: ${campaign.progress.sent} sent, ` +
          `${campaign.progress.failed} failed, ${campaign.progress.skipped} skipped`,
      );
    }
  }

  private async finish(campaign: Campaign): Promise<void> {
    this.processing.delete(campaign.id);
    this.activeCampaigns.delete(campaign.id);
    this.wakeups.delete(campaign.id);
    await this.campaignRepository.save(campaign);
  }

  /** A delay that resolves after `ms` OR immediately when {@link interrupt} is called. */
  private interruptibleSleep(campaignId: string, ms: number): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.wakeups.delete(campaignId);
        resolve();
      }, ms);
      this.wakeups.set(campaignId, () => {
        clearTimeout(timer);
        this.wakeups.delete(campaignId);
        resolve();
      });
    });
  }

  /** Wake a campaign's in-progress delay so pause/cancel take effect promptly. */
  private interrupt(campaignId: string): void {
    this.wakeups.get(campaignId)?.();
  }

  private sendOne(
    engine: IWhatsAppEngine,
    recipient: CampaignRecipient,
    message: CampaignMessage,
  ): Promise<MessageResult> {
    const media = message.media;
    if (media) {
      const data = media.url || media.base64 || '';
      const caption = this.personalize(media.caption ?? message.text ?? '', recipient) || undefined;
      switch (media.kind) {
        case 'image':
          return engine.sendImageMessage(recipient.jid, { mimetype: media.mimetype || 'image/jpeg', data, caption });
        case 'video':
          return engine.sendVideoMessage(recipient.jid, { mimetype: media.mimetype || 'video/mp4', data, caption });
        case 'document':
          return engine.sendDocumentMessage(recipient.jid, {
            mimetype: media.mimetype || 'application/octet-stream',
            data,
            filename: media.filename,
            caption,
          });
        case 'audio':
          return engine.sendAudioMessage(recipient.jid, { mimetype: media.mimetype || 'audio/mpeg', data });
      }
    }
    return engine.sendTextMessage(recipient.jid, this.personalize(message.text, recipient));
  }

  private personalize(template: string, recipient: CampaignRecipient): string {
    if (!template) return '';
    return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
      const k = key.toLowerCase();
      if (k === 'name') return recipient.name;
      if (k === 'phone') return recipient.phone;
      return whole; // leave unknown placeholders untouched
    });
  }

  // ── Controls ────────────────────────────────────────────────────────────

  async pause(id: string): Promise<Campaign> {
    const campaign = await this.findOne(id);
    if (campaign.status !== CampaignStatus.RUNNING) {
      throw new BadRequestException(`Campaign is ${campaign.status}, not running`);
    }
    this.processing.set(id, false);
    campaign.status = CampaignStatus.PAUSED;
    const saved = await this.campaignRepository.save(campaign);
    this.interrupt(id); // wake the delay so the loop exits without waiting a full window
    return saved;
  }

  async resume(id: string): Promise<Campaign> {
    const campaign = await this.findOne(id);
    if (campaign.status !== CampaignStatus.PAUSED) {
      throw new BadRequestException(`Campaign is ${campaign.status}, not paused`);
    }
    const engine = this.sessionService.getEngine(campaign.sessionId);
    if (!engine) {
      throw new BadRequestException(`Session '${campaign.sessionName ?? campaign.sessionId}' is not connected`);
    }
    // A loop parked from the pause may still be winding down. Interrupt it and
    // wait for it to fully exit before starting a fresh loop, so we never run
    // two loops for one campaign (which would double-send).
    const winding = this.loopPromises.get(id);
    if (winding) {
      this.interrupt(id);
      await winding;
    }

    campaign.status = CampaignStatus.RUNNING;
    await this.campaignRepository.save(campaign);
    this.startLoop(id);
    return campaign;
  }

  async cancel(id: string): Promise<Campaign> {
    const campaign = await this.findOne(id);
    if ([CampaignStatus.COMPLETED, CampaignStatus.CANCELLED].includes(campaign.status)) {
      throw new BadRequestException(`Campaign is already ${campaign.status}`);
    }
    const loopActive = this.activeCampaigns.has(id);
    this.processing.set(id, false);
    // If mid-run, mutate the live entity so the loop's finally block agrees.
    const live = this.activeCampaigns.get(id) ?? campaign;
    live.status = CampaignStatus.CANCELLED;
    live.completedAt = new Date();
    // A running loop reconciles pending->cancelled in its finally (after its
    // in-flight send settles); if no loop is running, do it here.
    if (!loopActive) this.reconcileCancelled(live);
    const saved = await this.campaignRepository.save(live);
    this.interrupt(id); // wake any parked delay so the loop exits promptly
    return saved;
  }

  /** Move not-yet-attempted (pending) recipients into the `cancelled` bucket. */
  private reconcileCancelled(campaign: Campaign): void {
    if (!campaign.progress) return;
    campaign.progress.cancelled = (campaign.progress.cancelled ?? 0) + campaign.progress.pending;
    campaign.progress.pending = 0;
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  async findAll(listId?: string): Promise<CampaignSummary[]> {
    const where = listId ? { listId } : {};
    const campaigns = await this.campaignRepository.find({ where, order: { createdAt: 'DESC' } });
    return campaigns.map(c => this.toSummary(c));
  }

  async findOne(id: string): Promise<Campaign> {
    // Prefer the live copy so status/progress reflect the in-flight run.
    const live = this.activeCampaigns.get(id);
    if (live) return live;
    const campaign = await this.campaignRepository.findOne({ where: { id } });
    if (!campaign) throw new NotFoundException(`Campaign '${id}' not found`);
    return campaign;
  }

  async remove(id: string): Promise<void> {
    if (this.processing.get(id)) {
      throw new BadRequestException('Cancel the campaign before deleting it');
    }
    const result = await this.campaignRepository.delete({ id });
    if (!result.affected) throw new NotFoundException(`Campaign '${id}' not found`);
  }

  async exportCsv(id: string): Promise<{ filename: string; csv: string }> {
    const campaign = await this.findOne(id);
    const header = ['name', 'phone', 'status', 'messageId', 'sentAt', 'deliveredAt', 'readAt', 'error'];
    const rows = (campaign.recipients ?? []).map(r =>
      [r.name, r.phone, r.status, r.messageId ?? '', r.sentAt ?? '', r.deliveredAt ?? '', r.readAt ?? '', r.error ?? '']
        .map(v => this.csvCell(v))
        .join(','),
    );
    const csv = [header.join(','), ...rows].join('\n');
    const safeName = campaign.name.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60);
    return { filename: `campaign-${safeName}-${id.slice(0, 8)}.csv`, csv };
  }

  // ── Ack (delivery/read) tracking ────────────────────────────────────────

  private async handleAck(messageId: string, ack: number): Promise<void> {
    if (ack < ACK_DELIVERED) return;
    const loc = this.msgIndex.get(messageId);
    if (!loc) return;

    const live = this.activeCampaigns.get(loc.campaignId);
    const campaign = live ?? (await this.campaignRepository.findOne({ where: { id: loc.campaignId } }));
    if (!campaign?.recipients) return;

    const r = campaign.recipients[loc.index];
    if (!r || r.messageId !== messageId) return;
    if (r.status === RecipientStatus.FAILED || r.status === RecipientStatus.SKIPPED) return;

    const nowIso = new Date().toISOString();
    let changed = false;

    if (ack >= ACK_DELIVERED && !r.deliveredAt) {
      r.deliveredAt = nowIso;
      campaign.progress.delivered++;
      if (r.status === RecipientStatus.SENT) r.status = RecipientStatus.DELIVERED;
      changed = true;
    }
    if (ack >= ACK_READ && !r.readAt) {
      r.readAt = nowIso;
      campaign.progress.read++;
      r.status = RecipientStatus.READ;
      changed = true;
    }

    // If live, the running loop persists it; otherwise persist here.
    if (changed && !live) {
      await this.campaignRepository.save(campaign);
    }
  }

  /** Track waMessageId -> recipient for ack updates, bounding memory on long-lived processes. */
  private rememberMessageId(messageId: string, campaignId: string, index: number): void {
    const MAX = 100_000;
    if (this.msgIndex.size >= MAX) {
      // Evict the oldest ~10% (Map preserves insertion order). Late acks for
      // very old campaigns are best-effort and safe to drop.
      let toDrop = Math.floor(MAX * 0.1);
      for (const key of this.msgIndex.keys()) {
        if (toDrop-- <= 0) break;
        this.msgIndex.delete(key);
      }
    }
    this.msgIndex.set(messageId, { campaignId, index });
  }

  private async getAlreadySentJids(listId: string): Promise<Set<string>> {
    const prior = await this.campaignRepository.find({ where: { listId } });
    const reached = new Set<string>();
    const done = [RecipientStatus.SENT, RecipientStatus.DELIVERED, RecipientStatus.READ];
    for (const c of prior) {
      for (const r of c.recipients ?? []) {
        if (done.includes(r.status)) reached.add(r.jid);
      }
    }
    return reached;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private toSummary(campaign: Campaign): CampaignSummary {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { recipients, ...summary } = campaign;
    return summary;
  }

  private calculateDelay(options: CampaignOptions): number {
    let delay = options.delayBetweenMessages;
    if (options.randomizeDelay && options.randomizeExtraMs > 0) {
      delay += Math.floor(Math.random() * options.randomizeExtraMs);
    }
    return delay;
  }

  private csvCell(value: string): string {
    const v = String(value ?? '');
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }

  private stamp(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(
      now.getMinutes(),
    )}`;
  }
}

// Re-export the list summary type for consumers that import from this module.
export type { CustomerListSummary };
