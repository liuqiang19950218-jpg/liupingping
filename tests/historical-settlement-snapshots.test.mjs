// Phase 2K.11A — Historical Settlement Snapshot parser tests.
//
// Coverage (spec §24):
//   1. 7-quarter parsing (full structure)
//   2. 108 rows (101 region + 7 total)
//   3. NULL 未对清 preserved (2026 Q1 empty cells)
//   4. 2025 Q4 gap=1 (Nantong region + total, unclassified_count)
//   5. 2026 Q1 region/total settled delta=2 (reported, never corrected)
//   6. source settlement_rate never recomputed/overwritten
//   7. duplicate import protection (classifyExistingImport + target-DB guard)
//   8. unknown quarter title → STOP
//   9. source hash gate
//
// Plus an integration test against the REAL authoritative workbook when it is
// present on this host (/home/liupp/111/工作簿1.xlsx).

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import * as XLSX from "xlsx";

import {
  SOURCE_SHA256,
  assertSourceHash,
  parseHistoricalSnapshotSheet,
  validateSnapshotDataset,
  classifyExistingImport,
  assertTargetDatabase,
  sha256Hex,
  computeUnclassifiedCount,
} from "../lib/historical-settlement-snapshots.mjs";

const REAL_FILE = "/home/liupp/111/工作簿1.xlsx";

// ---------------------------------------------------------------------------
// Fixture builder — mirrors the real workbook layout:
//   title row / header row / region rows (seq 1..n) / 总计 row / blank rows
// ---------------------------------------------------------------------------
function buildRows(blocks) {
  const rows = [];
  for (const b of blocks) {
    rows.push([b.title, null, null, null, null, null]);
    rows.push(["序号", "区域", "对账客户总数", "已对清", "未对清", "本季度对清率"]);
    b.regions.forEach((r, index) => {
      rows.push([index + 1, r[0], r[1], r[2], r[3], r[4]]);
    });
    rows.push([null, "总计", b.totals[0], b.totals[1], b.totals[2], b.totals[3]]);
    rows.push([null, null, null, null, null, null]);
    rows.push([null, null, null, null, null, null]);
  }
  return rows;
}

