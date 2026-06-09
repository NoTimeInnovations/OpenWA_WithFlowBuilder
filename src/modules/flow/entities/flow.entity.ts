import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { jsonColumnType } from '../../../common/utils/column-types';
import type { FlowGraph, FlowScope, TriggerDef } from '../dto/flow-graph.types';

@Entity('flows')
export class Flow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  description: string | null;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  /** { type: 'session' | 'sessions' | 'all', sessionIds?: string[] } */
  @Column({ type: jsonColumnType(), default: '{"type":"all"}' })
  scope: FlowScope;

  /** The full @xyflow/react document: { nodes, edges, viewport? }. */
  @Column({ type: jsonColumnType(), default: '{"nodes":[],"edges":[]}' })
  graph: FlowGraph;

  /** Denormalized trigger defs extracted from the trigger node on save (fast inbound matching). */
  @Column({ type: jsonColumnType(), default: '[]' })
  triggers: TriggerDef[];

  /** Global keyword that aborts an active run for this flow (e.g. 'stop'). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  escapeKeyword: string | null;

  /** Parked-run auto-abort window in hours. */
  @Column({ type: 'int', default: 24 })
  runTtlHours: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
