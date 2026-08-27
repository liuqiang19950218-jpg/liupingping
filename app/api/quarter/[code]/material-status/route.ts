import {
  getMaterialStatusByQuarter,
  isValidQuarterCode,
} from "../../../../../lib/server/recon/recon";
import { upsertQuarterMaterial } from "../../../../../lib/server/recon/write";
import { handleRouteError, readJsonBody } from "../../../../../lib/server/recon/errors";

export const runtime = "nodejs";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type",
};

type RouteContext = { params: Promise<{ code: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { code } = await context.params;
  if (!isValidQuarterCode(code)) {
    return Response.json({ error: "无效的季度代码" }, { status: 400, headers: corsHeaders });
  }
  try {
    const items = await getMaterialStatusByQuarter(code);
    return Response.json({ quarter: code, count: items.length, material: items }, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { error: "服务器内部错误", code: "INTERNAL" },
      { status: 500, headers: corsHeaders },
    );
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const { code } = await context.params;
  if (!isValidQuarterCode(code)) {
    return Response.json(
      { error: "无效的季度代码", code: "INVALID_INPUT" },
      { status: 400, headers: corsHeaders },
    );
  }
  try {
    const body = await readJsonBody(request);
    const material = await upsertQuarterMaterial(code, body);
    return Response.json({ quarter: code, material }, { headers: corsHeaders });
  } catch (error) {
    return handleRouteError(error, corsHeaders);
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