const SEVEN_QUARTERS = [
  {
    title: "终端24.3季度对账情况跟进",
    regions: [
      ["常州", 25, 25, 0, 1],
      ["淮安", 18, 18, 0, 1],
      ["连云港", 14, 14, 0, 1],
      ["南京", 88, 83, 5, 0.943181818181818],
      ["南通", 88, 83, 5, 0.943181818181818],
      ["苏州", 176, 171, 5, 0.971590909090909],
      ["宿迁", 4, 4, 0, 1],
      ["泰州", 18, 17, 1, 0.944444444444444],
      ["无锡", 96, 96, 0, 1],
      ["徐州", 23, 23, 0, 1],
      ["血站", 28, 27, 1, 0.964285714285714],
      ["盐城", 38, 38, 0, 1],
      ["扬州", 20, 20, 0, 1],
      ["镇江", 19, 19, 0, 1],
    ],
    totals: [655, 638, 17, 0.974045801526718],
  },
  {
    title: "终端24.4季度对账情况跟进",
    regions: [
      ["常州", 25, 25, 0, 1],
      ["淮安", 18, 18, 0, 1],
      ["疾控", 2, 2, 0, 1],
      ["连云港", 14, 14, 0, 1],
      ["南京", 91, 85, 6, 0.934065934065934],
      ["南通", 87, 84, 3, 0.96551724137931],
      ["苏州", 169, 166, 3, 0.982248520710059],
      ["宿迁", 8, 8, 0, 1],
      ["泰州", 16, 16, 0, 1],
      ["无锡", 102, 99, 3, 0.970588235294118],
      ["徐州", 27, 27, 0, 1],
      ["血站", 19, 19, 0, 1],
      ["盐城", 31, 31, 0, 1],
      ["扬州", 19, 19, 0, 1],
      ["镇江", 20, 20, 0, 1],
    ],
    totals: [648, 633, 15, 0.976851851851852],
  },
  {
    title: "终端25.1季度对账情况跟进",
    regions: [
      ["常州", 28, 28, 0, 1],
      ["淮安", 23, 23, 0, 1],
      ["疾控", 2, 2, 0, 1],
      ["连云港", 12, 12, 0, 1],
      ["南京", 96, 93, 3, 0.96875],
      ["南通", 83, 78, 5, 0.939759036144578],
      ["苏州", 158, 152, 6, 0.962025316455696],
      ["宿迁", 9, 9, 0, 1],
      ["泰州", 14, 14, 0, 1],
      ["无锡", 101, 101, 0, 1],
      ["徐州", 26, 26, 0, 1],
      ["血站", 20, 20, 0, 1],
      ["盐城", 31, 31, 0, 1],
      ["扬州", 20, 20, 0, 1],
      ["镇江", 20, 20, 0, 1],
    ],
    totals: [643, 629, 14, 0.978227060653188],
  },
  {
    title: "终端25.2季度对账情况跟进",
    regions: [
      ["常州", 28, 28, 0, 1],
      ["淮安", 25, 25, 0, 1],
      ["疾控", 2, 2, 0, 1],
      ["连云港", 13, 13, 0, 1],
      ["南京", 108, 104, 4, 0.962962962962963],
      ["南通", 91, 87, 4, 0.956043956043956],
      ["苏州", 174, 171, 3, 0.982758620689655],
      ["宿迁", 12, 12, 0, 1],
      ["泰州", 15, 14, 1, 0.933333333333333],
      ["无锡", 101, 101, 0, 1],
      ["徐州", 24, 24, 0, 1],
      ["血站", 25, 25, 0, 1],
      ["盐城", 37, 37, 0, 1],
      ["扬州", 21, 19, 2, 0.904761904761905],
      ["镇江", 22, 22, 0, 1],
    ],
    totals: [698, 684, 14, 0.979942693409742],
  },
  {
    title: "终端25.3季度对账情况跟进",
    regions: [
      ["常州", 28, 28, 0, 1],
      ["淮安", 27, 27, 0, 1],
      ["连云港", 14, 14, 0, 1],
      ["南京", 119, 116, 3, 0.974789915966387],
      ["南通", 98, 94, 4, 0.959183673469388],
      ["苏州", 168, 168, 0, 1],
      ["宿迁", 10, 10, 0, 1],
      ["泰州", 14, 14, 0, 1],
      ["无锡", 93, 92, 1, 0.989247311827957],
      ["徐州", 20, 20, 0, 1],
      ["血站", 25, 24, 1, 0.96],
      ["盐城", 37, 37, 0, 1],
      ["扬州", 22, 20, 2, 0.909090909090909],
      ["镇江", 18, 18, 0, 1],
    ],
    totals: [693, 682, 11, 0.984126984126984],
  },
  {
    title: "终端25.4季度对账情况跟进",
    regions: [
      ["常州", 32, 32, 0, 1],
      ["淮安", 27, 27, 0, 1],
      ["连云港", 13, 13, 0, 1],
      ["南京", 120, 119, 1, 0.991666666666667],
      ["南通", 101, 98, 2, 0.97029702970297],
      ["苏州", 164, 164, 0, 1],
      ["宿迁", 10, 10, 0, 1],
      ["泰州", 16, 15, 1, 0.9375],
      ["无锡", 95, 95, 0, 1],
      ["徐州", 27, 27, 0, 1],
      ["血站", 29, 29, 0, 1],
      ["盐城", 37, 37, 0, 1],
      ["扬州", 23, 22, 1, 0.956521739130435],
      ["镇江", 19, 19, 0, 1],
    ],
    totals: [713, 707, 5, 0.991584852734923],
  },
  {
    title: "终端26.1季度对账情况跟进",
    regions: [
      ["常州", 36, 36, null, 1],
      ["淮安", 29, 29, null, 1],
      ["连云港", 14, 14, null, 1],
      ["南京", 117, 115, 2, 0.982905982905983],
      ["南通", 108, 108, null, 1],
      ["苏州", 169, 169, null, 1],
      ["宿迁", 12, 12, null, 1],
      ["泰州", 18, 17, 1, 0.944444444444444],
      ["无锡", 101, 101, null, 1],
      ["徐州", 23, 23, null, 1],
      ["血站", 24, 24, null, 1],
      ["盐城", 33, 33, null, 1],
      ["扬州", 24, 23, 1, 0.958333333333333],
      ["镇江", 20, 20, null, 1],
    ],
    totals: [728, 722, 4, 0.991758241758242],
  },
];

const parseFixture = (blocks, extra = {}) =>
  parseHistoricalSnapshotSheet({
    rows: buildRows(blocks),
    sourceFileSha256: SOURCE_SHA256,
    ...extra,
  });

