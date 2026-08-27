import { getQuarter, getReconciliations, isValidQuarterCode } from "../../../../../lib/server/recon/recon";
import { handleRouteError } from "../../../../../lib/server/recon/errors";

export const runtime = "nodejs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

type RouteContext = { params: Promise<{ code: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { code } = await context.params;
  if (!isValidQuarterCode(code)) {
    return Response.json({ error: "无效的季度代码" }, { status: 400, headers: corsHeaders });
  }
  try {
    const quarter = await getQuarter(code);
    if (!quarter) {
      return Response.json({ error: "季度不存在" }, { status: 404, headers: corsHeaders });
    }
    const reconciliations = await getReconciliations(code);
    return Response.json({ quarter, reconciliations }, { headers: corsHeaders });
  } catch (error) {
    // handleRouteError surfaces typed ApiErrors (e.g. SCHEMA_004_REQUIRED) with
    // their code + message; unknown errors become a generic sanitized 500.
    return handleRouteError(error, corsHeaders);
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
