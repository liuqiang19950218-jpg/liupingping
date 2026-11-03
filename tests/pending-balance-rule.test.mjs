import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isCurrentOpenProblem } from "../lib/current-open-problems.mjs";
import { isResolvedArchiveReconciliation } from "../lib/closed-reconciliation-qualification.mjs";

const amountOf = (row) => Math.abs(Number(row.reconciliationDifference ?? 0));
const pendingRows = (rows) => rows.filter(isCurrentOpenProblem);
const pendingAmount = (rows) => pendingRows(rows).reduce((total, row) => total + amountOf(row), 0);

test("dated reconciliation differences use the same pending set and amount as the tracker", () => {
  const rows = [
    { id: "nj-1", customer: "南京客户", region: "南京", ownerName: "叶孝彤", reconciliationDifference: "120.50", solution: "待处理", solutionDate: "2026-11-01", manualResolutionStatus: null },
    { id: "nj-2", customer: "南京客户", region: "南京", ownerName: "叶孝彤", reconciliationDifference: "80", solution: "待处理", solutionDate: "2026-11-02", manualResolutionStatus: "reopened" },
    { id: "sz-archive", customer: "苏州客户", region: "苏州", ownerName: "王芳", reconciliationDifference: "35", solution: "已完成", solutionDate: "", manualResolutionStatus: null },
  ];

  assert.deepEqual(pendingRows(rows).map((row) => row.id), ["nj-1", "nj-2"]);
  assert.equal(pendingAmount(rows), 200.5);
  assert.equal(isResolvedArchiveReconciliation(rows[2]), true);
});

test("manual resolution removes only the selected reconciliation difference", () => {
  const rows = [
    { id: "same-customer-a", customer: "南京客户", reconciliationDifference: "100", solutionDate: "2026-11-01", manualResolutionStatus: null },
    { id: "same-customer-b", customer: "南京客户", reconciliationDifference: "55", solutionDate: "2026-11-02", manualResolutionStatus: null },
  ];
  assert.equal(pendingAmount(rows), 155);

  const persistedReload = rows.map((row) => row.id === "same-customer-a" ? { ...row, manualResolutionStatus: "resolved" } : row);
  assert.deepEqual(pendingRows(persistedReload).map((row) => row.id), ["same-customer-b"]);
  assert.equal(pendingAmount(persistedReload), 55);
  assert.equal(isResolvedArchiveReconciliation(persistedReload[0]), true);
});

test("archive, region, owner, quarter, and repeat-operation qualification stay record-scoped", () => {
  const rows = [
    { id: "nj-q2", quarterCode: "2026-Q2", customer: "南京客户", region: "南京", ownerName: "叶孝彤", reconciliationDifference: "10", solution: "处理中", solutionDate: "2026-11-01", manualResolutionStatus: null },
    { id: "sz-q2", quarterCode: "2026-Q2", customer: "苏州客户", region: "苏州", ownerName: "王芳", reconciliationDifference: "20", solution: "处理中", solutionDate: "2026-11-02", manualResolutionStatus: "reopened" },
    { id: "nt-q3", quarterCode: "2026-Q3", customer: "南通客户", region: "南通", ownerName: "陈强", reconciliationDifference: "30", solution: "处理完成", solutionDate: "", manualResolutionStatus: null },
  ];
  const scoped = (region, owner, quarter) => pendingRows(rows).filter((row) =>
    (region === "全部" || row.region === region) &&
    (owner === "全部" || row.ownerName === owner) &&
    row.quarterCode === quarter,
  );

  assert.deepEqual(scoped("南京", "全部", "2026-Q2").map((row) => row.id), ["nj-q2"]);
  assert.deepEqual(scoped("全部", "王芳", "2026-Q2").map((row) => row.id), ["sz-q2"]);
  assert.deepEqual(scoped("南通", "全部", "2026-Q3"), []);
  assert.equal(isResolvedArchiveReconciliation(rows[2]), true);

  const onceResolved = rows.map((row) => row.id === "nj-q2" ? { ...row, manualResolutionStatus: "resolved" } : row);
  const twiceResolved = onceResolved.map((row) => row.id === "nj-q2" ? { ...row, manualResolutionStatus: "resolved" } : row);
  assert.equal(pendingAmount(onceResolved), pendingAmount(twiceResolved));
  assert.deepEqual(pendingRows(twiceResolved).map((row) => row.id), ["sz-q2"]);
});

test("cockpit KPI and drill-down consume the tracker qualification and one filtered record collection", async () => {
  const [cockpit, tracker, write] = await Promise.all([
    readFile(new URL("../app/ManagementCockpit.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/UnresolvedFollowupDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/recon/write.ts", import.meta.url), "utf8"),
  ]);
  assert.match(cockpit, /import \{ isCurrentOpenProblem \} from "\.\.\/lib\/current-open-problems\.mjs"/);
  assert.match(cockpit, /const isPendingFollowUp = \(r: CockpitRow\) => isCurrentOpenProblem\(r\)/);
  assert.match(cockpit, /solutionDate: row\.solutionDate \?\? "", manualResolutionStatus: row\.manualResolutionStatus/);
  assert.match(cockpit, /const pendingFollowUpRows = useMemo\(/);
  assert.match(cockpit, /unresolved: pendingFollowUpRows\.reduce/);
  assert.match(cockpit, /onClick=\{\(\) => open\(PENDING_LIST_DETAIL_TITLE, pendingFollowUpRows\)\}/);
  const pendingCollection = cockpit.slice(cockpit.indexOf("const pendingFollowUpRows"), cockpit.indexOf("const m = useMemo"));
  assert.doesNotMatch(pendingCollection, /row\.filled/);
  assert.match(pendingCollection, /f\.region/);
  assert.match(pendingCollection, /f\.owner/);
  assert.match(pendingCollection, /f\.quarter/);
  assert.match(tracker, /isCurrentOpenProblem\(row\)/);
  assert.match(tracker, /manualResolutionStatus: "resolved"/);
  assert.match(write, /pushSet\("manual_resolution_status", manualStatus\)/);
});
