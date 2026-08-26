import { getMaterialStatusByReconciliation, isValidQuarterCode, isValidUuid } from "../../../../../../../lib/server/recon/recon";
import { sanitizePostgresError } from "../../../../../../../db/postgres";

export const runtime = "nodejs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

type RouteContext = { params: Promise<{ code: string; id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { code, id } = await context.params;
  if (!isValidQuarterCode(code) || !isValidUuid(id)) {
    return Response.json({ error: "无效的季度或对账记录标识" }, { status: 400, headers: corsHeaders });
  }
  try {
    const items = await getMaterialStatusByReconciliation(id);
    return Response.json({ quarter: code, reconciliationId: id, material: items }, { headers: corsHeaders });
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
