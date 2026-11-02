/**
 * The legacy tracker is deliberately narrower than the general follow-up
 * dataset.  Its membership is the historical resolution-date scope; its tab
 * is the independently persisted manual resolution state.
 */
export function isLegacyTrackerItem(row) {
  return Boolean(String(row.solutionDate ?? "").trim());
}

export function legacyTrackerTab(manualResolutionStatus) {
  return manualResolutionStatus === "resolved" ? "resolved" : "pending";
}

export function auditLegacyTrackerRouting(rows) {
  const scoped = rows.filter(isLegacyTrackerItem);
  return {
    pending: scoped.filter((row) => legacyTrackerTab(row.manualResolutionStatus) === "pending"),
    resolved: scoped.filter((row) => legacyTrackerTab(row.manualResolutionStatus) === "resolved"),
    excluded: rows.filter((row) => !isLegacyTrackerItem(row)),
  };
}
