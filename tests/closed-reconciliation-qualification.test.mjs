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

test("manual-resolved records always enter the archive regardless of solution/date completeness", () => {
  const cases = [
    { id: "manual-empty", solution: "", solutionDate: "" },
    { id: "manual-solution-only", solution: "已完成", solutionDate: "" },
    { id: "manual-date-only", solution: "", solutionDate: "2026-09-01" },
    { id: "manual-complete", solution: "已完成", solutionDate: "2026-09-01" },
  ];
  for (const row of cases) {
    const resolved = { ...row, manualResolutionStatus: "resolved" };
    assert.equal(hasManualResolvedQualification(resolved), true, resolved.id);
    assert.equal(isClosedReconciliation(resolved), true, resolved.id);
    assert.equal(isResolvedArchiveReconciliation(resolved), true, resolved.id);
    assert.equal(isUnresolvedFollowupReconciliation(resolved), false, resolved.id);
    assert.equal(isFollowupTrackerReconciliation(resolved), true, resolved.id);
  }
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

test("a manual-resolved reconciliation remains one archive record and does not close its sibling", () => {
  const rows = [
    { id: "same-customer-a", customer: "常州市第二人民医院", solution: "", solutionDate: "", manualResolutionStatus: "resolved" },
    { id: "same-customer-b", customer: "常州市第二人民医院", solution: "", solutionDate: "2026-09-01", manualResolutionStatus: "reopened" },
    { id: "same-customer-a", customer: "常州市第二人民医院", solution: "", solutionDate: "", manualResolutionStatus: "resolved" },
  ];
  assert.deepEqual(ids(rows), ["same-customer-a"]);
  assert.equal(isResolvedArchiveReconciliation(rows[0]), true);
  assert.equal(isUnresolvedFollowupReconciliation(rows[1]), true);
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
