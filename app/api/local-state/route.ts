import { env } from "cloudflare:workers";
import {
  reconstructStorageSnapshot,
  splitStorageSnapshot,
  type SnapshotChunk,
} from "../../server-state-chunks";
import { mergeStorageSnapshots, type StorageSnapshot } from "../../server-state-merge";

const SNAPSHOT_ID = "shared";
const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024;
const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

type SnapshotManifest = {
  version_id: string;
  updated_at: string;
  key_count: number;
  chunk_count: number;
  total_bytes: number;
};

type StoredSnapshot = {
  snapshot: StorageSnapshot;
  updatedAt: string;
  versionId?: string;
};

async function ensureSnapshotTable() {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS app_state_snapshots (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)",
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS app_state_snapshot_history (id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL)",
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS app_state_snapshot_manifests (id TEXT PRIMARY KEY, version_id TEXT NOT NULL, updated_at TEXT NOT NULL, key_count INTEGER NOT NULL, chunk_count INTEGER NOT NULL, total_bytes INTEGER NOT NULL)",
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS app_state_snapshot_chunks (version_id TEXT NOT NULL, storage_key TEXT NOT NULL, chunk_index INTEGER NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (version_id, storage_key, chunk_index))",
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_app_state_snapshot_chunks_version ON app_state_snapshot_chunks(version_id, storage_key, chunk_index)",
  ).run();
}

async function readChunkedSnapshot(manifest: SnapshotManifest): Promise<StorageSnapshot> {
  const chunks: SnapshotChunk[] = [];
  // Read a few deliberately small chunks per query. Four 32k-character
  // values remain comfortably below the gateway response ceiling while
  // avoiding hundreds of round trips for a complete snapshot.
  const pageSize = 4;
  for (let offset = 0; offset < manifest.chunk_count; offset += pageSize) {
    const page = await env.DB.prepare(
      "SELECT storage_key, chunk_index, payload FROM app_state_snapshot_chunks WHERE version_id = ? ORDER BY storage_key ASC, chunk_index ASC LIMIT ? OFFSET ?",
    ).bind(manifest.version_id, pageSize, offset).all<{
      storage_key: string;
      chunk_index: number;
      payload: string;
    }>();
    for (const row of page.results ?? []) {
      chunks.push({ storageKey: row.storage_key, chunkIndex: row.chunk_index, payload: row.payload });
    }
  }
  if (chunks.length !== manifest.chunk_count) throw new Error("服务器数据分块数量不一致");
  return reconstructStorageSnapshot(chunks, manifest.key_count);
}

async function readCurrentSnapshot(): Promise<StoredSnapshot | null> {
  const manifest = await env.DB.prepare(
    "SELECT version_id, updated_at, key_count, chunk_count, total_bytes FROM app_state_snapshot_manifests WHERE id = ?",
  ).bind(SNAPSHOT_ID).first<SnapshotManifest>();
  if (manifest) {
    return {
      snapshot: await readChunkedSnapshot(manifest),
      updatedAt: manifest.updated_at,
      versionId: manifest.version_id,
    };
  }
  const legacy = await env.DB.prepare(
    "SELECT payload, updated_at FROM app_state_snapshots WHERE id = ?",
  ).bind(SNAPSHOT_ID).first<{ payload: string; updated_at: string }>();
  if (!legacy) return null;
  return { snapshot: JSON.parse(legacy.payload) as StorageSnapshot, updatedAt: legacy.updated_at };
}

async function writeChunkedSnapshot(snapshot: StorageSnapshot, updatedAt: string) {
  const versionId = crypto.randomUUID();
  const payloadBytes = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
  const chunks = splitStorageSnapshot(snapshot);

  // Prepare and execute one small statement at a time. Do not eagerly build a
  // large array of bound statements: some D1-compatible gateways serialize
  // the complete binding collection before executing even a one-item batch.
  for (const chunk of chunks) {
    try {
      await env.DB.prepare(
        "INSERT INTO app_state_snapshot_chunks (version_id, storage_key, chunk_index, payload, created_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(versionId, chunk.storageKey, chunk.chunkIndex, chunk.payload, updatedAt).run();
    } catch (error) {
      throw new Error(
        `服务器数据分块写入失败（${chunk.storageKey} #${chunk.chunkIndex}，${chunk.payload.length}字符）：${error instanceof Error ? error.message : "未知错误"}`,
      );
    }
  }

  // Publish only after every chunk has been persisted. Readers therefore see
  // either the previous complete version or this complete version.
  try {
    await env.DB.prepare(
      "INSERT INTO app_state_snapshot_manifests (id, version_id, updated_at, key_count, chunk_count, total_bytes) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET version_id = excluded.version_id, updated_at = excluded.updated_at, key_count = excluded.key_count, chunk_count = excluded.chunk_count, total_bytes = excluded.total_bytes",
    ).bind(SNAPSHOT_ID, versionId, updatedAt, Object.keys(snapshot).length, chunks.length, payloadBytes).run();
  } catch (error) {
    throw new Error(`服务器数据清单发布失败：${error instanceof Error ? error.message : "未知错误"}`);
  }

  // Keep the active version only. Cleanup is best-effort because the manifest
  // has already been published successfully at this point. A cleanup failure
  // must not make the client retry an otherwise completed migration.
  try {
    await env.DB.prepare(
      "DELETE FROM app_state_snapshot_chunks WHERE version_id <> ?",
    ).bind(versionId).run();
  } catch (error) {
    console.warn("[local-state] stale chunk cleanup failed", error);
  }
}

export async function GET() {
  try {
    await ensureSnapshotTable();
    const result = await readCurrentSnapshot();
    if (!result) return Response.json({ snapshot: null }, { headers: corsHeaders });
    return Response.json({ snapshot: result.snapshot, updatedAt: result.updatedAt }, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "读取服务器数据失败" },
      { status: 500, headers: corsHeaders },
    );
  }
}

export async function POST(request: Request) {
  let stage = "解析上传文件";
  try {
    const body = (await request.json()) as { snapshot?: StorageSnapshot; mode?: "replace" | "merge" };
    const incomingSnapshot = body.snapshot;
    if (!incomingSnapshot || typeof incomingSnapshot !== "object") {
      return Response.json({ error: "缺少本机数据快照" }, { status: 400, headers: corsHeaders });
    }
    if (Object.keys(incomingSnapshot).length === 0) {
      return Response.json({ error: "禁止使用空数据覆盖服务器快照" }, { status: 400, headers: corsHeaders });
    }
    stage = "初始化数据库";
    await ensureSnapshotTable();
    const updatedAt = new Date().toISOString();
    stage = "读取服务器现有数据";
    const current = await readCurrentSnapshot();
    let snapshot = incomingSnapshot;
    if (body.mode === "merge" && current) {
      stage = "合并本机与服务器数据";
      snapshot = mergeStorageSnapshots(incomingSnapshot, current.snapshot);
    }
    stage = "检查合并数据大小";
    const payload = JSON.stringify(snapshot);
    if (new TextEncoder().encode(payload).byteLength > MAX_SNAPSHOT_BYTES) {
      return Response.json({ error: "本机数据过大，请联系管理员处理" }, { status: 413, headers: corsHeaders });
    }
    stage = "分块写入服务器数据库";
    await writeChunkedSnapshot(snapshot, updatedAt);
    return Response.json({ ok: true, updatedAt, keyCount: Object.keys(snapshot).length }, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      {
        error: `导入阶段“${stage}”失败：${error instanceof Error ? error.message : "保存服务器数据失败"}`,
      },
      { status: 500, headers: corsHeaders },
    );
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
