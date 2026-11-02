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
export async function POST(_request: Request, _context: RouteContext) {
  return Response.json(
    { error: "旧季度基础导入入口已停用，请使用数据导入中心的‘导入新季度基础对账表’。", code: "IMPORT_ENDPOINT_DEPRECATED" },
    { status: 410, headers: corsHeaders },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
