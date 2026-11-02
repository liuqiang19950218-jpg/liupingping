import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  formatHistoricalTrendTooltip,
  historicalTrend,
  latestHistoricalPeriod,
  normalizeHistoricalSettlementPeriods,
  sortHistoricalRegionsBySettlementRate,
} from "../lib/historical-settlement-dashboard.mjs";

const totals = [
  [2024, 3, 655, 638, 17, 0.974045801526718],
  [2024, 4, 648, 633, 15, 0.976851851851852],
  [2025, 1, 643, 629, 14, 0.978227060653188],
  [2025, 2, 698, 684, 14, 0.979942693409742],
  [2025, 3, 693, 682, 11, 0.984126984126984],
  [2025, 4, 713, 707, 5, 0.991584852734923],
  [2026, 1, 728, 722, 4, 0.991758241758242],
];

const payload = {
  periods: totals.map(([year, quarter, customerTotal, settledCount, unsettledCount, settlementRate]) => ({
    year, quarter, label: `${year} Q${quarter}`,
    total: { customerTotal, settledCount, unsettledCount, unclassifiedCount: year === 2025 && quarter === 4 ? 1 : 0, settlementRate: String(settlementRate) },
    regions: year === 2026 && quarter === 1
      ? [{ region: "常州", customerTotal: 36, settledCount: 36, unsettledCount: null, settlementRate: "1", sourceRow: 97 }, { region: "南京", customerTotal: 117, settledCount: 115, unsettledCount: 2, settlementRate: "0.982905982905983", sourceRow: 100 }]
      : [{ region: "常州", customerTotal: 1, settledCount: 1, unsettledCount: 0, settlementRate: "1", sourceRow: 1 }],
  })),
};

test("historical dashboard consumes seven sealed periods and source trend values", () => {
  const periods = normalizeHistoricalSettlementPeriods(payload);
  const trend = historicalTrend(periods);
  assert.equal(periods.length, 7);
  assert.deepEqual(trend.map((item) => item.quarter), ["2024 Q3", "2024 Q4", "2025 Q1", "2025 Q2", "2025 Q3", "2025 Q4", "2026 Q1"]);
  assert.deepEqual(trend.map((item) => item.unsettledCustomers), [17, 15, 14, 14, 11, 5, 4]);
  assert.deepEqual(trend.map((item) => Number(item.reconciliationRate.toFixed(1))), [97.4, 97.7, 97.8, 98, 98.4, 99.2, 99.2]);
  assert.equal(latestHistoricalPeriod(periods).label, "2026 Q1");
  assert.equal(periods.some((period) => period.label === "2026 Q2"), false);
  assert.equal(trend[0].unsettledCustomers, 17, "2024 Q3 bar data comes from the sealed total");
  assert.equal(typeof trend[0].unsettledCustomers, "number");
  assert.equal(historicalTrend([{ ...periods[0], total: { ...periods[0].total, unsettledCount: null } }])[0].unsettledCustomers, 0, "zero remains a chart value");
  const tooltip = formatHistoricalTrendTooltip([
    { axisValue: "2024 Q3", seriesName: "未对清客户数", value: 17 },
    { axisValue: "2024 Q3", seriesName: "对清率", value: 97.4045801526718 },
  ]);
  assert.match(tooltip, /未对清客户数：17户/);
  assert.match(tooltip, /对清率：97\.40%/);
  const safeTooltip = formatHistoricalTrendTooltip([{ axisValue: "2026 Q2", seriesName: "未对清客户数", value: undefined }]);
  assert.match(safeTooltip, /未对清客户数：0户/);
  assert.doesNotMatch(safeTooltip, /undefined|NaN/);
});

test("historical total is never recomputed from regions and NULL unsettled displays as zero", () => {
  const periods = normalizeHistoricalSettlementPeriods(payload);
  const q1 = periods.at(-1);
  const q4 = periods.at(-2);
  assert.equal(q1.total.customerTotal, 728);
  assert.equal(q1.total.settledCount, 722, "sealed total must remain 722, not region sum 724");
  assert.equal(q1.total.unsettledCount, 4);
  assert.equal(q1.total.settlementRate, 0.991758241758242);
  assert.equal(q1.regions[0].unsettledCount, 0, "NULL is display-only zero");
  assert.equal(q1.regions[0].sourceRow, 97, "source row order is retained");
  assert.equal(q4.total.unsettledCount, 5, "unclassified audit field must not change unsettled count");
  assert.equal(q4.total.unclassifiedCount, 1);
});

test("regional history presentation sorts rate ascending, then unresolved descending, then region name", () => {
  const source = [
    { region: "无锡", settlementRate: 1, unsettledCount: 0 },
    { region: "扬州", settlementRate: 0.5, unsettledCount: 3 },
    { region: "南京", settlementRate: 0.5, unsettledCount: 10 },
    { region: "常州", settlementRate: 0.5, unsettledCount: 10 },
    { region: "苏州", settlementRate: 0.3, unsettledCount: 1 },
  ];
  const sorted = sortHistoricalRegionsBySettlementRate(source);
  assert.deepEqual(sorted.map((item) => item.region), ["苏州", "常州", "南京", "扬州", "无锡"]);
  assert.deepEqual(source.map((item) => item.region), ["无锡", "扬州", "南京", "常州", "苏州"], "source snapshot rows remain unchanged");
});

test("API route is a single read-only sealed snapshot query", () => {
  const route = readFileSync("app/api/historical-settlement-snapshots/route.ts", "utf8");
  const query = readFileSync("lib/server/recon/historical-settlement-snapshots.ts", "utf8");
  const component = readFileSync("app/ReconciliationHistoryDashboard.tsx", "utf8");
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function (POST|PATCH|PUT|DELETE)/);
  assert.match(query, /historical_settlement_snapshots/);
  assert.match(query, /WHERE sealed = TRUE/);
  assert.match(query, /MAX\(snapshot_version\)/);
  assert.match(query, /source_row ASC/);
  assert.doesNotMatch(query, /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/);
  assert.match(component, /\/api\/historical-settlement-snapshots/);
  assert.doesNotMatch(component, /useAllDashboardQuarterRows|recon\.reconciliations/);
  assert.match(component, /历史季度对清趋势/);
  assert.match(component, /历史各区域对清情况/);
  assert.match(component, /isLaterThanSnapshot/);
  assert.match(component, /unsettledCustomers/);
  assert.doesNotMatch(component, /unreconciledCustomers/);
  assert.match(component, /formatter: formatHistoricalTrendTooltip/);
  assert.match(component, /sortHistoricalRegionsBySettlementRate\(activePeriod\.regions\)/);
  assert.match(component, /ref=\{regionTableRef\}/);
  assert.match(component, /scrollTo\(\{ top: 0 \}\)/);
});
