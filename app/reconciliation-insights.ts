import { type CockpitRow, cockpitRows, latestQuarterlyCockpitRows } from "./cockpit-data";

export type RiskLevel = "高风险" | "中风险" | "低风险";
export type IssueStage =
  | "待销售走申请"
  | "待销售去医院处理"
  | "待财务调账"
  | "待核查"
  | "已关闭";

export type ReconciliationIssue = CockpitRow & {
  riskLevel: RiskLevel;
  stage: IssueStage;
  overdueDays: number;
};

const NOW = new Date("2026-08-03T00:00:00").getTime();

export const formatMoney = (value: number, unit: "元" | "万元" = "元") =>
  unit === "万元"
    ? `${(value / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} 万`
    : value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });

export const formatRate = (value: number) => `${value.toFixed(1)}%`;

export const getOverdueDays = (date: string) => {
  const value = new Date(`${date}T00:00:00`).getTime();
  return Number.isFinite(value) ? Math.max(0, Math.floor((NOW - value) / 86_400_000)) : 0;
};

export const issueStageOf = (row: CockpitRow): IssueStage => {
  if (row.followStatus.includes("已解决")) return "已关闭";
  if (
    row.processStage === "待销售走申请" ||
    row.processStage === "待销售去医院处理" ||
    row.processStage === "待财务调账" ||
    row.processStage === "待核查"
  )
    return row.processStage;
  const content = `${row.followStatus} ${row.solution} ${row.cause}`;
  if (content.includes("财务") || content.includes("调账")) return "待财务调账";
  if (content.includes("医院")) return "待销售去医院处理";
  if (content.includes("申请")) return "待销售走申请";
  return "待核查";
};

export const issueRiskOf = (row: CockpitRow): RiskLevel => {
  const overdue = getOverdueDays(row.expectedDate);
  const invoiceIssue = Boolean(row.transitInvoiceFail || row.returnInvoiceFail || row.lostInvoiceFail || row.instrumentInvoiceFail || row.otherInvoiceFail || row.duplicateInvoice);
  if (overdue > 90 || row.difference >= 100000 || invoiceIssue || row.consecutiveUnclear) return "高风险";
  if (overdue > 30 || row.difference > 0) return "中风险";
  return "低风险";
};

export function allIssuesForQuarter(quarter: string): ReconciliationIssue[] {
  // The problem dashboard is a summary of the actual "待解决清单" rather
  // than a separate issue source.  A customer first enters that list only
  // after a first solution has been recorded, and leaves it once resolved.
  const liveRows = latestQuarterlyCockpitRows();
  const source = liveRows.length ? liveRows : cockpitRows;
  return source
    .filter((row) => row.quarter === quarter && row.filled && row.difference !== 0 && row.solution.trim())
    .map((row) => ({ ...row, riskLevel: issueRiskOf(row), stage: issueStageOf(row), overdueDays: getOverdueDays(row.expectedDate) }));
}

export function issuesForQuarter(quarter: string): ReconciliationIssue[] {
  return allIssuesForQuarter(quarter).filter((row) => row.followStatus !== "已解决");
}

export const topPendingIssuesByDifference = (items: ReconciliationIssue[], limit = 5) =>
  [...items]
    .sort((a, b) => b.difference - a.difference || b.overdueDays - a.overdueDays)
    .slice(0, limit);

export function issueSummary(items: ReconciliationIssue[]) {
  const totalAmount = items.reduce((sum, item) => sum + Math.abs(item.difference), 0);
  const by = <T extends string>(fn: (item: ReconciliationIssue) => T) =>
    [...items.reduce((map, item) => map.set(fn(item), (map.get(fn(item)) ?? 0) + 1), new Map<T, number>())]
      .map(([name, count]) => ({ name, count, ratio: items.length ? count / items.length : 0 }));
  return {
    totalAmount,
    overdue: items.filter((item) => item.overdueDays > 7),
    untouched: items.filter((item) => item.overdueDays >= 7),
    finance: items.filter((item) => item.followStatus.includes("财务")),
    high: items.filter((item) => item.riskLevel === "高风险"),
    stages: by((item) => item.stage),
    blockers: by((item) => item.cause || "未填写差额原因").sort((a, b) => b.count - a.count).slice(0, 5),
    owners: [...items.reduce((map, item) => {
      const entry = map.get(item.owner) ?? { name: item.owner || "未分配", count: 0, overdue: 0, high: 0 };
      entry.count += 1; entry.overdue += item.overdueDays > 7 ? 1 : 0; entry.high += item.riskLevel === "高风险" ? 1 : 0;
      map.set(item.owner, entry); return map;
    }, new Map<string, { name: string; count: number; overdue: number; high: number }>()).values()].sort((a, b) => b.count - a.count).slice(0, 5),
  };
}
