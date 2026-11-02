import { sanitizePostgresError } from "../../../db/postgres";
import { listHistoricalSettlementSnapshots } from "../../../lib/server/recon/historical-settlement-snapshots";

export const runtime = "nodejs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

// Intentionally read-only: historical snapshots are sealed management facts.
export async function GET() {
  try {
    return Response.json(await listHistoricalSettlementSnapshots(), { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: sanitizePostgresError(error) }, { status: 500, headers: corsHeaders });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
