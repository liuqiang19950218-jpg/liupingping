"use client";

import { useEffect } from "react";

const SYNC_MARKER = "reconciliation-server-snapshot-updated-at";
const LEDGER_SYNC_MARKER = "reconciliation-server-ledger-updated-at";
const REMOTE_ORIGIN = "http://192.168.51.182:8000";
const LEDGER_DB_NAME = "quarterly-reconciliation";
const LEDGER_STORE_NAME = "ledger";
const LEDGER_RECORD_KEY = "current";
const LEDGER_CHUNK_SIZE = 5_000;

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

async function uploadLedger(serverOrigin: string, ledger: LedgerUpload): Promise<void> {
  const totalChunks = Math.ceil(ledger.keys.length / LEDGER_CHUNK_SIZE);
  const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await requestJson(`${serverOrigin}/api/ledger-state`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "begin", uploadId, totalChunks, totalKeys: ledger.keys.length }),
  });
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const keys = ledger.keys.slice(chunkIndex * LEDGER_CHUNK_SIZE, (chunkIndex + 1) * LEDGER_CHUNK_SIZE);
    await requestJson(`${serverOrigin}/api/ledger-state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "chunk", uploadId, chunkIndex, keys }),
    });
  }
  await requestJson(`${serverOrigin}/api/ledger-state`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "commit",
      uploadId,
      totalChunks,
      totalKeys: ledger.keys.length,
      fileNames: ledger.fileNames,
      updatedAt: ledger.updatedAt,
    }),
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
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
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
          await requestJson(`${serverOrigin}/api/local-state`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ snapshot }),
          });
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

  return null;
}
