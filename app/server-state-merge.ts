const ACTIVE_SHEET_KEY = "local-quarterly-reconciliation";
const QUARTER_ARCHIVE_KEY = "local-quarterly-reconciliation-archive";
const SELECTED_QUARTER_KEY = "local-quarterly-reconciliation-selected-quarter";
const SPD_SHEET_ARCHIVE_KEY = "local-quarterly-reconciliation-spd-sheet-archive";

export type StorageSnapshot = Record<string, string>;

type SheetLike = {
  fileName?: unknown;
  headers?: unknown;
  rows?: unknown;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson(value: string | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function mergeObjects(incoming: unknown, current: unknown): unknown {
  if (!isPlainObject(incoming)) return current ?? incoming;
  if (!isPlainObject(current)) return incoming;
  const merged: Record<string, unknown> = { ...incoming };
  Object.entries(current).forEach(([key, value]) => {
    merged[key] = key in merged ? mergeObjects(merged[key], value) : value;
  });
  return merged;
}

function inferQuarter(storage: StorageSnapshot, sheet: SheetLike | undefined): string | undefined {
  const selected = storage[SELECTED_QUARTER_KEY]?.trim();
  if (/^20\d{2}\s*Q[1-4]$/i.test(selected || "")) return selected?.replace(/\s+/g, " ").toUpperCase();

  const headers = Array.isArray(sheet?.headers) ? sheet.headers.map(String) : [];
  const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
  const quarterColumn = headers.findIndex((header) => /对账时间点|季度/.test(header));
  const firstRow = Array.isArray(rows[0]) ? rows[0] : undefined;
  const cell = quarterColumn >= 0 && firstRow ? String(firstRow[quarterColumn] ?? "") : "";
  const source = `${cell} ${String(sheet?.fileName ?? "")}`;
  const direct = source.match(/(20\d{2})\s*Q([1-4])/i);
  if (direct) return `${direct[1]} Q${direct[2]}`;
  const chinese = source.match(/(\d{2,4})\s*年?\s*([1-4])\s*季度/);
  if (chinese) {
    const year = chinese[1].length === 2 ? `20${chinese[1]}` : chinese[1];
    return `${year} Q${chinese[2]}`;
  }
  return undefined;
}

function archiveWithActive(storage: StorageSnapshot, archiveKey: string): Record<string, unknown> {
  const parsed = parseJson(storage[archiveKey]);
  const archive = isPlainObject(parsed) ? { ...parsed } : {};
  if (archiveKey !== QUARTER_ARCHIVE_KEY) return archive;

  const active = parseJson(storage[ACTIVE_SHEET_KEY]);
  if (isPlainObject(active)) {
    const quarter = inferQuarter(storage, active as SheetLike);
    if (quarter && !(quarter in archive)) archive[quarter] = active;
  }
  return archive;
}

/**
 * 将旧网址浏览器中的季度数据补入服务器快照。
 * 同季度冲突时以服务器现有数据为准，避免迁移 Q1 时覆盖已经在 182 使用的 Q2。
 */
export function mergeStorageSnapshots(incoming: StorageSnapshot, current: StorageSnapshot): StorageSnapshot {
  const merged: StorageSnapshot = { ...incoming, ...current };

  const incomingArchive = archiveWithActive(incoming, QUARTER_ARCHIVE_KEY);
  const currentArchive = archiveWithActive(current, QUARTER_ARCHIVE_KEY);
  const quarterArchive = { ...incomingArchive, ...currentArchive };
  if (Object.keys(quarterArchive).length > 0) merged[QUARTER_ARCHIVE_KEY] = JSON.stringify(quarterArchive);

  const incomingSpd = archiveWithActive(incoming, SPD_SHEET_ARCHIVE_KEY);
  const currentSpd = archiveWithActive(current, SPD_SHEET_ARCHIVE_KEY);
  const spdArchive = { ...incomingSpd, ...currentSpd };
  if (Object.keys(spdArchive).length > 0) merged[SPD_SHEET_ARCHIVE_KEY] = JSON.stringify(spdArchive);

  for (const key of new Set([...Object.keys(incoming), ...Object.keys(current)])) {
    if (key === QUARTER_ARCHIVE_KEY || key === SPD_SHEET_ARCHIVE_KEY) continue;
    const incomingValue = parseJson(incoming[key]);
    const currentValue = parseJson(current[key]);
    if (isPlainObject(incomingValue) && isPlainObject(currentValue)) {
      merged[key] = JSON.stringify(mergeObjects(incomingValue, currentValue));
    }
  }

  return merged;
}
