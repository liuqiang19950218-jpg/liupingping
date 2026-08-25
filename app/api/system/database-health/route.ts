import { checkPostgresHealth } from "../../../../db/postgres";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = await checkPostgresHealth();
  const status = health.configured && !health.connected ? 503 : 200;

  return Response.json(health, { status });
}
