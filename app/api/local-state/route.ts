import { env } from "cloudflare:workers";
import { mergeStorageSnapshots, type StorageSnapshot } from "../../server-state-merge";

const SNAPSHOT_ID = "shared";
const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024;
const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

async function ensureSnapshotTable() {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS app_state_snapshots (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)",
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS app_state_snapshot_history (id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL)",
  ).run();
}

export async function GET() {
  try {
    await ensureSnapshotTable();
    const result = await env.DB.prepare(
      "SELECT payload, updated_at FROM app_state_snapshots WHERE id = ?",
    ).bind(SNAPSHOT_ID).first<{ payload: string; updated_at: string }>();
    if (!result) return Response.json({ snapshot: null }, { headers: corsHeaders });
    return Response.json({ snapshot: JSON.parse(result.payload), updatedAt: result.updated_at }, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "读取服务器数据失败" },
      { status: 500, headers: corsHeaders },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { snapshot?: StorageSnapshot; mode?: "replace" | "merge" };
    const incomingSnapshot = body.snapshot;
    if (!incomingSnapshot || typeof incomingSnapshot !== "object") {
      return Response.json({ error: "缺少本机数据快照" }, { status: 400, headers: corsHeaders });
    }
    if (Object.keys(incomingSnapshot).length === 0) {
      return Response.json({ error: "禁止使用空数据覆盖服务器快照" }, { status: 400, headers: corsHeaders });
    }
    await ensureSnapshotTable();
    const updatedAt = new Date().toISOString();
    const current = await env.DB.prepare(
      "SELECT payload, updated_at FROM app_state_snapshots WHERE id = ?",
    ).bind(SNAPSHOT_ID).first<{ payload: string; updated_at: string }>();
    let snapshot = incomingSnapshot;
    if (body.mode === "merge" && current) {
      const currentSnapshot = JSON.parse(current.payload) as StorageSnapshot;
      snapshot = mergeStorageSnapshots(incomingSnapshot, currentSnapshot);
    }
    const payload = JSON.stringify(snapshot);
    if (new TextEncoder().encode(payload).byteLength > MAX_SNAPSHOT_BYTES) {
      return Response.json({ error: "本机数据过大，请联系管理员处理" }, { status: 413, headers: corsHeaders });
    }
    if (current) {
      await env.DB.prepare(
        "INSERT INTO app_state_snapshot_history (id, payload, created_at) VALUES (?, ?, ?)",
      ).bind(`${current.updated_at}-${crypto.randomUUID()}`, current.payload, current.updated_at).run();
      await env.DB.prepare(
        "DELETE FROM app_state_snapshot_history WHERE id NOT IN (SELECT id FROM app_state_snapshot_history ORDER BY created_at DESC LIMIT 10)",
      ).run();
    }
    await env.DB.prepare(
      "INSERT INTO app_state_snapshots (id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
    ).bind(SNAPSHOT_ID, payload, updatedAt).run();
    return Response.json({ ok: true, updatedAt, keyCount: Object.keys(snapshot).length }, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "保存服务器数据失败" },
      { status: 500, headers: corsHeaders },
    );
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
