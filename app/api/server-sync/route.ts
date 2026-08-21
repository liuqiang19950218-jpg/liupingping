const REMOTE_ORIGIN = "http://192.168.51.182:8000";
const ALLOWED_TARGETS = new Set(["/api/local-state", "/api/ledger-state"]);

type SyncProxyBody = {
  targetPath?: string;
  payload?: unknown;
};

/**
 * 本机旧数据迁移专用代理。
 *
 * 浏览器可能阻止从 127.0.0.1 直接向局域网生产地址发起私网请求，
 * 因此仅允许服务端代转既定的两个状态同步接口，禁止任意 URL 转发。
 */
export async function POST(request: Request) {
  try {
    const requestHost = new URL(request.url).hostname;
    if (requestHost !== "localhost" && requestHost !== "127.0.0.1") {
      return Response.json(
        { error: "仅允许从本机开发地址执行服务器同步" },
        { status: 403 },
      );
    }

    const body = await request.json() as SyncProxyBody;
    const targetPath = body.targetPath || "";
    if (!ALLOWED_TARGETS.has(targetPath)) {
      return Response.json({ error: "不允许的同步目标" }, { status: 400 });
    }

    const response = await fetch(`${REMOTE_ORIGIN}${targetPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body.payload ?? {}),
    });
    const responseText = await response.text();
    return new Response(responseText, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") || "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "转发服务器同步请求失败" },
      { status: 500 },
    );
  }
}
