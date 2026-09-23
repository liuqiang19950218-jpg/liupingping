import { env } from "cloudflare:workers";
import { isValidQuarterCode } from "../../../../../lib/server/recon/recon";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ code: string }> };

function archiveService() {
  const url = env.ATTACHMENT_SERVICE_URL;
  const token = env.ATTACHMENT_SERVICE_TOKEN;
  if (typeof url !== "string" || !url || typeof token !== "string" || !token) throw new Error("季度归档服务暂不可用，请联系管理员配置。");
  const target = new URL(url);
  if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("季度归档服务地址无效。");
  return { target, token };
}

async function proxy(quarter: string, download: boolean) {
  const service = archiveService();
  const target = new URL("/internal/quarter-archives", service.target);
  target.searchParams.set("quarter", quarter);
  if (download) target.searchParams.set("download", "1");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), download ? 130_000 : 20_000);
  try {
    return await fetch(target, { headers: { authorization: `Bearer ${service.token}` }, signal: controller.signal });
  } finally { clearTimeout(timeout); }
}

async function errorResponse(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: unknown };
  return Response.json({ error: typeof body.error === "string" ? body.error : "季度归档生成失败，请稍后重试。" }, { status: response.status });
}

export async function GET(request: Request, context: RouteContext) {
  const { code } = await context.params;
  if (!isValidQuarterCode(code)) return Response.json({ error: "无效的季度代码。" }, { status: 400 });
  const download = new URL(request.url).searchParams.get("download") === "1";
  try {
    const response = await proxy(code, download);
    if (!response.ok) return errorResponse(response);
    if (!download) return Response.json(await response.json(), { headers: { "cache-control": "no-store" } });
    const headers = new Headers({ "content-type": "application/zip", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    const disposition = response.headers.get("content-disposition");
    if (disposition) headers.set("content-disposition", disposition);
    return new Response(response.body, { status: 200, headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "季度归档服务连接失败，请稍后重试。" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
