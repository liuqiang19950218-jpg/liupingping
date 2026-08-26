import { listQuarters } from "../../../lib/server/recon/recon";
import { sanitizePostgresError } from "../../../db/postgres";

export const runtime = "nodejs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export async function GET() {
  try {
    const quarters = await listQuarters();
    return Response.json({ quarters }, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { error: sanitizePostgresError(error) },
      { status: 500, headers: corsHeaders },
    );
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
