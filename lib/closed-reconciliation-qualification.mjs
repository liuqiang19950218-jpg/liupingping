import { isLegacyTrackerItem, legacyTrackerTab } from "./followup-tracker-routing.mjs";

const text = (value) => String(value ?? "").trim();

// These are derived read-model qualifications only. They never write a
// solution date or a manual-resolution status.
export function hasValidSolution(row) {
  return Boolean(text(row?.solution));
}

export function hasSolutionDate(row) {
  return Boolean(text(row?.solutionDate));
}

// A sales user must explicitly confirm completion for a dated plan to close.
export function hasManualResolvedQualification(row) {
  return isLegacyTrackerItem(row) && legacyTrackerTab(row?.manualResolutionStatus) === "resolved";
}

// A solution without a planned solution date is the approved auto-archive
// case. A solution with a date remains pending until manually confirmed.
export function hasSolutionOnlyResolvedQualification(row) {
  return hasValidSolution(row) && !hasSolutionDate(row);
}

export function isResolvedArchiveReconciliation(row) {
  return hasManualResolvedQualification(row) || hasSolutionOnlyResolvedQualification(row);
}

export function isUnresolvedFollowupReconciliation(row) {
  return isLegacyTrackerItem(row) && !isResolvedArchiveReconciliation(row);
}

export function isFollowupTrackerReconciliation(row) {
  return isResolvedArchiveReconciliation(row) || isUnresolvedFollowupReconciliation(row);
}

export function isClosedReconciliation(row) {
  return isResolvedArchiveReconciliation(row);
}

export function closedReconciliationIds(rows) {
  return new Set(rows.filter(isClosedReconciliation).map((row) => row.id));
}
