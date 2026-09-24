import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isResolvedArchiveReconciliation,
  isUnresolvedFollowupReconciliation,
} from "../lib/closed-reconciliation-qualification.mjs";

const ownerCounts = (rows) => rows.filter(isUnresolvedFollowupReconciliation).reduce((counts, row) => {
  counts.set(row.owner, (counts.get(row.owner) ?? 0) + 1);
  return counts;
}, new Map());

test("Top5 derives from current open problems, not the owner's historical total", () => {
  const history = [
    { id: "resolved-date", owner: "刘丽婷", solution: "已完成", solutionDate: "2026-09-01", manualResolutionStatus: "resolved" },
    { id: "resolved-solution-only-1", owner: "刘丽婷", solution: "已完成", solutionDate: "", manualResolutionStatus: null },
    { id: "resolved-solution-only-2", owner: "刘丽婷", solution: "已完成", solutionDate: null, manualResolutionStatus: null },
    { id: "open", owner: "刘丽婷", solution: "预计处理", solutionDate: "2026-09-30", manualResolutionStatus: null },
  ];
  assert.equal(history.filter(isResolvedArchiveReconciliation).length, 3);
  assert.deepEqual([...ownerCounts(history)], [["刘丽婷", 1]]);
  assert.deepEqual([...ownerCounts(history.map((row) => ({ ...row, manualResolutionStatus: "resolved" })))], []);
});

test("dashboard and stage drawer share the current open source set", async () => {
  const [dashboard, stages, tracker] = await Promise.all([
    readFile(new URL("../app/ProblemDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ProblemStageDistribution.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/UnresolvedFollowupDashboard.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, /const currentOpenProblems = useMemo/);
  assert.match(dashboard, /toItems\([\s\S]*\.filter\(\(item\) => !item\.resolved\)/);
  assert.match(dashboard, /filterProblemItemList\(currentOpenProblems/);
  assert.match(dashboard, /currentOpenProblems\.map\(\(item\) => item\.owner\)/);
  assert.match(stages, /target: "等待销售处理"/);
  assert.match(tracker, /const salesGroup = stage === "等待销售处理"/);
});
