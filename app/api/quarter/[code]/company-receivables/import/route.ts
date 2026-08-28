import { importQuarterCompanyReceivables } from "../../../../../../lib/server/recon/receivables-import";
import { handleRouteError, readJsonBody, invalidInput } from "../../../../../../lib/server/recon/errors";

export const runtime = "nodejs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

type RouteContext = { params: Promise<{ code: string }> };

// POST /api/quarter/[code]/company-receivables/import
// Body: { sourceFileName, headers, rows } — structured rows parsed by the
// browser XLSX flow. Server-scoped quarter resolution.
// Only company_receivable (+ server-derived reconciliation_difference) may
// change. Ambiguous keys are reported, never guessed.
export async function POST(request: Request, context: RouteContext) {
  const { code } = await context.params;
  try {
    const body = await readJsonBody(request);
    const sourceFileName = typeof body.sourceFileName === "string" ? body.sourceFileName : "";
    const headers = Array.isArray(body.headers) ? body.headers.map((h) => String(h)) : [];
    const rows = Array.isArray(body.rows) ? (body.rows as unknown[][]) : [];
    if (!headers.length || !rows.length) {
      throw invalidInput("请求体必须包含非空 headers 和 rows");
    }
    const result = await importQuarterCompanyReceivables(code, { sourceFileName, headers, rows });
    return Response.json(result, { status: 201, headers: corsHeaders });
  } catch (error) {
    return handleRouteError(error, corsHeaders);
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
