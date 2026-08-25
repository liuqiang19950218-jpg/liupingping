import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

type PostgresDb = ReturnType<typeof drizzle>;

export type PostgresHealth = {
  configured: boolean;
  connected: boolean;
  database?: string;
  schema?: "recon" | "missing";
  migration?: "001_foundation" | "pending";
  postgresVersion?: string;
  error?: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __quarterlyReconPgPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __quarterlyReconPgDb: PostgresDb | undefined;
}

const DEFAULT_POOL_MAX = 5;

export function isPostgresConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function sanitizePostgresError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(
    /(postgres(?:ql)?:\/\/[^:\s/]+:)([^@\s]+)(@)/gi,
    "$1***$3",
  );
}

export function getPostgresPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (!globalThis.__quarterlyReconPgPool) {
    const max = Number(process.env.POSTGRES_POOL_MAX || DEFAULT_POOL_MAX);

    globalThis.__quarterlyReconPgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number.isFinite(max) && max > 0 ? max : DEFAULT_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  return globalThis.__quarterlyReconPgPool;
}

export function getPostgresDb() {
  if (!globalThis.__quarterlyReconPgDb) {
    globalThis.__quarterlyReconPgDb = drizzle(getPostgresPool());
  }

  return globalThis.__quarterlyReconPgDb;
}

export async function closePostgresPool() {
  if (globalThis.__quarterlyReconPgPool) {
    await globalThis.__quarterlyReconPgPool.end();
    globalThis.__quarterlyReconPgPool = undefined;
    globalThis.__quarterlyReconPgDb = undefined;
  }
}

export async function checkPostgresHealth(): Promise<PostgresHealth> {
  if (!isPostgresConfigured()) {
    return {
      configured: false,
      connected: false,
    };
  }

  try {
    const pool = getPostgresPool();
    const databaseResult = await pool.query<{ current_database: string }>(
      "select current_database()",
    );
    const versionResult = await pool.query<{ version: string }>(
      "select version()",
    );
    const schemaResult = await pool.query<{ exists: boolean }>(
      "select exists (select 1 from information_schema.schemata where schema_name = 'recon')",
    );
    const migrationTableResult = await pool.query<{ exists: boolean }>(
      "select exists (select 1 from information_schema.tables where table_schema = 'recon' and table_name = 'schema_migrations')",
    );

    let migration: PostgresHealth["migration"] = "pending";

    if (migrationTableResult.rows[0]?.exists) {
      const migrationResult = await pool.query<{ version: string }>(
        "select version from recon.schema_migrations where version = $1 limit 1",
        ["001_foundation"],
      );
      migration = migrationResult.rowCount ? "001_foundation" : "pending";
    }

    return {
      configured: true,
      connected: true,
      database: databaseResult.rows[0]?.current_database,
      schema: schemaResult.rows[0]?.exists ? "recon" : "missing",
      migration,
      postgresVersion: versionResult.rows[0]?.version,
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      error: sanitizePostgresError(error),
    };
  }
}
