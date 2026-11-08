import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the two tables the Baileys engine (ENGINE_TYPE=baileys) uses on the `data` connection:
 *  - `baileys_stored_messages`: the persisted Baileys message store (reply/forward/react/delete by id,
 *    and the live chat-history endpoint). Keyed by session NAME, so — unlike upstream — there is no FK
 *    to `sessions.id`.
 *  - `lid_mappings`: the cross-session `lid -> phone` resolution cache.
 *
 * Runs on Postgres (migrationsRun) and on SQLite when DATABASE_SYNCHRONIZE=false. On the default SQLite
 * setup the schema is created by TypeORM synchronize; the hasTable guards keep this idempotent there.
 */
export class AddBaileysEngineTables1783000000000 implements MigrationInterface {
  name = 'AddBaileysEngineTables1783000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    const ts = isPostgres ? 'timestamp NOT NULL DEFAULT NOW()' : "datetime NOT NULL DEFAULT (datetime('now'))";

    if (!(await queryRunner.hasTable('baileys_stored_messages'))) {
      const idCol = isPostgres
        ? '"id" varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar'
        : '"id" varchar PRIMARY KEY NOT NULL';
      await queryRunner.query(
        `CREATE TABLE "baileys_stored_messages" (${idCol}, "sessionId" varchar NOT NULL, ` +
          `"waMessageId" varchar NOT NULL, "remoteJid" varchar, "serializedMessage" text NOT NULL, ` +
          `"createdAt" ${ts})`,
      );
      await queryRunner.query(
        `CREATE UNIQUE INDEX "UQ_baileys_stored_messages_session_wamsg" ON "baileys_stored_messages" ("sessionId", "waMessageId")`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_baileys_stored_messages_session_created" ON "baileys_stored_messages" ("sessionId", "createdAt")`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_baileys_stored_messages_session_jid" ON "baileys_stored_messages" ("sessionId", "remoteJid")`,
      );
    }

    if (!(await queryRunner.hasTable('lid_mappings'))) {
      await queryRunner.query(
        `CREATE TABLE "lid_mappings" ("lid" varchar PRIMARY KEY NOT NULL, "phone" varchar, "sessionId" varchar, "updatedAt" ${ts})`,
      );
      await queryRunner.query(`CREATE INDEX "IDX_lid_mappings_phone" ON "lid_mappings" ("phone")`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_lid_mappings_phone"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lid_mappings"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_baileys_stored_messages_session_jid"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_baileys_stored_messages_session_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_baileys_stored_messages_session_wamsg"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "baileys_stored_messages"`);
  }
}
