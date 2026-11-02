import {
  isValidQuarterCode,
  isValidUuid,
} from "../../../../../../../../lib/server/recon/recon";
import {
  updateReconciliationMaterial,
  deleteReconciliationMaterial,
} from "../../../../../../../../lib/server/recon/write";
import { handleRouteError, readJsonBody } from "../../../../../../../../lib/server/recon/errors";

export const runtime = "nodejs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type",
};

type RouteContext = { params: Promise<{ code: string; id: string; materialId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { code, id, materialId } = await context.params;
  if (!isValidQuarterCode(code) || !isValidUuid(id) || !isValidUuid(materialId)) {
    return Response.json(
      { error: "无效的季度、对账记录或资料状态标识", code: "INVALID_INPUT" },
      { status: 400, headers: corsHeaders },
    );
  }
  try {
    const body = await readJsonBody(request);
    const material = await updateReconciliationMaterial(code, id, materialId, body);
    return Response.json({ quarter: code, reconciliationId: id, material }, { headers: corsHeaders });
  } catch (error) {
    return handleRouteError(error, corsHeaders);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { code, id, materialId } = await context.params;
  if (!isValidQuarterCode(code) || !isValidUuid(id) || !isValidUuid(materialId)) {
    return Response.json(
      { error: "无效的季度、对账记录或资料状态标识", code: "INVALID_INPUT" },
      { status: 400, headers: corsHeaders },
    );
  }
  try {
    const result = await deleteReconciliationMaterial(code, id, materialId);
    return Response.json(result, { headers: corsHeaders });
  } catch (error) {
    return handleRouteError(error, corsHeaders);
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
