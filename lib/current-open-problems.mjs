import { isUnresolvedFollowupReconciliation } from "./closed-reconciliation-qualification.mjs";

const hasCustomer = (row) => Boolean(String(row?.customer ?? "").trim());
const hasRecordedAmount = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return Boolean(value.trim());
  return typeof value === "number" && Number.isFinite(value);
};

// Reconciliation API records expose reconciliationDifference; cockpit rows
// retain the same persisted amount as difference after their display mapping.
// Zero remains a recorded amount in both representations.
export function hasRecordedReconciliationDifference(row) {
  if (Object.prototype.hasOwnProperty.call(row ?? {}, "reconciliationDifference")) {
    return hasRecordedAmount(row?.reconciliationDifference);
  }
  return hasRecordedAmount(row?.difference);
}

// The read-only source set for every current-problem surface. Closed/archive
// rows are deliberately excluded; no persistence fields are changed here.
export function isCurrentOpenProblem(row) {
  return hasCustomer(row) && hasRecordedReconciliationDifference(row) && isUnresolvedFollowupReconciliation(row);
}

export function currentOpenProblemIds(rows) {
  return new Set([...rows].filter(isCurrentOpenProblem).map((row) => row.id));
}

export function currentOpenTrackerItems(items, reconciliationRows) {
  const ids = currentOpenProblemIds(reconciliationRows);
  return items.filter((item) => ids.has(item.reconciliationId));
}