// ---------------------------------------------------------------------------
// 1. 7-quarter parsing + 2. 108 rows
// ---------------------------------------------------------------------------
test("parses all 7 quarters with 108 records (101 region + 7 total)", () => {
  const { quarterBlocks, records } = parseFixture(SEVEN_QUARTERS);
  assert.equal(quarterBlocks.length, 7);
  assert.equal(records.length, 108);
  const byType = records.reduce((acc, r) => ((acc[r.record_type] = (acc[r.record_type] ?? 0) + 1), acc), {});
  assert.equal(byType.region, 101);
  assert.equal(byType.total, 7);
  const summary = validateSnapshotDataset(records, quarterBlocks);
  assert.deepEqual(summary.perQuarterRecordCounts, {
    "2024 Q3": 15,
    "2024 Q4": 16,
    "2025 Q1": 16,
    "2025 Q2": 16,
    "2025 Q3": 15,
    "2025 Q4": 15,
    "2026 Q1": 15,
  });
  // Per-quarter region sums must equal the source 总计 rows (except 2026 Q1
  // settled delta documented in spec §9.C).
  for (const key of summary.quarters) {
    if (key === "2026 Q1") {
      assert.equal(summary.perQuarterSums[key].match, false);
      continue;
    }
    assert.equal(summary.perQuarterSums[key].match, true, `${key} region sums must match its 总计 row`);
  }
});

test("per-quarter totals match the pinned source values", () => {
  const { records } = parseFixture(SEVEN_QUARTERS);
  const expected = {
    "2024 Q3": [655, 638, 17, 0.974045801526718],
    "2024 Q4": [648, 633, 15, 0.976851851851852],
    "2025 Q1": [643, 629, 14, 0.978227060653188],
    "2025 Q2": [698, 684, 14, 0.979942693409742],
    "2025 Q3": [693, 682, 11, 0.984126984126984],
    "2025 Q4": [713, 707, 5, 0.991584852734923],
    "2026 Q1": [728, 722, 4, 0.991758241758242],
  };
  for (const [key, [ct, sc, uc, rate]] of Object.entries(expected)) {
    const total = records.find(
      (r) => `${r.period_year} Q${r.period_quarter}` === key && r.record_type === "total",
    );
    assert.equal(total.customer_total, ct, `${key} customer_total`);
    assert.equal(total.settled_count, sc, `${key} settled_count`);
    assert.equal(total.unsettled_count, uc, `${key} unsettled_count`);
    assert.equal(total.settlement_rate, rate, `${key} settlement_rate`);
  }
});

// ---------------------------------------------------------------------------
// 3. NULL 未对清 preserved (2026 Q1 empty cells)
// ---------------------------------------------------------------------------
test("2026 Q1 empty 未对清 cells stay NULL (never coerced to 0)", () => {
  const { records } = parseFixture(SEVEN_QUARTERS);
  const q1RegionNulls = records.filter(
    (r) => r.period_year === 2026 && r.period_quarter === 1 && r.record_type === "region" && r.unsettled_count === null,
  );
  assert.equal(q1RegionNulls.length, 11);
  for (const rec of q1RegionNulls) {
    // unclassified derives from NULL as 0, but the STORED unsettled stays NULL.
    assert.equal(rec.unclassified_count, rec.customer_total - rec.settled_count);
  }
  assert.equal(
    q1RegionNulls.some((r) => r.region === "常州"),
    true,
  );
});

// ---------------------------------------------------------------------------
// 4. 2025 Q4 gap=1 (Nantong + total)
// ---------------------------------------------------------------------------
test("2025 Q4 Nantong gap=1 is preserved with validation_note", () => {
  const { records } = parseFixture(SEVEN_QUARTERS);
  const nt = records.find(
    (r) => r.period_year === 2025 && r.period_quarter === 4 && r.record_type === "region" && r.region === "南通",
  );
  assert.equal(nt.customer_total, 101);
  assert.equal(nt.settled_count, 98);
  assert.equal(nt.unsettled_count, 2);
  assert.equal(nt.unclassified_count, 1);
  assert.match(nt.validation_note, /存在1家未分类差额/);

  const total = records.find(
    (r) => r.period_year === 2025 && r.period_quarter === 4 && r.record_type === "total",
  );
  assert.equal(total.unclassified_count, 1);
  assert.equal(total.unsettled_count, 5, "未对清 must stay 5, never bumped to 6");
  assert.match(total.validation_note, /存在1家未分类差额/);
});

