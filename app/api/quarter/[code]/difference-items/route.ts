import {
  getQuarter,
  getDifferenceItemsByQuarter,
  isValidQuarterCode,
} from "../../../../../lib/server/recon/recon";
import { handleRouteError, notFound } from "../../../../../lib/server/recon/errors";

export const runtime = "nodejs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

type RouteContext = { params: Promise<{ code: string }> };

// GET /api/quarter/[code]/difference-items
// Quarter-scoped bulk read of difference_items for Dashboard aggregate charts.
// Server-side scope is enforced in SQL (difference_items JOIN reconciliations
// JOIN quarters WHERE quarters.code = $1) — the frontend never filters the full
// table. Each item carries reconciliationId for Map-join with the shared
// reconciliation dataset; amounts are NUMERIC-as-string; NULL stays NULL.
export async function GET(_request: Request, context: RouteContext) {
  const { code } = await context.params;
  if (!isValidQuarterCode(code)) {
    return Response.json(
      { error: "无效的季度代码", code: "INVALID_INPUT" },
      { status: 400, headers: corsHeaders },
    );
  }
  try {
    const quarter = await getQuarter(code);
    if (!quarter) {
      throw notFound(`季度 ${code} 不存在`);
    }
    const items = await getDifferenceItemsByQuarter(code);
    return Response.json({ quarter: code, count: items.length, items }, { headers: corsHeaders });
  } catch (error) {
    return handleRouteError(error, corsHeaders);
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
