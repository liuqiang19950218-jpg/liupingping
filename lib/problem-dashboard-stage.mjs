import { businessDayDistance } from "./date-only.mjs";

/**
 * The process dashboard and its drill-down use these keys as one contract.
 * A financial-review flag is deliberately not a leadership-escalation flag.
 */
export const PROBLEM_DASHBOARD_STAGES = Object.freeze({
  all: { key: "all", name: "未关闭问题" },
  overdue: { key: "overdue", name: "超期未关闭" },
  untouched: { key: "untouched", name: "7天未跟进" },
  waiting_sales: { key: "waiting_sales", name: "待销售处理" },
  finance_adjustment: { key: "finance_adjustment", name: "待内部处理" },
  finance_review: { key: "finance_review", name: "需财务复核" },
  leader_review: { key: "leader_review", name: "需领导介入" },
  week: { key: "week", name: "本周待办" },
});

const salesStage = (stage) => stage === "待销售走申请" || stage === "待销售去医院处理";
const knownStage = new Set(["待销售走申请", "待销售去医院处理", "待财务调账", "待核查", "已关闭"]);

/** Returns the one core process stage used by cards, KPI grouping and drawers. */
export function resolveProblemStage(item) {
  if (item.resolved || item.stage === "已关闭" || item.processStage === "已关闭") {
    return { stageKey: "closed", stageName: "已关闭" };
  }
  const supplied = item.stage ?? item.processStage ?? "";
  if (knownStage.has(supplied)) return { stageKey: stageKeyForName(supplied), stageName: supplied };
  const content = `${item.firstSolution ?? item.solution ?? ""} ${(item.followUps ?? []).map((entry) => entry.solution ?? "").join(" ")}`;
  if (content.includes("调账") || content.includes("财务")) return { stageKey: "finance_adjustment", stageName: "待财务调账" };
  if (content.includes("医院")) return { stageKey: "waiting_sales", stageName: "待销售去医院处理" };
  if (content.includes("申请")) return { stageKey: "waiting_sales", stageName: "待销售走申请" };
  return { stageKey: "checking", stageName: "待核查" };
}

function stageKeyForName(stage) {
  if (stage === "已关闭") return "closed";
  if (salesStage(stage)) return "waiting_sales";
  if (stage === "待财务调账") return "finance_adjustment";
  return "checking";
}
const daysSinceFollowup = (item) =>
  typeof item.daysSinceFollowup === "number"
    ? item.daysSinceFollowup
    : businessDayDistance(item.latestFollowupAt ?? item.latestFollowUpAt ?? item.firstTime ?? "") ?? 0;
const overdueDays = (item) =>
  typeof item.overdueDays === "number"
    ? item.overdueDays
    : businessDayDistance(item.expectedDate ?? "") ?? 0;

export function matchesProblemDashboardStage(item, key) {
  const { stageKey } = resolveProblemStage(item);
  switch (key) {
    case "overdue": return overdueDays(item) > 0;
    case "untouched": return daysSinceFollowup(item) >= 7;
    case "waiting_sales":
    case "customer": return stageKey === "waiting_sales";
    case "finance_adjustment":
    case "internal": return stageKey === "finance_adjustment";
    case "finance_review":
    case "finance": return item.financeAttention === "需财务复核";
    // No current reconciliation field denotes leadership escalation. Keep this
    // separate so a financial-review customer cannot be misclassified.
    case "leader_review":
    case "leader": return item.requiresLeaderReview === true;
    case "week": return daysSinceFollowup(item) <= 7;
    case "":
    case "all": return true;
    default: return false;
  }
}

export function countProblemDashboardStage(items, key) {
  return items.filter((item) => matchesProblemDashboardStage(item, key)).length;
}
