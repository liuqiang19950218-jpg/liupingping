/** Browser client for the same-origin reconciliation runtime API. */
export type Reconciliation = {
  id: string; sourceRowKey: string | null; quarterCode: string;
  sourceSequence: string | null; importOrder: number | null;
  region: string | null; accountSet: string | null; customer: string | null;
  companyReceivable: string | null; customerBookAmount: string | null;
  reconciliationDifference: string | null; reconciliationStatus: string | null;
  badDebtAmount: string | null; badDebtReason: string | null;
  adjustmentAmount: string | null; adjustmentReason: string | null;
  solution: string | null; solutionDate: string | null;
  manualResolutionStatus: "resolved" | "reopened" | null;
  financeAttention: "none" | "无需关注" | "一般关注" | "需财务复核" | null;
  ownerId: string | null; ownerName: string | null;
};
export type DifferenceItem = {
  // PostgreSQL returns its canonical persisted taxonomy verbatim.  It includes
  // migrated Q1 values such as returned_invoice and other_without_invoice.
  id: string; category: string;
  invoiceNo: string | null; invoiceDate: string | null; differenceAmount: string | null;
  differenceDescription: string | null; verificationStatus: "not_applicable" | "pending" | "matched" | "mismatched";
  attachmentKeys: string[];
};
export type PreviousQuarterTransferCandidate = { id: string; sequence: string | null; region: string | null; timepoint: string | null; companyReceivable: string | null; customerBookAmount: string | null; accountSet: string; matchMode: "EXACT_ACCOUNT_SET" | "EQUIVALENT_ACCOUNT_SET" };
export type PreviousQuarterTransferItem = Pick<DifferenceItem, "id" | "category" | "invoiceNo" | "invoiceDate" | "differenceAmount" | "differenceDescription"> & { transferStatus: "AVAILABLE" | "ALREADY_TRANSFERRED" | "CURRENT_INVOICE_EXISTS" };
export type PreviousQuarterTransferPreview = {
  matchStatus: "ZERO_MATCH" | "MULTI_MATCH" | "READY";
  target: { id: string; quarter: string; previousQuarter: string; accountSet: string; customer: string };
  source?: PreviousQuarterTransferCandidate;
  candidates: PreviousQuarterTransferCandidate[];
  items: PreviousQuarterTransferItem[];
  previewToken: string | null;
  accountMatchMode?: "EXACT_ACCOUNT_SET" | "EQUIVALENT_ACCOUNT_SET";
};
type DifferenceItemWrite = Omit<DifferenceItem, "id" | "verificationStatus"> & {
  verificationStatus?: DifferenceItem["verificationStatus"];
};
export type Quarter = { code: string; year: number; quarter: number; cutoffDate: string | null; status: string; reconciliationCount: number };
export type Followup = { id: string; followStatus: string; processStage: string | null; riskLevel: string; expectedCompleteAt: string | null; nextFollowUpAt: string | null; latestFollowUpAt: string | null; closedAt: string | null; events: FollowupEvent[] };
export type FollowupEvent = { id: string; eventType: string; content: string | null; occurredAt: string };
export type MaterialStatus = { id: string; materialType: string; provided: boolean | null; rawValue: string | null; reconciliationId: string | null };
export type QuarterImportResult = {
  quarter: string;
  status: "IMPORTED";
  importedRows: number;
  sourceSha256: string;
  batchKey: string;
};
// PostgreSQL ledger verification runtime (Phase 2G.1).
export type LedgerVerificationResult = {
  matched: boolean;
  status: "matched" | "not_found";
  matchedDatasetType: "HISTORICAL_BASE" | "CURRENT_YEAR_QUARTER" | null;
  matchedDatasetId: string | null;
  invoiceNo: string;
  invoiceDate: string | null;
  invoiceAmount: string | null;
  matchCount: number;
};
export type LedgerInvoiceResolution = { invoiceNumber: string; status: "resolved" | "ambiguous" | "not_found"; invoiceDate: string | null; invoiceAmount: string | null; candidateDates: string[] };
export type QuarterLedgerImportResult = {
  quarter: string;
  status: "IMPORTED";
  datasetId: string;
  datasetType: "CURRENT_YEAR_QUARTER";
  version: number;
  sourceFiles: string[];
  sourceSha256: string;
  insertedRows: number;
  distinctInvoices: number;
};
export type LedgerSourceFileInput = {
  sourceFileName: string;
  headers: string[];
  rows: unknown[][];
};
// Quarter-scoped dashboard aggregate reads (Phase 2F.1). Each item carries
// reconciliationId for Map-join with the shared reconciliation dataset; amounts
// are NUMERIC-as-string; NULL stays NULL.
export type QuarterDifferenceItem = {
  id: string;
  reconciliationId: string;
  quarterCode: string;
  // Real DB category values are returned verbatim (never renamed). The write API
  // taxonomy is transit/returned/lost/instrument/otherInvoice/other, but legacy
  // quarters may contain migrated values (e.g. returned_invoice, lost_invoice,
  // equipment, other_with_invoice, other_without_invoice, transit) — so the type
  // is `string` on purpose.
  category: string;
  invoiceNo: string | null;
  invoiceDate: string | null;
  differenceAmount: string | null;
  differenceDescription: string | null;
  verificationStatus: "not_applicable" | "pending" | "matched" | "mismatched";
  attachmentKeys: string[];
};
export type QuarterFollowupEvent = {
  id: string;
  eventType: string;
  content: string | null;
  occurredAt: string;
};
export type QuarterFollowupItem = {
  id: string;
  reconciliationId: string;
  quarterCode: string;
  followStatus: string;
  processStage: string | null;
  riskLevel: string;
  expectedCompleteAt: string | null;
  nextFollowUpAt: string | null;
  latestFollowUpAt: string | null;
  closedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  events: QuarterFollowupEvent[];
  latestEvent: QuarterFollowupEvent | null;
};
// Independent quarterly SPD dashboard dataset (SPD SOURCE B, recon.spd_dashboard_rows).
// This is the separately-uploaded SPD 专项 Excel — NOT recon.material_status
// (SPD SOURCE A). "是"/"否" both count as submitted; blank/NULL = unsubmitted.
export type SpdDashboardSummary = {
  total: number;
  submitted: number;
  unsubmitted: number;
  submissionRate: number | null;
};
export type SpdDashboardRow = {
  id: string;
  sourceRowNumber: number | null;
  accountSet: string | null;
  region: string | null;
  customer: string | null;
  spdConfirmation: string | null;
  spdInventoryConfirmation: string | null;
  reconciliationId: string | null;
};
export type SpdDashboardData = {
  quarter: string;
  count: number;
  summary: {
    spdConfirmation: SpdDashboardSummary;
    spdInventoryConfirmation: SpdDashboardSummary;
  };
  items: SpdDashboardRow[];
};

