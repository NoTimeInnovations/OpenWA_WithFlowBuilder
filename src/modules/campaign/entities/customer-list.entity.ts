import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { DateTransformer } from '../../../common/transformers/date.transformer';
import { jsonColumnType, dateColumnType } from '../../../common/utils/column-types';

/** A single saved customer within a list. Deduplicated by `jid` at import time. */
export interface CustomerListRecipient {
  /** Display name (falls back to the phone digits when the upload omits a name). */
  name: string;
  /** Bare international digits, e.g. `9198470xxxxx`. */
  phone: string;
  /** WhatsApp chat id `<digits>@c.us`. */
  jid: string;
  /** Original phone string as uploaded (for auditing / re-export). */
  raw?: string;
}

/**
 * A persisted, named, dated segment of customers uploaded as JSON. Reusable:
 * the same list can be sent to over and over, each send captured as a separate
 * {@link Campaign} run.
 */
@Entity('customer_lists')
export class CustomerList {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  /** Digits-only country code used to normalize local numbers at import (e.g. `91`). */
  @Column({ name: 'default_country_code', type: 'varchar', length: 8, nullable: true })
  defaultCountryCode: string | null;

  @Column({ type: 'varchar', length: 50, default: 'json-upload' })
  source: string;

  @Column({ type: jsonColumnType(), default: '[]' })
  recipients: CustomerListRecipient[];

  /** Denormalized count so list views don't need to load the full recipients array. */
  @Column({ name: 'recipient_count', type: 'int', default: 0 })
  recipientCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  /** When this list was last used in a campaign — powers the "last sent" column. */
  @Column({ name: 'last_campaign_at', type: dateColumnType(), nullable: true, transformer: DateTransformer })
  lastCampaignAt: Date | null;
}
