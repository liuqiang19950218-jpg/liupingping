"use client";

import * as XLSX from "xlsx";
import {
  ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { updateDashboardSnapshot } from "./cockpit-data";
import {
  ensureArchiveFromActive,
  quarterOf,
  quarterOptions,
  selectQuarter,
  selectedQuarter,
  sheetForQuarter,
  writeArchivedSheet,
} from "./quarter-storage";
import { ImportDashboard } from "./ImportDashboard";
import { DataImportCenter } from "./DataImportCenter";
import { PreviousQuarterDifferenceTransferDrawer } from "./PreviousQuarterDifferenceTransferDrawer";
import { recordImport } from "./import-history";
import {
  reconciliationApi,
  ReconciliationApiError,
  type DifferenceItem,
  type MaterialStatus,
  type QuarterDifferenceItem,
  type Reconciliation,
} from "../lib/api/reconciliation-api";
import {
  FORM_DIFFERENCE_CATEGORIES,
  planDifferenceItemMutations,
  toApiDifferenceCategory,
  toFormDifferenceCategory,
} from "../lib/difference-category-adapter.mjs";
import "./reconciliation.css";
import "./reconciliation-writeoff-section.css";

type InvoiceEntry = {
  id?: string;
  verificationStatus?: DifferenceItem["verificationStatus"];
  date: string;
  invoice: string;
  amount: string;
  note: string;
};
type LedgerLookup = Record<string, { amount: number; dates: string[] }>;
type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: {
    resultIndex: number;
    results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
  }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};
type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;
declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}
type OtherEntry = { id?: string; verificationStatus?: DifferenceItem["verificationStatus"]; amount: string; note: string; image?: string };
type DifferenceType =
  | "transit"
  | "returned"
  | "lost"
  | "instrument"
  | "otherInvoice"
  | "other";
type DetailForm = {
  companyAmount: string;
  customerAmount: string;
  responsible: string;
  transit: InvoiceEntry[];
  returned: InvoiceEntry[];
  lost: InvoiceEntry[];
  instrument: InvoiceEntry[];
  otherInvoice: InvoiceEntry[];
  other: OtherEntry[];
  badDebt: string;
  badDebtReason: string;
  adjustment: string;
  adjustmentReason: string;
  resolutionSolution: string;
  resolutionTime: string;
};
type LocalSheet = {
  headers: string[];
  rows: unknown[][];
  fileName: string;
  details?: Record<string, DetailForm>;
};
type LedgerUpload = { keys: string[]; fileNames: string[]; updatedAt: string };
type TableView = {
  region: string;
  columnFilters: Record<number, string>;
  hiddenColumns: number[];
  salesHidden: boolean;
  filterColumns: number[];
  searchInput: string;
  page: number;
  pageSize: number;
  stripeFilter: "all" | "review";
  columnWidths: Record<number, number>;
};