// ---------------------------------------------------------------------------
// 5. 2026 Q1 region/total settled delta=2 (reported, never corrected)
// ---------------------------------------------------------------------------
test("2026 Q1 region settled sum 724 vs source total 722 → delta 2 preserved", () => {
  const { quarterBlocks, records } = parseFixture(SEVEN_QUARTERS);
  const summary = validateSnapshotDataset(records, quarterBlocks);
  assert.equal(summary.exceptions.delta2026q1.regionSettledSum, 724);
  assert.equal(summary.exceptions.delta2026q1.totalSettled, 722);
  assert.equal(summary.exceptions.delta2026q1.delta, 2);
  assert.equal(summary.exceptions.delta2026q1.preserved, true);

  const total = records.find(
    (r) => r.period_year === 2026 && r.period_quarter === 1 && r.record_type === "total",
  );
  assert.equal(total.settled_count, 722, "source total row stays 722");
  assert.match(total.validation_note, /相差2家/);
});

// ---------------------------------------------------------------------------
// 6. source settlement_rate never recomputed / overwritten
// ---------------------------------------------------------------------------
test("settlement_rate is stored verbatim; audit only reports recomputed diffs", () => {
  const { quarterBlocks } = parseFixture(SEVEN_QUARTERS);
  // Force a deliberately wrong rate on one record and assert the parser keeps
  // the SOURCE value and the audit reports the mismatch without touching it.
  const rows = buildRows(SEVEN_QUARTERS);
  rows[3][5] = 0.5; // 2024 Q3 淮安 (index 3): real rate is 1, inject 0.5 as "source"
  const { records: recs } = parseHistoricalSnapshotSheet({
    rows,
    sourceFileSha256: SOURCE_SHA256,
  });
  const huaian = recs.find((r) => r.period_year === 2024 && r.period_quarter === 3 && r.region === "淮安");
  assert.equal(huaian.settlement_rate, 0.5, "source value must win");
  assert.equal(huaian.settled_count / huaian.customer_total, 1);
  const summary = validateSnapshotDataset(recs, quarterBlocks);
  assert.ok(summary.rateAudit.mismatches.length >= 1);
  assert.ok(summary.rateAudit.mismatches.some((m) => m.region === "淮安" && m.absDiff === 0.5));
  // The real dataset has no mismatches beyond float epsilon.
  const { records: realRecs } = parseFixture(SEVEN_QUARTERS);
  const realSummary = validateSnapshotDataset(realRecs, quarterBlocks);
  assert.equal(realSummary.rateAudit.mismatches.length, 0);
});

test("2026 Q1 total rate matches 722/728 exactly as stored", () => {
  const { records } = parseFixture(SEVEN_QUARTERS);
  const total = records.find(
    (r) => r.period_year === 2026 && r.period_quarter === 1 && r.record_type === "total",
  );
  assert.equal(total.settlement_rate, 0.991758241758242);
  assert.ok(Math.abs(total.settled_count / total.customer_total - total.settlement_rate) < 1e-12);
});

// ---------------------------------------------------------------------------
// 7. duplicate import protection + target-DB guard
// ---------------------------------------------------------------------------
test("duplicate import classification: none / complete / partial", () => {
  assert.deepEqual(classifyExistingImport(0, 108), { status: "none" });
  assert.deepEqual(classifyExistingImport(108, 108), { status: "complete", importedCount: 108 });
  assert.deepEqual(classifyExistingImport(50, 108), { status: "partial", importedCount: 50, expectedTotal: 108 });
});

test("target-DB assertion refuses the formal database name", () => {
  assert.throws(() => assertTargetDatabase("quarterly_recon"), /TARGET_DB_BLOCKED/);
  assert.equal(assertTargetDatabase("quarterly_recon_2k11a_test"), true);
});

// ---------------------------------------------------------------------------
// 8. unknown quarter title → hard STOP
// ---------------------------------------------------------------------------
test("unknown quarter title stops with UNKNOWN_TITLE (no fuzzy parsing)", () => {
  const rows = buildRows(SEVEN_QUARTERS);
  rows.splice(2, 0, ["终端27.2季度对账情况跟进", null, null, null, null, null]);
  assert.throws(
    () => parseHistoricalSnapshotSheet({ rows, sourceFileSha256: SOURCE_SHA256 }),
    /UNKNOWN_TITLE.*终端27\.2季度对账情况跟进/,
  );
});

