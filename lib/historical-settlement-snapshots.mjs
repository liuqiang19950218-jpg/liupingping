// Phase 2K.11A — Historical Settlement Snapshot parser + validation.
//
// Pure module: no DB access, no filesystem. Used by
//   scripts/import-historical-settlement-snapshots.mjs  (CLI)
//   tests/historical-settlement-snapshots.test.mjs      (node --test)
//
// Parses the authoritative historical management snapshot workbook
// (工作簿1(2).xlsx — on this host /home/liupp/111/工作簿1.xlsx) into 108
// sealed snapshot records across 7 quarters (2024 Q3 .. 2026 Q1).
//
// Business rules (user-approved):
//   * source values are SEALED — settlement_rate is the raw Excel value and is
//     NEVER recomputed; unsettled_count NULL stays NULL;
//   * region names are preserved verbatim (no alias / fuzzy merge);
//   * unclassified_count is an AUDIT-ONLY derived field =
//     customer_total - settled_count - COALESCE(unsettled_count, 0);
//   * documented audit exceptions are preserved with validation_note:
//     2025 Q4 Nantong gap=1, 2025 Q4 total gap=1, 2026 Q1 total/region
//     settled delta=2.

import { createHash } from "node:crypto";

export const SOURCE_FILE = "工作簿1(2).xlsx";
export const SOURCE_SHEET = "Sheet1";
export const SOURCE_SHA256 =
  "31dcbba85938e72f48cadd6eea40b671f0411f3dd027036ea232fb3e907856da";
export const SNAPSHOT_VERSION = 1;

// Exact titles only — no fuzzy title matching (spec §16).
export const QUARTER_TITLE_MAP = Object.freeze({
  "终端24.3季度对账情况跟进": { year: 2024, quarter: 3 },
  "终端24.4季度对账情况跟进": { year: 2024, quarter: 4 },
  "终端25.1季度对账情况跟进": { year: 2025, quarter: 1 },
  "终端25.2季度对账情况跟进": { year: 2025, quarter: 2 },
  "终端25.3季度对账情况跟进": { year: 2025, quarter: 3 },
  "终端25.4季度对账情况跟进": { year: 2025, quarter: 4 },
  "终端26.1季度对账情况跟进": { year: 2026, quarter: 1 },
});

export const HEADER_CELLS = Object.freeze([
  "序号",
  "区域",
  "对账客户总数",
  "已对清",
  "未对清",
  "本季度对清率",
]);

const TITLE_LIKE = /^终端\d{2}\.\d季度对账情况跟进$/;

export function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// Source-file gate: hard STOP unless the workbook sha256 matches (spec §2).
export function assertSourceHash(fileSha256) {
  if (fileSha256 !== SOURCE_SHA256) {
    throw new Error(
      `SOURCE_HASH_MISMATCH: expected ${SOURCE_SHA256}, got ${fileSha256}. STOP — do not import.`,
    );
  }
  return true;
}

