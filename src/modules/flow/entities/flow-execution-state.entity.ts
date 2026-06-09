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
import { Flow } from './flow.entity';
import { DateTransformer } from '../../../common/transformers/date.transformer';
import { jsonColumnType, dateColumnType } from '../../../common/utils/column-types';
import type { FlowRunStatus } from '../dto/flow-graph.types';

/**
 * Per-contact-per-session runtime FSM row. Lets a flow span multiple inbound
 * messages: the contact is "parked" on an input node between replies.
 */
@Entity('flow_execution_states')
@Index(['sessionId', 'chatId'])
@Index(['status'])
@Index(['flowId'])
export class FlowExecutionState {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  flowId: string;

  @ManyToOne(() => Flow, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'flowId' })
  flow: Flow;

  @Column({ type: 'uuid' })
  sessionId: string;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session: Session;

  /** WhatsApp jid of the contact (the inbound message's `from`). */
  @Column({ type: 'varchar', length: 255 })
  chatId: string;

  /** Node the contact is currently parked on (awaiting their next reply). */
  @Column({ type: 'varchar', length: 128, nullable: true })
  currentNodeId: string | null;

  @Column({ type: 'varchar', length: 32, default: 'active' })
  status: FlowRunStatus;

  /** Captured run-scoped values (e.g. { name: 'Abhi' }). */
  @Column({ type: jsonColumnType(), default: '{}' })
  variables: Record<string, unknown>;

  /** Runaway-loop guard (jump/goto). */
  @Column({ type: 'int', default: 0 })
  stepCount: number;

  @Column({ type: dateColumnType(), nullable: true, transformer: DateTransformer })
  lastInteractionAt: Date | null;

  @Column({ type: dateColumnType(), nullable: true, transformer: DateTransformer })
  expiresAt: Date | null;

  @CreateDateColumn()
  startedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
