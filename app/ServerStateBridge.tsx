"use client";

import { useEffect } from "react";

const SYNC_MARKER = "reconciliation-server-snapshot-updated-at";
const REMOTE_ORIGIN = "http://192.168.51.182:8000";

function businessSnapshot() {
  const snapshot: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) continue;
    if (/reconciliation|quarter|dashboard|followup|issue|tracker/i.test(key)) {
      const value = localStorage.getItem(key);
      if (value !== null) snapshot[key] = value;
    }
  }
  return snapshot;
}

function restoreSnapshot(snapshot: Record<string, string>) {
  Object.entries(snapshot).forEach(([key, value]) => localStorage.setItem(key, value));
}

/**
 * `?syncServer=1` is a one-time bridge for the original local browser origin.
 * The deployed origin then restores the uploaded snapshot automatically.
 */
export function ServerStateBridge() {
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const isOneTimeSync = query.get("syncServer") === "1";
    const serverOrigin = query.get("serverOrigin") || REMOTE_ORIGIN;

    if (isOneTimeSync) {
      const snapshot = businessSnapshot();
      void fetch(`${serverOrigin}/api/local-state`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snapshot }),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error((await response.json() as { error?: string }).error || "同步失败");
          window.alert("本机对账数据已同步到服务器。请打开服务器地址继续使用。");
        })
        .catch((error: unknown) => window.alert(`本机数据同步失败：${error instanceof Error ? error.message : "未知错误"}`));
      return;
    }

    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") return;
    void fetch("/api/local-state")
      .then(async (response) => response.ok ? response.json() as Promise<{ snapshot: Record<string, string> | null; updatedAt?: string }> : null)
      .then((payload) => {
        if (!payload?.snapshot || !payload.updatedAt) return;
        if (localStorage.getItem(SYNC_MARKER) === payload.updatedAt) return;
        restoreSnapshot(payload.snapshot);
        localStorage.setItem(SYNC_MARKER, payload.updatedAt);
        window.location.reload();
      })
      .catch(() => undefined);
  }, []);

  return null;
}
