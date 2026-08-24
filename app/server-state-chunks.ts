import type { StorageSnapshot } from "./server-state-merge";

// Keep chunks deliberately small. The remote D1-compatible gateway applies a
// lower bind/result ceiling than SQLite's documented 2 MB value limit, and a
// Chinese UTF-16 code unit can occupy up to 3 UTF-8 bytes (4 for surrogate
// pairs). 32,000 code units stay comfortably below that gateway ceiling.
export const SNAPSHOT_CHUNK_MAX_CHARS = 32_000;
export const SNAPSHOT_CHUNK_MAX_BYTES = SNAPSHOT_CHUNK_MAX_CHARS * 4;

export type SnapshotChunk = {
  storageKey: string;
  chunkIndex: number;
  payload: string;
};

function avoidSplittingSurrogatePair(value: string, end: number) {
  if (end <= 0 || end >= value.length) return end;
  const previous = value.charCodeAt(end - 1);
  const next = value.charCodeAt(end);
  if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
    return end - 1;
  }
  return end;
}

function findChunkEnd(value: string, start: number) {
  return avoidSplittingSurrogatePair(
    value,
    Math.min(value.length, start + SNAPSHOT_CHUNK_MAX_CHARS),
  );
}

export function splitStorageSnapshot(snapshot: StorageSnapshot): SnapshotChunk[] {
  const chunks: SnapshotChunk[] = [];
  for (const [storageKey, value] of Object.entries(snapshot)) {
    if (value.length === 0) {
      chunks.push({ storageKey, chunkIndex: 0, payload: "" });
      continue;
    }
    let start = 0;
    let chunkIndex = 0;
    while (start < value.length) {
      const end = findChunkEnd(value, start);
      if (end <= start) throw new Error(`无法拆分服务器数据：${storageKey}`);
      chunks.push({ storageKey, chunkIndex, payload: value.slice(start, end) });
      start = end;
      chunkIndex += 1;
    }
  }
  return chunks;
}

export function reconstructStorageSnapshot(chunks: SnapshotChunk[], expectedKeyCount: number) {
  const snapshot: StorageSnapshot = {};
  const nextIndex = new Map<string, number>();
  for (const chunk of chunks) {
    const expectedIndex = nextIndex.get(chunk.storageKey) ?? 0;
    if (chunk.chunkIndex !== expectedIndex) {
      throw new Error(`服务器数据分块不完整：${chunk.storageKey}`);
    }
    snapshot[chunk.storageKey] = `${snapshot[chunk.storageKey] ?? ""}${chunk.payload}`;
    nextIndex.set(chunk.storageKey, expectedIndex + 1);
  }
  if (Object.keys(snapshot).length !== expectedKeyCount) {
    throw new Error("服务器数据键数量不一致");
  }
  return snapshot;
}
