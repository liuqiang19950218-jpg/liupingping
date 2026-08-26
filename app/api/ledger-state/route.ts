import { env } from "cloudflare:workers";

const MANIFEST_ID = "shared";
const MAX_CHUNK_KEYS = 5_000;
const MAX_CHUNK_BYTES = 2 * 1024 * 1024;
const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

type Manifest = {
  upload_id: string;
  file_names: string;
  updated_at: string;
  total_chunks: number;
  total_keys: number;
};

async function ensureTables() {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS ledger_state_manifests (id TEXT PRIMARY KEY, upload_id TEXT NOT NULL, file_names TEXT NOT NULL, updated_at TEXT NOT NULL, total_chunks INTEGER NOT NULL, total_keys INTEGER NOT NULL)",
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS ledger_state_chunks (upload_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(upload_id, chunk_index))",
  ).run();
}

export async function GET(request: Request) {
  try {
    await ensureTables();
    const url = new URL(request.url);
    const uploadId = url.searchParams.get("uploadId");
    const chunkIndex = url.searchParams.get("chunk");
    if (uploadId && chunkIndex !== null) {
      const result = await env.DB.prepare(
        "SELECT payload FROM ledger_state_chunks WHERE upload_id = ? AND chunk_index = ?",
      ).bind(uploadId, Number(chunkIndex)).first<{ payload: string }>();
      return Response.json({ keys: result ? JSON.parse(result.payload) : null }, { headers: corsHeaders });
    }
    const result = await env.DB.prepare(
      "SELECT upload_id, file_names, updated_at, total_chunks, total_keys FROM ledger_state_manifests WHERE id = ?",
    ).bind(MANIFEST_ID).first<Manifest>();
    if (!result) return Response.json({ manifest: null }, { headers: corsHeaders });
    return Response.json({
      manifest: {
        uploadId: result.upload_id,
        fileNames: JSON.parse(result.file_names),
        updatedAt: result.updated_at,
        totalChunks: result.total_chunks,
        totalKeys: result.total_keys,
      },
    }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取往来索引失败" }, { status: 500, headers: corsHeaders });
  }
}

export async function POST(request: Request) {
  try {
    await ensureTables();
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");
    const uploadId = String(body.uploadId || "");
    if (!uploadId) return Response.json({ error: "缺少上传批次号" }, { status: 400, headers: corsHeaders });

    if (action === "begin") {
      const totalChunks = Number(body.totalChunks);
      const totalKeys = Number(body.totalKeys);
      if (!Number.isInteger(totalChunks) || totalChunks <= 0 || !Number.isInteger(totalKeys) || totalKeys <= 0) {
        return Response.json({ error: "禁止使用空往来索引覆盖服务器数据" }, { status: 400, headers: corsHeaders });
      }
      await env.DB.prepare("DELETE FROM ledger_state_chunks WHERE upload_id = ?").bind(uploadId).run();
      return Response.json({ ok: true }, { headers: corsHeaders });
    }

    if (action === "chunk") {
      const chunkIndex = Number(body.chunkIndex);
      const keys = body.keys;
      if (!Number.isInteger(chunkIndex) || !Array.isArray(keys) || keys.length === 0 || keys.length > MAX_CHUNK_KEYS) {
        return Response.json({ error: "往来索引分块格式不正确" }, { status: 400, headers: corsHeaders });
      }
      const payload = JSON.stringify(keys);
      if (new TextEncoder().encode(payload).byteLength > MAX_CHUNK_BYTES) {
        return Response.json({ error: "往来索引分块过大" }, { status: 413, headers: corsHeaders });
      }
      await env.DB.prepare(
        "INSERT INTO ledger_state_chunks (upload_id, chunk_index, payload) VALUES (?, ?, ?) ON CONFLICT(upload_id, chunk_index) DO UPDATE SET payload = excluded.payload",
      ).bind(uploadId, chunkIndex, payload).run();
      return Response.json({ ok: true }, { headers: corsHeaders });
    }

    if (action === "commit") {
      const totalChunks = Number(body.totalChunks);
      const totalKeys = Number(body.totalKeys);
      const fileNames = Array.isArray(body.fileNames) ? body.fileNames.map(String) : [];
      const count = await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM ledger_state_chunks WHERE upload_id = ?",
      ).bind(uploadId).first<{ count: number }>();
      if (!count || Number(count.count) !== totalChunks || totalKeys <= 0) {
        return Response.json({ error: "往来索引分块不完整，已取消提交" }, { status: 409, headers: corsHeaders });
      }
      const updatedAt = String(body.updatedAt || new Date().toISOString());
      const previous = await env.DB.prepare(
        "SELECT upload_id FROM ledger_state_manifests WHERE id = ?",
      ).bind(MANIFEST_ID).first<{ upload_id: string }>();
      await env.DB.prepare(
        "INSERT INTO ledger_state_manifests (id, upload_id, file_names, updated_at, total_chunks, total_keys) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET upload_id = excluded.upload_id, file_names = excluded.file_names, updated_at = excluded.updated_at, total_chunks = excluded.total_chunks, total_keys = excluded.total_keys",
      ).bind(MANIFEST_ID, uploadId, JSON.stringify(fileNames), updatedAt, totalChunks, totalKeys).run();
      if (previous?.upload_id && previous.upload_id !== uploadId) {
        await env.DB.prepare("DELETE FROM ledger_state_chunks WHERE upload_id = ?").bind(previous.upload_id).run();
      }
      return Response.json({ ok: true, updatedAt, totalKeys }, { headers: corsHeaders });
    }

    return Response.json({ error: "不支持的同步动作" }, { status: 400, headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "保存往来索引失败" }, { status: 500, headers: corsHeaders });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