// Phase 2H.1 — remaining business import result shapes.
export type MaterialImportResult = {
  quarter: string;
  status: "IMPORTED" | "PARTIAL";
  sourceRows: number;
  matchedRows: number;
  unmatchedRows: number;
  ambiguousRows: number;
  writtenMaterialCells: number;
  unmatchedKeys: string[];
  sourceSha256: string;
  importBatchId: string;
};
export type SpdImportResult = {
  quarter: string;
  status: "REPLACED";
  sourceRows: number;
  replacedRows: number;
  linkedReconciliations: number;
  sourceSha256: string;
  importBatchId: string;
};
export type CompanyReceivableImportResult = {
  quarter: string;
  status: "IMPORTED" | "PARTIAL";
  sourceRows: number;
  matchedRows: number;
  updatedRows: number;
  unchangedRows: number;
  unmatchedRows: number;
  ambiguousRows: number;
  sourceSha256: string;
  importBatchId: string;
};
export type HistoricalLedgerReplaceResult = {
  status: "REPLACED";
  datasetId: string;
  datasetType: "HISTORICAL_BASE";
  version: number;
  sourceFiles: string[];
  sourceSha256: string;
  insertedRows: number;
  distinctInvoices: number;
  previousVersion: number;
  importBatchId: string | null;
};

export class ReconciliationApiError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
async function request<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { ...init, signal, headers: { "content-type": "application/json", ...init.headers } });
  const payload = await response.json().catch(() => ({})) as { error?: string; code?: string } & T;
  if (!response.ok) throw new ReconciliationApiError(payload.code ?? "INTERNAL", payload.error ?? `请求失败（${response.status}）`);
  return payload;
}

