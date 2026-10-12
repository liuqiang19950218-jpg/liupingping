import assert from "node:assert/strict";
import test from "node:test";
import {
  countProblemDashboardStage,
  matchesProblemDashboardStage,
  resolveProblemStage,
} from "../lib/problem-dashboard-stage.mjs";
import { isResolvedArchiveReconciliation } from "../lib/closed-reconciliation-qualification.mjs";
import { currentOpenProblemIds } from "../lib/current-open-problems.mjs";

const openFinance = (id, overrides = {}) => ({
  id,
  customer: `客户${id}`,
  solution: "等待财务调账",
  solutionDate: "2026-10-20",
  manualResolutionStatus: null,
  processStage: "待财务调账",
  financeAttention: "需财务复核",
  ...overrides,
});

test("one resolver makes a four-item stage KPI and drawer filter identical", () => {
  const problems = ["1", "2", "3", "4"].map((id) => openFinance(id));
  assert.equal(countProblemDashboardStage(problems, "finance_adjustment"), 4);
  assert.equal(problems.filter((item) => matchesProblemDashboardStage(item, "finance_adjustment")).length, 4);
  assert.equal(countProblemDashboardStage([], "finance_adjustment"), 0);
});

test("financial attention is a finance-review filter, never a leadership escalation", () => {
  const finance = openFinance("finance");
  assert.deepEqual(resolveProblemStage(finance), { stageKey: "finance_adjustment", stageName: "待财务调账" });
  assert.equal(matchesProblemDashboardStage(finance, "finance_review"), true);
  assert.equal(matchesProblemDashboardStage(finance, "leader_review"), false);
  assert.equal(matchesProblemDashboardStage({ ...finance, requiresLeaderReview: true }, "leader_review"), true);
});

test("closed records are excluded from current stages and remain qualified by the unchanged archive rule", () => {
  const closed = Array.from({ length: 77 }, (_, index) => ({
    id: `closed-${index}`,
    customer: `已关闭${index}`,
    solution: "已完成",
    solutionDate: "",
    manualResolutionStatus: null,
  }));
  assert.equal(closed.filter(isResolvedArchiveReconciliation).length, 77);
  assert.equal(currentOpenProblemIds(closed).size, 0);
  assert.equal(countProblemDashboardStage([], "all"), 0);
});
