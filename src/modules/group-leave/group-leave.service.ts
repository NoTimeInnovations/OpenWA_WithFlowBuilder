import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import * as path from 'path';
import { GroupLeaveRule } from './entities/group-leave-rule.entity';
import { CreateGroupLeaveRuleDto, UpdateGroupLeaveRuleDto } from './dto';
import { SessionService } from '../session/session.service';
import { StorageService } from '../../common/storage/storage.service';
import { MediaInput } from '../../engine/interfaces/whatsapp-engine.interface';
import { createLogger } from '../../common/services/logger.service';

/** Shape of a multer in-memory upload (avoids a hard dependency on @types/multer). */
export interface UploadedAudioFile {
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
};

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
    if (!dto.audioUrl && !dto.audioStorageKey) {
      throw new BadRequestException('Provide an audio URL or upload an audio file');
    }
    const rule = this.ruleRepo.create({
      sessionId: dto.sessionId,
      groupId: dto.groupId,
      groupName: dto.groupName || null,
      audioUrl: dto.audioUrl || null,
      audioStorageKey: dto.audioStorageKey || null,
      audioMimetype: dto.audioMimetype || null,
      audioFilename: dto.audioFilename || null,
      sendAsVoice: dto.sendAsVoice ?? true,
      enabled: dto.enabled ?? true,
    });
    return this.ruleRepo.save(rule);
  }

  async update(id: string, dto: UpdateGroupLeaveRuleDto): Promise<GroupLeaveRule> {
    const rule = await this.findOne(id);

    if (dto.groupId !== undefined) rule.groupId = dto.groupId;
    if (dto.groupName !== undefined) rule.groupName = dto.groupName;
    if (dto.audioUrl !== undefined) rule.audioUrl = dto.audioUrl || null;
    if (dto.audioStorageKey !== undefined) rule.audioStorageKey = dto.audioStorageKey || null;
    if (dto.audioMimetype !== undefined) rule.audioMimetype = dto.audioMimetype || null;
    if (dto.audioFilename !== undefined) rule.audioFilename = dto.audioFilename || null;
    if (dto.sendAsVoice !== undefined) rule.sendAsVoice = dto.sendAsVoice;
    if (dto.enabled !== undefined) rule.enabled = dto.enabled;

    if (!rule.audioUrl && !rule.audioStorageKey) {
      throw new BadRequestException('A rule must have an audio URL or an uploaded audio file');
    }

    return this.ruleRepo.save(rule);
  }

  async delete(id: string): Promise<void> {
    const rule = await this.findOne(id);
    await this.ruleRepo.remove(rule);
  }

  // ===========================================================================
  // Audio upload (multipart) — persists via StorageService, returns a key
  // ===========================================================================

  async uploadAudio(file: UploadedAudioFile | undefined): Promise<{
    storageKey: string;
    mimetype: string;
    filename: string;
    size: number;
  }> {
    if (!file || !file.buffer?.length) {
      throw new BadRequestException('No audio file uploaded');
    }
    if (!file.mimetype?.startsWith('audio/')) {
      throw new BadRequestException(`Unsupported file type '${file.mimetype}'. Please upload an audio file.`);
    }

    const ext = path.extname(file.originalname || '') || MIME_EXTENSIONS[file.mimetype] || '';
    const storageKey = `group-leave/${crypto.randomUUID()}${ext}`;
    await this.storageService.putFile(storageKey, file.buffer);

    this.logger.log(`Stored group-leave audio: ${storageKey} (${file.size} bytes)`);
    return {
      storageKey,
      mimetype: file.mimetype,
      filename: file.originalname || `audio${ext}`,
      size: file.size,
    };
  }

  // ===========================================================================
  // Trigger — called from SessionService when group_leave fires
  // ===========================================================================

  async handleGroupLeave(sessionId: string, groupId: string, leaverIds: string[]): Promise<void> {
    const rules = await this.ruleRepo.find({ where: { sessionId, groupId, enabled: true } });
    if (rules.length === 0) return;

    const engine = this.sessionService.getEngine(sessionId);
    if (!engine) {
      this.logger.warn('Session not connected — cannot send group-leave audio', { sessionId, groupId });
      return;
    }

    // Don't message ourselves if the bot is the one that was removed.
    const botPhone = engine.getPhoneNumber();
    const recipients = (leaverIds ?? []).filter(id => !!id && !(botPhone && id.startsWith(`${botPhone}@`)));
    if (recipients.length === 0) return;

    for (const rule of rules) {
      let media: MediaInput;
      try {
        media = await this.buildMedia(rule);
      } catch (err) {
        this.logger.error('Failed to load group-leave audio', err instanceof Error ? err.message : String(err), {
          ruleId: rule.id,
        });
        continue;
      }

      for (const recipient of recipients) {
        try {
          await engine.sendAudioMessage(recipient, media);
          this.logger.log(`Sent group-leave audio to ${recipient}`, { sessionId, groupId, ruleId: rule.id });
        } catch (err) {
          this.logger.error(
            `Failed to send group-leave audio to ${recipient}`,
            err instanceof Error ? err.message : String(err),
            { sessionId, groupId, ruleId: rule.id },
          );
        }
      }

      rule.lastTriggeredAt = new Date();
      await this.ruleRepo.save(rule).catch(() => {
        /* best-effort timestamp update */
      });
    }
  }

  private async buildMedia(rule: GroupLeaveRule): Promise<MediaInput> {
    const asVoice = rule.sendAsVoice;
    if (rule.audioStorageKey) {
      const data = await this.storageService.getFile(rule.audioStorageKey);
      return {
        mimetype: rule.audioMimetype || 'audio/mpeg',
        data,
        filename: rule.audioFilename || undefined,
        asVoice,
      };
    }
    if (rule.audioUrl) {
      return { mimetype: rule.audioMimetype || 'audio/mpeg', data: rule.audioUrl, asVoice };
    }
    throw new Error('Rule has no audio configured');
  }
}
