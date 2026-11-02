import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("problem dashboard restores the original four stage presentation", async () => {
  const [dashboard, distribution, tracker] = await Promise.all([
    readFile(new URL("../app/ProblemDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ProblemStageDistribution.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/UnresolvedFollowupDashboard.tsx", import.meta.url), "utf8"),
  ]);
  for (const stage of ["已关闭", "等待销售处理", "待财务调账", "核查中"]) assert.match(distribution, new RegExp(stage));
  assert.doesNotMatch(distribution, /待确认/);
  assert.doesNotMatch(dashboard, /buildManagementStageDistribution/);
  assert.doesNotMatch(tracker, /processManagementStage|followupManagementStage/);
});

test("closed drawer still selects only the shared resolved archive set", async () => {
  const [dashboard, tracker, qualification] = await Promise.all([
    readFile(new URL("../app/ProblemDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/UnresolvedFollowupDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/closed-reconciliation-qualification.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, /isResolvedArchiveReconciliation/);
  assert.match(tracker, /isResolvedArchiveReconciliation\(row\)/);
  assert.match(qualification, /hasManualResolvedQualification\(row\) \|\| hasSolutionOnlyResolvedQualification\(row\)/);
});
