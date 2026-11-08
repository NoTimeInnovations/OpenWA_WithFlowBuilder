import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Persisted Baileys message store (the lib ships none). Holds the serialized WAMessage proto
 * (via BufferJSON) so reply/forward/react/delete can resolve the original message/key by id across
 * restarts. Engine-specific — lives in the engine layer, not the neutral `messages` table.
 *
 * Fork note: upstream declared a CASCADE FK `sessionId -> sessions.id`, but the engine is keyed by the
 * session NAME (SessionService passes `session.name` as the engine sessionId), so every write would
 * violate that FK on SQLite and be dropped. Here `sessionId` is the plain session name (no FK); rows are
 * cleared on logout. `remoteJid` (engine dialect) is stored too so the live chat-history endpoint can
 * read a chat's recent messages on this engine.
 */
@Entity('baileys_stored_messages')
@Index(['sessionId', 'waMessageId'], { unique: true }) // lookup + dedup (send-return vs upsert echo)
@Index(['sessionId', 'createdAt']) // eviction ordering
@Index(['sessionId', 'remoteJid']) // per-chat history
export class BaileysStoredMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  sessionId: string;

  @Column()
  waMessageId: string;

  @Column({ type: 'varchar', nullable: true })
  remoteJid: string | null;

  @Column({ type: 'text' })
  serializedMessage: string;

  @CreateDateColumn()
  createdAt: Date;
}
