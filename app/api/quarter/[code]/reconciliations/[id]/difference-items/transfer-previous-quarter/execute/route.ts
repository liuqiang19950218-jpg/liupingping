import { isValidQuarterCode, isValidUuid } from "../../../../../../../../../lib/server/recon/recon";
import { handleRouteError, readJsonBody } from "../../../../../../../../../lib/server/recon/errors";
import { executePreviousQuarterTransfer } from "../../../../../../../../../lib/server/recon/previous-quarter-transfer";

export const runtime = "nodejs";
type Context = { params: Promise<{ code: string; id: string }> };
const headers = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" };
export async function POST(request: Request, context: Context) {
  const { code, id } = await context.params;
  if (!isValidQuarterCode(code) || !isValidUuid(id)) return Response.json({ error: "无效的季度或对账记录标识", code: "INVALID_INPUT" }, { status: 400, headers });
  try { return Response.json(await executePreviousQuarterTransfer(code, id, await readJsonBody(request)), { headers }); }
  catch (error) { return handleRouteError(error, headers); }
}
export function OPTIONS() { return new Response(null, { status: 204, headers }); }
