import {
  isValidQuarterCode,
  isValidUuid,
} from "../../../../../../lib/server/recon/recon";
import { deleteQuarterMaterial } from "../../../../../../lib/server/recon/write";
import { handleRouteError } from "../../../../../../lib/server/recon/errors";

export const runtime = "nodejs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type",
};

type RouteContext = { params: Promise<{ code: string; materialId: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
  const { code, materialId } = await context.params;
  if (!isValidQuarterCode(code) || !isValidUuid(materialId)) {
    return Response.json(
      { error: "无效的季度或资料状态标识", code: "INVALID_INPUT" },
      { status: 400, headers: corsHeaders },
    );
  }
  try {
    const result = await deleteQuarterMaterial(code, materialId);
    return Response.json(result, { headers: corsHeaders });
  } catch (error) {
    return handleRouteError(error, corsHeaders);
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
