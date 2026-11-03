import assert from "node:assert/strict";
import test from "node:test";
import {
  currentOpenProblemIds,
  hasRecordedReconciliationDifference,
  isCurrentOpenProblem,
} from "../lib/current-open-problems.mjs";
import { isResolvedArchiveReconciliation } from "../lib/closed-reconciliation-qualification.mjs";

const amountOf = (row) => Math.abs(Number(row.reconciliationDifference ?? row.difference ?? 0));
const pendingRows = (rows) => rows.filter(isCurrentOpenProblem);
const pendingAmount = (rows) => pendingRows(rows).reduce((total, row) => total + amountOf(row), 0);
const filterForDashboard = (rows, { region = "全部", owner = "全部", quarter = "" } = {}) =>
  pendingRows(rows).filter((row) =>
    (!quarter || row.quarterCode === quarter || row.quarter === quarter) &&
    (region === "全部" || row.region === region) &&
    (owner === "全部" || row.ownerName === owner || row.owner === owner),
  );

test("pending qualification requires a recorded resolution difference while zero stays valid", () => {
  const dated = { customer: "南京客户", solutionDate: "2026-11-01", manualResolutionStatus: null };
  const cases = [
    ["有解决时间、有解决差额", { ...dated, reconciliationDifference: "12.50" }, true],
    ["null 差额", { ...dated, reconciliationDifference: null }, false],
    ["undefined 差额", { ...dated, reconciliationDifference: undefined }, false],
    ["空字符串差额", { ...dated, reconciliationDifference: "" }, false],
    ["纯空格差额", { ...dated, reconciliationDifference: "  \t" }, false],
    ["数字 0", { ...dated, reconciliationDifference: 0 }, true],
    ["字符串 0", { ...dated, reconciliationDifference: "0" }, true],
    ["字符串 0.00", { ...dated, reconciliationDifference: "0.00" }, true],
  ];

  for (const [name, row, expected] of cases) {
    assert.equal(hasRecordedReconciliationDifference(row), expected, name);
    assert.equal(isCurrentOpenProblem(row), expected, name);
  }
});

test("date, archive, and manual-resolution rules remain mutually exclusive", () => {
  const pending = { id: "pending", customer: "南京客户", reconciliationDifference: "35", solutionDate: "2026-11-01", manualResolutionStatus: null };
  const manuallyResolved = { ...pending, id: "manual", manualResolutionStatus: "resolved" };
  const reopened = { ...pending, id: "reopened", manualResolutionStatus: "reopened" };
  const solutionOnlyArchive = { id: "archive", customer: "苏州客户", reconciliationDifference: "18", solution: "已完成", solutionDate: "", manualResolutionStatus: null };
  const noDate = { id: "no-date", customer: "南通客户", reconciliationDifference: "8", solutionDate: "", manualResolutionStatus: null };

  assert.equal(isCurrentOpenProblem(pending), true);
  assert.equal(isCurrentOpenProblem(manuallyResolved), false);
  assert.equal(isCurrentOpenProblem(reopened), true);
  assert.equal(isCurrentOpenProblem(noDate), false);
  assert.equal(isResolvedArchiveReconciliation(solutionOnlyArchive), true);
  assert.equal(isCurrentOpenProblem(solutionOnlyArchive), false);
});

test("reconciliationDifference and cockpit difference are equivalent pending-balance inputs", () => {
  const apiRow = { id: "api", customer: "南京客户", reconciliationDifference: "0.00", solutionDate: "2026-11-01", manualResolutionStatus: null };
  const cockpitRow = { id: "cockpit", customer: "南京客户", difference: 0, solutionDate: "2026-11-01", manualResolutionStatus: null };
  assert.equal(isCurrentOpenProblem(apiRow), true);
  assert.equal(isCurrentOpenProblem(cockpitRow), true);
  assert.equal(pendingAmount([apiRow, cockpitRow]), 0);
});

test("an empty source difference never becomes eligible after cockpit display mapping", () => {
  const sourceRow = { id: "empty-source", customer: "南通客户", reconciliationDifference: " ", solutionDate: "2026-11-01", manualResolutionStatus: null };
  const cockpitRow = { ...sourceRow, difference: 0 };
  assert.equal(isCurrentOpenProblem(sourceRow), false);
  assert.equal(isCurrentOpenProblem(cockpitRow), false);
});

test("manual resolution removes only its reconciliation id and amount", () => {
  const rows = [
    { id: "same-customer-a", customer: "南京客户", reconciliationDifference: "100", solutionDate: "2026-11-01", manualResolutionStatus: null },
    { id: "same-customer-b", customer: "南京客户", reconciliationDifference: "55", solutionDate: "2026-11-02", manualResolutionStatus: null },
  ];
  assert.equal(pendingAmount(rows), 155);

  const persistedReload = rows.map((row) => row.id === "same-customer-a" ? { ...row, manualResolutionStatus: "resolved" } : row);
  assert.deepEqual([...currentOpenProblemIds(persistedReload)], ["same-customer-b"]);
  assert.equal(pendingAmount(persistedReload), 55);
  assert.equal(isResolvedArchiveReconciliation(persistedReload[0]), true);
});

test("UF, cockpit KPI, and drill-down retain identical IDs and amount after filters", () => {
  const rows = [
    { id: "nj-a", quarterCode: "2026-Q2", customer: "南京客户甲", region: "南京", ownerName: "叶孝彤", reconciliationDifference: "120.50", solutionDate: "2026-11-01", manualResolutionStatus: null },
    { id: "nj-b", quarterCode: "2026-Q2", customer: "南京客户乙", region: "南京", ownerName: "王芳", reconciliationDifference: "0", solutionDate: "2026-11-02", manualResolutionStatus: "reopened" },
    { id: "sz-a", quarterCode: "2026-Q2", customer: "苏州客户", region: "苏州", ownerName: "王芳", reconciliationDifference: "35", solutionDate: "2026-11-03", manualResolutionStatus: "resolved" },
    { id: "nt-missing", quarterCode: "2026-Q2", customer: "南通客户", region: "南通", ownerName: "陈强", reconciliationDifference: " ", solutionDate: "2026-11-04", manualResolutionStatus: null },
    { id: "nj-unreconciled", quarterCode: "2026-Q2", customer: "南京客户未对账", region: "南京", ownerName: "叶孝彤", reconciliationDifference: "5", solutionDate: "2026-11-04", manualResolutionStatus: null, filled: false },
    { id: "q3-a", quarterCode: "2026-Q3", customer: "南京客户丙", region: "南京", ownerName: "叶孝彤", reconciliationDifference: "50", solutionDate: "2026-11-05", manualResolutionStatus: null },
  ];
  const filters = { region: "南京", owner: "叶孝彤", quarter: "2026-Q2" };
  const ufRows = filterForDashboard(rows, filters);
  const cockpitKpiRows = filterForDashboard(rows.map((row) => ({ ...row, difference: Number(row.reconciliationDifference) })), filters);
  const cockpitDrilldownRows = [...cockpitKpiRows];

  assert.deepEqual(ufRows.map((row) => row.id), ["nj-a", "nj-unreconciled"]);
  assert.deepEqual(cockpitKpiRows.map((row) => row.id), ufRows.map((row) => row.id));
  assert.deepEqual(cockpitDrilldownRows.map((row) => row.id), ufRows.map((row) => row.id));
  assert.equal(pendingAmount(ufRows), 125.5);
  assert.equal(pendingAmount(cockpitKpiRows), 125.5);
  assert.equal(pendingAmount(cockpitDrilldownRows), 125.5);
});
