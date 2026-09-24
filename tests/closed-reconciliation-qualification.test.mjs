import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  closedReconciliationIds,
  hasExistingResolvedQualification,
  hasValidSolution,
  isClosedReconciliation,
} from "../lib/closed-reconciliation-qualification.mjs";

const ids = (rows) => [...closedReconciliationIds(rows)].sort();

test("existing manual-resolved records remain closed", () => {
  const row = { id: "legacy", solution: "", solutionDate: "2026-09-01", manualResolutionStatus: "resolved" };
  assert.equal(hasExistingResolvedQualification(row), true);
  assert.equal(isClosedReconciliation(row), true);
});

test("a nonblank solution closes a record without generating a solution date", () => {
  for (const solutionDate of [null, ""]) {
    const row = { id: `solution-${String(solutionDate)}`, solution: "已经与客户确认", solutionDate, manualResolutionStatus: null };
    assert.equal(hasValidSolution(row), true);
    assert.equal(isClosedReconciliation(row), true);
    assert.equal(row.solutionDate, solutionDate);
  }
});

test("blank solutions and unrelated tracker data do not close a record", () => {
  for (const solution of [null, "", " \n  "]) {
    assert.equal(isClosedReconciliation({ id: String(solution), solution, solutionDate: null, manualResolutionStatus: null }), false);
  }
});

test("closed identity is reconciliation id, deduplicates followups, and stays quarter scoped", () => {
  const q1 = [{ id: "q1-same-customer", solution: "Q1 已处理", solutionDate: null, manualResolutionStatus: null }];
  const q2 = [{ id: "q2-same-customer", solution: "", solutionDate: null, manualResolutionStatus: null }];
  assert.deepEqual(ids(q1), ["q1-same-customer"]);
  assert.deepEqual(ids(q2), []);
  assert.deepEqual(ids([...q1, ...q1]), ["q1-same-customer"]);
});

test("dashboard KPI, drill-down, and archive use the shared qualification", async () => {
  const [dashboard, tracker, drawer] = await Promise.all([
    readFile(new URL("../app/ProblemDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/UnresolvedFollowupDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ProblemFollowupDrawer.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, /isClosedReconciliation/);
  assert.match(tracker, /isClosedReconciliation\(row\)/);
  assert.match(tracker, /hasValidSolution\(row\)/);
  assert.match(drawer, /toItems\(/);
});