// Looks-like-a-title helper (used to reject unknown quarter titles).
export function isTitleLike(value) {
  return typeof value === "string" && TITLE_LIKE.test(value.trim());
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

// rows: array of arrays from XLSX.utils.sheet_to_json(ws, {header:1, raw:true,
// defval:null}). source_row is 1-indexed (Excel row number) = index + 1.
export function parseHistoricalSnapshotSheet({
  rows,
  sourceFile = SOURCE_FILE,
  sourceSheet = SOURCE_SHEET,
  sourceFileSha256 = SOURCE_SHA256,
}) {
  const quarterBlocks = [];
  const records = [];
  let current = null; // { title, year, quarter, headerRow, rows: [] }

  const closeBlock = () => {
    if (current) quarterBlocks.push(current);
    current = null;
  };

  for (let index = 0; index < rows.length; index += 1) {
    const sourceRow = index + 1;
    const raw = rows[index] ?? [];
    const col0 = raw[0] == null ? "" : String(raw[0]).trim();
    const region = raw[1] == null ? "" : String(raw[1]).trim();

    // Blank separator rows inside a block are skipped; they do not close it.
    if (col0 === "" && region === "") continue;

    // New quarter title (exact match) opens a block. The REAL workbook's FIRST
    // title row carries the workbook section marker "五、" (五、终端24.3季度对账
    // 情况跟进); every later title is plain. The section marker is not part of
    // the quarter identity, so an optional literal "五、" prefix is stripped
    // BEFORE the exact-match lookup. Everything else must match the pinned
    // titles verbatim — no fuzzy parsing (spec §16).
    const normalizedTitle = col0.startsWith("五、") ? col0.slice(2) : col0;
    if (QUARTER_TITLE_MAP[normalizedTitle]) {
      closeBlock();
      current = {
        title: normalizedTitle,
        ...QUARTER_TITLE_MAP[normalizedTitle],
        headerRow: null,
        dataRows: [],
        totalRow: null,
      };
      continue;
    }

    // A title-looking row that is NOT in the map → hard STOP (spec §16).
    if (isTitleLike(col0) || isTitleLike(normalizedTitle)) {
      throw new Error(
        `UNKNOWN_TITLE: source_row ${sourceRow} has unrecognized quarter title "${col0}". STOP — no fuzzy title parsing.`,
      );
    }

    if (!current) {
      // Data before any title — tolerate only fully blank rows (already
      // skipped) else hard STOP: a title must come first.
      throw new Error(
        `STRUCTURE: source_row ${sourceRow} has content before the first quarter title.`,
      );
    }

    // Header row directly after the title.
    if (current.headerRow === null && col0 === HEADER_CELLS[0]) {
      const actual = raw.slice(0, HEADER_CELLS.length).map((c) =>
        c == null ? "" : String(c).trim(),
      );
      if (actual.join("|") !== HEADER_CELLS.join("|")) {
        throw new Error(
          `HEADER_MISMATCH: source_row ${sourceRow} header is "${actual.join(
            "|",
          )}", expected "${HEADER_CELLS.join("|")}".`,
        );
      }
      current.headerRow = sourceRow;
      continue;
    }

    // Data row: region column must be present.
    if (region !== "") {
      const cell = (n) => {
        const v = raw[n];
        return v === null || v === undefined ? null : v;
      };
      const customerTotal = cell(2);
      const settledCount = cell(3);
      // 未对清 may be an EMPTY Excel cell → must stay NULL (spec §7).
      const unsettledCount = cell(4) == null ? null : cell(4);
      const rate = cell(5);
      const seq = cell(0) == null ? null : cell(0);

      const numeric = [customerTotal, settledCount, unsettledCount, rate].filter(
        (v) => v !== null,
      );
      if (!numeric.every((v) => typeof v === "number" && Number.isFinite(v))) {
        throw new Error(
          `STRUCTURE: source_row ${sourceRow} has non-numeric cell(s) in a data row (region "${region}").`,
        );
      }
      if (customerTotal === null || settledCount === null || rate === null) {
        throw new Error(
          `STRUCTURE: source_row ${sourceRow} (region "${region}") is missing customer_total/settled_count/rate.`,
        );
      }

      const row = {
        sourceRow,
        seq: seq === null ? null : Number(seq),
        region,
        customerTotal: Number(customerTotal),
        settledCount: Number(settledCount),
        unsettledCount: unsettledCount === null ? null : Number(unsettledCount),
        rate: Number(rate),
      };

      if (region === "总计") {
        if (current.totalRow) {
          throw new Error(
            `STRUCTURE: source_row ${sourceRow} has a second 总计 row in "${current.title}".`,
          );
        }
        current.totalRow = row;
      } else {
        current.dataRows.push(row);
      }
      continue;
    }

    // Non-blank col0 but empty region inside a block (e.g. stray cell) → STOP.
    if (col0 !== "") {
      throw new Error(
        `STRUCTURE: source_row ${sourceRow} has col A "${col0}" but no region — cannot classify.`,
      );
    }
  }
  closeBlock();

  if (quarterBlocks.length === 0) {
    throw new Error("STRUCTURE: no quarter titles found in the sheet.");
  }

  // Build the 108 sealed records.
  for (const block of quarterBlocks) {
    if (block.headerRow === null) {
      throw new Error(`STRUCTURE: "${block.title}" has no header row.`);
    }
    if (block.totalRow === null) {
      throw new Error(`STRUCTURE: "${block.title}" has no 总计 row.`);
    }
    const expectedSeq = block.dataRows.map((r, i) => i + 1);
    const actualSeq = block.dataRows.map((r) => r.seq);
    if (JSON.stringify(actualSeq) !== JSON.stringify(expectedSeq)) {
      throw new Error(
        `STRUCTURE: "${block.title}" region 序号 must be 1..N, got ${actualSeq.join(
          ",",
        )}.`,
      );
    }

    for (const r of block.dataRows) {
      records.push(toRecord(block, r, "region", validationNote(block, r)));
    }
    records.push(toRecord(block, block.totalRow, "total", validationNote(block, block.totalRow)));
  }

  return { quarterBlocks, records };
}

// Audit-only derived field (spec §8): source Excel difference not falling into
// settled + unsettled. NOT a business "未对账/未对清" field.
export function computeUnclassifiedCount(customerTotal, settledCount, unsettledCount) {
  return customerTotal - settledCount - (unsettledCount == null ? 0 : unsettledCount);
}

// Source values preserved verbatim; only unclassified_count is derived.
function toRecord(block, r, recordType, note) {
  return {
    period_year: block.year,
    period_quarter: block.quarter,
    record_type: recordType,
    region: r.region,
    customer_total: r.customerTotal,
    settled_count: r.settledCount,
    unsettled_count: r.unsettledCount,
    unclassified_count: computeUnclassifiedCount(
      r.customerTotal,
      r.settledCount,
      r.unsettledCount,
    ),
    settlement_rate: r.rate,
    source_file: SOURCE_FILE,
    source_file_sha256: SOURCE_SHA256,
    source_sheet: SOURCE_SHEET,
    source_row: r.sourceRow,
    snapshot_version: SNAPSHOT_VERSION,
    sealed: true,
    validation_note: note,
  };
}

// Documented audit exceptions only (spec §9). Everything else keeps NULL note.
function validationNote(block, r) {
  const q = block.quarter;
  if (block.year === 2025 && q === 4) {
    if (r.region === "南通") {
      return "源表：客户总数101，已对清98，未对清2，存在1家未分类差额；原值保留。";
    }
    if (r.region === "总计") {
      return "源表总计：客户总数713，已对清707，未对清5，存在1家未分类差额；原值保留。";
    }
  }
  if (block.year === 2026 && q === 1 && r.region === "总计") {
    return "源表总计已对清722；区域明细已对清合计724，相差2家。总计及区域均按源Excel原值封存，不自动修正。";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Audit / validation (spec §18–§20)
// ---------------------------------------------------------------------------

const RATE_EPSILON = 1e-9;

// Independent audit of the parsed records. Reports EVERYTHING; never mutates.
// Returns a summary object with PASS/exception fields.
export function validateSnapshotDataset(records, quarterBlocks) {
  const byQuarter = new Map();
  for (const block of quarterBlocks) {
    byQuarter.set(`${block.year} Q${block.quarter}`, block);
  }

  const summary = {
    totalRecords: records.length,
    quarterCount: quarterBlocks.length,
    quarters: quarterBlocks.map((b) => `${b.year} Q${b.quarter}`),
    perQuarterRecordCounts: {},
    totalRecordsByType: {},
    perQuarterSums: {},
    rateAudit: { maxAbsDiff: 0, mismatches: [] },
    exceptions: {},
  };

  const regionByQuarter = new Map();
  const totalByQuarter = new Map();
  for (const rec of records) {
    const key = `${rec.period_year} Q${rec.period_quarter}`;
    (rec.record_type === "total" ? totalByQuarter : regionByQuarter).set(key, rec);
  }

  for (const [key, block] of byQuarter) {
    const regions = records.filter(
      (r) => `${r.period_year} Q${r.period_quarter}` === key && r.record_type === "region",
    );
    const total = totalByQuarter.get(key);
    summary.perQuarterRecordCounts[key] = regions.length + 1;

    const sums = regions.reduce(
      (acc, r) => {
        acc.customer_total += r.customer_total;
        acc.settled_count += r.settled_count;
        acc.unsettled_count += r.unsettled_count == null ? 0 : r.unsettled_count;
        return acc;
      },
      { customer_total: 0, settled_count: 0, unsettled_count: 0 },
    );
    summary.perQuarterSums[key] = {
      region: sums,
      total: {
        customer_total: total.customer_total,
        settled_count: total.settled_count,
        unsettled_count: total.unsettled_count == null ? 0 : total.unsettled_count,
      },
      match:
        sums.customer_total === total.customer_total &&
        sums.settled_count === total.settled_count &&
        sums.unsettled_count === (total.unsettled_count == null ? 0 : total.unsettled_count),
    };
  }

  summary.totalRecordsByType = records.reduce(
    (acc, r) => {
      acc[r.record_type] = (acc[r.record_type] ?? 0) + 1;
      return acc;
    },
    {},
  );

  // Rate audit: recompute settled/customer_total and compare to the source
  // value. REPORT ONLY — never overwrite the source rate (spec §20).
  for (const rec of records) {
    const recomputed = rec.settled_count / rec.customer_total;
    const absDiff = Math.abs(recomputed - rec.settlement_rate);
    if (absDiff > summary.rateAudit.maxAbsDiff) {
      summary.rateAudit.maxAbsDiff = absDiff;
    }
    if (absDiff > RATE_EPSILON) {
      summary.rateAudit.mismatches.push({
        region: rec.region,
        quarter: `${rec.period_year} Q${rec.period_quarter}`,
        sourceRate: rec.settlement_rate,
        recomputed,
        absDiff,
      });
    }
  }

  // Documented exceptions (spec §9).
  const nt25q4 = records.find(
    (r) =>
      r.period_year === 2025 && r.period_quarter === 4 && r.record_type === "region" && r.region === "南通",
  );
  summary.exceptions.nantong2025q4 = nt25q4
    ? {
        unclassified_count: nt25q4.unclassified_count,
        preserved: nt25q4.unclassified_count === 1 && nt25q4.settled_count === 98,
      }
    : { preserved: false };

  const t25q4 = records.find(
    (r) => r.period_year === 2025 && r.period_quarter === 4 && r.record_type === "total",
  );
  summary.exceptions.total2025q4 = t25q4
    ? {
        unclassified_count: t25q4.unclassified_count,
        preserved: t25q4.unclassified_count === 1 && t25q4.unsettled_count === 5,
      }
    : { preserved: false };

  const t26q1 = records.find(
    (r) => r.period_year === 2026 && r.period_quarter === 1 && r.record_type === "total",
  );
  const r26q1 = summary.perQuarterSums["2026 Q1"]?.region;
  summary.exceptions.delta2026q1 = t26q1 && r26q1
    ? {
        regionSettledSum: r26q1.settled_count,
        totalSettled: t26q1.settled_count,
        delta: r26q1.settled_count - t26q1.settled_count,
        preserved: r26q1.settled_count - t26q1.settled_count === 2,
      }
    : { preserved: false };

  return summary;
}

// ---------------------------------------------------------------------------
// Import guards (duplicate protection + target-DB assertion)
// ---------------------------------------------------------------------------

// Duplicate-import protection (spec §15.10, §17/§18): if v1 rows already exist
// for this source file, STOP — never insert again.
export function classifyExistingImport(importedCount, expectedTotal) {
  if (importedCount === 0) return { status: "none" };
  if (importedCount === expectedTotal) {
    return { status: "complete", importedCount };
  }
  return { status: "partial", importedCount, expectedTotal };
}

// Hard target-DB assertion: never run an import against the formal DB name.
export function assertTargetDatabase(dbName) {
  if (dbName === "quarterly_recon") {
    throw new Error(
      `TARGET_DB_BLOCKED: refusing to import into formal database "${dbName}". Use an isolated test clone.`,
    );
  }
  return true;
}
