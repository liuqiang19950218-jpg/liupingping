/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const STATE_SNAPSHOT_ID = "shared";
const STATE_MAX_BYTES = 20 * 1024 * 1024;
const STATE_CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

async function handleLocalState(request: Request, env: Env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: STATE_CORS_HEADERS });
  }
  try {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS app_state_snapshots (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)",
    ).run();
    if (request.method === "GET") {
      const result = await env.DB.prepare(
        "SELECT payload, updated_at FROM app_state_snapshots WHERE id = ?",
      ).bind(STATE_SNAPSHOT_ID).first<{ payload: string; updated_at: string }>();
      return Response.json(
        result ? { snapshot: JSON.parse(result.payload), updatedAt: result.updated_at } : { snapshot: null },
        { headers: STATE_CORS_HEADERS },
      );
    }
    if (request.method !== "POST") {
      return Response.json({ error: "不支持的请求方法" }, { status: 405, headers: STATE_CORS_HEADERS });
    }
    const body = (await request.json()) as { snapshot?: Record<string, string> };
    if (!body.snapshot || typeof body.snapshot !== "object") {
      return Response.json({ error: "缺少本机数据快照" }, { status: 400, headers: STATE_CORS_HEADERS });
    }
    const payload = JSON.stringify(body.snapshot);
    if (new TextEncoder().encode(payload).byteLength > STATE_MAX_BYTES) {
      return Response.json({ error: "本机数据过大，请联系管理员处理" }, { status: 413, headers: STATE_CORS_HEADERS });
    }
    const updatedAt = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO app_state_snapshots (id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
    ).bind(STATE_SNAPSHOT_ID, payload, updatedAt).run();
    return Response.json({ ok: true, updatedAt, keyCount: Object.keys(body.snapshot).length }, { headers: STATE_CORS_HEADERS });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "服务器数据处理失败" },
      { status: 500, headers: STATE_CORS_HEADERS },
    );
  }
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/local-state") {
      return handleLocalState(request, env);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
