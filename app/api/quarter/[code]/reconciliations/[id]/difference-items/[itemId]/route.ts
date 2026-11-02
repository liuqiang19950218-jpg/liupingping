import {
  isValidQuarterCode,
  isValidUuid,
} from "../../../../../../../../lib/server/recon/recon";
import {
  updateDifferenceItem,
  deleteDifferenceItem,
} from "../../../../../../../../lib/server/recon/write";
import { handleRouteError, readJsonBody } from "../../../../../../../../lib/server/recon/errors";

export const runtime = "nodejs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type",
};

type RouteContext = { params: Promise<{ code: string; id: string; itemId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { code, id, itemId } = await context.params;
  if (!isValidQuarterCode(code) || !isValidUuid(id) || !isValidUuid(itemId)) {
    return Response.json(
      { error: "无效的季度、对账记录或差额明细标识", code: "INVALID_INPUT" },
      { status: 400, headers: corsHeaders },
    );
  }
  try {
    const body = await readJsonBody(request);
    const item = await updateDifferenceItem(code, id, itemId, body);
    return Response.json({ quarter: code, reconciliationId: id, item }, { headers: corsHeaders });
  } catch (error) {
    return handleRouteError(error, corsHeaders);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { code, id, itemId } = await context.params;
  if (!isValidQuarterCode(code) || !isValidUuid(id) || !isValidUuid(itemId)) {
    return Response.json(
      { error: "无效的季度、对账记录或差额明细标识", code: "INVALID_INPUT" },
      { status: 400, headers: corsHeaders },
    );
  }
  try {
    const result = await deleteDifferenceItem(code, id, itemId);
    return Response.json(result, { headers: corsHeaders });
  } catch (error) {
    return handleRouteError(error, corsHeaders);
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
