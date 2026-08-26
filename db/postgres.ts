import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

type PostgresDb = ReturnType<typeof drizzle>;
type PostgresClient = Client;

export type PostgresHealth = {
  configured: boolean;
  connected: boolean;
  database?: string;
  schema?: "recon" | "missing";
  migration?: "001_foundation" | "pending";
  postgresVersion?: string;
  error?: string;
};

const POSTGRES_CONNECTION_TIMEOUT_MS = 5_000;

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

export function createPostgresClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  return new Client({
    connectionString,
    connectionTimeoutMillis: POSTGRES_CONNECTION_TIMEOUT_MS,
  });
}

// workerd cannot safely reuse pg sockets across requests, so every request
// creates, connects, uses, and closes its own PostgreSQL client.
export async function withPostgresClient<T>(
  callback: (client: PostgresClient) => Promise<T>,
) {
  const client = createPostgresClient();
  await client.connect();

  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

export async function withPostgresDb<T>(
  callback: (db: PostgresDb, client: PostgresClient) => Promise<T>,
) {
  return withPostgresClient((client) => callback(drizzle(client), client));
}

export async function checkPostgresHealth(): Promise<PostgresHealth> {
  if (!isPostgresConfigured()) {
    return {
      configured: false,
      connected: false,
    };
  }

  try {
    return await withPostgresClient(async (client) => {
      const databaseResult = await client.query<{ current_database: string }>(
        "select current_database()",
      );
      const versionResult = await client.query<{ version: string }>(
        "select version()",
      );
      const schemaResult = await client.query<{ exists: boolean }>(
        "select exists (select 1 from information_schema.schemata where schema_name = 'recon')",
      );
      const migrationTableResult = await client.query<{ exists: boolean }>(
        "select exists (select 1 from information_schema.tables where table_schema = 'recon' and table_name = 'schema_migrations')",
      );

      let migration: PostgresHealth["migration"] = "pending";

      if (migrationTableResult.rows[0]?.exists) {
        const migrationResult = await client.query<{ version: string }>(
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
    });
  } catch (error) {
    return {
      configured: true,
      connected: false,
      error: sanitizePostgresError(error),
    };
  }
}
