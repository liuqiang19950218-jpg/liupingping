/** Browser client for the same-origin reconciliation runtime API. */
export type Reconciliation = {
  id: string; sourceRowKey: string | null; quarterCode: string;
  region: string | null; accountSet: string | null; customer: string | null;
  companyReceivable: string | null; customerBookAmount: string | null;
  reconciliationDifference: string | null; reconciliationStatus: string | null;
  badDebtAmount: string | null; badDebtReason: string | null;
  adjustmentAmount: string | null; adjustmentReason: string | null;
  solution: string | null; solutionDate: string | null;
  ownerId: string | null; ownerName: string | null;
};
export type DifferenceItem = {
  id: string; category: "transit" | "returned" | "lost" | "instrument" | "otherInvoice" | "other";
  invoiceNo: string | null; invoiceDate: string | null; differenceAmount: string | null;
  differenceDescription: string | null; verificationStatus: "not_applicable" | "pending" | "matched" | "mismatched";
  attachmentKeys: string[];
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

export class ReconciliationApiError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
async function request<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { ...init, signal, headers: { "content-type": "application/json", ...init.headers } });
  const payload = await response.json().catch(() => ({})) as { error?: string; code?: string } & T;
  if (!response.ok) throw new ReconciliationApiError(payload.code ?? "INTERNAL", payload.error ?? `请求失败（${response.status}）`);
  return payload;
}
const base = (quarter: string, id?: string) => `/api/quarter/${encodeURIComponent(quarter)}/reconciliations${id ? `/${encodeURIComponent(id)}` : ""}`;
export const reconciliationApi = {
  listQuarters: (signal?: AbortSignal) => request<{ quarters: Quarter[] }>("/api/quarters", {}, signal),
  list: (quarter: string, signal?: AbortSignal) => request<{ quarter: string; reconciliations: Reconciliation[] }>(base(quarter), {}, signal),
  importQuarter: (quarter: string, body: { sourceFileName: string; headers: string[]; rows: unknown[][] }) => request<QuarterImportResult>(`/api/quarter/${encodeURIComponent(quarter)}/import`, { method: "POST", body: JSON.stringify(body) }),
  patch: (quarter: string, id: string, body: Partial<Pick<Reconciliation, "customerBookAmount" | "reconciliationStatus" | "badDebtAmount" | "badDebtReason" | "adjustmentAmount" | "adjustmentReason" | "solution" | "solutionDate" | "ownerName">>) => request<{ quarter: string; reconciliation: Reconciliation }>(base(quarter, id), { method: "PATCH", body: JSON.stringify(body) }),
  listDifferenceItems: (quarter: string, id: string, signal?: AbortSignal) => request<{ items: DifferenceItem[] }>(`${base(quarter, id)}/difference-items`, {}, signal),
  createDifferenceItem: (quarter: string, id: string, body: Omit<DifferenceItem, "id">) => request<{ item: DifferenceItem }>(`${base(quarter, id)}/difference-items`, { method: "POST", body: JSON.stringify(body) }),
  patchDifferenceItem: (quarter: string, id: string, itemId: string, body: Partial<Omit<DifferenceItem, "id">>) => request<{ item: DifferenceItem }>(`${base(quarter, id)}/difference-items/${encodeURIComponent(itemId)}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteDifferenceItem: (quarter: string, id: string, itemId: string) => request(`${base(quarter, id)}/difference-items/${encodeURIComponent(itemId)}`, { method: "DELETE" }),
  getFollowups: (quarter: string, id: string) => request<{ followups: Followup[] }>(`${base(quarter, id)}/followups`),
  createFollowup: (quarter: string, id: string, body: Partial<Followup> & { event?: Omit<FollowupEvent, "id"> }) => request(`${base(quarter, id)}/followups`, { method: "POST", body: JSON.stringify(body) }),
  updateFollowup: (quarter: string, id: string, body: Partial<Followup> & { event?: Omit<FollowupEvent, "id"> }) => request(`${base(quarter, id)}/followups`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteFollowup: (quarter: string, id: string) => request(`${base(quarter, id)}/followups`, { method: "DELETE" }),
  createFollowupEvent: (quarter: string, id: string, body: Omit<FollowupEvent, "id">) => request(`${base(quarter, id)}/followups/events`, { method: "POST", body: JSON.stringify(body) }),
  getMaterialStatus: (quarter: string, id?: string) => request<{ material: MaterialStatus[] }>(id ? `${base(quarter, id)}/material-status` : `/api/quarter/${encodeURIComponent(quarter)}/material-status`),
  listQuarterDifferenceItems: (quarter: string, signal?: AbortSignal) => request<{ quarter: string; count: number; items: QuarterDifferenceItem[] }>(`/api/quarter/${encodeURIComponent(quarter)}/difference-items`, {}, signal),
  listQuarterFollowups: (quarter: string, signal?: AbortSignal) => request<{ quarter: string; count: number; eventCount: number; items: QuarterFollowupItem[] }>(`/api/quarter/${encodeURIComponent(quarter)}/followups`, {}, signal),
  upsertMaterialStatus: (quarter: string, body: Omit<MaterialStatus, "id">, id?: string) => request(id ? `${base(quarter, id)}/material-status` : `/api/quarter/${encodeURIComponent(quarter)}/material-status`, { method: id ? "POST" : "PUT", body: JSON.stringify(body) }),
  updateMaterialStatus: (quarter: string, materialId: string, body: Partial<MaterialStatus>, id?: string) => request(id ? `${base(quarter, id)}/material-status/${encodeURIComponent(materialId)}` : `/api/quarter/${encodeURIComponent(quarter)}/material-status/${encodeURIComponent(materialId)}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteMaterialStatus: (quarter: string, materialId: string, id?: string) => request(id ? `${base(quarter, id)}/material-status/${encodeURIComponent(materialId)}` : `/api/quarter/${encodeURIComponent(quarter)}/material-status/${encodeURIComponent(materialId)}`, { method: "DELETE" }),
};
