/** The PostgreSQL reconciliation_status vocabulary shared by every dashboard. */
export const SETTLED_STATUS = "已对清";
export const UNSETTLED_STATUS = "未对清";
export const UNRECONCILED_STATUS = "未对账";

const statusOf = (rowOrStatus) => typeof rowOrStatus === "string"
  ? rowOrStatus
  : rowOrStatus?.reconciliationStatus ?? null;

export const isSettled = (rowOrStatus) => statusOf(rowOrStatus) === SETTLED_STATUS;
export const isUnsettled = (rowOrStatus) => statusOf(rowOrStatus) === UNSETTLED_STATUS;
export const isUnreconciled = (rowOrStatus) => statusOf(rowOrStatus) === UNRECONCILED_STATUS;

export function summarizeSettlement(rows) {
  return rows.reduce((summary, row) => {
    if (isSettled(row)) summary.settled += 1;
    else if (isUnsettled(row)) summary.unsettled += 1;
    else if (isUnreconciled(row)) summary.unreconciled += 1;
    return summary;
  }, { settled: 0, unsettled: 0, unreconciled: 0 });
}

export function settlementRate({ settled, unsettled }) {
  const denominator = settled + unsettled;
  return denominator ? (settled / denominator) * 100 : 0;
}
