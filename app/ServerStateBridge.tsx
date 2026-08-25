"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { splitStorageSnapshot } from "./server-state-chunks";

const SYNC_MARKER = "reconciliation-server-snapshot-updated-at";
const LEDGER_SYNC_MARKER = "reconciliation-server-ledger-updated-at";
const REMOTE_ORIGIN = "http://192.168.51.182:8000";
const LEDGER_DB_NAME = "quarterly-reconciliation";
const LEDGER_STORE_NAME = "ledger";
const LEDGER_RECORD_KEY = "current";
const LEDGER_CHUNK_SIZE = 5_000;
const SNAPSHOT_UPLOAD_BATCH_SIZE = 4;

type LedgerUpload = {
  keys: string[];
  fileNames: string[];
  updatedAt: string;
};

type LedgerManifest = {
  uploadId: string;
  fileNames: string[];
  updatedAt: string;
  totalChunks: number;
  totalKeys: number;
};

type MigrationMode = "export" | "import" | null;

type MigrationBundle = {
  version: 1;
  exportedAt: string;
  sourceOrigin: string;
  snapshot: Record<string, string>;
  ledger: LedgerUpload | null;
};

function businessSnapshot() {
  const snapshot: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || key === SYNC_MARKER || key === LEDGER_SYNC_MARKER) continue;
    if (/reconciliation|quarter|dashboard|followup|issue|tracker|import/i.test(key)) {
      const value = localStorage.getItem(key);
      if (value !== null) snapshot[key] = value;
    }
  }
  return snapshot;
}

function restoreSnapshot(snapshot: Record<string, string>) {
  Object.entries(snapshot).forEach(([key, value]) => localStorage.setItem(key, value));
}

function openLedgerDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LEDGER_DB_NAME);
    request.onerror = () => reject(request.error ?? new Error("无法打开往来索引数据库"));
    request.onsuccess = () => resolve(request.result);
  });
}

async function ensureLedgerDatabase(): Promise<IDBDatabase> {
  const database = await openLedgerDatabase();
  if (database.objectStoreNames.contains(LEDGER_STORE_NAME)) return database;
  const nextVersion = database.version + 1;
  database.close();
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LEDGER_DB_NAME, nextVersion);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(LEDGER_STORE_NAME)) {
        request.result.createObjectStore(LEDGER_STORE_NAME);
      }
    };
    request.onerror = () => reject(request.error ?? new Error("无法初始化往来索引数据库"));
    request.onsuccess = () => resolve(request.result);
  });
}

async function readCurrentLedger(): Promise<LedgerUpload | null> {
  const database = await openLedgerDatabase();
  if (!database.objectStoreNames.contains(LEDGER_STORE_NAME)) {
    database.close();
    return null;
  }
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(LEDGER_STORE_NAME, "readonly");
    const request = transaction.objectStore(LEDGER_STORE_NAME).get(LEDGER_RECORD_KEY);
    request.onerror = () => reject(request.error ?? new Error("读取往来索引失败"));
    request.onsuccess = () => resolve((request.result as LedgerUpload | undefined) ?? null);
    transaction.oncomplete = () => database.close();
  });
}

async function saveCurrentLedger(ledger: LedgerUpload): Promise<void> {
  const database = await ensureLedgerDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(LEDGER_STORE_NAME, "readwrite");
    transaction.objectStore(LEDGER_STORE_NAME).put(ledger, LEDGER_RECORD_KEY);
    transaction.onerror = () => reject(transaction.error ?? new Error("保存往来索引失败"));
    transaction.oncomplete = () => resolve();
  });
  database.close();
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}