export const differenceAttachmentApi = {
  upload: async (file: File): Promise<{ key: string; contentType: string; size: number }> => {
    const body = new FormData(); body.append("file", file);
    const response = await fetch("/api/attachments/images", { method: "POST", body });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "图片上传失败，请重试。");
    return payload;
  },
  url: (key: string) => `/api/attachments/images?key=${encodeURIComponent(key)}`,
  remove: async (key: string) => {
    const response = await fetch(`/api/attachments/images?key=${encodeURIComponent(key)}`, { method: "DELETE" });
    if (!response.ok) throw new Error("图片删除失败。");
  },
};
const base = (quarter: string, id?: string) => `/api/quarter/${encodeURIComponent(quarter)}/reconciliations${id ? `/${encodeURIComponent(id)}` : ""}`;
export const reconciliationApi = {
  listQuarters: (signal?: AbortSignal) => request<{ quarters: Quarter[] }>("/api/quarters", {}, signal),
  list: (quarter: string, signal?: AbortSignal) => request<{ quarter: string; reconciliations: Reconciliation[] }>(base(quarter), {}, signal),
  importQuarter: (quarter: string, body: { sourceFileName: string; headers: string[]; rows: unknown[][] }) => request<QuarterImportResult>(`/api/quarter/${encodeURIComponent(quarter)}/import`, { method: "POST", body: JSON.stringify(body) }),
  patch: (quarter: string, id: string, body: Partial<Pick<Reconciliation, "customerBookAmount" | "reconciliationStatus" | "badDebtAmount" | "badDebtReason" | "adjustmentAmount" | "adjustmentReason" | "solution" | "solutionDate" | "ownerName" | "manualResolutionStatus" | "financeAttention">>) => request<{ quarter: string; reconciliation: Reconciliation }>(base(quarter, id), { method: "PATCH", body: JSON.stringify(body) }),
  listDifferenceItems: (quarter: string, id: string, signal?: AbortSignal) => request<{ items: DifferenceItem[] }>(`${base(quarter, id)}/difference-items`, {}, signal),
  createDifferenceItem: (quarter: string, id: string, body: DifferenceItemWrite) => request<{ item: DifferenceItem }>(`${base(quarter, id)}/difference-items`, { method: "POST", body: JSON.stringify(body) }),
  previewPreviousQuarterDifferenceItems: (quarter: string, id: string, sourceReconciliationId?: string) => request<PreviousQuarterTransferPreview>(`${base(quarter, id)}/difference-items/transfer-previous-quarter/preview`, { method: "POST", body: JSON.stringify(sourceReconciliationId ? { sourceReconciliationId } : {}) }),
  executePreviousQuarterDifferenceItems: (quarter: string, id: string, previewToken: string, sourceDifferenceItemIds: string[]) => request<{ batchId: string; targetQuarter: string; sourceQuarter: string; insertedCount: number; targetDifferenceItemIds: string[] }>(`${base(quarter, id)}/difference-items/transfer-previous-quarter/execute`, { method: "POST", body: JSON.stringify({ previewToken, sourceDifferenceItemIds }) }),
  patchDifferenceItem: (quarter: string, id: string, itemId: string, body: Partial<DifferenceItemWrite>) => request<{ item: DifferenceItem }>(`${base(quarter, id)}/difference-items/${encodeURIComponent(itemId)}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteDifferenceItem: (quarter: string, id: string, itemId: string) => request(`${base(quarter, id)}/difference-items/${encodeURIComponent(itemId)}`, { method: "DELETE" }),
  getFollowups: (quarter: string, id: string) => request<{ followups: Followup[] }>(`${base(quarter, id)}/followups`),
  createFollowup: (quarter: string, id: string, body: Partial<Followup> & { event?: Omit<FollowupEvent, "id"> }) => request(`${base(quarter, id)}/followups`, { method: "POST", body: JSON.stringify(body) }),
  updateFollowup: (quarter: string, id: string, body: Partial<Followup> & { event?: Omit<FollowupEvent, "id"> }) => request(`${base(quarter, id)}/followups`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteFollowup: (quarter: string, id: string) => request(`${base(quarter, id)}/followups`, { method: "DELETE" }),
  createFollowupEvent: (quarter: string, id: string, body: Omit<FollowupEvent, "id">) => request(`${base(quarter, id)}/followups/events`, { method: "POST", body: JSON.stringify(body) }),
  getMaterialStatus: (quarter: string, id?: string, signal?: AbortSignal) => request<{ material: MaterialStatus[] }>(id ? `${base(quarter, id)}/material-status` : `/api/quarter/${encodeURIComponent(quarter)}/material-status`, {}, signal),
  listQuarterDifferenceItems: (quarter: string, signal?: AbortSignal) => request<{ quarter: string; count: number; items: QuarterDifferenceItem[] }>(`/api/quarter/${encodeURIComponent(quarter)}/difference-items`, {}, signal),
  listQuarterFollowups: (quarter: string, signal?: AbortSignal) => request<{ quarter: string; count: number; eventCount: number; items: QuarterFollowupItem[] }>(`/api/quarter/${encodeURIComponent(quarter)}/followups`, {}, signal),
  getSpdDashboard: (quarter: string, signal?: AbortSignal) => request<SpdDashboardData>(`/api/quarter/${encodeURIComponent(quarter)}/spd-dashboard`, {}, signal),
  verifyLedgerInvoice: (quarter: string, body: { invoiceNo?: string; invoiceDate?: string; amount?: string }, signal?: AbortSignal) => request<LedgerVerificationResult>(`/api/quarter/${encodeURIComponent(quarter)}/ledger/verify`, { method: "POST", body: JSON.stringify(body) }, signal),
  resolveLedgerInvoices: (quarter: string, invoiceNumbers: string[], signal?: AbortSignal) => request<{ results: LedgerInvoiceResolution[] }>(`/api/quarter/${encodeURIComponent(quarter)}/ledger/resolve`, { method: "POST", body: JSON.stringify({ invoiceNumbers }) }, signal),
  importQuarterLedger: (quarter: string, body: { sourceFiles: LedgerSourceFileInput[] }) => request<QuarterLedgerImportResult>(`/api/quarter/${encodeURIComponent(quarter)}/ledger/import`, { method: "POST", body: JSON.stringify(body) }),
  upsertMaterialStatus: (quarter: string, body: Omit<MaterialStatus, "id">, id?: string) => request(id ? `${base(quarter, id)}/material-status` : `/api/quarter/${encodeURIComponent(quarter)}/material-status`, { method: id ? "POST" : "PUT", body: JSON.stringify(body) }),
  updateMaterialStatus: (quarter: string, materialId: string, body: Partial<MaterialStatus>, id?: string) => request(id ? `${base(quarter, id)}/material-status/${encodeURIComponent(materialId)}` : `/api/quarter/${encodeURIComponent(quarter)}/material-status/${encodeURIComponent(materialId)}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteMaterialStatus: (quarter: string, materialId: string, id?: string) => request(id ? `${base(quarter, id)}/material-status/${encodeURIComponent(materialId)}` : `/api/quarter/${encodeURIComponent(quarter)}/material-status/${encodeURIComponent(materialId)}`, { method: "DELETE" }),
  // Phase 2H.1 — remaining business imports (server-scoped quarter imports).
  importMaterials: (quarter: string, body: { sourceFileName: string; headers: string[]; rows: unknown[][] }) => request<MaterialImportResult>(`/api/quarter/${encodeURIComponent(quarter)}/materials/import`, { method: "POST", body: JSON.stringify(body) }),
  importSpdDashboard: (quarter: string, body: { sourceFileName: string; headers: string[]; rows: unknown[][] }) => request<SpdImportResult>(`/api/quarter/${encodeURIComponent(quarter)}/spd-dashboard/import`, { method: "POST", body: JSON.stringify(body) }),
  importCompanyReceivables: (quarter: string, body: { sourceFileName: string; headers: string[]; rows: unknown[][] }) => request<CompanyReceivableImportResult>(`/api/quarter/${encodeURIComponent(quarter)}/company-receivables/import`, { method: "POST", body: JSON.stringify(body) }),
  replaceHistoricalLedger: (body: { sourceFiles: LedgerSourceFileInput[] }) => request<HistoricalLedgerReplaceResult>(`/api/ledger/historical/import`, { method: "POST", body: JSON.stringify(body) }),
};
