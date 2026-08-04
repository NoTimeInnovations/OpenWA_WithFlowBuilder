import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `customer_lists` and `campaigns` tables backing the Customer
 * Lists + Campaigns feature. Runs on Postgres (migrationsRun) and on SQLite
 * when DATABASE_SYNCHRONIZE=false. On the default zero-config SQLite setup the
 * schema is created by TypeORM synchronize instead.
 */
export class AddCampaigns1782000000000 implements MigrationInterface {
  name = 'AddCampaigns1782000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    if (isPostgres) {
      await this.upPostgres(queryRunner);
    } else {
      await this.upSqlite(queryRunner);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_campaigns_list_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_campaigns_session_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_campaigns_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_customer_lists_created_at"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "campaigns"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_lists"`);
  }

  // ── SQLite ────────────────────────────────────────────────────────────
  private async upSqlite(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "customer_lists" (` +
        `"id" varchar PRIMARY KEY NOT NULL, ` +
        `"name" varchar(200) NOT NULL, ` +
        `"description" varchar(500), ` +
        `"default_country_code" varchar(8), ` +
        `"source" varchar(50) NOT NULL DEFAULT ('json-upload'), ` +
        `"recipients" text NOT NULL DEFAULT ('[]'), ` +
        `"recipient_count" integer NOT NULL DEFAULT (0), ` +
        `"created_at" datetime NOT NULL DEFAULT (datetime('now')), ` +
        `"updated_at" datetime NOT NULL DEFAULT (datetime('now')), ` +
        `"last_campaign_at" datetime` +
        `)`,
    );
    await queryRunner.query(
      `CREATE TABLE "campaigns" (` +
        `"id" varchar PRIMARY KEY NOT NULL, ` +
        `"list_id" varchar, ` +
        `"list_name" varchar(200) NOT NULL, ` +
        `"session_id" varchar NOT NULL, ` +
        `"session_name" varchar(100), ` +
        `"name" varchar(200) NOT NULL, ` +
        `"message" text NOT NULL, ` +
        `"status" varchar NOT NULL DEFAULT ('draft'), ` +
        `"options" text, ` +
        `"progress" text, ` +
        `"recipients" text, ` +
        `"current_index" integer NOT NULL DEFAULT (0), ` +
        `"created_at" datetime NOT NULL DEFAULT (datetime('now')), ` +
        `"updated_at" datetime NOT NULL DEFAULT (datetime('now')), ` +
        `"started_at" datetime, ` +
        `"completed_at" datetime` +
        `)`,
    );
    await this.createIndexes(queryRunner);
  }

  // ── PostgreSQL ────────────────────────────────────────────────────────
  private async upPostgres(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "customer_lists" (` +
        `"id" varchar PRIMARY KEY NOT NULL, ` +
        `"name" varchar(200) NOT NULL, ` +
        `"description" varchar(500), ` +
        `"default_country_code" varchar(8), ` +
        `"source" varchar(50) NOT NULL DEFAULT 'json-upload', ` +
        `"recipients" jsonb NOT NULL DEFAULT '[]', ` +
        `"recipient_count" integer NOT NULL DEFAULT 0, ` +
        `"created_at" timestamp NOT NULL DEFAULT NOW(), ` +
        `"updated_at" timestamp NOT NULL DEFAULT NOW(), ` +
        `"last_campaign_at" timestamp` +
        `)`,
    );
    await queryRunner.query(
      `CREATE TABLE "campaigns" (` +
        `"id" varchar PRIMARY KEY NOT NULL, ` +
        `"list_id" varchar, ` +
        `"list_name" varchar(200) NOT NULL, ` +
        `"session_id" varchar NOT NULL, ` +
        `"session_name" varchar(100), ` +
        `"name" varchar(200) NOT NULL, ` +
        `"message" jsonb NOT NULL, ` +
        `"status" varchar NOT NULL DEFAULT 'draft', ` +
        `"options" jsonb, ` +
        `"progress" jsonb, ` +
        `"recipients" jsonb, ` +
        `"current_index" integer NOT NULL DEFAULT 0, ` +
        `"created_at" timestamp NOT NULL DEFAULT NOW(), ` +
        `"updated_at" timestamp NOT NULL DEFAULT NOW(), ` +
        `"started_at" timestamp, ` +
        `"completed_at" timestamp` +
        `)`,
    );
    await this.createIndexes(queryRunner);
  }

  private async createIndexes(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX "IDX_campaigns_list_id" ON "campaigns" ("list_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_campaigns_session_id" ON "campaigns" ("session_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_campaigns_status" ON "campaigns" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_customer_lists_created_at" ON "customer_lists" ("created_at")`);
  }
}