function isLoopbackHost() {
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

async function postServerJson<T>(serverOrigin: string, targetPath: string, payload: unknown): Promise<T> {
  if (isLoopbackHost() && serverOrigin !== window.location.origin) {
    return requestJson<T>("/api/server-sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetPath, payload }),
    });
  }
  return requestJson<T>(`${serverOrigin}${targetPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function createSnapshotUploadId() {
  return `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function uploadSnapshot(
  serverOrigin: string,
  snapshot: Record<string, string>,
  mode: "merge" | "replace",
): Promise<void> {
  const chunks = splitStorageSnapshot(snapshot);
  if (chunks.length === 0) return;

  const uploadId = createSnapshotUploadId();
  const totalBytes = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;

  await postServerJson(serverOrigin, "/api/local-state", {
    action: "begin",
    uploadId,
    mode,
    keyCount: Object.keys(snapshot).length,
    chunkCount: chunks.length,
    totalBytes,
  });

  for (let index = 0; index < chunks.length; index += SNAPSHOT_UPLOAD_BATCH_SIZE) {
    await postServerJson(serverOrigin, "/api/local-state", {
      action: "chunk",
      uploadId,
      chunks: chunks.slice(index, index + SNAPSHOT_UPLOAD_BATCH_SIZE),
    });
  }

  await postServerJson(serverOrigin, "/api/local-state", {
    action: "commit",
    uploadId,
  });
}

async function uploadLedger(serverOrigin: string, ledger: LedgerUpload): Promise<void> {
  const totalChunks = Math.ceil(ledger.keys.length / LEDGER_CHUNK_SIZE);
  const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await postServerJson(serverOrigin, "/api/ledger-state", {
    action: "begin",
    uploadId,
    totalChunks,
    totalKeys: ledger.keys.length,
  });
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const keys = ledger.keys.slice(chunkIndex * LEDGER_CHUNK_SIZE, (chunkIndex + 1) * LEDGER_CHUNK_SIZE);
    await postServerJson(serverOrigin, "/api/ledger-state", { action: "chunk", uploadId, chunkIndex, keys });
  }
  await postServerJson(serverOrigin, "/api/ledger-state", {
    action: "commit",
    uploadId,
    totalChunks,
    totalKeys: ledger.keys.length,
    fileNames: ledger.fileNames,
    updatedAt: ledger.updatedAt,
  });
}

async function downloadLedger(serverOrigin: string): Promise<LedgerUpload | null> {
  const payload = await requestJson<{ manifest: LedgerManifest | null }>(`${serverOrigin}/api/ledger-state`);
  if (!payload.manifest) return null;
  const keys: string[] = [];
  for (let chunkIndex = 0; chunkIndex < payload.manifest.totalChunks; chunkIndex += 1) {
    const chunk = await requestJson<{ keys: string[] | null }>(
      `${serverOrigin}/api/ledger-state?uploadId=${encodeURIComponent(payload.manifest.uploadId)}&chunk=${chunkIndex}`,
    );
    if (!Array.isArray(chunk.keys)) throw new Error(`服务器往来索引第 ${chunkIndex + 1} 块缺失`);
    keys.push(...chunk.keys);
  }
  if (keys.length !== payload.manifest.totalKeys) throw new Error("服务器往来索引数量校验失败");
  return { keys, fileNames: payload.manifest.fileNames, updatedAt: payload.manifest.updatedAt };
}

/**
 * `?syncServer=1` 将原浏览器的 localStorage 与 IndexedDB 往来索引一次性同步到服务器。
 * 生产地址随后会自动恢复这两类数据，使所有使用者共享同一份初始业务数据。
 */
export function ServerStateBridge() {
  const [migrationMode, setMigrationMode] = useState<MigrationMode>(null);
  const [migrationStatus, setMigrationStatus] = useState("");
  const [migrationBusy, setMigrationBusy] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const requestedMigration = query.get("migration");
    if (requestedMigration === "export" || requestedMigration === "import") {
      const timer = window.setTimeout(() => setMigrationMode(requestedMigration), 0);
      return () => window.clearTimeout(timer);
    }
    const isOneTimeSync = query.get("syncServer") === "1";
    const serverOrigin = query.get("serverOrigin") || REMOTE_ORIGIN;

    if (isOneTimeSync) {
      void (async () => {
        const snapshot = businessSnapshot();
        const ledger = await readCurrentLedger();
        if (Object.keys(snapshot).length === 0 && (!ledger || ledger.keys.length === 0)) {
          window.alert("当前浏览器地址下未发现本机对账数据，已取消同步。请回到原先能看到数据的网址后再执行同步。");
          return;
        }
        if (Object.keys(snapshot).length > 0) {
          await uploadSnapshot(serverOrigin, snapshot, "merge");
        }
        if (ledger?.keys.length) await uploadLedger(serverOrigin, ledger);
        window.alert(`本机数据已完整同步到服务器。往来索引：${ledger?.keys.length.toLocaleString("zh-CN") ?? 0} 条。`);
      })().catch((error: unknown) => {
        window.alert(`本机数据同步失败：${error instanceof Error ? error.message : "未知错误"}`);
      });
      return;
    }

    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") return;
    void (async () => {
      let shouldReload = false;
      const payload = await requestJson<{ snapshot: Record<string, string> | null; updatedAt?: string }>("/api/local-state");
      if (payload.snapshot && payload.updatedAt && localStorage.getItem(SYNC_MARKER) !== payload.updatedAt) {
        restoreSnapshot(payload.snapshot);
        localStorage.setItem(SYNC_MARKER, payload.updatedAt);
        shouldReload = true;
      }
      const ledger = await downloadLedger(window.location.origin);
      if (ledger && localStorage.getItem(LEDGER_SYNC_MARKER) !== ledger.updatedAt) {
        await saveCurrentLedger(ledger);
        localStorage.setItem(LEDGER_SYNC_MARKER, ledger.updatedAt);
        shouldReload = true;
      }
      if (shouldReload) window.location.reload();
    })().catch((error: unknown) => {
      console.warn("[ServerStateBridge] 恢复服务器业务数据失败", error);
    });
  }, []);

  async function handleExport() {
    setMigrationBusy(true);
    setMigrationStatus("正在整理当前网址中的 Q1 数据……");
    try {
      const snapshot = businessSnapshot();
      const ledger = await readCurrentLedger();
      if (Object.keys(snapshot).length === 0 && (!ledger || ledger.keys.length === 0)) {
        throw new Error("当前网址下没有找到可导出的对账数据");
      }
      const bundle: MigrationBundle = {
        version: 1,
        exportedAt: new Date().toISOString(),
        sourceOrigin: window.location.origin,
        snapshot,
        ledger,
      };
      const blob = new Blob([JSON.stringify(bundle)], { type: "application/json;charset=utf-8" });
      const link = document.createElement("a");
      const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/T/, "-").slice(0, 15);
      link.href = URL.createObjectURL(blob);
      link.download = `季度对账_Q1浏览器数据_${timestamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      setMigrationStatus(`导出完成：业务数据 ${Object.keys(snapshot).length} 项，往来索引 ${ledger?.keys.length.toLocaleString("zh-CN") ?? 0} 条。`);
    } catch (error) {
      setMigrationStatus(`导出失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setMigrationBusy(false);
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setMigrationBusy(true);
    setMigrationStatus("正在把 Q1 合并到服务器，现有季度不会被覆盖……");
    try {
      const bundle = JSON.parse(await file.text()) as Partial<MigrationBundle>;
      if (bundle.version !== 1 || !bundle.snapshot || typeof bundle.snapshot !== "object") {
        throw new Error("文件不是本系统生成的季度数据迁移包");
      }
      setMigrationStatus("正在分块把 Q1 合并到服务器，现有季度不会被覆盖……");
      await uploadSnapshot(window.location.origin, bundle.snapshot, "merge");
      if (bundle.ledger?.keys?.length) {
        const serverLedger = await downloadLedger(window.location.origin);
        const mergedLedger: LedgerUpload = serverLedger
          ? {
              keys: Array.from(new Set([...serverLedger.keys, ...bundle.ledger.keys])),
              fileNames: Array.from(new Set([...serverLedger.fileNames, ...bundle.ledger.fileNames])),
              updatedAt: new Date().toISOString(),
            }
          : bundle.ledger;
        await uploadLedger(window.location.origin, mergedLedger);
      }
      setMigrationStatus("Q1 已合并到服务器。即将刷新并显示合并后的季度数据……");
      window.setTimeout(() => {
        window.location.href = "/";
      }, 1200);
    } catch (error) {
      setMigrationStatus(`导入失败：${error instanceof Error ? error.message : "未知错误"}`);
      setMigrationBusy(false);
    }
  }

  if (!migrationMode) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 p-6">
      <section className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-7 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-sm font-semibold text-blue-600">季度数据安全迁移</p>
            <h2 className="text-2xl font-bold text-slate-900">
              {migrationMode === "export" ? "从旧网址导出 Q1 数据" : "将 Q1 合并到 182 服务器"}
            </h2>
          </div>
          <button
            type="button"
            aria-label="关闭"
            className="rounded-lg px-3 py-1.5 text-xl text-slate-500 hover:bg-slate-100"
            onClick={() => { window.location.href = "/"; }}
          >
            ×
          </button>
        </div>
        <p className="mb-6 leading-7 text-slate-600">
          {migrationMode === "export"
            ? "此操作只读取当前旧网址浏览器内保存的数据，并下载一个迁移文件，不会删除或修改原数据。"
            : "选择从旧网址下载的迁移文件。系统只补入缺失季度；182 服务器中已经存在的数据优先保留。"}
        </p>
        {migrationMode === "export" ? (
          <button
            type="button"
            disabled={migrationBusy}
            className="w-full rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => { void handleExport(); }}
          >
            {migrationBusy ? "正在导出……" : "导出当前网址的 Q1 数据"}
          </button>
        ) : (
          <label className={`block w-full rounded-lg bg-blue-600 px-5 py-3 text-center font-semibold text-white ${migrationBusy ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-blue-700"}`}>
            {migrationBusy ? "正在合并……" : "选择 Q1 数据迁移文件"}
            <input
              type="file"
              accept="application/json,.json"
              disabled={migrationBusy}
              className="sr-only"
              onChange={(event) => { void handleImport(event); }}
            />
          </label>
        )}
        {migrationStatus ? (
          <p className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">{migrationStatus}</p>
        ) : null}
      </section>
    </div>
  );
}
