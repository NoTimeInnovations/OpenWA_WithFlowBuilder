import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import * as path from 'path';
import { GroupLeaveRule, RuleMediaItem, MediaKind } from './entities/group-leave-rule.entity';
import { CreateGroupLeaveRuleDto, UpdateGroupLeaveRuleDto, GroupEvent, MAX_DELAY_SECONDS } from './dto';
import { SessionService } from '../session/session.service';
import { StorageService } from '../../common/storage/storage.service';
import { MediaInput, IWhatsAppEngine, MessageResult } from '../../engine/interfaces/whatsapp-engine.interface';
import { createLogger } from '../../common/services/logger.service';

/** Shape of a multer in-memory upload (avoids a hard dependency on @types/multer). */
export interface UploadedMediaFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const MIME_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/webm': '.webm',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/x-m4a': '.m4a',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/3gpp': '.3gp',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
};

const DEFAULT_MIME: Record<MediaKind, string> = {
  audio: 'audio/mpeg',
  video: 'video/mp4',
  image: 'image/jpeg',
  document: 'application/octet-stream',
};

function kindFromMime(mimetype: string | undefined): MediaKind | null {
  if (!mimetype) return null;
  if (mimetype.startsWith('audio/')) return 'audio';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('image/')) return 'image';
  return 'document'; // everything else is sent as a document
}

@Injectable()
export class GroupLeaveService {
  private readonly logger = createLogger('GroupLeaveService');

  constructor(
    @InjectRepository(GroupLeaveRule, 'data')
    private readonly ruleRepo: Repository<GroupLeaveRule>,
    private readonly storageService: StorageService,
    @Inject(forwardRef(() => SessionService))
    private readonly sessionService: SessionService,
  ) {}

  // ===========================================================================
  // CRUD
  // ===========================================================================

