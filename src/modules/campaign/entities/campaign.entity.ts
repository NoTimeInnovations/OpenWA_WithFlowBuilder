import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { DateTransformer } from '../../../common/transformers/date.transformer';
import { jsonColumnType, dateColumnType } from '../../../common/utils/column-types';

/** Lifecycle of a single send run. */
export enum CampaignStatus {
  DRAFT = 'draft',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  FAILED = 'failed',
}

/** Per-recipient delivery state within a run. */
export enum RecipientStatus {
  PENDING = 'pending',
  SENT = 'sent', // accepted by the WhatsApp server (reliable)
  DELIVERED = 'delivered', // reached the recipient device (best-effort, via ack)
  READ = 'read', // opened by the recipient (best-effort, via ack)
  FAILED = 'failed',
  SKIPPED = 'skipped', // deduped or already-sent in a previous run
}

export interface CampaignRecipient {
  name: string;
  phone: string;
  jid: string;
  status: RecipientStatus;
  messageId?: string;
  error?: string;
  /** ISO timestamps (stored inside JSON, so kept as strings for portability). */
  sentAt?: string | null;
  deliveredAt?: string | null;
  readAt?: string | null;
}

export interface CampaignMedia {
  kind: 'image' | 'video' | 'document' | 'audio';
  url?: string;
  base64?: string;
  mimetype?: string;
  filename?: string;
  caption?: string;
}

export interface CampaignMessage {
  /** Text template; supports `{name}` and `{phone}` placeholders. */
  text: string;
  media?: CampaignMedia | null;
}

export interface CampaignOptions {
  /** Base pause between consecutive sends, in ms. */
  delayBetweenMessages: number;
  /** Add a random 0..randomizeExtraMs on top of the base delay. */
  randomizeDelay: boolean;
  randomizeExtraMs: number;
  /** Abort the run on the first send failure. */
  stopOnError: boolean;
  /** Skip recipients already sent/delivered/read in a previous run of this list. */
  skipAlreadySent: boolean;
}

export interface CampaignProgress {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  pending: number;
  skipped: number;
  cancelled: number;
}

/**
 * A single send run against a {@link CustomerList}. Recipients + per-recipient
 * status are stored inline as JSON (mirrors MessageBatch) so a run is a single
 * self-contained, re-viewable record with its own date/time.
 */
@Entity('campaigns')
export class Campaign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Source list id. Nullable + name snapshot so runs survive list deletion. */
  @Column({ name: 'list_id', type: 'varchar', nullable: true })
  listId: string | null;

  @Column({ name: 'list_name', type: 'varchar', length: 200 })
  listName: string;

  @Column({ name: 'session_id', type: 'varchar' })
  sessionId: string;

  @Column({ name: 'session_name', type: 'varchar', length: 100, nullable: true })
  sessionName: string | null;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: jsonColumnType() })
  message: CampaignMessage;

  @Column({ type: 'varchar', default: CampaignStatus.DRAFT })
  status: CampaignStatus;

  @Column({ type: jsonColumnType(), nullable: true })
  options: CampaignOptions;

  @Column({ type: jsonColumnType(), nullable: true })
  progress: CampaignProgress;

  @Column({ type: jsonColumnType(), nullable: true })
  recipients: CampaignRecipient[];

  @Column({ name: 'current_index', type: 'int', default: 0 })
  currentIndex: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'started_at', type: dateColumnType(), nullable: true, transformer: DateTransformer })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: dateColumnType(), nullable: true, transformer: DateTransformer })
  completedAt: Date | null;
}
