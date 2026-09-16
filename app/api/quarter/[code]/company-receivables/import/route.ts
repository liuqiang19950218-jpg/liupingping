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
export async function POST(_request: Request, _context: RouteContext) {
  return Response.json(
    { error: "旧公司应收导入入口已停用，请使用数据导入中心的‘公司应收增量更新’。", code: "IMPORT_ENDPOINT_DEPRECATED" },
    { status: 410, headers: corsHeaders },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
