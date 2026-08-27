import { importQuarter } from "../../../../../lib/server/recon/import";
import { handleRouteError, readJsonBody } from "../../../../../lib/server/recon/errors";

export const runtime = "nodejs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

type RouteContext = { params: Promise<{ code: string }> };

// POST /api/quarter/[code]/import
// Body: { sourceFileName, headers, rows } — structured source rows parsed by the
// browser XLSX flow. The server re-validates critical fields and writes the whole
// quarter atomically (quarter, regions, account_sets, customers, import_batches,
// reconciliations, provenance) in ONE transaction.
export async function POST(request: Request, context: RouteContext) {
  const { code } = await context.params;
  try {
    const body = await readJsonBody(request);
    const sourceFileName =
      typeof body.sourceFileName === "string" ? body.sourceFileName : "";
    const headers = Array.isArray(body.headers)
      ? body.headers.map((h) => String(h))
      : [];
    const rows = Array.isArray(body.rows) ? (body.rows as unknown[][]) : [];
    const result = await importQuarter(code, { sourceFileName, headers, rows });
    return Response.json(result, { status: 201, headers: corsHeaders });
  } catch (error) {
    return handleRouteError(error, corsHeaders);
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
