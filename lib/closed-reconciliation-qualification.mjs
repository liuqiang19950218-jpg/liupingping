import { isLegacyTrackerItem, legacyTrackerTab } from "./followup-tracker-routing.mjs";

const text = (value) => String(value ?? "").trim();

// Preserve the existing dated tracker/manual-resolution route, then extend it
// with the approved current-quarter solution-only qualification.  This is a
// derived read model only: it never writes a solution date or status.
export function hasValidSolution(row) {
  return Boolean(text(row?.solution));
}

export function hasExistingResolvedQualification(row) {
  return isLegacyTrackerItem(row) && legacyTrackerTab(row?.manualResolutionStatus) === "resolved";
}

export function isClosedReconciliation(row) {
  return hasExistingResolvedQualification(row) || hasValidSolution(row);
}

export function closedReconciliationIds(rows) {
  return new Set(rows.filter(isClosedReconciliation).map((row) => row.id));
}
