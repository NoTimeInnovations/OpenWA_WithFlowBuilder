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
import { dateColumnType } from '../../../common/utils/column-types';

/**
 * A rule that plays a goodbye audio to whoever leaves (or is removed from) a
 * watched group. When `group_leave` fires for `groupId` on `sessionId`, the
 * configured audio is sent as a 1:1 message to each participant who left.
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

  /** Audio provided as a public URL (alternative to an uploaded file) */
  @Column({ type: 'varchar', length: 2048, nullable: true })
  audioUrl: string | null;

  /** Storage key for an uploaded audio file (read back via StorageService) */
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
