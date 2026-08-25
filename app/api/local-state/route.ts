import { env } from "cloudflare:workers";
import {
  reconstructStorageSnapshot,
  SNAPSHOT_CHUNK_MAX_CHARS,
  splitStorageSnapshot,
  type SnapshotChunk,
} from "../../server-state-chunks";
import { mergeStorageSnapshots, type StorageSnapshot } from "../../server-state-merge";

const SNAPSHOT_ID = "shared";
// Snapshots can contain a considerable amount of sales-entered detail. They are
// persisted in small chunks below, so the total may exceed a single D1 binding.
const MAX_SNAPSHOT_BYTES = 128 * 1024 * 1024;
const UPLOAD_CHUNK_BATCH_SIZE = 4;
const STAGED_READ_PAGE_SIZE = 20;
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

type StagedUpload = {
  upload_id: string;
  mode: "replace" | "merge";
  key_count: number;
  chunk_count: number;
  total_bytes: number;
};

function isSnapshot(value: unknown): value is StorageSnapshot {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUploadId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function readUploadChunks(value: unknown): SnapshotChunk[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > UPLOAD_CHUNK_BATCH_SIZE) return null;
  const chunks: SnapshotChunk[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const chunk = item as Record<string, unknown>;
    if (
      typeof chunk.storageKey !== "string" ||
      !chunk.storageKey ||
      !isNonNegativeInteger(chunk.chunkIndex) ||
      typeof chunk.payload !== "string" ||
      chunk.payload.length > SNAPSHOT_CHUNK_MAX_CHARS
    ) return null;
    chunks.push({ storageKey: chunk.storageKey, chunkIndex: chunk.chunkIndex, payload: chunk.payload });
  }
  return chunks;
}

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
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS app_state_snapshot_uploads (upload_id TEXT PRIMARY KEY, mode TEXT NOT NULL, key_count INTEGER NOT NULL, chunk_count INTEGER NOT NULL, total_bytes INTEGER NOT NULL, created_at TEXT NOT NULL)",
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS app_state_snapshot_upload_chunks (upload_id TEXT NOT NULL, storage_key TEXT NOT NULL, chunk_index INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (upload_id, storage_key, chunk_index))",
  ).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_app_state_snapshot_upload_chunks_upload ON app_state_snapshot_upload_chunks(upload_id, storage_key, chunk_index)",
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

async function readStagedSnapshot(upload: StagedUpload): Promise<StorageSnapshot> {
  const chunks: SnapshotChunk[] = [];
  for (let offset = 0; offset < upload.chunk_count; offset += STAGED_READ_PAGE_SIZE) {
    const page = await env.DB.prepare(
      "SELECT storage_key, chunk_index, payload FROM app_state_snapshot_upload_chunks WHERE upload_id = ? ORDER BY storage_key ASC, chunk_index ASC LIMIT ? OFFSET ?",
    ).bind(upload.upload_id, STAGED_READ_PAGE_SIZE, offset).all<{
      storage_key: string;
      chunk_index: number;
      payload: string;
    }>();
    for (const row of page.results ?? []) {
      chunks.push({ storageKey: row.storage_key, chunkIndex: row.chunk_index, payload: row.payload });
    }
  }
  if (chunks.length !== upload.chunk_count) throw new Error("迁移文件分块不完整，请重新选择文件导入");
  return reconstructStorageSnapshot(chunks, upload.key_count);
}

async function removeStagedUpload(uploadId: string) {
  await env.DB.prepare("DELETE FROM app_state_snapshot_upload_chunks WHERE upload_id = ?").bind(uploadId).run();
  await env.DB.prepare("DELETE FROM app_state_snapshot_uploads WHERE upload_id = ?").bind(uploadId).run();
}