test("structural errors stop loudly (bad header, missing 总计, stray content)", () => {
  const rows = buildRows([SEVEN_QUARTERS[0]]);
  rows[1] = ["序号", "区域", "错列", "已对清", "未对清", "本季度对清率"];
  assert.throws(() => parseHistoricalSnapshotSheet({ rows, sourceFileSha256: SOURCE_SHA256 }), /HEADER_MISMATCH/);

  const rows2 = buildRows([SEVEN_QUARTERS[0]]);
  rows2.pop();
  rows2.pop();
  rows2[16] = [null, null, null, null, null, null]; // remove 总计
  assert.throws(() => parseHistoricalSnapshotSheet({ rows: rows2, sourceFileSha256: SOURCE_SHA256 }), /no 总计 row/);

  const rows3 = buildRows([SEVEN_QUARTERS[0]]);
  rows3[3] = ["x", null, null, null, null, null];
  assert.throws(() => parseHistoricalSnapshotSheet({ rows: rows3, sourceFileSha256: SOURCE_SHA256 }), /cannot classify/);
});

// ---------------------------------------------------------------------------
// 9. source hash gate
// ---------------------------------------------------------------------------
test("source hash gate: mismatch hard-stops, pinned hash passes", () => {
  assert.throws(() => assertSourceHash("0".repeat(64)), /SOURCE_HASH_MISMATCH/);
  assert.equal(assertSourceHash(SOURCE_SHA256), true);
  assert.equal(
    sha256Hex(Buffer.from("x")),
    "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881",
  );
});

test("unclassified_count derivation is audit-only", () => {
  assert.equal(computeUnclassifiedCount(101, 98, 2), 1);
  assert.equal(computeUnclassifiedCount(101, 98, null), 3);
  assert.equal(computeUnclassifiedCount(728, 722, 4), 2);
});

// ---------------------------------------------------------------------------
// Integration: REAL authoritative workbook (skipped when not on this host)
// ---------------------------------------------------------------------------
const realFilePresent = existsSync(REAL_FILE);
test("REAL workbook parses to 108 records with pinned hash and audit exceptions", { skip: !realFilePresent && "workbook not present on this host" }, async () => {
  const { readFile } = await import("node:fs/promises");
  const buffer = await readFile(REAL_FILE);
  const fileSha = sha256Hex(buffer);
  assert.equal(fileSha, SOURCE_SHA256, "real file must match the pinned sha256");
  assertSourceHash(fileSha);

  const workbook = XLSX.read(buffer, { type: "buffer" });
  assert.equal(workbook.SheetNames[0], "Sheet1");
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
    header: 1,
    raw: true,
    defval: null,
  });

  const { quarterBlocks, records } = parseHistoricalSnapshotSheet({
    rows,
    sourceFileSha256: fileSha,
  });
  const summary = validateSnapshotDataset(records, quarterBlocks);
  assert.equal(records.length, 108);
  assert.equal(quarterBlocks.length, 7);
  assert.equal(summary.totalRecordsByType.region, 101);
  assert.equal(summary.totalRecordsByType.total, 7);
  assert.deepEqual(summary.perQuarterRecordCounts, {
    "2024 Q3": 15,
    "2024 Q4": 16,
    "2025 Q1": 16,
    "2025 Q2": 16,
    "2025 Q3": 15,
    "2025 Q4": 15,
    "2026 Q1": 15,
  });
  assert.equal(summary.exceptions.nantong2025q4.preserved, true);
  assert.equal(summary.exceptions.total2025q4.preserved, true);
  assert.equal(summary.exceptions.delta2026q1.preserved, true);
  assert.equal(summary.rateAudit.mismatches.length, 0, "real rates match recomputed within epsilon");
  // Region names verbatim — no alias merging (spec §3).
  const regions = new Set(
    records.filter((r) => r.record_type === "region").map((r) => r.region),
  );
  for (const name of ["常州", "淮安", "疾控", "连云港", "南京", "南通", "苏州", "宿迁", "泰州", "无锡", "徐州", "血站", "盐城", "扬州", "镇江"]) {
    assert.equal(regions.has(name), true, `region ${name} must exist verbatim`);
  }
});
