import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isSettled,
  isUnreconciled,
  isUnsettled,
  settlementRate,
  summarizeSettlement,
} from "../lib/reconciliation-settlement-status.mjs";

const q1Rows = [
  ...Array.from({ length: 726 }, (_, index) => ({ id: `s-${index}`, reconciliationStatus: "已对清", region: "南京" })),
  { id: "u-1", reconciliationStatus: "未对清", region: "南京", customer: "高邮市人民医院" },
  { id: "u-2", reconciliationStatus: "未对清", region: "南京", customer: "南京医科大学第二附属医院" },
  { id: "u-3", reconciliationStatus: "未对清", region: "扬州", customer: "泰兴市人民医院" },
  { id: "u-4", reconciliationStatus: "未对清", region: "泰州", customer: "南京市浦口区中医院" },
  ...Array.from({ length: 22 }, (_, index) => ({ id: `n-${index}`, reconciliationStatus: "未对账", region: "南京" })),
];

test("已对清 is settled only", () => {
  assert.equal(isSettled("已对清"), true);
  assert.equal(isUnsettled("已对清"), false);
});
test("未对清 is unsettled only", () => {
  assert.equal(isSettled("未对清"), false);
  assert.equal(isUnsettled("未对清"), true);
});
test("未对账 is neither settled nor unsettled", () => {
  assert.equal(isSettled("未对账"), false);
  assert.equal(isUnsettled("未对账"), false);
  assert.equal(isUnreconciled("未对账"), true);
});
test("Q1 counts are 726 settled, 4 unsettled, and 22 unreconciled", () => {
  assert.deepEqual(summarizeSettlement(q1Rows), { settled: 726, unsettled: 4, unreconciled: 22 });
});
test("settlement rate excludes unreconciled rows", () => {
  assert.equal(settlementRate({ settled: 726, unsettled: 4 }).toFixed(1), "99.5");
});
test("Q1 action list contains exactly the four unsettled customers", () => {
  const actions = q1Rows.filter(isUnsettled).map((row) => row.customer);
  assert.deepEqual(actions, ["高邮市人民医院", "南京医科大学第二附属医院", "泰兴市人民医院", "南京市浦口区中医院"]);
});
test("unreconciled rows never enter the action list", () => {
  assert.equal(q1Rows.filter(isUnsettled).some(isUnreconciled), false);
});
test("overview unsettled metric is 4", () => {
  assert.equal(summarizeSettlement(q1Rows).unsettled, 4);
});
test("overview settled metric is 726", () => {
  assert.equal(summarizeSettlement(q1Rows).settled, 726);
});
test("regional settled plus unsettled counts keep the 730 denominator", () => {
  const regional = new Map();
  q1Rows.filter((row) => isSettled(row) || isUnsettled(row)).forEach((row) => regional.set(row.region, (regional.get(row.region) ?? 0) + 1));
  assert.equal([...regional.values()].reduce((sum, count) => sum + count, 0), 730);
});
test("affected dashboard modules contain no old 对清 equality comparison", async () => {
  const files = ["Q1ActionPanel.tsx", "DashboardOverview.tsx", "CurrentYearLinkedSummary.tsx", "ReconciliationHistoryDashboard.tsx", "ManagementCockpit.tsx", "cockpit-data.ts"];
  const source = await Promise.all(files.map((file) => readFile(new URL(`../app/${file}`, import.meta.url), "utf8")));
  assert.equal(source.some((text) => /(?:===|!==)\s*["']对清["']/.test(text)), false);
});
test("every realtime dashboard module imports the shared rule", async () => {
  // ReconciliationHistoryDashboard is intentionally excluded: it only renders
  // sealed historical snapshots and must not read live reconciliation status.
  const files = ["Q1ActionPanel.tsx", "DashboardOverview.tsx", "CurrentYearLinkedSummary.tsx", "ManagementCockpit.tsx", "cockpit-data.ts"];
  const source = await Promise.all(files.map((file) => readFile(new URL(`../app/${file}`, import.meta.url), "utf8")));
  assert.equal(source.every((text) => text.includes("reconciliation-settlement-status")), true);
});