const T = {
  all: "\u5168\u90e8\u533a\u57df",
  region: "\u533a\u57df",
  customer: "\u5ba2\u6237\u540d\u79f0",
  company: "\u516c\u53f8\u5e94\u6536",
  customerBook: "\u5ba2\u6237\u8d26\u9762\u91d1\u989d",
  difference: "\u5bf9\u8d26\u5dee\u989d",
  transit: "\u5728\u9014\u91d1\u989d",
  returned: "\u9000\u7968\u91d1\u989d",
  lost: "\u4e22\u7968\u91d1\u989d",
  instrument: "\u4eea\u5668\u8bbe\u5907",
  other: "\u5176\u4ed6\u539f\u56e0",
  note: "\u5dee\u989d\u539f\u56e0\u5907\u6ce8",
  badDebt: "\u6b7b\u8d26\u91d1\u989d",
  adjustment: "\u8c03\u8d26\u91d1\u989d",
  cleared: "26\u5e742\u5b63\u5ea6\u662f\u5426\u5bf9\u6e05",
  clear: "\u5bf9\u6e05",
  uncleared: "\u672a\u5bf9\u6e05",
  unreconciled: "\u672a\u5bf9\u8d26",
  local: "\u672c\u673a\u7248",
  import: "\u4e0a\u4f20\u5bf9\u8d26\u5b63\u5ea6\u8868",
  uploadLedger:
    "\u4e0a\u4f20\uff0f\u66ff\u6362\u672c\u5e74\u5f80\u6765\u660e\u7ec6",
  uploadMaterials: "\u5bfc\u5165\u8d44\u6599\u63d0\u4f9b\u60c5\u51b5\u8868",
  uploadCompanyReceivable:
    "\u4e0a\u4f20\u516c\u53f8\u5e94\u6536\u66f4\u65b0\u8868",
  uploadSpdSheet: "\u5bfc\u5165SPD\u8868",
  withdrawQuarter: "\u64a4\u56de\u672c\u5b63\u5ea6\u5bf9\u8d26\u660e\u7ec6",
  importTitle: "\u5b63\u5ea6\u5bf9\u8d26",
  importHint:
    "\u5386\u53f2\u5f80\u6765\u660e\u7ec6\u5df2\u7ecf\u4fdd\u7559\uff1b\u6bcf\u5b63\u5ea6\u4e0a\u4f20\u672c\u5e74\u6700\u65b0\u5f80\u6765\u660e\u7ec6\uff0c\u6838\u9a8c\u65f6\u4f1a\u4e00\u8d77\u67e5\u627e\u3002",
  needImport: "\u8bf7\u5148\u4e0a\u4f20\u5bf9\u8d26\u5b63\u5ea6\u8868",
  sales: "\u9500\u552e\u586b\u5199",
  fill: "\u586b\u5199",
  customerFallback: "\u5ba2\u6237",
  detail: "\u5bf9\u8d26\u660e\u7ec6",
  invoiceDate: "\u5f00\u7968\u65e5\u671f",
  invoice: "\u53d1\u7968\u53f7",
  amount: "\u91d1\u989d",
  reason: "\u5dee\u989d\u8bf4\u660e",
  transitReview: "\u5728\u9014\u91d1\u989d\uff08\u9700\u590d\u6838\uff09",
  returnReview: "\u9000\u7968\u91d1\u989d\uff08\u9700\u590d\u6838\uff09",
  lostReview: "\u4e22\u7968\u91d1\u989d\uff08\u9700\u590d\u6838\uff09",
  instrumentReview: "\u4eea\u5668\u8bbe\u5907\uff08\u9700\u590d\u6838\uff09",
  otherInvoice: "\u5176\u4ed6\uff08\u6709\u53d1\u7968\uff09",
  otherNoInvoice:
    "\u5176\u4ed6\uff08\u65e0\u53d1\u7968\u53ca\u65e0\u6cd5\u9a8c\u8bc1\uff09",
  add: "\uff0b \u65b0\u589e\u4e00\u7b14",
  remove: "\u5220\u9664\u672c\u7b14",
  total: "\u516d\u7c7b\u5dee\u989d\u5408\u8ba1\uff1a",
  compare: "\u4e0e\u5bf9\u8d26\u5dee\u989d\uff1a",
  same: "\u4e00\u81f4",
  different: "\u4e0d\u4e00\u81f4",
  save: "\u4fdd\u5b58\u672c\u6b21\u586b\u5199",
  loading: "\u6b63\u5728\u52a0\u8f7d\u5f80\u6765\u660e\u7ec6\u2026",
  matched: "\u5f80\u6765\u660e\u7ec6\u6838\u9a8c\uff1a\u6b63\u786e",
  missing: "\u5f80\u6765\u660e\u7ec6\u672a\u627e\u5230\u6b64\u53d1\u7968",
  incomplete:
    "\u8bf7\u5b8c\u6574\u586b\u5199\u65e5\u671f\u3001\u53d1\u7968\u53f7\u548c\u91d1\u989d",
  saved: "\u5df2\u4fdd\u5b58\u9500\u552e\u586b\u5199\u5185\u5bb9\u3002",
};
const STORAGE_KEY = "local-quarterly-reconciliation";
const TABLE_VIEW_KEY = "local-quarterly-reconciliation-table-view";
const PG_SELECTED_QUARTER_KEY = "postgres-quarterly-reconciliation-selected-quarter";
const SPD_CONFIRMATION_HEADER = "SPD\u786e\u8ba4\u8868";
const LEGACY_SPD_CONFIRMATION_HEADER = "SPD\u786e\u8ba4\u51fd";
const MATERIAL_HEADERS = [
  "\u5bf9\u8d26\u51fd",
  "\u5bf9\u8d26\u786e\u8ba4\u51fd",
  SPD_CONFIRMATION_HEADER,
  "SPD\u5e93\u5b58\u786e\u8ba4\u51fd",
  "\u5728\u9014\u8bc1\u660e",
  "\u7cbe\u51c6\u6838\u9500",
  "\u50ac\u6b3e\u51fd\u9001\u8fbe\u8bc1\u660e",
];
const RESPONSIBLE_HEADER = "\u5bf9\u8d26\u8d1f\u8d23\u4eba";
let historicalLedgerKeys: Set<string> | null = null;
let historicalLedgerLookup: LedgerLookup = {};
const blankInvoice = (): InvoiceEntry => ({
  date: "",
  invoice: "",
  amount: "",
  note: "",
});
const blankOther = (): OtherEntry => ({ amount: "", note: "", image: "" });
const empty = (): DetailForm => ({
  companyAmount: "",
  customerAmount: "",
  responsible: "",
  transit: [blankInvoice()],
  returned: [blankInvoice()],
  lost: [blankInvoice()],
  instrument: [blankInvoice()],
  otherInvoice: [blankInvoice()],
  other: [blankOther()],
  badDebt: "",
  badDebtReason: "",
  adjustment: "",
  adjustmentReason: "",
  resolutionSolution: "",
  resolutionTime: "",
});
const API_HEADERS = [
  "序号", "账套", T.region, RESPONSIBLE_HEADER, T.customer, T.company,
  T.customerBook, T.difference, T.transit, T.returned, T.lost, T.instrument,
  T.other, T.note, T.badDebt, T.adjustment, T.cleared, "解决方案", "解决时间",
  ...MATERIAL_HEADERS,
];
const summaryLabel: Record<DifferenceType, string> = {
  transit: "在途", returned: "退票", lost: "丢票", instrument: "仪器设备", otherInvoice: "其他（有发票）", other: "其他",
};
const summaryValuesFromDifferenceItems = (items: Array<Pick<DifferenceItem, "category" | "differenceAmount" | "differenceDescription">>) => {
  const amounts: Record<DifferenceType, number> = { transit: 0, returned: 0, lost: 0, instrument: 0, otherInvoice: 0, other: 0 };
  const notes: string[] = [];
  items.forEach((item) => {
    const category = toFormDifferenceCategory(item.category);
    amounts[category] += num(item.differenceAmount);
    if (item.differenceDescription) notes.push(`${summaryLabel[category]}：${item.differenceDescription}`);
  });
  return { amounts, note: notes.join("；") };
};
const apiSheet = (quarter: string, reconciliations: Reconciliation[], material: MaterialStatus[] = [], differenceItems: QuarterDifferenceItem[] = []): LocalSheet => ({
  headers: API_HEADERS,
  fileName: `${quarter}-PostgreSQL`,
  rows: reconciliations.map((row, i) => {
    const byType = new Map(material.filter((item) => item.reconciliationId === row.id).map((item) => [item.materialType, item.rawValue ?? (item.provided ? "已提供" : "")]));
    const summary = summaryValuesFromDifferenceItems(differenceItems.filter((item) => item.reconciliationId === row.id));
    return [
    i + 1, row.accountSet ?? "", row.region ?? "", row.ownerName ?? "", row.customer ?? "",
    row.companyReceivable ?? "", row.customerBookAmount ?? "", row.reconciliationDifference ?? "",
    summary.amounts.transit || "", summary.amounts.returned || "", summary.amounts.lost || "", summary.amounts.instrument || "", summary.amounts.otherInvoice + summary.amounts.other || "", summary.note, row.badDebtAmount ?? "", row.adjustmentAmount ?? "",
    // The server owns this nullable status. Do not manufacture "未对账" for NULL.
    row.reconciliationStatus ?? "", row.solution ?? "", row.solutionDate ?? "",
    ...MATERIAL_HEADERS.map((header) => byType.get(header) ?? ""),
  ];
  }),
  details: Object.fromEntries(reconciliations.map((row, i) => [String(i), {
    ...empty(), companyAmount: row.companyReceivable ?? "", customerAmount: row.customerBookAmount ?? "",
    responsible: row.ownerName ?? "", badDebt: row.badDebtAmount ?? "", badDebtReason: row.badDebtReason ?? "",
    adjustment: row.adjustmentAmount ?? "", adjustmentReason: row.adjustmentReason ?? "",
    resolutionSolution: row.solution ?? "", resolutionTime: row.solutionDate ?? "",
  }])),
});
const formFromDifferenceItems = (base: DetailForm, items: DifferenceItem[]): DetailForm => {
  const next = { ...base };
  (['transit', 'returned', 'lost', 'instrument', 'otherInvoice'] as DifferenceType[]).forEach((category) => {
    next[category] = items.filter((item) => toFormDifferenceCategory(item.category) === category).map((item) => ({ id: item.id, verificationStatus: item.verificationStatus, date: item.invoiceDate ?? "", invoice: item.invoiceNo ?? "", amount: item.differenceAmount ?? "", note: item.differenceDescription ?? "" })) as InvoiceEntry[];
    if (!next[category].length) next[category] = [blankInvoice()];
  });
  next.other = items.filter((item) => toFormDifferenceCategory(item.category) === 'other').map((item) => ({ id: item.id, verificationStatus: item.verificationStatus, amount: item.differenceAmount ?? "", note: item.differenceDescription ?? "", image: item.attachmentKeys.join(",") }));
  if (!next.other.length) next.other = [blankOther()];
  return next;
};
const toPostgresQuarterCode = (quarter: string) => {
  const match = quarter.trim().match(/^(\d{4})\s*-?\s*Q([1-4])$/i);
  return match ? `${match[1]}-Q${match[2]}` : null;
};
const num = (value: unknown) => {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const nullableText = (value: string) => value.trim() || null;
const exactAmount = (value: unknown) => {
  const normalized = String(value ?? "").replace(/[\s,\uFFE5\u00A5]/g, "");
  if (!normalized) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
};
const hasValue = (value: unknown) => {
  const normalizedValue = String(value ?? "").replace(/\s/g, "");
  return !["", "—", "-", "未填写", "未对账", "null", "undefined"].includes(normalizedValue);
};
const money = (value: number) =>
  value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const tableColumnClass = (header: unknown) => {
  const name = String(header);
  if (name.includes("\u8d26\u671f")) return "account-period-cell";
  if (name === T.customer || name.includes("\u5ba2\u6237\u540d\u79f0"))
    return "customer-name-cell";
  if (name === "\u89e3\u51b3\u65b9\u6848") return "resolution-cell";
  if (name === "\u5dee\u989d\u539f\u56e0\u5907\u6ce8")
    return "detail-note-cell";
  return "";
};
const tableColumnHeadingClass = (header: unknown) =>
  tableColumnClass(header) === "detail-note-cell"
    ? "detail-note-heading"
    : tableColumnClass(header) === "resolution-cell"
      ? "resolution-heading"
      : tableColumnClass(header) === "customer-name-cell"
        ? "customer-name-heading"
        : tableColumnClass(header) === "account-period-cell"
          ? "account-period-heading"
          : "";
const tableHeader = (header: unknown) => String(header);
const tableValue = (header: unknown, value: unknown) => {
  const text = String(value ?? "");
  const name = String(header);
  if (
    !text ||
    ![
      T.difference,
      T.company,
      T.customerBook,
      T.transit,
      T.returned,
      T.lost,
      T.instrument,
      T.other,
    ].includes(name)
  )
    return text;
  const amount = Number(text.replace(/,/g, ""));
  return Number.isFinite(amount)
    ? amount.toLocaleString("zh-CN", { maximumFractionDigits: 2 })
    : text;
};
const displayTableValue = (
  header: unknown,
  value: unknown,
  customerAmount: unknown,
) =>
  String(header) === T.difference && !hasValue(customerAmount)
    ? "—"
    : tableValue(header, value) || "—";
const isMoneyHeader = (header: unknown) => {
  const name = String(header).trim();
  return (
    [
    T.company,
    T.customerBook,
    T.difference,
    T.transit,
    T.returned,
    T.lost,
    T.instrument,
    T.other,
    T.badDebt,
    T.adjustment,
    ].includes(name) ||
    /(\u91d1\u989d|\u5dee\u989d)$/.test(name)
  );
};
const matchesColumnFilter = (
  header: unknown,
  cellValue: unknown,
  filterValue: string,
) => {
  const keyword = filterValue.trim();
  if (!keyword) return true;

  if (isMoneyHeader(header)) {
    const expectedAmount = exactAmount(keyword);
    const actualAmount = exactAmount(cellValue);
    return (
      expectedAmount !== null &&
      actualAmount !== null &&
      actualAmount === expectedAmount
    );
  }

  return String(cellValue ?? "")
    .toLocaleLowerCase()
    .includes(keyword.toLocaleLowerCase());
};
const cellClass = (header: unknown, index: number) =>
  [
    tableColumnClass(header),
    isMoneyHeader(header) ? "money-cell" : "",
    [T.company, T.customerBook].includes(String(header)) ? "primary-money" : "",
    String(header) === T.difference ? "difference-cell" : "",
    String(header).includes("是否对清") ? "status-cell" : "",
    index === 0 ? "sticky-index" : "",
    String(header).includes("账套") ? "sticky-account" : "",
    String(header) === T.customer ? "sticky-customer" : "",
  ]
    .filter(Boolean)
    .join(" ");
const clearedBadgeClass = (value: unknown) => {
  const text = String(value ?? "");
  return text === T.clear
    ? "is-cleared"
    : text === T.unreconciled
      ? "is-unreconciled"
      : text === T.uncleared
        ? "is-uncleared"
        : "is-empty";
};
const reorderReviewColumns = (source: LocalSheet) => {
  const review = [T.lost, T.instrument].filter((header) =>
    source.headers.includes(header),
  );
  const returnedAt = source.headers.indexOf(T.returned);
  if (!review.length || returnedAt < 0) return source;
  const base = source.headers.filter((header) => !review.includes(header));
  const insertAt = base.indexOf(T.returned) + 1;
  const headers = [
    ...base.slice(0, insertAt),
    ...review,
    ...base.slice(insertAt),
  ];
  if (headers.every((header, index) => header === source.headers[index]))
    return source;
  const positions = headers.map((header) => source.headers.indexOf(header));
  return {
    ...source,
    headers,
    rows: source.rows.map((row) =>
      positions.map((position) => row[position] ?? ""),
    ),
  };
};
const placeMaterialHeaders = (source: LocalSheet) => {
  const materialHeaders = MATERIAL_HEADERS.filter((header) =>
    source.headers.includes(header),
  );
  const base = source.headers.filter(
    (header) => !MATERIAL_HEADERS.includes(header),
  );
  const solutionAt = base.indexOf("\u89e3\u51b3\u65b9\u6848");
  if (!materialHeaders.length || solutionAt < 0) return source;
  const headers = [
    ...base.slice(0, solutionAt),
    ...materialHeaders,
    ...base.slice(solutionAt),
  ];
  if (headers.every((header, index) => header === source.headers[index]))
    return source;
  const positions = headers.map((header) => source.headers.indexOf(header));
  return {
    ...source,
    headers,
    rows: source.rows.map((row) =>
      positions.map((position) => (position < 0 ? "" : (row[position] ?? ""))),
    ),
  };
};
const ensureMaterialHeaders = (source: LocalSheet) =>
  placeMaterialHeaders({
    ...source,
    headers: [
      ...source.headers,
      ...MATERIAL_HEADERS.filter((header) => !source.headers.includes(header)),
    ],
    rows: source.rows.map((row) => [...row]),
  });
const materialImportAliases = (header: string) =>
  header === SPD_CONFIRMATION_HEADER
    ? [SPD_CONFIRMATION_HEADER, LEGACY_SPD_CONFIRMATION_HEADER]
    : [header];
const companyReceivableImportAliases = [
  T.company,
  "\u516c\u53f8\u5e94\u6536\u91d1\u989d",
  "\u516c\u53f8\u5e94\u6536\uff08\u5143\uff09",
];
const sum = (entries: Array<{ amount: string }>) =>
  entries.reduce((total, entry) => total + num(entry.amount), 0);
// 发票类差额以“发票号”为唯一的填报起点。没有发票号的占位行不属于
// 发票明细，不计入汇总、导出或往来核验；这样旧数据中的 0/0.00 占位值
// 也不会再被保存或误判为一笔待核验发票。
const hasInvoiceNumber = (entry: InvoiceEntry) => Boolean(entry.invoice.trim());
const anyInvoice = hasInvoiceNumber;

const meaningfulInvoiceEntries = (entries?: InvoiceEntry[]) =>
  (entries ?? []).filter(hasInvoiceNumber);
const sumInvoiceEntries = (entries?: InvoiceEntry[]) =>
  sum(meaningfulInvoiceEntries(entries));

const normalizeInvoiceEntries = (entries?: InvoiceEntry[]) => {
  const normalized = meaningfulInvoiceEntries(entries).map((entry) => ({
    ...entry,
    invoice: entry.invoice.trim(),
  }));
  return normalized.length ? normalized : [blankInvoice()];
};
// A stripe identifies every row with an outstanding reconciliation difference.
// It intentionally does not depend on the reconciliation status, so 未对账 rows
// are highlighted as long as their difference amount is non-zero.
const needsDifferenceStripe = (difference: number) =>
  Math.abs(difference) >= 0.01;
const backfillClearedStatus = (source: LocalSheet) => {
  const clearedAt = source.headers.findIndex((header) =>
    String(header).replace(/\s/g, "").includes("是否对清"),
  );
  const companyAt = source.headers.indexOf(T.company),
    customerAt = source.headers.indexOf(T.customerBook);
  if (clearedAt < 0 || companyAt < 0 || customerAt < 0) return source;
  let changed = false;
  const rows = source.rows.map((sourceRow, id) => {
    const detail = source.details?.[String(id)];
    const customerValue = detail?.customerAmount ?? sourceRow[customerAt];
    const filled = hasValue(customerValue);
    const row = [...sourceRow];
    const difference = num(row[companyAt]) - num(customerValue);
    const total = detail
      ? sumInvoiceEntries(detail.transit) +
        sumInvoiceEntries(detail.returned) +
        sumInvoiceEntries(detail.lost ?? []) +
        sumInvoiceEntries(detail.instrument ?? []) +
        sumInvoiceEntries(detail.otherInvoice) +
        sum(detail.other)
      : 0;
    // NULL/empty is authoritative: do not backfill it to “未对账”.
    const status = !filled
      ? row[clearedAt]
      : Math.abs(difference) < 0.01 || Math.abs(difference - total) < 0.01
        ? T.clear
        : T.uncleared;
    if (row[clearedAt] !== status) {
      row[clearedAt] = status;
      changed = true;
    }
    return row;
  });
  return changed ? { ...source, rows } : source;
};
const ledgerKey = (entry: InvoiceEntry) =>
  `${entry.invoice.trim()}|${entry.date.replace(/[^0-9]/g, "").slice(0, 8)}|${num(entry.amount).toFixed(2)}`;
const validLedgerEntry = (
  entry: InvoiceEntry,
  keys: Set<string> | null,
  lookup: LedgerLookup = historicalLedgerLookup,
) => {
  if (!hasInvoiceNumber(entry)) return true;
  if (!entry.date || !entry.invoice || entry.amount === "") return false;
  const matched = lookup[entry.invoice.trim()];
  return Boolean(
    (matched &&
      matched.dates.includes(entry.date) &&
      Math.abs(matched.amount - num(entry.amount)) < 0.01) ||
    keys?.has(ledgerKey(entry)),
  );
};
const findLedgerMatch = (
  invoice: string,
  lookup: LedgerLookup,
  keys: Set<string> | null,
) => {
  const number = invoice.trim();
  if (lookup[number]) return lookup[number];
  if (number.length < 7 || !keys) return null;
  const dates = new Set<string>();
  let amount = 0,
    found = false;
  for (const key of keys) {
    if (!key.startsWith(`${number}|`)) continue;
    const [, date, value] = key.split("|");
    if (date.length !== 8) continue;
    dates.add(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`);
    amount += Number(value);
    found = true;
  }
  return found ? { amount, dates: [...dates].sort() } : null;
};
const normalizeDate = (value: unknown) => {
  const text = String(value ?? "").trim();
  const digits = text.replace(/[^0-9]/g, "");
  if (digits.length === 8) return digits;
  const date = new Date(text);
  if (!Number.isNaN(date.getTime()))
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  return "";
};
const headerIndex = (headers: unknown[], names: string[]) =>
  headers.findIndex((header) => {
    const text = String(header ?? "").replace(/\s/g, "");
    return names.some((name) => text.includes(name));
  });
const dbRequest = <T,>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) =>
  new Promise<T>((resolve, reject) => {
    const open = indexedDB.open("quarterly-reconciliation", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("ledger");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction("ledger", mode);
      const request = action(tx.objectStore("ledger"));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    };
  });
const loadCurrentLedger = () =>
  dbRequest<LedgerUpload | undefined>("readonly", (store) =>
    store.get("current"),
  );
const saveCurrentLedger = (value: LedgerUpload) =>
  dbRequest<IDBValidKey>("readwrite", (store) => store.put(value, "current"));
async function readLedgerSourceFiles(files: File[]) {
  const sourceFiles: { sourceFileName: string; headers: string[]; rows: unknown[][] }[] = [];
  for (const file of files) {
    const workbook = XLSX.read(await file.arrayBuffer(), {
      type: "array",
      cellDates: true,
    });
    for (const sheetName of workbook.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(
        workbook.Sheets[sheetName],
        { header: 1, defval: "", raw: false, dateNF: "yyyy-mm-dd" },
      );
      const headerRow = rows
        .slice(0, 5)
        .find(
          (row) =>
            headerIndex(row, [
              "\u53d1\u7968\u53f7",
              "\u53d1\u7968\u4ee3\u7801",
              "\u5355\u636e\u7f16\u53f7",
              "\u6458\u8981",
            ]) >= 0,
        );
      const start = rows.indexOf(headerRow) + 1;
      if (headerRow && rows.slice(start).some((row) => row.some((value) => String(value ?? "").trim())))
        sourceFiles.push({ sourceFileName: workbook.SheetNames.length > 1 ? `${file.name}#${sheetName}` : file.name, headers: headerRow.map(String), rows: rows.slice(start).filter((row) => row.some((value) => String(value ?? "").trim())) });
    }
  }
  return sourceFiles;
}

export function QuarterlyReconciliation({
  mode = "table",
}: {
  mode?: "table" | "import";
}) {
  const [sheet, setSheet] = useState<LocalSheet | null>(null);
  const [region, setRegion] = useState(T.all);
  const [message, setMessage] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const [form, setForm] = useState<DetailForm>(empty());
  const [activeDifferenceType, setActiveDifferenceType] =
    useState<DifferenceType | null>(null);
  const [speechRecording, setSpeechRecording] = useState(false);
  const [speechMessage, setSpeechMessage] = useState("");
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const [currentLedgerInfo, setCurrentLedgerInfo] =
    useState<LedgerUpload | null>(null);
  const [uploadingLedger, setUploadingLedger] = useState(false);
  const [importingMaterials, setImportingMaterials] = useState(false);
  const [importingSpd, setImportingSpd] = useState(false);
  const [importingCompanyReceivables, setImportingCompanyReceivables] = useState(false);
  const [replacingHistoricalLedger, setReplacingHistoricalLedger] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<number, string>>(
    {},
  );
  const [hiddenColumns, setHiddenColumns] = useState<number[]>([]);
  const [salesHidden, setSalesHidden] = useState(false);
  const [filterColumns, setFilterColumns] = useState<number[]>([]);
  const [filterColumn, rawSetFilterColumn] = useState<number | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [stripeFilter, setStripeFilter] = useState<"all" | "review">("all");
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({});
  const [viewReady, setViewReady] = useState(false);
  const [activeQuarter, setActiveQuarter] = useState("");
  const [archivedQuarters, setArchivedQuarters] = useState<string[]>([]);
  const [postgresQuarters, setPostgresQuarters] = useState<string[]>([]);
  const [apiIds, setApiIds] = useState<string[]>([]);
  const [apiDifferenceItems, setApiDifferenceItems] = useState<Record<string, DifferenceItem[]>>({});
  const [saving, setSaving] = useState(false);
  const mutationSequence = useRef<Map<string, number>>(new Map());
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [importingQuarter, setImportingQuarter] = useState(false);
  const [importedQuarter, setImportedQuarter] = useState("");
  const apiRequest = useRef<AbortController | null>(null);
  const currentPostgresQuarter = () => {
    const quarter = toPostgresQuarterCode(activeQuarter);
    return quarter && postgresQuarters.includes(quarter) ? quarter : null;
  };
  const refreshPostgresImportState = async (quarter: string, includeMaterial = false) => {
    const [reconciliationResult, materialResult, differenceResult] = await Promise.all([
      reconciliationApi.list(quarter),
      includeMaterial ? reconciliationApi.getMaterialStatus(quarter) : Promise.resolve(null),
      reconciliationApi.listQuarterDifferenceItems(quarter),
    ]);
    // The legacy import view persists every sheet change to its archive.  These
    // business imports must only refresh PostgreSQL-backed state, never seed it.
    if (mode !== "import") {
      setSheet(apiSheet(quarter, reconciliationResult.reconciliations, materialResult?.material ?? [], differenceResult.items));
      setApiIds(reconciliationResult.reconciliations.map((item) => item.id));
      setApiDifferenceItems({});
      setRefreshNonce((current) => current + 1);
    }
    window.dispatchEvent(new Event("reconciliation-dashboard-updated"));
  };
  const setFilterColumn = (column: number | null) => {
    rawSetFilterColumn(null);
    if (column !== null)
      setFilterColumns((columns) =>
        columns.includes(column)
          ? columns.filter((item) => item !== column)
          : [...columns, column],
      );
  };
  const stopSolutionRecording = () => {
    speechRecognitionRef.current?.stop();
    speechRecognitionRef.current = null;
    setSpeechRecording(false);
  };
  const toggleSolutionRecording = () => {
    if (speechRecording) {
      stopSolutionRecording();
      return;
    }
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setSpeechMessage("当前浏览器不支持语音转文字，请使用最新版 Chrome 或 Edge。");
      return;
    }
    const recognition = new Recognition();
    let transcript = "";
    recognition.lang = "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        if (event.results[index].isFinal) transcript += event.results[index][0].transcript;
      }
    };
    recognition.onerror = (event) => {
      const errorMessages: Record<string, string> = {
        "not-allowed": "麦克风权限未开启，请允许浏览器使用麦克风后重试。",
        "no-speech": "未识别到语音，请重新开始录音。",
        "network": "语音识别服务连接失败，请检查网络后重试。",
      };
      setSpeechMessage(errorMessages[event.error] ?? "语音转文字失败，请重试。");
    };
    recognition.onend = () => {
      if (transcript.trim()) {
        setForm((current) => ({
          ...current,
          resolutionSolution: `${current.resolutionSolution}${current.resolutionSolution.trim() ? "；" : ""}${transcript.trim()}`,
        }));
        setSpeechMessage("\u8bed\u97f3\u5185\u5bb9\u5df2\u8ffd\u52a0\u5230\u89e3\u51b3\u65b9\u6848\u3002");
      }
      speechRecognitionRef.current = null;
      setSpeechRecording(false);
    };
    try {
      recognition.start();
      speechRecognitionRef.current = recognition;
      setSpeechRecording(true);
      setSpeechMessage("正在录音，请说出解决方案；再次点击即可结束并转为文字。");
    } catch {
      setSpeechMessage("录音启动失败，请稍后重试。");
    }
  };

  useEffect(() => {
    if (mode !== "import") {
      setViewReady(true);
      return;
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setSheet(JSON.parse(saved));
      const savedView = localStorage.getItem(TABLE_VIEW_KEY);
      if (savedView) {
        const view = JSON.parse(savedView) as Partial<TableView>;
        if (view.region) setRegion(view.region);
        if (view.columnFilters) setColumnFilters(view.columnFilters);
        if (view.hiddenColumns) setHiddenColumns(view.hiddenColumns);
        if (typeof view.salesHidden === "boolean")
          setSalesHidden(view.salesHidden);
        if (view.filterColumns) setFilterColumns(view.filterColumns);
        if (typeof view.searchInput === "string")
          setSearchInput(view.searchInput);
        if (typeof view.page === "number") setPage(view.page);
        if (typeof view.pageSize === "number") setPageSize(view.pageSize);
        if (view.stripeFilter) setStripeFilter(view.stripeFilter);
        if (view.columnWidths) setColumnWidths(view.columnWidths);
      }
    } catch {
      /* Keep existing local data untouched if a browser value is invalid. */
    } finally {
      setViewReady(true);
    }
  }, [mode]);
  useEffect(() => {
    if (mode !== "import") return;
    ensureArchiveFromActive();
    const refreshArchive = () => {
      const quarter = selectedQuarter();
      setArchivedQuarters(quarterOptions());
      const archived = sheetForQuarter(quarter);
      if (archived) setSheet(archived as LocalSheet);
    };
    const refreshOptions = () => {
      setArchivedQuarters(quarterOptions());
    };
    refreshArchive();
    window.addEventListener("reconciliation-quarter-selected", refreshArchive);
    window.addEventListener("reconciliation-quarter-updated", refreshOptions);
    return () => {
      window.removeEventListener(
        "reconciliation-quarter-selected",
        refreshArchive,
      );
      window.removeEventListener(
        "reconciliation-quarter-updated",
        refreshOptions,
      );
    };
  }, [mode]);
  useEffect(() => {
    if (mode !== "import") return;
    const controller = new AbortController();
    const loadPostgresQuarter = async () => {
      try {
        const { quarters } = await reconciliationApi.listQuarters(controller.signal);
        if (controller.signal.aborted) return;
        const options = quarters.map((item) => item.code);
        const preferred = toPostgresQuarterCode(localStorage.getItem(PG_SELECTED_QUARTER_KEY) ?? "");
        const quarter = preferred && options.includes(preferred) ? preferred : options[0] ?? "";
        setPostgresQuarters(options);
        setActiveQuarter(quarter);
        if (quarter) localStorage.setItem(PG_SELECTED_QUARTER_KEY, quarter);
      } catch (error) {
        if (!controller.signal.aborted) {
          setPostgresQuarters([]);
          setActiveQuarter("");
          setMessage(error instanceof Error ? `PostgreSQL 季度加载失败：${error.message}` : "PostgreSQL 季度加载失败。");
        }
      }
    };
    void loadPostgresQuarter();
    return () => controller.abort();
  }, [mode]);
  useEffect(() => {
    if (mode === "import") return;
    const controller = new AbortController();
    apiRequest.current?.abort();
    apiRequest.current = controller;
    const load = async () => {
      try {
        const { quarters } = await reconciliationApi.listQuarters(controller.signal);
        const options = quarters.map((item) => item.code);
        const preferredQuarter = localStorage.getItem(PG_SELECTED_QUARTER_KEY) ?? "";
        const quarter = options.includes(activeQuarter)
          ? activeQuarter
          : options.includes(preferredQuarter)
            ? preferredQuarter
            : options[0] ?? "";
        if (!quarter) throw new Error("当前没有可用的 PostgreSQL 对账季度。");
        const [{ reconciliations }, { material }, { items: differenceItems }] = await Promise.all([
          reconciliationApi.list(quarter, controller.signal),
          reconciliationApi.getMaterialStatus(quarter),
          reconciliationApi.listQuarterDifferenceItems(quarter, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setArchivedQuarters(options);
        setActiveQuarter(quarter);
        setApiIds(reconciliations.map((item) => item.id));
        setApiDifferenceItems({});
        setSheet(apiSheet(quarter, reconciliations, material, differenceItems));
        setMessage("");
      } catch (error) {
        if (controller.signal.aborted) return;
        setApiIds([]);
        setApiDifferenceItems({});
        setSheet(null); // Never retain old business data after an API failure.
        setMessage(error instanceof Error ? `PostgreSQL 对账数据加载失败：${error.message}` : "PostgreSQL 对账数据加载失败。");
      }
    };
    void load();
    return () => controller.abort();
  }, [mode, activeQuarter, refreshNonce]);
  useEffect(() => {
    const applyDetailTarget = () => {
      try {
        const raw = localStorage.getItem("reconciliation-detail-target");
        if (!raw) return;
        const target = JSON.parse(raw) as { customer?: string };
        if (target.customer) {
          setSearchInput(target.customer);
          setSearchQuery(target.customer);
          setPage(1);
        }
        // A cockpit drill-down is a one-time navigation aid, not a persistent
        // table filter.  Leaving it in storage would reapply the old customer
        // whenever the detail page is opened again after clearing filters.
        localStorage.removeItem("reconciliation-detail-target");
      } catch {
        localStorage.removeItem("reconciliation-detail-target");
        /* Ignore an invalid deep-link target without affecting the ledger. */
      }
    };
    applyDetailTarget();
    window.addEventListener("reconciliation-open-current-detail", applyDetailTarget);
    return () => window.removeEventListener("reconciliation-open-current-detail", applyDetailTarget);
  }, []);
  useEffect(() => {
    if (mode !== "import" || !sheet || !viewReady) return;
    writeArchivedSheet(sheet);
    setArchivedQuarters(quarterOptions());
  }, [sheet, viewReady, mode]);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setSearchQuery(searchInput.trim()),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  useEffect(() => {
    if (!viewReady) return;
    const view: TableView = {
      region,
      columnFilters,
      hiddenColumns,
      salesHidden,
      filterColumns,
      searchInput,
      page,
      pageSize,
      stripeFilter,
      columnWidths,
    };
    localStorage.setItem(TABLE_VIEW_KEY, JSON.stringify(view));
  }, [
    viewReady,
    region,
    columnFilters,
    hiddenColumns,
    salesHidden,
    filterColumns,
    searchInput,
    page,
    pageSize,
    stripeFilter,
    columnWidths,
  ]);

  const index = (name: string) => sheet?.headers.indexOf(name) ?? -1;
  const clearedIndex =
    sheet?.headers.findIndex((header) =>
      String(header).replace(/\s/g, "").includes("是否对清"),
    ) ?? -1;
  const regionIndex = index(T.region);
  const customerIndex = index(T.customer);
  const companyIndex = index(T.company);
  const customerBookIndex = index(T.customerBook);
  const accountIndex =
    sheet?.headers.findIndex((header) =>
      String(header).replace(/\s/g, "").includes("\u8d26\u5957"),
    ) ?? -1;
  const responsibleIndex =
    sheet?.headers.findIndex((header) =>
      String(header).replace(/\s/g, "").includes(RESPONSIBLE_HEADER),
    ) ?? -1;
  const columnStyle = (column: number) => {
    const width = columnWidths[column];
    const style: Record<string, string | number> = {};
    if (width) {
      style.width = width;
      style.minWidth = width;
    }
    if (column === 0) style.left = 0;
    if (column === accountIndex) style.left = columnWidths[0] ?? 64;
    if (column === customerIndex)
      style.left =
        (columnWidths[0] ?? 64) + (columnWidths[accountIndex] ?? 110);
    return Object.keys(style).length ? style : undefined;
  };
  const startColumnResize = (
    event: ReactPointerEvent<HTMLButtonElement>,
    column: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const header = event.currentTarget.closest("th");
    const startWidth = header?.getBoundingClientRect().width ?? 100;
    const startX = event.clientX;
    const resize = (moveEvent: PointerEvent) =>
      setColumnWidths((widths) => ({
        ...widths,
        [column]: Math.max(
          48,
          Math.round(startWidth + moveEvent.clientX - startX),
        ),
      }));
    const stop = () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop);
  };
  const regions = useMemo(
    () =>
      sheet
        ? Array.from(
            new Set(
              sheet.rows.map((row) =>
                String(row[regionIndex] ?? "\u672a\u586b\u5199"),
              ),
            ),
          )
        : [],
    [sheet, regionIndex],
  );
  const shown = useMemo(
    () =>
      sheet
        ? sheet.rows
            .map((row, id) => ({ row, id }))
            .filter(({ row, id }) => {
              const needle = searchQuery.toLocaleLowerCase();
              const searchable = [
                row[customerIndex],
                row[responsibleIndex],
                row[regionIndex],
              ]
                .map((value) => String(value ?? "").toLocaleLowerCase())
                .join(" ");
              return (
                (region === T.all ||
                  String(row[regionIndex] ?? "\u672a\u586b\u5199") ===
                    region) &&
                (!needle || searchable.includes(needle)) &&
                Object.entries(columnFilters).every(
                  ([column, value]) => {
                    const columnIndex = Number(column);
                    return matchesColumnFilter(
                      sheet.headers[columnIndex],
                      row[columnIndex],
                      value,
                    );
                  },
                ) &&
                (stripeFilter === "all" ||
                  needsDifferenceStripe(num(row[index(T.difference)])))
              );
            })
        : [],
    [
      sheet,
      region,
      regionIndex,
      customerIndex,
      responsibleIndex,
      searchQuery,
      columnFilters,
      stripeFilter,
    ],
  );
  const pageCount = Math.max(1, Math.ceil(shown.length / pageSize));
  const pagedRows = shown.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    setPage(1);
  }, [region, searchQuery, columnFilters, stripeFilter, pageSize]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  const saveSheet = (next: LocalSheet, syncDashboards = false) => {
    const headers = [...next.headers];
    const solution = "\u89e3\u51b3\u65b9\u6848",
      time = "\u89e3\u51b3\u65f6\u95f4";
    if (!headers.includes(T.lost)) headers.push(T.lost);
    if (!headers.includes(T.instrument)) headers.push(T.instrument);
    if (!headers.includes(solution)) headers.push(solution);
    if (!headers.includes(time)) headers.push(time);
    MATERIAL_HEADERS.forEach((header) => {
      if (!headers.includes(header)) headers.push(header);
    });
    const ordered = placeMaterialHeaders(
      reorderReviewColumns({
        ...next,
        headers,
        rows: next.rows.map((row) => [...row]),
      }),
    );
    const rows = ordered.rows.map((row) => [...row]);
    Object.entries(ordered.details ?? {}).forEach(([id, detail]) => {
      const row = rows[Number(id)];
      if (row) {
        row[ordered.headers.indexOf(T.lost)] = sumInvoiceEntries(detail.lost ?? []);
        row[ordered.headers.indexOf(T.instrument)] = sumInvoiceEntries(
          detail.instrument ?? [],
        );
        row[ordered.headers.indexOf(solution)] = detail.resolutionSolution;
        row[ordered.headers.indexOf(time)] = detail.resolutionTime;
      }
    });
    const saved = { ...ordered, rows };
    setSheet(saved);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    window.dispatchEvent(new Event("reconciliation-updated"));
    if (syncDashboards) {
      writeArchivedSheet(saved);
      updateDashboardSnapshot();
    }
  };
  const changeQuarter = (quarter: string) => {
    if (mode !== "import") {
      localStorage.setItem(PG_SELECTED_QUARTER_KEY, quarter);
      setActiveQuarter(quarter);
      setRegion(T.all);
      setPage(1);
      return;
    }
    const postgresQuarter = toPostgresQuarterCode(quarter);
    if (!postgresQuarter || !postgresQuarters.includes(postgresQuarter)) return;
    localStorage.setItem(PG_SELECTED_QUARTER_KEY, postgresQuarter);
    setActiveQuarter(postgresQuarter);
    setRegion(T.all);
    setPage(1);
    setMessage(`已切换至 ${postgresQuarter} 季度。`);
  };
  const setCell = (row: unknown[], name: string, value: string | number) => {
    const i = index(name);
    if (i >= 0) row[i] = value;
  };
  const updateResponsible = (value: string) => {
    const nextForm = { ...form, responsible: value };
    setForm(nextForm);
    if (mode !== "import") return;
    if (!sheet || active === null || responsibleIndex < 0) return;
    const rows = sheet.rows.map((row) => [...row]);
    rows[active][responsibleIndex] = value;
    saveSheet({
      ...sheet,
      rows,
      details: { ...(sheet.details ?? {}), [String(active)]: nextForm },
    });
  };
  const hideColumn = (column: number) => {
    setHiddenColumns((columns) =>
      columns.includes(column) ? columns : [...columns, column],
    );
    setFilterColumns((columns) => columns.filter((item) => item !== column));
  };
  const toggleFilterColumn = (column: number) =>
    setFilterColumns((columns) =>
      columns.includes(column)
        ? columns.filter((item) => item !== column)
        : [...columns, column],
    );
  const exportTable = () => {
    if (!sheet) return;
    const columns = sheet.headers
      .map((header, index) => ({ header, index }))
      .filter(({ index }) => !hiddenColumns.includes(index));
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      columns.map((column) => column.header),
      ...shown.map(({ row }) =>
        columns.map(({ header, index }) =>
          displayTableValue(header, row[index], row[customerBookIndex]),
        ),
      ),
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, "本季度对账明细");

    // Keep the summary table compact, while exporting every sales-entered
    // difference item at invoice level in its own sheet.  This keeps an
    // invoice's date, number, amount and explanation together instead of
    // only exporting the aggregated six-category totals on the main row.
    const differenceHeaders = [
      "主表序号",
      "差额分类",
      "账套",
      "区域",
      "客户名称",
      "对账负责人",
      "开票日期",
      "发票号",
      "差额金额（元）",
      "差额说明",
      "图片附件",
    ];
    const differenceRows = shown.flatMap(({ row, id }) => {
      const detail = sheet.details?.[String(id)];
      if (!detail) return [];
      const base = [
        row[0] ?? id + 1,
        "",
        accountIndex >= 0 ? row[accountIndex] ?? "" : "",
        regionIndex >= 0 ? row[regionIndex] ?? "" : "",
        customerIndex >= 0 ? row[customerIndex] ?? "" : "",
        detail.responsible || (responsibleIndex >= 0 ? row[responsibleIndex] ?? "" : ""),
      ];
      return DIFFERENCE_SUMMARIES.flatMap((category) =>
        entriesFor(detail, category.type)
          .filter((entry) =>
            category.invoice
              ? anyInvoice(entry as InvoiceEntry)
              : num(entry.amount) !== 0 || Boolean(entry.note.trim()) || Boolean((entry as OtherEntry).image),
          )
          .map((entry) => {
            const invoiceEntry = entry as InvoiceEntry;
            const otherEntry = entry as OtherEntry;
            return [
              ...base.slice(0, 1),
              category.label,
              ...base.slice(2),
              category.invoice ? invoiceEntry.date : "",
              category.invoice ? invoiceEntry.invoice : "",
              entry.amount === "" ? "" : num(entry.amount),
              entry.note,
              category.invoice ? "" : otherEntry.image ? "已上传" : "",
            ];
          }),
      );
    });
    const differenceSheet = XLSX.utils.aoa_to_sheet([
      differenceHeaders,
      ...differenceRows,
    ]);
    differenceSheet["!cols"] = [
      { wch: 10 }, { wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 28 },
      { wch: 14 }, { wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 42 }, { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(workbook, differenceSheet, "差额发票明细");
    XLSX.writeFile(
      workbook,
      `${sheet.fileName.replace(/\.(xlsx|xls)$/i, "")}-导出.xlsx`,
    );
  };
  const refreshTable = () => {
    if (mode !== "import") {
      setRefreshNonce((value) => value + 1);
      return;
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved)
        setSheet(
          reorderReviewColumns(backfillClearedStatus(JSON.parse(saved))),
        );
    } catch {
      /* Keep the currently visible sheet if the saved copy is unavailable. */
    }
    setRegion(T.all);
    setStripeFilter("all");
    setColumnFilters({});
    setFilterColumns([]);
    setHiddenColumns([]);
    setSalesHidden(false);
    setMessage("已刷新表格，并恢复全部明细。");
  };
  const updateDashboards = () => {
    const count = updateDashboardSnapshot();
    setMessage(
      count
        ? `已将 ${count} 条本年度对账记录更新到其他看板。`
        : "暂无可更新的本年度对账数据。",
    );
  };

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || importingQuarter) return;
    let serverImportedQuarter = "";
    try {
      setImportingQuarter(true);
      setMessage("正在解析 Excel…");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const all = XLSX.utils.sheet_to_json<unknown[]>(
        wb.Sheets[wb.SheetNames[0]],
        { header: 1, defval: "" },
      );
      const headers = (all[0] ?? []).map(String);
      const rows = all
        .slice(1)
        .filter((row) => row.some((value) => value !== ""));
      if (!headers.length || !rows.length)
        throw new Error(
          "\u6ca1\u6709\u8bfb\u53d6\u5230\u53ef\u7528\u7684\u8868\u5934\u6216\u6570\u636e\u3002",
        );
      const quarter = toPostgresQuarterCode(quarterOf(file.name, headers, rows));
      if (!quarter)
        throw new Error("无法从对账时间点或季度信息识别导入季度，未提交数据库。");
      setMessage("正在写入数据库…");
      const result = await reconciliationApi.importQuarter(quarter, {
        sourceFileName: file.name,
        headers,
        rows,
      });
      serverImportedQuarter = result.quarter;
      const { quarters } = await reconciliationApi.listQuarters();
      if (!quarters.some((item) => item.code === result.quarter))
        throw new Error("导入已返回成功，但刷新季度列表未找到该季度，请刷新后核验。");
      recordImport({
        fileName: file.name,
        importedAt: new Date().toISOString(),
        dataType: "reconciliation",
        description: "PostgreSQL 季度对账表导入（仅本机兼容记录）。",
        recordCount: result.importedRows,
        targetStore: "PostgreSQL import_batches（本机兼容记录）",
        quarter: result.quarter,
        status: "success",
        stats: { inserted: result.importedRows },
      });
      localStorage.setItem(PG_SELECTED_QUARTER_KEY, result.quarter);
      selectQuarter(result.quarter);
      setImportedQuarter(result.quarter);
      setRegion(T.all);
      setMessage(`导入成功：${result.quarter} 共 ${result.importedRows} 条，正在显示 PostgreSQL 最新数据。`);
      window.dispatchEvent(new Event("reconciliation-open-postgres-quarter"));
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      const errorMessage = error instanceof Error ? error.message : "";
      setMessage(
        serverImportedQuarter
          ? `导入已成功写入 PostgreSQL（${serverImportedQuarter}），但刷新季度列表失败：${errorMessage || "请刷新页面核验。"}`
          : code === "QUARTER_HAS_EXISTING_DATA" || errorMessage.includes("QUARTER_HAS_EXISTING_DATA")
          ? "该季度已经存在业务数据。为防止覆盖销售已填写的对账数据，当前不允许直接重新导入。"
          : code === "IMPORT_ALREADY_EXISTS" || errorMessage.includes("IMPORT_ALREADY_EXISTS")
            ? "该文件/数据已经导入，请勿重复导入。"
            : error instanceof Error
              ? `导入失败：${error.message}`
              : "导入失败。",
      );
    } finally {
      setImportingQuarter(false);
      event.target.value = "";
    }
  }
  async function importMaterials(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const quarter = currentPostgresQuarter();
    if (!quarter) {
      setMessage("当前没有有效的 PostgreSQL 季度，无法导入资料提供情况表。");
      event.target.value = "";
      return;
    }
    setImportingMaterials(true);
    try {
      setMessage("正在解析 Excel…");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const all = XLSX.utils.sheet_to_json<unknown[]>(
        workbook.Sheets[workbook.SheetNames[0]],
        { header: 1, defval: "" },
      );
      const sourceHeaders = (all[0] ?? []).map(String);
      const sourceRows = all
        .slice(1)
        .filter((row) =>
          row.some((value) => String(value ?? "").trim() !== ""),
        );
      if (!sourceHeaders.length || !sourceRows.length) throw new Error("资料提供情况表未读取到可用的表头或数据。");
      setMessage("正在写入数据库…");
      const result = await reconciliationApi.importMaterials(quarter, { sourceFileName: file.name, headers: sourceHeaders, rows: sourceRows });
      await refreshPostgresImportState(quarter, true);
      recordImport({
        fileName: file.name,
        importedAt: new Date().toISOString(),
        dataType: "materials",
        description: "客户资料提供状态数据。",
        recordCount: result.writtenMaterialCells,
        targetStore: "PostgreSQL · recon.material_status",
        quarter,
        status: result.status === "PARTIAL" ? "partial" : "success",
        stats: { updated: result.matchedRows, skipped: result.unmatchedRows },
      });
      setMessage(
        `资料提供情况已导入：匹配 ${result.matchedRows} 条，未匹配 ${result.unmatchedRows} 条。`,
      );
    } catch (error) {
      recordImport({
        fileName: file.name,
        importedAt: new Date().toISOString(),
        dataType: "materials",
        description:
          error instanceof Error ? error.message : "资料提供情况表导入失败。",
        targetStore: "PostgreSQL · materials/import",
        quarter,
        status: "failed",
        stats: { errors: 1 },
      });
      setMessage(
        error instanceof Error
          ? error.message
          : "\u8d44\u6599\u63d0\u4f9b\u60c5\u51b5\u8868\u5bfc\u5165\u5931\u8d25\u3002",
      );
    }
    finally { setImportingMaterials(false); }
    event.target.value = "";
  }
  async function importCompanyReceivables(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    if (!file) return;
    const quarter = currentPostgresQuarter();
    if (!quarter) {
      setMessage("当前没有有效的 PostgreSQL 季度，无法上传公司应收更新表。");
      event.target.value = "";
      return;
    }
    setImportingCompanyReceivables(true);
    try {
      setMessage("正在解析 Excel…");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const all = XLSX.utils.sheet_to_json<unknown[]>(
        workbook.Sheets[workbook.SheetNames[0]],
        { header: 1, defval: "" },
      );
      const sourceHeaders = (all[0] ?? []).map(String);
      const sourceRows = all
        .slice(1)
        .filter((row) =>
          row.some((value) => String(value ?? "").trim() !== ""),
        );
      if (!sourceHeaders.length || !sourceRows.length) throw new Error("公司应收更新表未读取到可用的表头或数据。");
      setMessage("正在写入数据库…");
      const result = await reconciliationApi.importCompanyReceivables(quarter, { sourceFileName: file.name, headers: sourceHeaders, rows: sourceRows });
      await refreshPostgresImportState(quarter, true);
      recordImport({
        fileName: file.name,
        importedAt: new Date().toISOString(),
        dataType: "companyReceivable",
        description: "公司应收更新数据。",
        recordCount: result.updatedRows,
        targetStore: "PostgreSQL · recon.reconciliations.company_receivable",
        quarter,
        status: result.status === "PARTIAL" ? "partial" : "success",
        stats: { updated: result.updatedRows, skipped: result.unmatchedRows + result.ambiguousRows },
      });
      setMessage(
        `公司应收更新完成：匹配 ${result.matchedRows} 条，更新 ${result.updatedRows} 条，未匹配 ${result.unmatchedRows} 条${result.ambiguousRows ? `；有 ${result.ambiguousRows} 行匹配到多个客户记录，系统未自动更新，请人工核对。` : "。"}`,
      );
    } catch (error) {
      recordImport({
        fileName: file.name,
        importedAt: new Date().toISOString(),
        dataType: "companyReceivable",
        description: error instanceof Error ? error.message : "公司应收更新表上传失败。",
        targetStore: "PostgreSQL · company-receivables/import",
        quarter,
        status: "failed",
        stats: { errors: 1 },
      });
      setMessage(
        error instanceof Error
          ? error.message
          : "\u516c\u53f8\u5e94\u6536\u66f4\u65b0\u8868\u4e0a\u4f20\u5931\u8d25\u3002",
      );
    }
    finally { setImportingCompanyReceivables(false); }
    event.target.value = "";
  }
  async function importSpdSheet(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const quarter = currentPostgresQuarter();
    if (!quarter) {
      setMessage("当前没有有效的 PostgreSQL 季度，无法导入 SPD 表。");
      event.target.value = "";
      return;
    }
    setImportingSpd(true);
    try {
      setMessage("正在解析 Excel…");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const all = XLSX.utils.sheet_to_json<unknown[]>(
        workbook.Sheets[workbook.SheetNames[0]],
        { header: 1, defval: "" },
      );
      const headers = (all[0] ?? []).map(String);
      const rows = all
        .slice(1)
        .filter((row) => row.some((value) => String(value ?? "").trim() !== ""));
      if (!headers.length || !rows.length)
        throw new Error("SPD\u8868\u672a\u8bfb\u53d6\u5230\u53ef\u7528\u7684\u8868\u5934\u6216\u6570\u636e\u3002");
      if (
        headerIndex(headers, ["SPD\u786e\u8ba4\u8868", "SPD\u786e\u8ba4\u51fd"]) < 0 &&
        headerIndex(headers, ["SPD\u5e93\u5b58\u786e\u8ba4\u51fd"]) < 0
      )
        throw new Error(
          "SPD\u8868\u5fc5\u987b\u81f3\u5c11\u5305\u542bSPD\u786e\u8ba4\u8868\u6216SPD\u5e93\u5b58\u786e\u8ba4\u51fd\u5217\u3002",
        );
      setMessage("正在写入数据库…");
      const result = await reconciliationApi.importSpdDashboard(quarter, { sourceFileName: file.name, headers, rows });
      await reconciliationApi.getSpdDashboard(quarter);
      window.dispatchEvent(new Event("reconciliation-dashboard-updated"));
      recordImport({
        fileName: file.name,
        importedAt: new Date().toISOString(),
        dataType: "spd",
        description: "SPD 确认表和 SPD 库存确认函数据。",
        recordCount: result.replacedRows,
        targetStore: "PostgreSQL · recon.spd_dashboard_rows",
        quarter,
        status: "success",
        stats: { inserted: result.replacedRows },
      });
      setMessage(`SPD 表已替换：${result.replacedRows} 条记录，已刷新看板数据。`);
    } catch (error) {
      recordImport({
        fileName: file.name,
        importedAt: new Date().toISOString(),
        dataType: "spd",
        description: error instanceof Error ? error.message : "SPD表导入失败。",
        targetStore: "PostgreSQL · spd-dashboard/import",
        quarter,
        status: "failed",
        stats: { errors: 1 },
      });
      setMessage(
        error instanceof Error ? error.message : "SPD\u8868\u5bfc\u5165\u5931\u8d25\u3002",
      );
    }
    finally { setImportingSpd(false); }
    event.target.value = "";
  }
  async function importCurrentLedger(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    const quarterCode = toPostgresQuarterCode(activeQuarter);
    if (!quarterCode || !postgresQuarters.includes(quarterCode)) {
      setMessage("当前没有有效的 PostgreSQL 季度，无法上传本年往来明细。");
      event.target.value = "";
      return;
    }
    setUploadingLedger(true);
    try {
      setMessage("正在解析 Excel…");
      const sourceFiles = await readLedgerSourceFiles(files);
      if (!sourceFiles.length)
        throw new Error(
          "没有从文件中读取到可导入的表头和数据行。",
        );
      setMessage("正在写入数据库…");
      const result = await reconciliationApi.importQuarterLedger(quarterCode, { sourceFiles });
      recordImport({
        fileName: result.sourceFiles.join("、"),
        importedAt: new Date().toISOString(),
        dataType: "ledger",
        description: "本年往来明细数据。",
        recordCount: result.insertedRows,
        targetStore: "PostgreSQL · recon.ledger_datasets / ledger_verification_entries",
        quarter: quarterCode,
        status: "success",
        stats: { inserted: result.insertedRows },
      });
      setCurrentLedgerInfo({ keys: [], fileNames: result.sourceFiles, updatedAt: new Date().toLocaleString("zh-CN") });
      setMessage(
        `本年往来明细上传成功：${result.insertedRows} 条记录。`,
      );
    } catch (error) {
      const code = error instanceof ReconciliationApiError ? error.code : "";
      const description = code === "LEDGER_QUARTER_DATA_ALREADY_EXISTS"
        ? "当前季度已存在本年往来明细，暂不支持直接覆盖，请确认后续替换策略。"
        : error instanceof Error ? error.message : "往来明细上传失败。";
      recordImport({
        fileName: files.map((file) => file.name).join("、"),
        importedAt: new Date().toISOString(),
        dataType: "ledger",
        description,
        targetStore: "PostgreSQL · ledger/import",
        quarter: quarterCode,
        status: "failed",
        stats: { errors: 1 },
      });
      setMessage(description);
    } finally {
      setUploadingLedger(false);
      event.target.value = "";
    }
  }
  async function open(id: number) {
    if (!sheet) return;
    const row = sheet.rows[id];
    const old = sheet.details?.[String(id)];
    const value = (name: string) => String(row[index(name)] ?? "");
    const base =
      old
        ? {
            ...empty(),
            ...old,
            companyAmount: old.companyAmount ?? String(row[companyIndex] ?? ""),
            responsible: old.responsible ?? String(row[responsibleIndex] ?? ""),
            transit: normalizeInvoiceEntries(old.transit),
            returned: normalizeInvoiceEntries(old.returned),
            lost: normalizeInvoiceEntries(old.lost),
            instrument: normalizeInvoiceEntries(old.instrument),
            otherInvoice: normalizeInvoiceEntries(old.otherInvoice),
          }
        : {
            ...empty(),
            companyAmount: value(T.company),
            customerAmount: value(T.customerBook),
            responsible: String(row[responsibleIndex] ?? ""),
            // 对账表中的分类金额只是汇总值，不能自动生成没有发票号的
            // 发票明细。发票类明细必须由销售填写真实发票号后才参与核验。
            badDebt: value(T.badDebt),
            adjustment: value(T.adjustment),
          };
    setForm(base);
    setActive(id);
    if (mode !== "import") {
      const reconciliationId = apiIds[id];
      if (!reconciliationId || !activeQuarter) return;
      try {
        const { items } = await reconciliationApi.listDifferenceItems(activeQuarter, reconciliationId);
        setApiDifferenceItems((current) => ({ ...current, [reconciliationId]: items }));
        setForm(formFromDifferenceItems(base, items));
      } catch (error) {
        setActive(null);
        setMessage(error instanceof Error ? `差额明细加载失败：${error.message}` : "差额明细加载失败。");
      }
    }
  }
  async function importHistoricalLedger(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    if (!window.confirm("替换后，新历史往来底库将成为当前核验版本；旧版本会保留，不会删除。是否继续？")) {
      event.target.value = "";
      return;
    }
    setReplacingHistoricalLedger(true);
    try {
      setMessage("正在解析 Excel…");
      const sourceFiles = await readLedgerSourceFiles(files);
      if (!sourceFiles.length) throw new Error("没有从文件中读取到可导入的历史往来数据。");
      setMessage("正在替换历史往来底库…");
      const result = await reconciliationApi.replaceHistoricalLedger({ sourceFiles });
      recordImport({
        fileName: result.sourceFiles.join("、"), importedAt: new Date().toISOString(), dataType: "historicalLedger",
        description: "历史往来底库 PostgreSQL 版本替换（本机兼容记录）。", recordCount: result.insertedRows,
        targetStore: "PostgreSQL · recon.ledger_datasets / ledger_verification_entries", quarter: "",
        status: "success", stats: { inserted: result.insertedRows },
      });
      setMessage(`历史往来底库已更新为 V${result.version}，共导入 ${result.insertedRows} 条核验记录。`);
    } catch (error) {
      const code = error instanceof ReconciliationApiError ? error.code : "";
      const description = code === "IMPORT_ALREADY_EXISTS" ? "该文件已导入，无需重复上传。" : error instanceof Error ? error.message : "历史往来底库替换失败。";
      recordImport({
        fileName: files.map((file) => file.name).join("、"), importedAt: new Date().toISOString(), dataType: "historicalLedger",
        description, recordCount: 0, targetStore: "PostgreSQL · ledger/historical/import", quarter: "", status: "failed", stats: { errors: 1 },
      });
      setMessage(description);
    } finally {
      setReplacingHistoricalLedger(false);
      event.target.value = "";
    }
  }
  async function commit() {
    if (!sheet || active === null) return;
    const needsCheck = [
      ...form.transit,
      ...form.returned,
      ...form.lost,
      ...form.instrument,
      ...form.otherInvoice,
    ].filter(hasInvoiceNumber);
    if (mode !== "import") {
      const reconciliationId = apiIds[active];
      if (!reconciliationId || !activeQuarter) return;
      if (saving) return;
      const mutationKey = `reconciliation:${reconciliationId}`;
      const sequence = (mutationSequence.current.get(mutationKey) ?? 0) + 1;
      mutationSequence.current.set(mutationKey, sequence);
      const desired = (FORM_DIFFERENCE_CATEGORIES as DifferenceType[]).flatMap((category) => {
        const entries = category === 'other' ? form.other : form[category] as InvoiceEntry[];
        return entries.filter((entry) => category === 'other'
          ? num(entry.amount) !== 0 || entry.note.trim() || Boolean((entry as OtherEntry).image)
          : hasInvoiceNumber(entry as InvoiceEntry)).map((entry) => ({
            id: entry.id, formCategory: category, category: toApiDifferenceCategory(category), invoiceNo: category === 'other' ? null : (entry as InvoiceEntry).invoice || null,
            invoiceDate: category === 'other' ? null : (entry as InvoiceEntry).date || null,
            differenceAmount: entry.amount || null, differenceDescription: entry.note || null,
            // This UI only round-trips approved attachment keys. It never uploads or reads binary data.
            attachmentKeys: category === 'other' ? String((entry as OtherEntry).image ?? '').split(',').map((key) => key.trim()).filter((key) => key && !key.startsWith('data:')) : [],
          }));
      });
      try {
        setSaving(true);
        setMessage("正在保存到 PostgreSQL…");
        const original = sheet.details?.[String(active)];
        const reconciliationPatch = {
          ...(nullableText(form.customerAmount) !== nullableText(original?.customerAmount ?? "") ? { customerBookAmount: nullableText(form.customerAmount) } : {}),
          ...(nullableText(form.responsible) !== nullableText(original?.responsible ?? "") ? { ownerName: nullableText(form.responsible) } : {}),
          ...(nullableText(form.badDebt) !== nullableText(original?.badDebt ?? "") ? { badDebtAmount: nullableText(form.badDebt) } : {}),
          ...(nullableText(form.badDebtReason) !== nullableText(original?.badDebtReason ?? "") ? { badDebtReason: nullableText(form.badDebtReason) } : {}),
          ...(nullableText(form.adjustment) !== nullableText(original?.adjustment ?? "") ? { adjustmentAmount: nullableText(form.adjustment) } : {}),
          ...(nullableText(form.adjustmentReason) !== nullableText(original?.adjustmentReason ?? "") ? { adjustmentReason: nullableText(form.adjustmentReason) } : {}),
          ...(nullableText(form.resolutionSolution) !== nullableText(original?.resolutionSolution ?? "") ? { solution: nullableText(form.resolutionSolution) } : {}),
          ...(nullableText(form.resolutionTime) !== nullableText(original?.resolutionTime ?? "") ? { solutionDate: nullableText(form.resolutionTime) } : {}),
        };
        if (Object.keys(reconciliationPatch).length) await reconciliationApi.patch(activeQuarter, reconciliationId, reconciliationPatch);
        const differenceMutations = planDifferenceItemMutations(apiDifferenceItems[reconciliationId] ?? [], desired);
        for (const item of differenceMutations.patch) await reconciliationApi.patchDifferenceItem(activeQuarter, reconciliationId, item.id, item.body);
        for (const item of differenceMutations.delete) await reconciliationApi.deleteDifferenceItem(activeQuarter, reconciliationId, item);
        for (const item of differenceMutations.create) await reconciliationApi.createDifferenceItem(activeQuarter, reconciliationId, item);
        // The detail form owns reconciliation fields only. Followup items and
        // events are managed exclusively by the unresolved-followup dashboard.
        // Re-read confirmed server state; do not retain an optimistic local copy.
        const [{ reconciliations }, { items }, { material }, { items: differenceItems }] = await Promise.all([
          reconciliationApi.list(activeQuarter), reconciliationApi.listDifferenceItems(activeQuarter, reconciliationId), reconciliationApi.getMaterialStatus(activeQuarter), reconciliationApi.listQuarterDifferenceItems(activeQuarter),
        ]);
        if (mutationSequence.current.get(mutationKey) === sequence) {
          setSheet(apiSheet(activeQuarter, reconciliations, material, differenceItems));
          setApiIds(reconciliations.map((item) => item.id));
          setApiDifferenceItems((currentItems) => ({ ...currentItems, [reconciliationId]: items }));
          setMessage("已保存到 PostgreSQL。显示内容已按服务端确认结果刷新。");
          stopSolutionRecording();
          setActive(null);
        }
      } catch (error) {
        if (mutationSequence.current.get(mutationKey) === sequence) setMessage(error instanceof Error ? `保存失败：${error.message}。未使用本地数据回退。` : "保存失败；未使用本地数据回退。");
      } finally {
        if (mutationSequence.current.get(mutationKey) === sequence) setSaving(false);
      }
      return;
    }
    const company = num(form.companyAmount);
    const customer = num(form.customerAmount);
    const difference = company - customer;
    const transit = sumInvoiceEntries(form.transit);
    const returned = sumInvoiceEntries(form.returned);
    const lost = sumInvoiceEntries(form.lost);
    const instrument = sumInvoiceEntries(form.instrument);
    const otherInvoice = sumInvoiceEntries(form.otherInvoice);
    const other = sum(form.other);
    const total = transit + returned + lost + instrument + otherInvoice + other;
    const rows = sheet.rows.map((row) => [...row]);
    const row = rows[active];
    setCell(row, T.customerBook, form.customerAmount === "" ? "" : customer);
    setCell(row, T.difference, form.customerAmount === "" ? "" : difference);
    setCell(row, T.transit, transit);
    setCell(row, T.returned, returned);
    setCell(row, T.lost, lost);
    setCell(row, T.instrument, instrument);
    setCell(row, T.other, otherInvoice + other);
    setCell(row, T.badDebt, form.badDebt);
    setCell(row, T.adjustment, form.adjustment);
    const notes = [
      ...meaningfulInvoiceEntries(form.transit).map((e) => e.note && `在途：${e.note}`),
      ...meaningfulInvoiceEntries(form.returned).map((e) => e.note && `退票：${e.note}`),
      ...meaningfulInvoiceEntries(form.lost).map((e) => e.note && `丢票：${e.note}`),
      ...meaningfulInvoiceEntries(form.instrument).map((e) => e.note && `仪器设备：${e.note}`),
      ...meaningfulInvoiceEntries(form.otherInvoice).map((e) => e.note && `其他（有发票）：${e.note}`),
      ...form.other.map((e) => e.note && `其他：${e.note}`),
    ]
      .filter(Boolean)
      .join("；");
    setCell(row, T.note, notes);
    if (clearedIndex >= 0)
      row[clearedIndex] =
        form.customerAmount === ""
          ? T.unreconciled
          : Math.abs(difference) < 0.01 || Math.abs(difference - total) < 0.01
            ? T.clear
            : T.uncleared;
    saveSheet({
      ...sheet,
      rows,
      details: {
        ...(sheet.details ?? {}),
        [String(active)]: {
          ...form,
          transit: normalizeInvoiceEntries(form.transit),
          returned: normalizeInvoiceEntries(form.returned),
          lost: normalizeInvoiceEntries(form.lost),
          instrument: normalizeInvoiceEntries(form.instrument),
          otherInvoice: normalizeInvoiceEntries(form.otherInvoice),
        },
      },
    });
    setMessage(T.saved);
    stopSolutionRecording();
    setActive(null);
  }
  async function refreshTransferredDifferenceItems() {
    if (active === null || !activeQuarter) return;
    const reconciliationId = apiIds[active];
    if (!reconciliationId) return;
    const [{ items }, { reconciliations }, { material }, { items: quarterItems }] = await Promise.all([
      reconciliationApi.listDifferenceItems(activeQuarter, reconciliationId),
      reconciliationApi.list(activeQuarter),
      reconciliationApi.getMaterialStatus(activeQuarter),
      reconciliationApi.listQuarterDifferenceItems(activeQuarter),
    ]);
    setApiDifferenceItems((current) => ({ ...current, [reconciliationId]: items }));
    setSheet(apiSheet(activeQuarter, reconciliations, material, quarterItems));
    setForm((current) => formFromDifferenceItems(current, items));
    setMessage("已按服务端确认结果刷新差额明细。");
    window.dispatchEvent(new Event("reconciliation-dashboard-updated"));
  }

  const company = num(form.companyAmount);
  const difference = company - num(form.customerAmount);
  const total =
    sumInvoiceEntries(form.transit) +
    sumInvoiceEntries(form.returned) +
    sumInvoiceEntries(form.lost) +
    sumInvoiceEntries(form.instrument) +
    sumInvoiceEntries(form.otherInvoice) +
    sum(form.other);
  const isClear =
    form.customerAmount !== "" &&
    (Math.abs(difference) < 0.01 || Math.abs(difference - total) < 0.01);

  return (
    <>
      <section
        className={`local-tool ${mode === "import" ? "data-import-tool" : "detail-table-tool"}`}
      >
        <div className="local-toolbar">
          <div>
            <p className="eyebrow">
              {mode === "import" ? "数据导入" : T.local}
            </p>
            <h2>{mode === "import" ? "数据导入" : "本季度对账详细情况"}</h2>
            <p>
              {mode === "import"
                ? T.importHint
                : "查看、筛选、填写和导出本年度对账明细。"}
            </p>
          </div>
          {mode === "import" ? (
            <div className="toolbar-actions upload-actions">
              <label className="file-button ledger-upload">
                {uploadingLedger ? T.loading : T.uploadLedger}
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  multiple
                  disabled={uploadingLedger}
                  onChange={importCurrentLedger}
                />
              </label>
              <label className="file-button materials-upload">
                {importingMaterials ? T.loading : T.uploadMaterials}
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  disabled={importingMaterials}
                  onChange={importMaterials}
                />
              </label>
              <label className="file-button materials-upload">
                {importingSpd ? T.loading : T.uploadSpdSheet}
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  disabled={importingSpd}
                  onChange={importSpdSheet}
                />
              </label>
              <label className="file-button ledger-upload">
                {replacingHistoricalLedger ? "正在替换历史往来底库…" : "替换历史往来底库"}
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  multiple
                  disabled={replacingHistoricalLedger}
                  onChange={importHistoricalLedger}
                />
              </label>
              {sheet && (
                <button
                  type="button"
                  className="dashboard-sync-button"
                  onClick={updateDashboards}
                >
                  一键更新其他看板
                </button>
              )}
              <DataImportCenter />
            </div>
          ) : (
            <div className="toolbar-actions">
              <button
                className="refresh-button"
                type="button"
                onClick={refreshTable}
              >
                刷新
              </button>
              <button
                className="export-button"
                type="button"
                onClick={exportTable}
                disabled={!sheet}
              >
                导出
              </button>
            </div>
          )}
        </div>
        {(mode === "import" ? postgresQuarters : archivedQuarters).length > 0 && (
          <div className="quarter-archive-control">
            <label>
              对账季度
              <select
                aria-label="筛选对账季度"
                value={activeQuarter}
                onChange={(event) => changeQuarter(event.target.value)}
              >
                {(mode === "import" ? postgresQuarters : archivedQuarters).map((quarter) => (
                  <option key={quarter} value={quarter}>
                    {quarter}
                  </option>
                ))}
              </select>
            </label>
            <span>已按季度独立保存，导入新季度不会覆盖已有明细。</span>
          </div>
        )}
        {currentLedgerInfo && (
          <p className="ledger-info">{`\u672c\u5e74\u5f80\u6765\u660e\u7ec6\uff1a${currentLedgerInfo.fileNames.join("、")} \uff08${currentLedgerInfo.keys.length}\u6761\uff0c${currentLedgerInfo.updatedAt}\uff09`}</p>
        )}
        {message && <p className="import-message">{message}</p>}
        {mode !== "import" && sheet && filterColumns.length > 0 && (
          <div className="column-filter multi-column-filter">
            {filterColumns.map((column) => (
              <div className="filter-item" key={column}>
                <b>筛选“{sheet.headers[column]}”</b>
                <input
                  value={columnFilters[column] ?? ""}
                  placeholder="输入筛选内容"
                  onChange={(event) =>
                    setColumnFilters((filters) => ({
                      ...filters,
                      [column]: event.target.value,
                    }))
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    setColumnFilters((filters) => ({
                      ...filters,
                      [column]: "",
                    }))
                  }
                >
                  清除
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setFilterColumns((columns) =>
                      columns.filter((item) => item !== column),
                    )
                  }
                >
                  关闭
                </button>
              </div>
            ))}
          </div>
        )}
        {mode === "import" ? (
          <>
            <div className="import-status">
              <strong>其他独立导入与历史记录</strong>
              <span>
                往来明细、资料提供、SPD 和历史往来底库维持各自既有导入流程；季度基础表与公司应收更新请使用上方新中心。
              </span>
            </div>
            <ImportDashboard ledger={currentLedgerInfo} />
          </>
        ) : !sheet ? (
          <div className="local-empty">
            <strong>{T.needImport}</strong>
          </div>
        ) : (
          <>
            <div className="reconciliation-toolbar">
              <div className="file-summary">
                <span className="file-icon" aria-hidden="true">
                  XLS
                </span>
                <div>
                  <strong title={sheet.fileName}>{sheet.fileName}</strong>
                  <span>
                    {"共 " +
                      sheet.rows.length +
                      " 条记录 · 当前显示 " +
                      shown.length +
                      " 条"}
                  </span>
                </div>
              </div>
              <div className="table-controls">
                <label>
                  区域
                  <select
                    value={region}
                    onChange={(event) => setRegion(event.target.value)}
                  >
                    <option>{T.all}</option>
                    {regions.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  橙色条纹
                  <select
                    value={stripeFilter}
                    onChange={(event) =>
                      setStripeFilter(event.target.value as "all" | "review")
                    }
                  >
                    <option value="all">全部</option>
                    <option value="review">仅有对账差额</option>
                  </select>
                </label>
                <label className="search-control">
                  <span className="sr-only">搜索客户、负责人或区域</span>
                  <input
                    value={searchInput}
                    placeholder="搜索客户、负责人或区域"
                    onChange={(event) => setSearchInput(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="toolbar-outline"
                  onClick={() => setColumnMenuOpen((open) => !open)}
                  aria-expanded={columnMenuOpen}
                >
                  列设置
                  {hiddenColumns.length > 0
                    ? "（" + hiddenColumns.length + "）"
                    : ""}
                </button>
                <button
                  type="button"
                  className="toolbar-ghost"
                  onClick={() => {
                    setRegion(T.all);
                    setStripeFilter("all");
                    setSearchInput("");
                    setSearchQuery("");
                    setColumnFilters({});
                    setFilterColumns([]);
                    setPage(1);
                    localStorage.removeItem("reconciliation-detail-target");
                  }}
                >
                  清空筛选
                </button>
              </div>
              {columnMenuOpen && (
                <div className="column-menu" role="dialog" aria-label="列设置">
                  <strong>显示列</strong>
                  {sheet.headers.map((header, index) => (
                    <label key={index}>
                      <input
                        type="checkbox"
                        checked={!hiddenColumns.includes(index)}
                        onChange={() =>
                          hiddenColumns.includes(index)
                            ? setHiddenColumns((columns) =>
                                columns.filter((column) => column !== index),
                              )
                            : setHiddenColumns((columns) => [...columns, index])
                        }
                      />
                      {tableHeader(header)}
                    </label>
                  ))}
                </div>
              )}
            </div>
            {(hiddenColumns.length > 0 || salesHidden) && (
              <div className="hidden-columns">
                已隐藏：
                {hiddenColumns.map((i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() =>
                      setHiddenColumns((columns) =>
                        columns.filter((column) => column !== i),
                      )
                    }
                  >
                    显示“{sheet.headers[i]}”
                  </button>
                ))}
                {salesHidden && (
                  <button type="button" onClick={() => setSalesHidden(false)}>
                    显示“{T.sales}”
                  </button>
                )}
              </div>
            )}
            {filterColumn !== null && (
              <div className="column-filter">
                <b>筛选“{sheet.headers[filterColumn]}”</b>
                <input
                  autoFocus
                  value={columnFilters[filterColumn] ?? ""}
                  placeholder="输入筛选内容"
                  onChange={(event) =>
                    setColumnFilters((filters) => ({
                      ...filters,
                      [filterColumn!]: event.target.value,
                    }))
                  }
                />
                <button
                  onClick={() =>
                    setColumnFilters((filters) => ({
                      ...filters,
                      [filterColumn!]: "",
                    }))
                  }
                >
                  清除
                </button>
                <button onClick={() => setFilterColumn(null)}>关闭</button>
              </div>
            )}
            <div className="table-scroll local-table" aria-busy={!sheet}>
              <table>
                <thead>
                  <tr>
                    {sheet.headers.map(
                      (header, index) =>
                        !hiddenColumns.includes(index) && (
                          <th
                            key={index}
                            scope="col"
                            style={columnStyle(index)}
                            className={[
                              tableColumnHeadingClass(header),
                              columnWidths[index] ? "is-resized" : "",
                              index === 0 ? "sticky-index" : "",
                              String(header).includes("账套")
                                ? "sticky-account"
                                : "",
                              String(header) === T.customer
                                ? "sticky-customer"
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            <span>{tableHeader(header)}</span>
                            <button
                              type="button"
                              className={
                                "column-filter-icon " +
                                (filterColumns.includes(index) ? "active" : "")
                              }
                              aria-label={"筛选 " + tableHeader(header)}
                              onClick={() => setFilterColumn(index)}
                            >
                              ⌄
                            </button>
                            <button
                              type="button"
                              className="column-resize-handle"
                              aria-label={
                                "调整 " + tableHeader(header) + " 列宽"
                              }
                              onPointerDown={(event) =>
                                startColumnResize(event, index)
                              }
                            />
                          </th>
                        ),
                    )}
                    {!salesHidden && (
                      <th
                        scope="col"
                        style={columnStyle(-1)}
                        className={[
                          "sales-heading",
                          "sticky-action",
                          columnWidths[-1] ? "is-resized" : "",
                        ].join(" ")}
                      >
                        <span>{T.sales}</span>
                        <button
                          type="button"
                          className="column-filter-icon"
                          aria-label="隐藏销售填写列"
                          onClick={() => setSalesHidden(true)}
                        >
                          ⋮
                        </button>
                        <button
                          type="button"
                          className="column-resize-handle"
                          aria-label="调整销售填写列宽"
                          onPointerDown={(event) =>
                            startColumnResize(event, -1)
                          }
                        />
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.length ? (
                    pagedRows.map(({ row, id }) => {
                      const customerAmount = row[customerBookIndex];
                      const hasCustomerBook = hasValue(customerAmount);
                      return (
                        <tr
                          key={id}
                          className={[
                            num(row[index(T.difference)]) !== 0
                              ? "has-difference"
                              : "",
                            needsDifferenceStripe(
                              num(row[index(T.difference)]),
                            )
                              ? "has-history-difference"
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {sheet.headers.map(
                            (header, index) =>
                              !hiddenColumns.includes(index) && (
                                <td
                                  key={index}
                                  style={columnStyle(index)}
                                  className={[
                                    cellClass(header, index),
                                    columnWidths[index] ? "is-resized" : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" ")}
                                >
                                  {String(header).includes("是否对清") ? (
                                    <span
                                      className={
                                        "status-badge " +
                                        clearedBadgeClass(row[index])
                                      }
                                    >
                                      {String(row[index] ?? "—")}
                                    </span>
                                  ) : (
                                    <span
                                      className={
                                        "cell-value " +
                                        (String(header) === T.difference &&
                                        !hasCustomerBook
                                          ? "is-empty-money"
                                          : "")
                                      }
                                      title={String(row[index] ?? "")}
                                    >
                                      {displayTableValue(
                                        header,
                                        row[index],
                                        customerAmount,
                                      )}
                                    </span>
                                  )}
                                </td>
                              ),
                          )}
                          {!salesHidden && (
                            <td
                              style={columnStyle(-1)}
                              className={[
                                "sticky-action",
                                columnWidths[-1] ? "is-resized" : "",
                              ].join(" ")}
                            >
                              <button
                                className="fill-button"
                                type="button"
                                onClick={() => open(id)}
                              >
                                {T.fill}
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td
                        className="table-empty"
                        colSpan={sheet.headers.length + 1}
                      >
                        暂无符合条件的对账记录
                        <button
                          type="button"
                          onClick={() => {
                            setRegion(T.all);
                            setStripeFilter("all");
                            setSearchInput("");
                            setSearchQuery("");
                            setColumnFilters({});
                            setFilterColumns([]);
                            setPage(1);
                            localStorage.removeItem("reconciliation-detail-target");
                          }}
                        >
                          清空筛选
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="table-pagination">
              <span>
                共 {shown.length} 条，第 {page} / {pageCount} 页
              </span>
              <div>
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  上一页
                </button>
                <span>{page}</span>
                <button
                  type="button"
                  disabled={page >= pageCount}
                  onClick={() =>
                    setPage((current) => Math.min(pageCount, current + 1))
                  }
                >
                  下一页
                </button>
                <select
                  aria-label="每页条数"
                  value={pageSize}
                  onChange={(event) => setPageSize(Number(event.target.value))}
                >
                  <option value={10}>每页 10 条</option>
                  <option value={20}>每页 20 条</option>
                  <option value={50}>每页 50 条</option>
                  <option value={100}>每页 100 条</option>
                </select>
              </div>
            </div>
          </>
        )}
      </section>
      {active !== null && sheet && (
        <div className="modal-backdrop">
          <section className="sales-modal">
            <div className="sales-modal-sticky">
              <button
                type="button"
                className="modal-close"
                aria-label="关闭销售填写"
                onClick={() => {
                  stopSolutionRecording();
                  setActiveDifferenceType(null);
                  setActive(null);
                }}
              >
                {"\u00d7"}
              </button>
              <p className="eyebrow">{T.sales}</p>
              <p className="sales-account">
                {"\u8d26\u5957\uff1a"}
                {String(sheet.rows[active][accountIndex] ?? "\u2014")}
              </p>
              <h2>{`${String(sheet.rows[active][customerIndex] ?? T.customerFallback)} ${T.detail}`}</h2>
              <div className="amount-bar">
                <span>
                  {`${T.company}\uff1a`}
                  <strong>{money(company)}</strong>
                </span>
                <span>
                  {`${T.difference}\uff1a`}
                  <strong>{money(difference)}</strong>
                </span>
                <span className={isClear ? "clear" : "unclear"}>
                  {isClear ? T.clear : T.uncleared}
                </span>
              </div>
              <div className="customer-save-row">
                <TextField
                  label={T.customerBook}
                  value={form.customerAmount}
                  type="number"
                  onChange={(value) =>
                    setForm({ ...form, customerAmount: value })
                  }
                />
                <TextField
                  label={RESPONSIBLE_HEADER}
                  value={form.responsible}
                  onChange={updateResponsible}
                />
                <button
                  className="save-button top-save-button"
                  onClick={commit}
                  disabled={saving}
                >
                  {saving ? "保存中…" : T.save}
                </button>
              </div>
            </div>
            <div className="sales-modal-body">
              <DifferenceSummaryList
                form={form}
                activeType={activeDifferenceType}
                onOpen={setActiveDifferenceType}
              />
              {mode !== "import" && activeQuarter && apiIds[active] && <PreviousQuarterDifferenceTransferDrawer
                quarter={activeQuarter}
                reconciliationId={apiIds[active]}
                accountSet={String(sheet.rows[active][accountIndex] ?? "")}
                customer={String(sheet.rows[active][customerIndex] ?? "")}
                onTransferred={refreshTransferredDifferenceItems}
              />}
              <div className="amount-bar evidence">
                <span>
                  {T.total}
                  <strong>{money(total)}</strong>
                </span>
                <span>
                  {T.compare}
                  <strong>{money(difference)}</strong>
                </span>
                <span>
                  差额未分配：
                  <strong>{money(Math.max(0, Math.abs(difference) - total))}</strong>
                </span>
              </div>
              <section className="writeoff-adjustment-section" aria-label="呆账、调账和解决信息">
                <TextField
                  label="呆账金额"
                  value={form.badDebt}
                  type="number"
                  onChange={(value) => setForm({ ...form, badDebt: value })}
                />
                <TextField
                  label="调账金额"
                  value={form.adjustment}
                  type="number"
                  onChange={(value) => setForm({ ...form, adjustment: value })}
                />
                <TextField
                  label="呆账原因"
                  value={form.badDebtReason}
                  onChange={(value) => setForm({ ...form, badDebtReason: value })}
                />
                <TextField
                  label="调账原因"
                  value={form.adjustmentReason}
                  onChange={(value) => setForm({ ...form, adjustmentReason: value })}
                />
                <TextField
                  label={"\u89e3\u51b3\u65f6\u95f4"}
                  value={form.resolutionTime}
                  type="date"
                  onChange={(value) =>
                    setForm({ ...form, resolutionTime: value })
                  }
                />
                <div className="solution-field-with-speech">
                  <TextField
                    label={"\u89e3\u51b3\u65b9\u6848"}
                    value={form.resolutionSolution}
                    onChange={(value) =>
                      setForm({ ...form, resolutionSolution: value })
                    }
                  />
                  <button
                    type="button"
                    className={`speech-record-button${speechRecording ? " is-recording" : ""}`}
                    onClick={toggleSolutionRecording}
                    aria-pressed={speechRecording}
                  >
                    <span aria-hidden="true">{speechRecording ? "\u25cf" : "\u25c9"}</span>
                    {speechRecording ? "\u7ed3\u675f\u5f55\u97f3" : "\u8bed\u97f3\u8f6c\u6587\u5b57"}
                  </button>
                  {speechMessage && (
                    <p className="speech-record-hint" role="status">
                      {speechMessage}
                    </p>
                  )}
                </div>
              </section>
            </div>
          </section>
          {activeDifferenceType && (
            <DifferenceDetailDrawer
              type={activeDifferenceType}
              form={form}
              onChange={setForm}
              onClose={() => setActiveDifferenceType(null)}
              onPreview={setPreviewImage}
              quarter={activeQuarter}
            />
          )}
        </div>
      )}
      {previewImage && (
        <div
          className="image-lightbox"
          role="dialog"
          aria-label="图片预览"
          onClick={() => setPreviewImage(null)}
        >
          <div onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="modal-close"
              onClick={() => setPreviewImage(null)}
            >
              ×
            </button>
            <img src={previewImage} alt="其他（无发票）图片附件预览" />
          </div>
        </div>
      )}
    </>
  );

  return (
    <>
      <section className="local-tool">
        <div className="local-toolbar">
          <div>
            <p className="eyebrow">{T.local}</p>
            <h2>{T.importTitle}</h2>
            <p>{T.importHint}</p>
          </div>
          <div className="toolbar-actions">
            <label className="file-button">
              {T.import}
              <input type="file" accept=".xlsx,.xls" onChange={importFile} />
            </label>
          </div>
        </div>
        {message && <p className="import-message">{message}</p>}
        {!sheet ? (
          <div className="local-empty">
            <strong>{T.needImport}</strong>
          </div>
        ) : (
          <>
            <div className="local-summary">
              <div>
                <strong>{sheet!.fileName}</strong>
                <span>{`\u5171 ${sheet!.rows.length} \u6761\u8bb0\u5f55`}</span>
              </div>
              <label>
                {`\u6309${T.region}\u67e5\u770b`}
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                >
                  <option>{T.all}</option>
                  {regions.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <span>{`\u5f53\u524d\u663e\u793a ${shown.length} \u6761`}</span>
            </div>
            <div className="table-scroll local-table">
              <table>
                <thead>
                  <tr>
                    {sheet!.headers.map((header, i) => (
                      <th key={i}>{header}</th>
                    ))}
                    <th>{T.sales}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(({ row, id }) => (
                    <tr key={id}>
                      {sheet!.headers.map((_, i) => (
                        <td key={i}>{String(row[i] ?? "")}</td>
                      ))}
                      <td>
                        <button
                          className="fill-button"
                          onClick={() => open(id)}
                        >
                          {T.fill}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      {active !== null && sheet && (
        <div className="modal-backdrop">
          <section className="sales-modal">
            <button className="modal-close" onClick={() => setActive(null)}>
              ×
            </button>
            <p className="eyebrow">{T.sales}</p>
            <h2>{`${String(sheet!.rows[active!][customerIndex!] ?? T.customerFallback)} ${T.detail}`}</h2>
            <div className="amount-bar">
              <span>
                {`${T.company}：`}
                <strong>{money(company)}</strong>
              </span>
              <span>
                {`${T.difference}：`}
                <strong>{money(difference)}</strong>
              </span>
              <span className={isClear ? "clear" : "unclear"}>
                {isClear ? T.clear : T.uncleared}
              </span>
            </div>
            <TextField
              label={T.company}
              value={form.companyAmount}
              type="number"
              onChange={(value) => setForm({ ...form, companyAmount: value })}
            />
            <TextField
              label={T.customerBook}
              value={form.customerAmount}
              type="number"
              onChange={(value) => setForm({ ...form, customerAmount: value })}
            />
            <div className="detail-grid">
              <InvoiceGroup
                title={T.transitReview}
                entries={form.transit}
                requiresReview={true}
                quarter={activeQuarter}
                setEntries={(entries) => setForm({ ...form, transit: entries })}
              />
              <InvoiceGroup
                title={T.returnReview}
                entries={form.returned}
                requiresReview={true}
                quarter={activeQuarter}
                setEntries={(entries) =>
                  setForm({ ...form, returned: entries })
                }
              />
              <InvoiceGroup
                title={T.otherInvoice}
                entries={form.otherInvoice}
                requiresReview={false}
                quarter={activeQuarter}
                setEntries={(entries) =>
                  setForm({ ...form, otherInvoice: entries })
                }
              />
              <OtherGroup
                entries={form.other}
                setEntries={(entries) => setForm({ ...form, other: entries })}
                onPreview={setPreviewImage}
              />
            </div>
            <div className="amount-bar evidence">
              <span>
                {T.total}
                <strong>{money(total)}</strong>
              </span>
              <span>
                {T.compare}
                <strong>
                  {Math.abs(total - difference) < 0.01 ? T.same : T.different}
                </strong>
              </span>
            </div>
            <div className="detail-grid two">
              <TextField
                label={T.badDebt}
                value={form.badDebt}
                type="number"
                onChange={(value) => setForm({ ...form, badDebt: value })}
              />
              <TextField
                label={T.adjustment}
                value={form.adjustment}
                type="number"
                onChange={(value) => setForm({ ...form, adjustment: value })}
              />
            </div>
            <button className="save-button" onClick={commit}>
              {T.save}
            </button>
          </section>
        </div>
      )}
    </>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  onBlur,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  onBlur?: () => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        step={type === "number" ? "0.01" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
    </label>
  );
}

const DIFFERENCE_SUMMARIES: Array<{
  type: DifferenceType;
  label: string;
  icon: string;
  invoice: boolean;
}> = [
  { type: "transit", label: "在途金额", icon: "▣", invoice: true },
  { type: "returned", label: "退票金额", icon: "↩", invoice: true },
  { type: "lost", label: "丢票金额", icon: "▤", invoice: true },
  { type: "instrument", label: "仪器设备金额", icon: "▥", invoice: true },
  { type: "otherInvoice", label: "其他（有发票）", icon: "▧", invoice: true },
  { type: "other", label: "其他（无发票及无法验证）", icon: "▨", invoice: false },
];

function entriesFor(form: DetailForm, type: DifferenceType) {
  return form[type];
}

function DifferenceSummaryList({
  form,
  activeType,
  onOpen,
}: {
  form: DetailForm;
  activeType: DifferenceType | null;
  onOpen: (type: DifferenceType) => void;
}) {
  return (
    <section className="difference-summary-list" aria-label="差额类型总览">
      <div className="difference-summary-heading">
        <b>差额类型总览</b>
        <small>点击右侧“填写”录入明细</small>
      </div>
      {DIFFERENCE_SUMMARIES.map((item) => {
        const entries = entriesFor(form, item.type);
        const meaningfulEntries = item.invoice
          ? meaningfulInvoiceEntries(entries as InvoiceEntry[])
          : (entries as OtherEntry[]).filter(
              (entry) => num(entry.amount) !== 0 || entry.note.trim() || Boolean(entry.image),
            );
        const filled = meaningfulEntries.length;
        const subtotal = meaningfulEntries.reduce((total, entry) => total + num(entry.amount), 0);
        return (
          <div className={`difference-summary-row ${activeType === item.type ? "active" : ""}`} key={item.type}>
            <i aria-hidden="true">{item.icon}</i>
            <strong>{item.label}</strong>
            <span className="summary-tag">{item.invoice ? "需填报" : "可附图片"}</span>
            <span>{filled} 笔</span>
            <b>金额小计：{money(subtotal)}</b>
            <button type="button" onClick={() => onOpen(item.type)}>填写</button>
            <em aria-hidden="true">›</em>
          </div>
        );
      })}
    </section>
  );
}

function DifferenceDetailDrawer({
  type,
  form,
  onChange,
  onClose,
  onPreview,
  quarter,
}: {
  type: DifferenceType;
  form: DetailForm;
  onChange: (next: DetailForm) => void;
  onClose: () => void;
  onPreview: (image: string) => void;
  quarter: string;
}) {
  const meta = DIFFERENCE_SUMMARIES.find((item) => item.type === type)!;
  const entries = entriesFor(form, type);
  const meaningfulEntries = meta.invoice
    ? meaningfulInvoiceEntries(entries as InvoiceEntry[])
    : (entries as OtherEntry[]).filter(
        (entry) => num(entry.amount) !== 0 || entry.note.trim() || Boolean(entry.image),
      );
  const subtotal = meaningfulEntries.reduce((total, entry) => total + num(entry.amount), 0);
  const [ocrStatus, setOcrStatus] = useState("");
  const [ocrRecognizing, setOcrRecognizing] = useState(false);
  const [verificationResults, setVerificationResults] = useState<Record<number, "matched" | "not_found" | "pending">>({});
  const verifyRequest = useRef<AbortController | null>(null);
  const setEntries = (next: InvoiceEntry[] | OtherEntry[]) =>
    onChange({ ...form, [type]: next } as DetailForm);
  const add = () =>
    setEntries([
      ...entries,
      ...(meta.invoice ? [blankInvoice()] : [blankOther()]),
    ] as InvoiceEntry[] & OtherEntry[]);
  const batchAdd = () =>
    setEntries([
      ...entries,
      ...(meta.invoice ? [blankInvoice(), blankInvoice(), blankInvoice()] : [blankOther(), blankOther(), blankOther()]),
    ] as InvoiceEntry[] & OtherEntry[]);
  const copy = (index: number) =>
    setEntries([
      ...entries.slice(0, index + 1),
      { ...entries[index] },
      ...entries.slice(index + 1),
    ] as InvoiceEntry[] & OtherEntry[]);
  const remove = (index: number) =>
    setEntries(
      entries.length === 1
        ? (meta.invoice ? [blankInvoice()] : [blankOther()])
        : entries.filter((_, entryIndex) => entryIndex !== index),
    );
  const update = (index: number, field: "date" | "invoice" | "amount" | "note", value: string) =>
    setEntries(
      entries.map((entry, entryIndex) => {
        if (entryIndex !== index) return entry;
        // 无发票号时，本行只是待填写的占位行，不能写入金额、日期或说明，
        // 否则旧的 0 会再次作为一笔待核验发票保存。
        if (meta.invoice && !hasInvoiceNumber(entry as InvoiceEntry)) return entry;
        return { ...entry, [field]: value };
      }) as InvoiceEntry[] & OtherEntry[],
    );
  const updateInvoice = (index: number, invoice: string) => {
    const normalizedInvoice = invoice.trim();
    setEntries(
      entries.map((entry, entryIndex) => {
        if (entryIndex !== index) return entry;
        const current = entry as InvoiceEntry;
        if (!normalizedInvoice) return blankInvoice();
        return normalizedInvoice ? { ...current, invoice: normalizedInvoice } : blankInvoice();
      }) as InvoiceEntry[],
    );
  };
  const fillRecognizedInvoices = (invoiceNumbers: string[]) => {
    const invoiceEntries = entries as InvoiceEntry[];
    const existingNumbers = new Set(
      invoiceEntries.map((entry) => entry.invoice.trim()).filter(Boolean),
    );
    const newNumbers = invoiceNumbers.filter((invoice) => !existingNumbers.has(invoice));
    if (!newNumbers.length) return { added: 0, matched: 0 };

    let nextIndex = 0;
    let matchedCount = 0;
    const createRecognizedEntry = (invoice: string) => {
      return {
        ...blankInvoice(),
        invoice,
        date: "", amount: "",
      };
    };
    const nextEntries = invoiceEntries.map((entry) => {
      if (nextIndex >= newNumbers.length || anyInvoice(entry)) return entry;
      return createRecognizedEntry(newNumbers[nextIndex++]);
    });
    while (nextIndex < newNumbers.length) {
      nextEntries.push(createRecognizedEntry(newNumbers[nextIndex++]));
    }
    setEntries(nextEntries);
    return { added: newNumbers.length, matched: matchedCount };
  };
  const recognizeInvoices = async (files?: FileList | null) => {
    if (!files?.length || !meta.invoice) return;
    setOcrRecognizing(true);
    setOcrStatus("正在识别发票，请稍候…");
    try {
      const recognized: string[] = [];
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.append("file", file);
        const response = await fetch(OCR_INVOICE_ENDPOINT, { method: "POST", body });
        if (!response.ok) throw new Error(`OCR ${response.status}`);
        recognized.push(...extractInvoiceNumbersFromOcr(await response.json()));
      }
      const uniqueNumbers = [...new Set(recognized)];
      const result = fillRecognizedInvoices(uniqueNumbers);
      setOcrStatus(
        result.added
          ? `已识别 ${result.added} 个发票号，请填写日期和金额后由服务器核验。`
          : "未识别到新的发票号，请确认图片清晰且未重复导入。",
      );
    } catch {
      setOcrStatus("OCR识别失败，请确认OCR服务可访问后重试。");
    } finally {
      setOcrRecognizing(false);
    }
  };
  const addImage = (index: number, file?: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () =>
      setEntries(
        entries.map((entry, entryIndex) =>
          entryIndex === index ? { ...entry, image: String(reader.result ?? "") } : entry,
        ) as OtherEntry[],
      );
    reader.readAsDataURL(file);
  };
  useEffect(() => {
    const candidates = entries.map((entry, index) => ({ entry: entry as InvoiceEntry, index })).filter(({ entry }) => meta.invoice && hasInvoiceNumber(entry) && entry.invoice && entry.date && entry.amount !== "");
    if (!candidates.length || !quarter) return;
    verifyRequest.current?.abort();
    const controller = new AbortController(); verifyRequest.current = controller;
    const timer = window.setTimeout(() => {
      void Promise.all(candidates.map(async ({ entry, index }) => {
        try { const result = await reconciliationApi.verifyLedgerInvoice(quarter, { invoiceNo: entry.invoice, invoiceDate: entry.date, amount: entry.amount }, controller.signal); return [index, result.status] as const; }
        catch (error) { if (controller.signal.aborted) return null; return [index, error instanceof ReconciliationApiError && error.code === "LEDGER_INVOICE_NOT_FOUND" ? "not_found" : "pending"] as const; }
      })).then((results) => { if (!controller.signal.aborted) setVerificationResults(Object.fromEntries(results.filter((item): item is readonly [number, "matched" | "not_found" | "pending"] => item !== null))); });
    }, 400);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [entries, meta.invoice, quarter]);
  const verification = (entry: InvoiceEntry, index: number) => {
    if (!hasInvoiceNumber(entry)) return null;
    if (!entry.date || !entry.invoice || entry.amount === "") {
      return { label: "\u5f85\u6838\u9a8c", kind: "pending" };
    }
    const status = verificationResults[index] ?? "pending";
    return status === "matched" ? { label: "往来明细核验：正确", kind: "correct" } : status === "not_found" ? { label: "往来明细未找到此发票", kind: "error" } : { label: "正在核验", kind: "pending" };
  };
  return (
    <aside className="difference-detail-drawer" role="dialog" aria-modal="true" aria-label={`填写${meta.label}差额明细`}>
      <header>
        <div>
          <p>填写差额明细</p>
          <h2>{meta.label}差额明细</h2>
          <span>{meaningfulEntries.length} 笔　金额小计：<b>{money(subtotal)}</b></span>
        </div>
        <button type="button" aria-label="关闭差额明细" onClick={onClose}>×</button>
      </header>
      <div className="drawer-tools">
        <button type="button" onClick={add}>＋ 新增一行</button>
        <button type="button" onClick={batchAdd}>▣ 批量录入</button>
        {meta.invoice && <label className="drawer-ocr-button">
          {ocrRecognizing ? "OCR识别中…" : "OCR发票识别"}
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={ocrRecognizing}
            onChange={(event) => {
              void recognizeInvoices(event.target.files);
              event.target.value = "";
            }}
          />
        </label>}
      </div>
      {meta.invoice && ocrStatus && <p className="drawer-ocr-status" role="status">{ocrStatus}</p>}
      <div className="difference-drawer-table-wrap">
        <table className="difference-drawer-table">
          <thead>
            <tr>
              <th>序号</th>
              {meta.invoice && <><th>开票日期</th><th>发票号码</th></>}
              <th>金额（元）</th>
              <th>差额说明</th>
              {meta.invoice && <th>往来核验</th>}
              {!meta.invoice && <th>图片附件</th>}
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => (
              <tr key={index}>
                <td>{index + 1}</td>
                {meta.invoice && <><td><input type="date" value={(entry as InvoiceEntry).date} disabled={!hasInvoiceNumber(entry as InvoiceEntry)} onChange={(event) => update(index, "date", event.target.value)} /></td><td><input value={(entry as InvoiceEntry).invoice} onChange={(event) => updateInvoice(index, event.target.value)} placeholder="填写发票号码" /></td></>}
                <td><input type="number" step="0.01" value={entry.amount} disabled={meta.invoice && !hasInvoiceNumber(entry as InvoiceEntry)} onChange={(event) => update(index, "amount", event.target.value)} placeholder="填写金额" /></td>
                <td><input value={entry.note} disabled={meta.invoice && !hasInvoiceNumber(entry as InvoiceEntry)} onChange={(event) => update(index, "note", event.target.value)} placeholder="填写差额说明" /></td>
                {meta.invoice && (() => {
                  const result = verification(entry as InvoiceEntry, index);
                  return <td>{result && <span className={`drawer-verification ${result.kind}`}>{result.label}</span>}</td>;
                })()}
                {!meta.invoice && <td className="drawer-attachment"><input value={(entry as OtherEntry).image ?? ""} onChange={(event) => setEntries(entries.map((current, currentIndex) => currentIndex === index ? { ...current, image: event.target.value } : current) as OtherEntry[])} placeholder="附件 key（逗号分隔）" /><small>仅保存附件 key；本阶段不上传或读取文件。</small></td>}
                <td className="drawer-row-actions"><button type="button" onClick={() => copy(index)}>复制</button><button type="button" onClick={() => remove(index)}>删除</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={meta.invoice ? 6 : 4}>合计：{meaningfulEntries.length} 笔</td><td>{money(subtotal)}</td></tr></tfoot>
        </table>
      </div>
    </aside>
  );
}
async function cropInvoiceRows(file: File) {
  return new Promise<HTMLCanvasElement[]>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const sourceWidth = image.naturalWidth;
      const sourceHeight = image.naturalHeight;
      const source = document.createElement("canvas");
      source.width = sourceWidth;
      source.height = sourceHeight;
      const sourceContext = source.getContext("2d", {
        willReadFrequently: true,
      });
      if (!sourceContext) {
        URL.revokeObjectURL(url);
        reject(new Error("canvas"));
        return;
      }
      sourceContext.drawImage(image, 0, 0);
      const pixels = sourceContext.getImageData(
        0,
        0,
        sourceWidth,
        sourceHeight,
      ).data;
      const isDark = (x: number, y: number) => {
        const at = (y * sourceWidth + x) * 4;
        return pixels[at] < 75 && pixels[at + 1] < 75 && pixels[at + 2] < 75;
      };
      const vertical: number[] = [];
      for (let x = 0; x < sourceWidth; x++) {
        let dark = 0;
        for (let y = 2; y < sourceHeight - 2; y++) if (isDark(x, y)) dark++;
        if (dark > sourceHeight * 0.55) vertical.push(x);
      }
      const columns = vertical.filter(
        (x, index) => index === 0 || x - vertical[index - 1] > 2,
      );
      const left =
        columns.length >= 5 ? columns[3] + 2 : Math.round(sourceWidth * 0.6);
      const right =
        columns.length >= 5 ? columns[4] - 2 : Math.round(sourceWidth * 0.89);
      const width = right - left;
      const lines: number[] = [];
      for (let y = 0; y < sourceHeight; y++) {
        let dark = 0;
        for (let x = left + 2; x < right - 2; x++) if (isDark(x, y)) dark++;
        if (dark > width * 0.58) lines.push(y);
      }
      const detected = lines.filter(
        (y, index) => index === 0 || y - lines[index - 1] > 2,
      );
      const rowHeight = detected.length > 1 ? detected[1] - detected[0] : 0;
      const boundaries =
        detected.length > 1
          ? [Math.max(0, detected[0] - rowHeight), ...detected]
          : detected;
      const ranges = boundaries
        .slice(0, -1)
        .map((top, index) => [top + 2, boundaries[index + 1] - 2] as const)
        .filter(([top, bottom]) => bottom - top > 12);
      const rows = (ranges.length > 1 ? ranges : [[0, sourceHeight]]).map(
        ([top, bottom]) => {
          const scale = 3;
          const canvas = document.createElement("canvas");
          canvas.width = width * scale;
          canvas.height = (bottom - top) * scale;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("canvas");
          context.filter = "grayscale(1) contrast(3)";
          context.drawImage(
            image,
            left,
            top,
            width,
            bottom - top,
            0,
            0,
            canvas.width,
            canvas.height,
          );
          return canvas;
        },
      );
      URL.revokeObjectURL(url);
      resolve(rows);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image"));
    };
    image.src = url;
  });
}
const extractInvoiceNumbers = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.replace(/\D/g, ""))
    .filter((digits) => digits.length >= 7);

const OCR_INVOICE_ENDPOINT = "/api/ocr/recognize";

function collectOcrText(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(collectOcrText);
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).flatMap(collectOcrText);
}

function extractInvoiceNumbersFromOcr(value: unknown): string[] {
  const candidates = collectOcrText(value).flatMap((text) =>
    text.match(/(?<!\d)\d{7,20}(?!\d)/g) ?? [],
  );
  return [...new Set(candidates)];
}
function InvoiceGroup({
  title,
  entries,
  requiresReview,
  quarter,
  setEntries,
}: {
  title: string;
  entries: InvoiceEntry[];
  requiresReview: boolean;
  quarter: string;
  setEntries: (entries: InvoiceEntry[]) => void;
}) {
  const [choices, setChoices] = useState<Record<number, string[]>>({});
  const [expanded, setExpanded] = useState(true);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoStatus, setPhotoStatus] = useState("");
  const [photoInvoices, setPhotoInvoices] = useState<string[]>([]);
  const [verificationResults, setVerificationResults] = useState<Record<number, "matched" | "not_found" | "pending">>({});
  const update = (index: number, field: keyof InvoiceEntry, value: string) =>
    setEntries(
      entries.map((entry, i) =>
        i === index ? { ...entry, [field]: value } : entry,
      ),
    );
  const remove = (index: number) =>
    setEntries(
      entries.length === 1
        ? [blankInvoice()]
        : entries.filter((_, i) => i !== index),
    );
  const autoFill = (_index: number) => undefined;
  useEffect(() => {
    const candidates = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => requiresReview && entry.invoice && entry.date && entry.amount !== "");
    if (!quarter || !candidates.length) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void Promise.all(candidates.map(async ({ entry, index }) => {
      try { const result = await reconciliationApi.verifyLedgerInvoice(quarter, { invoiceNo: entry.invoice, invoiceDate: entry.date, amount: entry.amount }, controller.signal); return [index, result.status] as const; }
      catch (error) { return [index, error instanceof ReconciliationApiError && error.code === "LEDGER_INVOICE_NOT_FOUND" ? "not_found" : "pending"] as const; }
    })).then((results) => { if (!controller.signal.aborted) setVerificationResults(Object.fromEntries(results)); }), 400);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [entries, requiresReview, quarter]);
  const recognizePhotos = async (files: File[]) => {
    if (!files.length) return;
    setPhotoBusy(true);
    setPhotoStatus("正在通过表格线定位“发票号码”单元格并逐行识别…");
    setPhotoInvoices([]);
    let worker: Awaited<
      ReturnType<typeof import("tesseract.js").createWorker>
    > | null = null;
    try {
      const { createWorker, PSM } = await import("tesseract.js");
      worker = await createWorker("eng");
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789",
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
      });
      const numbers = new Set<string>();
      let rows = 0;
      for (const file of files) {
        for (const row of await cropInvoiceRows(file)) {
          const result = await worker.recognize(row);
          for (const invoice of extractInvoiceNumbers(result.data.text)) {
            numbers.add(invoice);
            rows++;
          }
        }
      }
      const found = [...numbers];
      setPhotoInvoices(found);
      setPhotoStatus(
        found.length
          ? `已识别 ${rows} 行、${found.length} 个不重复发票号；请填写日期和金额后由服务器核验。`
          : "未识别到发票号，请确认截图包含“发票号码”整列。",
      );
    } catch {
      setPhotoStatus("照片识别失败，请使用包含发票号码整列的清晰截图后重试。");
    } finally {
      if (worker) await worker.terminate();
      setPhotoBusy(false);
    }
  };
  const importPhotos = () => {
    const existing = new Set(
      entries.map((entry) => entry.invoice.trim()).filter(Boolean),
    );
    const fresh = photoInvoices.filter((invoice) => !existing.has(invoice));
    if (!fresh.length) {
      setPhotoStatus("识别到的发票号已在当前明细中，不重复导入。");
      return;
    }
    const next = [
      ...entries.filter(anyInvoice),
      ...fresh.map((invoice) => ({ invoice, date: "", amount: "", note: "照片识别导入" })),
    ];
    setEntries(next.length ? next : [blankInvoice()]);
    setPhotoInvoices([]);
    setPhotoStatus(
      `已导入 ${fresh.length} 笔；多日期发票请在下方确认开票日期。`,
    );
  };
  return (
    <div className="detail-box">
      <div className="detail-box-heading">
        <h3>{title}</h3>
        <button
          type="button"
          className="collapse-button"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起" : "展开"}
        </button>
      </div>
      {expanded && (
        <>
          {requiresReview && (
            <div className="photo-import">
              <label className="photo-import-button">
                {photoBusy ? "正在识别…" : "导入识别照片"}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={photoBusy}
                  onChange={(event) => {
                    void recognizePhotos(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                />
              </label>
              <span>仅在本机识别；发票号会用往来明细自动补全日期和金额。</span>
              {photoStatus && <p>{photoStatus}</p>}
              {photoInvoices.length > 0 && (
                <div className="photo-result">
                  <span>{photoInvoices.join("、")}</span>
                  <button type="button" onClick={importPhotos}>
                    导入识别结果
                  </button>
                </div>
              )}
            </div>
          )}
          {entries.map((entry, index) => {
            const has = hasInvoiceNumber(entry);
            const verification = verificationResults[index] ?? "pending";
            const status = !has
              ? ""
              : !entry.date || !entry.invoice || entry.amount === ""
                ? T.incomplete
                : verification === "matched"
                    ? T.matched
                    : verification === "not_found" ? T.missing : T.loading;
            return (
              <div className="invoice-entry" key={index}>
                <div className="entry-head">
                  <strong>{`\u7b2c ${index + 1} \u7b14`}</strong>
                  {entries.length > 1 && (
                    <button
                      type="button"
                      className="remove-entry"
                      onClick={() => remove(index)}
                    >
                      {T.remove}
                    </button>
                  )}
                </div>
                <TextField
                  label={T.invoiceDate}
                  value={entry.date}
                  type="date"
                  onChange={(value) => update(index, "date", value)}
                />
                <TextField
                  label={T.invoice}
                  value={entry.invoice}
                  onChange={(value) => update(index, "invoice", value)}
                  onBlur={() => autoFill(index)}
                />
                <TextField
                  label={T.amount}
                  value={entry.amount}
                  type="number"
                  onChange={(value) => update(index, "amount", value)}
                />
                {choices[index]?.length > 1 && (
                  <div className="invoice-choices">
                    <span>金额已自动累计，请确认开票日期：</span>
                    {choices[index].map((date) => (
                      <button
                        type="button"
                        key={date}
                        onClick={() => {
                          update(index, "date", date);
                          setChoices((current) => ({
                            ...current,
                            [index]: [],
                          }));
                        }}
                      >
                        {date}
                      </button>
                    ))}
                  </div>
                )}
                <TextField
                  label={T.reason}
                  value={entry.note}
                  onChange={(value) => update(index, "note", value)}
                />
                {requiresReview && (
                  <p
                    className={`ledger-check ${has && verification !== "pending" ? (verification === "matched" ? "matched" : "not-matched") : ""}`}
                  >
                    {status || "填写完整发票号后将自动带出日期和金额"}
                  </p>
                )}
              </div>
            );
          })}
          <button
            type="button"
            className="add-entry"
            onClick={() => setEntries([...entries, blankInvoice()])}
          >
            {T.add}
          </button>
        </>
      )}
    </div>
  );
}
function OtherGroup({
  entries,
  setEntries,
  onPreview,
}: {
  entries: OtherEntry[];
  setEntries: (entries: OtherEntry[]) => void;
  onPreview: (image: string) => void;
}) {
  const update = (index: number, field: keyof OtherEntry, value: string) =>
    setEntries(
      entries.map((entry, i) =>
        i === index ? { ...entry, [field]: value } : entry,
      ),
    );
  const remove = (index: number) =>
    setEntries(
      entries.length === 1
        ? [blankOther()]
        : entries.filter((_, i) => i !== index),
    );
  const addImage = async (index: number, file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      window.alert("请选择图片文件。");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      window.alert("图片不能超过 2MB。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => update(index, "image", String(reader.result ?? ""));
    reader.readAsDataURL(file);
  };
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="detail-box">
      <div className="detail-box-heading">
        <h3>{T.otherNoInvoice}</h3>
        <button
          type="button"
          className="collapse-button"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起" : "展开"}
        </button>
      </div>
      {expanded && (
        <>
          {entries.map((entry, index) => (
            <div className="invoice-entry" key={index}>
              <div className="entry-head">
                <strong>{`\u7b2c ${index + 1} \u7b14`}</strong>
                {entries.length > 1 && (
                  <button
                    type="button"
                    className="remove-entry"
                    onClick={() => remove(index)}
                  >
                    {T.remove}
                  </button>
                )}
              </div>
              <TextField
                label={T.amount}
                value={entry.amount}
                type="number"
                onChange={(value) => update(index, "amount", value)}
              />
              <TextField
                label={T.reason}
                value={entry.note}
                onChange={(value) => update(index, "note", value)}
              />
              <label className="image-field">
                <span>图片附件</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    void addImage(index, event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
                {entry.image && (
                  <div className="image-preview">
                    <button
                      type="button"
                      className="image-open"
                      onClick={() => onPreview(entry.image!)}
                      aria-label={`查看其他（无发票）第 ${index + 1} 笔图片`}
                    >
                      <img
                        src={entry.image}
                        alt={`其他（无发票）第 ${index + 1} 笔附件`}
                      />
                      <span>点击查看</span>
                    </button>
                    <button
                      type="button"
                      className="remove-entry"
                      onClick={() => update(index, "image", "")}
                    >
                      删除图片
                    </button>
                  </div>
                )}
              </label>
            </div>
          ))}
          <button
            type="button"
            className="add-entry"
            onClick={() => setEntries([...entries, blankOther()])}
          >
            {T.add}
          </button>
        </>
      )}
    </div>
  );
}
