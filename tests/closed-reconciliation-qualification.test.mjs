import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  closedReconciliationIds,
  hasManualResolvedQualification,
  hasSolutionDate,
  hasSolutionOnlyResolvedQualification,
  hasValidSolution,
  isClosedReconciliation,
  isFollowupTrackerReconciliation,
  isResolvedArchiveReconciliation,
  isUnresolvedFollowupReconciliation,
} from "../lib/closed-reconciliation-qualification.mjs";

const ids = (rows) => [...closedReconciliationIds(rows)].sort();

test("manual-resolved records close only when their solution date exists", () => {
  const row = { id: "legacy", solution: "", solutionDate: "2026-09-01", manualResolutionStatus: "resolved" };
  assert.equal(hasManualResolvedQualification(row), true);
  assert.equal(isClosedReconciliation(row), true);
  assert.equal(isResolvedArchiveReconciliation(row), true);
  assert.equal(isUnresolvedFollowupReconciliation(row), false);
  assert.equal(isFollowupTrackerReconciliation(row), true);
});

test("a nonblank solution without a date closes and does not generate one", () => {
  for (const solutionDate of [null, ""]) {
    const row = { id: `solution-${String(solutionDate)}`, solution: "已经与客户确认", solutionDate, manualResolutionStatus: null };
    assert.equal(hasValidSolution(row), true);
    assert.equal(hasSolutionDate(row), false);
    assert.equal(hasSolutionOnlyResolvedQualification(row), true);
    assert.equal(isClosedReconciliation(row), true);
    assert.equal(isUnresolvedFollowupReconciliation(row), false);
    assert.equal(row.solutionDate, solutionDate);
  }
});

test("a dated solution remains unresolved until the sales user confirms completion", () => {
  for (const manualResolutionStatus of [null, "reopened"]) {
    const row = { id: String(manualResolutionStatus), solution: "预计月底处理", solutionDate: "2026-09-30", manualResolutionStatus };
    assert.equal(isResolvedArchiveReconciliation(row), false);
    assert.equal(isClosedReconciliation(row), false);
    assert.equal(isUnresolvedFollowupReconciliation(row), true);
    assert.equal(isFollowupTrackerReconciliation(row), true);
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
  assert.match(dashboard, /isResolvedArchiveReconciliation/);
  assert.match(dashboard, /Boolean\(item\.customer\?\.trim\(\)\)/);
  assert.match(tracker, /isCurrentOpenProblem\(row\)/);
  assert.match(tracker, /isResolvedArchiveReconciliation\(row\)/);
  assert.match(drawer, /toItems\(/);
});
