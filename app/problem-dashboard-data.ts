import {
  formatMoney,
  getOverdueDays,
  allIssuesForQuarter,
  issueSummary,
  issuesForQuarter,
  topPendingIssuesByDifference,
  type ReconciliationIssue,
} from "./reconciliation-insights";

export type ProblemFilters = {
  quarter: string;
  region: string;
  owner: string;
  risk: string;
  cause: string;
  stage: string;
  aging: string;
  follow: string;
};

export type StageItem = { name: string; count: number; ratio: number; color: string };
export type CountItem = { name: string; count: number; ratio: number; color: string };
export type OwnerItem = { name: string; count: number; overdue: number; high: number; untouched: number; averageDays: number };
export type AgeItem = { name: string; count: number; ratio: number; color: string };

const STAGES = [
  ["待销售走申请", "#1677ff"],
  ["待销售去医院处理", "#25bda5"],
  ["待财务调账", "#f6bd16"],
  ["待核查", "#20a8d8"],
  ["已关闭", "#b8bfd8"],
] as const;

const AGES = [
  ["0-7天", 0, 7, "#3f8cff"], ["8-30天", 8, 30, "#20c5c7"], ["31-60天", 31, 60, "#f6bd16"],
  ["61-90天", 61, 90, "#8b69ed"], ["90天以上", 91, Infinity, "#ef6a6a"],
] as const;

const latestAt = (item: ReconciliationIssue) => item.updatedAt || item.expectedDate || "—";
const stageOf = (item: ReconciliationIssue) => item.stage;
const followStateOf = (item: ReconciliationIssue) =>
  item.overdueDays > 7 ? "已超期" : item.overdueDays > 0 ? "待跟进" : "跟进中";

export function filterProblemItems(filters: ProblemFilters) {
  return filterItems(issuesForQuarter(filters.quarter), filters);
}

export function filterAllProblemItems(filters: ProblemFilters) {
  return filterItems(allIssuesForQuarter(filters.quarter), filters);
}

function filterItems(source: ReconciliationIssue[], filters: ProblemFilters) {
  return source.filter((item) => {
    if (filters.region !== "全部" && item.region !== filters.region) return false;
    if (filters.owner !== "全部" && item.owner !== filters.owner) return false;
    if (filters.risk !== "全部" && item.riskLevel !== filters.risk) return false;
    if (filters.cause !== "全部" && item.cause !== filters.cause) return false;
    if (filters.stage !== "全部" && stageOf(item) !== filters.stage) return false;
    if (filters.follow !== "全部" && followStateOf(item) !== filters.follow) return false;
    if (filters.aging !== "全部") {
      const found = AGES.find(([name]) => name === filters.aging);
      if (found && (item.overdueDays < found[1] || item.overdueDays > found[2])) return false;
    }
    return true;
  });
}

export function buildProblemDashboard(items: ReconciliationIssue[], closedItems: ReconciliationIssue[] = []) {
  const summary = issueSummary(items);
  const total = items.length;
  const stageTotal = total + closedItems.length;
  const stages: StageItem[] = STAGES.map(([name, color]) => {
    const count = name === "已关闭"
      ? closedItems.length
      : items.filter((item) => stageOf(item) === name).length;
    return { name, count, ratio: stageTotal ? count / stageTotal : 0, color };
  }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
  const blockers: CountItem[] = summary.blockers.map((item, index) => ({
    ...item,
    color: ["#1677ff", "#13c2c2", "#f6bd16", "#ef6a6a", "#a49adf"][index] ?? "#94a3b8",
  }));
  const owners: OwnerItem[] = [...items.reduce((map, item) => {
    const entry = map.get(item.owner) ?? { name: item.owner || "未分配", count: 0, overdue: 0, high: 0, untouched: 0, averageDays: 0 };
    entry.count += 1;
    entry.overdue += item.overdueDays > 0 ? 1 : 0;
    entry.high += item.riskLevel === "高风险" ? 1 : 0;
    entry.untouched += item.overdueDays >= 7 ? 1 : 0;
    entry.averageDays += item.overdueDays;
    map.set(item.owner, entry);
    return map;
  }, new Map<string, OwnerItem>()).values()]
    .map((item) => ({ ...item, averageDays: item.count ? item.averageDays / item.count : 0 }))
    .sort((a, b) => b.count - a.count || b.high - a.high)
    .slice(0, 5);
  const ages: AgeItem[] = AGES.map(([name, min, max, color]) => {
    const count = items.filter((item) => item.overdueDays >= min && item.overdueDays <= max).length;
    return { name, count, ratio: total ? count / total : 0, color };
  }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
  const priority = topPendingIssuesByDifference(items);
  const waitingCustomer = items.filter(
    (item) =>
      item.stage === "待销售走申请" || item.stage === "待销售去医院处理",
  );
  const waitingInternal = items.filter((item) => item.stage === "待财务调账");
  const high = items.filter((item) => item.riskLevel === "高风险");
  const finance = summary.finance;
  const overdue = items.filter((item) => item.overdueDays > 0);
  return {
    total,
    stageTotal,
    summary,
    stages,
    blockers,
    owners,
    ages,
    priority,
    preview: priority.slice(0, 8),
    metrics: {
      all: items,
      overdue,
      untouched: summary.untouched,
      customer: waitingCustomer,
      internal: waitingInternal,
      finance,
      leader: high,
      week: items.filter((item) => item.overdueDays <= 7),
    },
    suggestions: [
      { id: "overdue", icon: "◷", tone: "danger", title: "优先处理超期问题", description: `当前超期 ${overdue.length} 个，建议按风险等级优先处理。`, filter: "overdue" },
      { id: "customer", icon: "◌", tone: "cyan", title: "推进待销售处理", description: `待销售处理 ${waitingCustomer.length} 个，建议销售主动联系客户推进。`, filter: "customer" },
      { id: "finance", icon: "¥", tone: "blue", title: "安排财务复核", description: `需财务介入 ${finance.length} 个，建议尽快核查与调账。`, filter: "finance" },
      { id: "leader", icon: "◎", tone: "purple", title: "升级高风险事项", description: `高风险问题 ${high.length} 个，建议统筹推进并打通阻塞。`, filter: "leader" },
      { id: "large", icon: "▣", tone: "orange", title: "优先关闭大额问题", description: `关注前 ${priority.length} 个大额待解决问题，降低风险敞口。`, filter: "large" },
    ],
  };
}

export const issueTitle = (item: ReconciliationIssue) => item.cause || item.solution || "待核查对账差额";
export const issueLatestAt = latestAt;
export const issueFollowState = followStateOf;
export { formatMoney, getOverdueDays };
