import {
  getMaterialStatusByReconciliation,
  isValidQuarterCode,
  isValidUuid,
} from "../../../../../../../lib/server/recon/recon";
import { upsertReconciliationMaterial } from "../../../../../../../lib/server/recon/write";
import { handleRouteError, readJsonBody } from "../../../../../../../lib/server/recon/errors";

export const runtime = "nodejs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
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
      { error: "服务器内部错误", code: "INTERNAL" },
      { status: 500, headers: corsHeaders },
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { code, id } = await context.params;
  if (!isValidQuarterCode(code) || !isValidUuid(id)) {
    return Response.json(
      { error: "无效的季度或对账记录标识", code: "INVALID_INPUT" },
      { status: 400, headers: corsHeaders },
    );
  }
  try {
    const body = await readJsonBody(request);
    const material = await upsertReconciliationMaterial(code, id, body);
    return Response.json({ quarter: code, reconciliationId: id, material }, { status: 201, headers: corsHeaders });
  } catch (error) {
    return handleRouteError(error, corsHeaders);
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
