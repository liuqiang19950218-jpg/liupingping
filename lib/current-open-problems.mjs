import { isUnresolvedFollowupReconciliation } from "./closed-reconciliation-qualification.mjs";

const hasCustomer = (row) => Boolean(String(row?.customer ?? "").trim());

// The read-only source set for every current-problem surface. Closed/archive
// rows are deliberately excluded; no persistence fields are changed here.
export function isCurrentOpenProblem(row) {
  return hasCustomer(row) && isUnresolvedFollowupReconciliation(row);
}

export function currentOpenProblemIds(rows) {
  return new Set([...rows].filter(isCurrentOpenProblem).map((row) => row.id));
}

export function currentOpenTrackerItems(items, reconciliationRows) {
  const ids = currentOpenProblemIds(reconciliationRows);
  return items.filter((item) => ids.has(item.reconciliationId));
}
