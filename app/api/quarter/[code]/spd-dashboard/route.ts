import {
  getQuarter,
  getSpdDashboardByQuarter,
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

// GET /api/quarter/[code]/spd-dashboard
// Independent quarterly SPD dashboard dataset (SPD SOURCE B). This is the
// separately-uploaded SPD 专项 Excel stored in recon.spd_dashboard_rows — it is
// NOT recon.material_status (SPD SOURCE A). The two are never merged/synced.
//
// Row semantics (business-confirmed):
//   - Every source row is preserved, including empty-status rows (they count in total).
//   - "是" and "否" both count as submitted; only blank/NULL counts as unsubmitted.
//   - Raw 账套/区域/客户名称 are returned as source truth; reconciliationId may be null.
//   - source_payload / remark are NOT exposed to the frontend.
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
    const data = await getSpdDashboardByQuarter(code);
    return Response.json(data, { headers: corsHeaders });
  } catch (error) {
    return handleRouteError(error, corsHeaders);
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
