import { previewReceivable } from "../../../../../lib/server/recon/base-imports";
import { handleRouteError, readJsonBody } from "../../../../../lib/server/recon/errors";
export const runtime = "nodejs";
export async function POST(request: Request) { try { const body=await readJsonBody(request); return Response.json(await previewReceivable(String(body.quarter??""),body as Parameters<typeof previewReceivable>[1])); } catch(error) { return handleRouteError(error, {}); } }
