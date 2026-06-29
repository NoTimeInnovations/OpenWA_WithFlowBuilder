import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Session } from '../../session/entities/session.entity';
import { DateTransformer } from '../../../common/transformers/date.transformer';
import { dateColumnType, jsonColumnType } from '../../../common/utils/column-types';

export type MediaKind = 'audio' | 'video' | 'image' | 'document' | 'text';

/** One item a rule sends: a text message, or media provided as a URL / uploaded file. */
export interface RuleMediaItem {
  kind: MediaKind;
  text?: string | null; // kind === 'text'
  url?: string | null;
  storageKey?: string | null;
  mimetype?: string | null;
  filename?: string | null;
  caption?: string | null; // image/video/document
  asVoice?: boolean; // audio → send as voice note (PTT)
}

/**
 * A rule that sends one or more media files to whoever joins or leaves a
 * watched group. When the configured `event` fires for `groupId` on
 * `sessionId`, each item in `media` is sent as a 1:1 message (after `delaySeconds`).
 */
@Entity('group_leave_rules')
@Index(['sessionId', 'groupId'])
export class GroupLeaveRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  sessionId: string;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session: Session;

  /** Which participant event triggers this rule */
  @Column({ type: 'varchar', length: 16, default: 'leave' })
  event: 'join' | 'leave';

  /** Watched group chat id, e.g. "123456789@g.us" */
  @Column({ type: 'varchar', length: 255 })
  groupId: string;

  /** Cached group display name (for the dashboard list) */
  @Column({ type: 'varchar', length: 512, nullable: true })
  groupName: string | null;

  /** Ordered media items to send (the source of truth; legacy audio* fields below are a fallback) */
  @Column({ type: jsonColumnType(), nullable: true })
  media: RuleMediaItem[] | null;

  /** @deprecated Legacy single-audio fields, kept for rules created before multi-media */
  @Column({ type: 'varchar', length: 2048, nullable: true })
  audioUrl: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  audioStorageKey: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  audioMimetype: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  audioFilename: string | null;

  /** Send the audio as a WhatsApp voice note (PTT) rather than an audio file */
  @Column({ type: 'boolean', default: true })
  sendAsVoice: boolean;

  /** Seconds to wait after the event before sending the audio (0 = immediate) */
  @Column({ type: 'int', default: 0 })
  delaySeconds: number;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: dateColumnType(), nullable: true, transformer: DateTransformer })
  lastTriggeredAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
