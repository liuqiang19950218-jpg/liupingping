/** The approved routing contract for a non-empty first solution. */
export function solutionFollowupBucket(solution, solutionDate) {
  if (!String(solution ?? "").trim()) return null;
  return String(solutionDate ?? "").trim() ? "pending" : "resolved";
}

export function auditSolutionRouting(rows) {
  const routed = rows.map((row) => ({ id: row.id, bucket: solutionFollowupBucket(row.solution, row.solutionDate) }));
  return {
    pending: routed.filter((item) => item.bucket === "pending"),
    resolved: routed.filter((item) => item.bucket === "resolved"),
    blank: routed.filter((item) => item.bucket === null),
  };
}
