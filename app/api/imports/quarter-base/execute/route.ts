import { executeBase } from "../../../../../lib/server/recon/base-imports";
import { handleRouteError, readJsonBody } from "../../../../../lib/server/recon/errors";
export const runtime = "nodejs";
export async function POST(request: Request) { try { const body=await readJsonBody(request); return Response.json(await executeBase("NEW_QUARTER_BASE",String(body.quarter??""),body as Parameters<typeof executeBase>[2]),{status:201}); } catch(error) { return handleRouteError(error, {}); } }