async function handleUploadAction(body: Record<string, unknown>) {
  const action = body.action;
  if (action === "begin") {
    if (
      !isUploadId(body.uploadId) ||
      !isNonNegativeInteger(body.keyCount) || body.keyCount === 0 ||
      !isNonNegativeInteger(body.chunkCount) || body.chunkCount === 0 ||
      !isNonNegativeInteger(body.totalBytes) || body.totalBytes > MAX_SNAPSHOT_BYTES ||
      (body.mode !== "merge" && body.mode !== "replace")
    ) return Response.json({ error: "迁移文件参数无效" }, { status: 400, headers: corsHeaders });

    await removeStagedUpload(body.uploadId);
    await env.DB.prepare(
      "INSERT INTO app_state_snapshot_uploads (upload_id, mode, key_count, chunk_count, total_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(body.uploadId, body.mode, body.keyCount, body.chunkCount, body.totalBytes, new Date().toISOString()).run();
    return Response.json({ ok: true }, { headers: corsHeaders });
  }

  if (!isUploadId(body.uploadId)) {
    return Response.json({ error: "迁移任务标识无效" }, { status: 400, headers: corsHeaders });
  }

  if (action === "chunk") {
    const chunks = readUploadChunks(body.chunks);
    if (!chunks) return Response.json({ error: "迁移数据分块无效" }, { status: 400, headers: corsHeaders });
    const upload = await env.DB.prepare(
      "SELECT upload_id, mode, key_count, chunk_count, total_bytes FROM app_state_snapshot_uploads WHERE upload_id = ?",
    ).bind(body.uploadId).first<StagedUpload>();
    if (!upload) return Response.json({ error: "迁移任务不存在或已过期，请重新选择文件" }, { status: 404, headers: corsHeaders });
    for (const chunk of chunks) {
      await env.DB.prepare(
        "INSERT INTO app_state_snapshot_upload_chunks (upload_id, storage_key, chunk_index, payload) VALUES (?, ?, ?, ?) ON CONFLICT(upload_id, storage_key, chunk_index) DO UPDATE SET payload = excluded.payload",
      ).bind(body.uploadId, chunk.storageKey, chunk.chunkIndex, chunk.payload).run();
    }
    return Response.json({ ok: true }, { headers: corsHeaders });
  }

  if (action === "commit") {
    const upload = await env.DB.prepare(
      "SELECT upload_id, mode, key_count, chunk_count, total_bytes FROM app_state_snapshot_uploads WHERE upload_id = ?",
    ).bind(body.uploadId).first<StagedUpload>();
    if (!upload) return Response.json({ error: "迁移任务不存在或已过期，请重新选择文件" }, { status: 404, headers: corsHeaders });
    const incoming = await readStagedSnapshot(upload);
    const incomingBytes = new TextEncoder().encode(JSON.stringify(incoming)).byteLength;
    if (incomingBytes > MAX_SNAPSHOT_BYTES) return Response.json({ error: "本机数据过大，请联系管理员处理" }, { status: 413, headers: corsHeaders });
    const current = await readCurrentSnapshot();
    const snapshot = upload.mode === "merge" && current
      ? mergeStorageSnapshots(incoming, current.snapshot)
      : incoming;
    if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MAX_SNAPSHOT_BYTES) {
      return Response.json({ error: "合并后的数据过大，请联系管理员处理" }, { status: 413, headers: corsHeaders });
    }
    const updatedAt = new Date().toISOString();
    await writeChunkedSnapshot(snapshot, updatedAt);
    await removeStagedUpload(upload.upload_id);
    return Response.json({ ok: true, updatedAt, keyCount: Object.keys(snapshot).length }, { headers: corsHeaders });
  }

  return Response.json({ error: "不支持的迁移动作" }, { status: 400, headers: corsHeaders });
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
    const body = (await request.json()) as Record<string, unknown>;
    stage = "初始化数据库";
    await ensureSnapshotTable();
    if (typeof body.action === "string") return await handleUploadAction(body);
    const incomingSnapshot = body.snapshot;
    if (!isSnapshot(incomingSnapshot)) {
      return Response.json({ error: "缺少本机数据快照" }, { status: 400, headers: corsHeaders });
    }
    if (Object.keys(incomingSnapshot).length === 0) {
      return Response.json({ error: "禁止使用空数据覆盖服务器快照" }, { status: 400, headers: corsHeaders });
    }
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
