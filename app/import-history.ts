import {
  QUARTER_ARCHIVE_KEY,
  SPD_SHEET_ARCHIVE_KEY,
  readArchive,
  readSpdSheetArchive,
} from "./quarter-storage";

export const IMPORT_HISTORY_KEY = "quarterly-reconciliation-import-history-v1";
export const IMPORT_HISTORY_UPDATED = "reconciliation-import-history-updated";

export type ImportStatus =
  | "success"
  | "partial"
  | "pending"
  | "failed"
  | "historical";

export type ImportHistoryRecord = {
  id: string;
  fileName: string;
  importedAt?: string;
  dataType: "reconciliation" | "ledger" | "materials" | "spd" | "companyReceivable";
  description: string;
  recordCount?: number;
  targetStore: string;
  quarter?: string;
  operator: string;
  status: ImportStatus;
  sourceKey?: string;
  isHistorical?: boolean;
  stats?: {
    inserted?: number;
    updated?: number;
    skipped?: number;
    errors?: number;
    note?: string;
  };
};

export type LedgerImportSnapshot = {
  keys: string[];
  fileNames: string[];
  updatedAt: string;
};

const labels: Record<ImportHistoryRecord["dataType"], string> = {
  reconciliation: "对账表",
  ledger: "往来明细",
  materials: "资料提供情况",
  spd: "SPD 表",
  companyReceivable: "应收更新",
};

export const importTypeLabel = (type: ImportHistoryRecord["dataType"]) =>
  labels[type];

export function readImportHistory(): ImportHistoryRecord[] {
  try {
    const value = JSON.parse(localStorage.getItem(IMPORT_HISTORY_KEY) || "[]");
    return Array.isArray(value) ? (value as ImportHistoryRecord[]) : [];
  } catch {
    return [];
  }
}

function writeImportHistory(records: ImportHistoryRecord[]) {
  localStorage.setItem(IMPORT_HISTORY_KEY, JSON.stringify(records));
  window.dispatchEvent(new Event(IMPORT_HISTORY_UPDATED));
}

export function recordImport(
  record: Omit<ImportHistoryRecord, "id" | "operator"> & {
    operator?: string;
  },
) {
  const next: ImportHistoryRecord = {
    ...record,
    id: `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    operator: record.operator || "本机用户",
  };
  writeImportHistory([next, ...readImportHistory()]);
  return next;
}

/**
 * Adds only defensible records for data that existed before import auditing was
 * introduced.  The deterministic sourceKey makes the migration idempotent.
 */
export function backfillImportHistory(ledger?: LedgerImportSnapshot | null) {
  const current = readImportHistory();
  const known = new Set(current.map((item) => item.sourceKey).filter(Boolean));
  const additions: ImportHistoryRecord[] = [];
  const appendHistorical = (record: Omit<ImportHistoryRecord, "id" | "operator" | "status" | "isHistorical">) => {
    if (record.sourceKey && known.has(record.sourceKey)) return;
    if (record.sourceKey) known.add(record.sourceKey);
    additions.push({
      ...record,
      id: `historical-${record.sourceKey ?? additions.length}`,
      operator: "本机用户",
      status: "historical",
      isHistorical: true,
    });
  };

  Object.entries(readArchive()).forEach(([quarter, sheet]) => {
    appendHistorical({
      fileName: sheet.fileName || "历史对账表数据",
      dataType: "reconciliation",
      description: "导入记录功能启用前已存在的本季度对账表数据。",
      recordCount: sheet.rows.length,
      targetStore: QUARTER_ARCHIVE_KEY,
      quarter,
      sourceKey: `legacy:reconciliation:${quarter}:${sheet.fileName || "unknown"}`,
    });
  });

  Object.entries(readSpdSheetArchive()).forEach(([quarter, sheet]) => {
    appendHistorical({
      fileName: sheet.fileName || "历史SPD表数据",
      dataType: "spd",
      description: "导入记录功能启用前已存在的 SPD 确认表/库存确认函数据。",
      recordCount: sheet.rows.length,
      targetStore: SPD_SHEET_ARCHIVE_KEY,
      quarter,
      sourceKey: `legacy:spd:${quarter}:${sheet.fileName || "unknown"}`,
    });
  });

  if (ledger?.keys?.length) {
    appendHistorical({
      fileName: ledger.fileNames.filter(Boolean).join("、") || "历史往来明细数据",
      importedAt: ledger.updatedAt || undefined,
      dataType: "ledger",
      description: "导入记录功能启用前已存在的本年往来明细数据。",
      recordCount: ledger.keys.length,
      targetStore: "IndexedDB · quarterly-reconciliation/ledger/current",
      sourceKey: `legacy:ledger:${ledger.fileNames.join("|")}:${ledger.keys.length}`,
    });
  }

  if (additions.length) writeImportHistory([...additions, ...current]);
  return additions.length;
}

export function formatImportTime(value?: string) {
  if (!value) return "时间未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function importStatusLabel(status: ImportStatus) {
  return {
    success: "导入成功",
    partial: "部分异常",
    pending: "待校验",
    failed: "导入失败",
    historical: "历史已存在",
  }[status];
}