  async findAll(): Promise<GroupLeaveRule[]> {
    return this.ruleRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<GroupLeaveRule> {
    const rule = await this.ruleRepo.findOne({ where: { id } });
    if (!rule) {
      throw new NotFoundException(`Group-leave rule with id '${id}' not found`);
    }
    return rule;
  }

  async create(dto: CreateGroupLeaveRuleDto): Promise<GroupLeaveRule> {
    if (!(dto.media?.length ?? 0) && !dto.audioUrl && !dto.audioStorageKey) {
      throw new BadRequestException('Add at least one media item (a URL or an uploaded file)');
    }
    const rule = this.ruleRepo.create({
      sessionId: dto.sessionId,
      event: dto.event ?? 'leave',
      groupId: dto.groupId,
      groupName: dto.groupName || null,
      media: dto.media?.length ? dto.media : null,
      audioUrl: dto.audioUrl || null,
      audioStorageKey: dto.audioStorageKey || null,
      audioMimetype: dto.audioMimetype || null,
      audioFilename: dto.audioFilename || null,
      sendAsVoice: dto.sendAsVoice ?? true,
      delaySeconds: dto.delaySeconds ?? 0,
      enabled: dto.enabled ?? true,
    });
    return this.ruleRepo.save(rule);
  }

  async update(id: string, dto: UpdateGroupLeaveRuleDto): Promise<GroupLeaveRule> {
    const rule = await this.findOne(id);

    if (dto.event !== undefined) rule.event = dto.event;
    if (dto.groupId !== undefined) rule.groupId = dto.groupId;
    if (dto.groupName !== undefined) rule.groupName = dto.groupName;
    if (dto.media !== undefined) rule.media = dto.media.length ? dto.media : null;
    if (dto.audioUrl !== undefined) rule.audioUrl = dto.audioUrl || null;
    if (dto.audioStorageKey !== undefined) rule.audioStorageKey = dto.audioStorageKey || null;
    if (dto.audioMimetype !== undefined) rule.audioMimetype = dto.audioMimetype || null;
    if (dto.audioFilename !== undefined) rule.audioFilename = dto.audioFilename || null;
    if (dto.sendAsVoice !== undefined) rule.sendAsVoice = dto.sendAsVoice;
    if (dto.delaySeconds !== undefined) rule.delaySeconds = dto.delaySeconds;
    if (dto.enabled !== undefined) rule.enabled = dto.enabled;

    if (!(rule.media?.length ?? 0) && !rule.audioUrl && !rule.audioStorageKey) {
      throw new BadRequestException('A rule must have at least one media item');
    }

    return this.ruleRepo.save(rule);
  }

  async delete(id: string): Promise<void> {
    const rule = await this.findOne(id);
    await this.ruleRepo.remove(rule);
  }

  // ===========================================================================
  // Media upload (multipart) — persists via StorageService, returns a key + kind
  // ===========================================================================

  async uploadMedia(file: UploadedMediaFile | undefined): Promise<{
    storageKey: string;
    kind: MediaKind;
    mimetype: string;
    filename: string;
    size: number;
  }> {
    if (!file || !file.buffer?.length) {
      throw new BadRequestException('No file uploaded');
    }
    const kind = kindFromMime(file.mimetype);
    if (!kind) {
      throw new BadRequestException(`Unsupported file type '${file.mimetype}'.`);
    }

    const ext = path.extname(file.originalname || '') || MIME_EXTENSIONS[file.mimetype] || '';
    const storageKey = `group-leave/${crypto.randomUUID()}${ext}`;
    await this.storageService.putFile(storageKey, file.buffer);

    this.logger.log(`Stored group media: ${storageKey} (${kind}, ${file.size} bytes)`);
    return {
      storageKey,
      kind,
      mimetype: file.mimetype,
      filename: file.originalname || `file${ext}`,
      size: file.size,
    };
  }

  // ===========================================================================
  // Trigger — called from SessionService when group_join / group_leave fires
  // ===========================================================================

  async handleGroupEvent(
    sessionId: string,
    groupId: string,
    participantIds: string[],
    event: GroupEvent,
  ): Promise<void> {
    const rules = await this.ruleRepo.find({ where: { sessionId, groupId, event, enabled: true } });
    if (rules.length === 0) {
      this.logger.log(`group_${event} for ${groupId} ignored — no enabled rule for this group`, {
        sessionId,
        groupId,
        event,
      });
      return;
    }

    const engine = this.sessionService.getEngine(sessionId);
    if (!engine) {
      this.logger.warn('Session not connected — cannot send group audio', { sessionId, groupId, event });
      return;
    }

    // Don't message ourselves if the bot is the affected participant.
    const botPhone = engine.getPhoneNumber();
    const recipients = (participantIds ?? []).filter(id => !!id && !(botPhone && id.startsWith(`${botPhone}@`)));
    if (recipients.length === 0) return;

    this.logger.log(`group_${event}: ${recipients.length} recipient(s) for ${groupId}`, {
      sessionId,
      groupId,
      event,
      recipients,
    });

    for (const rule of rules) {
      // Optional per-rule delay before sending (capped; held in-memory).
      const delaySeconds = Math.min(Math.max(rule.delaySeconds ?? 0, 0), MAX_DELAY_SECONDS);
      if (delaySeconds > 0) {
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
      }

      // Re-fetch the engine in case the session reconnected during the delay.
      const sendEngine = this.sessionService.getEngine(sessionId);
      if (!sendEngine) {
        this.logger.warn('Session disconnected before send — skipping', { sessionId, groupId, event, ruleId: rule.id });
        continue;
      }

      let items: Array<{ kind: MediaKind; input: MediaInput }>;
      try {
        items = await this.resolveMediaItems(rule);
      } catch (err) {
        this.logger.error('Failed to load group media', err instanceof Error ? err.message : String(err), {
          ruleId: rule.id,
        });
        continue;
      }
      if (items.length === 0) {
        this.logger.warn('Rule has no usable media — skipping', { ruleId: rule.id });
        continue;
      }

      // Send every item, in order, to every recipient.
      for (const recipient of recipients) {
        for (const { kind, input } of items) {
          try {
            await this.sendItem(sendEngine, kind, recipient, input);
            this.logger.log(`Sent group-${event} ${kind} to ${recipient}`, {
              sessionId,
              groupId,
              event,
              ruleId: rule.id,
            });
          } catch (err) {
            this.logger.error(
              `Failed to send group-${event} ${kind} to ${recipient}`,
              err instanceof Error ? err.message : String(err),
              { sessionId, groupId, event, ruleId: rule.id },
            );
          }
        }
      }

      rule.lastTriggeredAt = new Date();
      await this.ruleRepo.save(rule).catch(() => {
        /* best-effort timestamp update */
      });
    }
  }

  /** Build the ordered media items for a rule (new media[] or the legacy single-audio fallback). */
  private async resolveMediaItems(rule: GroupLeaveRule): Promise<Array<{ kind: MediaKind; input: MediaInput }>> {
    const source: RuleMediaItem[] = rule.media?.length ? rule.media : this.legacyMediaItems(rule);
    const out: Array<{ kind: MediaKind; input: MediaInput }> = [];
    for (const item of source) {
      const input = await this.toMediaInput(item);
      if (input) out.push({ kind: item.kind, input });
    }
    return out;
  }

  private legacyMediaItems(rule: GroupLeaveRule): RuleMediaItem[] {
    if (!rule.audioStorageKey && !rule.audioUrl) return [];
    return [
      {
        kind: 'audio',
        url: rule.audioUrl,
        storageKey: rule.audioStorageKey,
        mimetype: rule.audioMimetype,
        filename: rule.audioFilename,
        asVoice: rule.sendAsVoice,
      },
    ];
  }

  private async toMediaInput(item: RuleMediaItem): Promise<MediaInput | null> {
    let data: Buffer | string;
    if (item.storageKey) {
      data = await this.storageService.getFile(item.storageKey);
    } else if (item.url) {
      data = item.url;
    } else {
      return null;
    }
    return {
      mimetype: item.mimetype || DEFAULT_MIME[item.kind],
      data,
      filename: item.filename || undefined,
      caption: item.caption || undefined,
      asVoice: item.kind === 'audio' ? (item.asVoice ?? true) : undefined,
    };
  }

  private sendItem(
    engine: IWhatsAppEngine,
    kind: MediaKind,
    recipient: string,
    input: MediaInput,
  ): Promise<MessageResult> {
    switch (kind) {
      case 'image':
        return engine.sendImageMessage(recipient, input);
      case 'video':
        return engine.sendVideoMessage(recipient, input);
      case 'document':
        return engine.sendDocumentMessage(recipient, input);
      case 'audio':
      default:
        return engine.sendAudioMessage(recipient, input);
    }
  }
}
