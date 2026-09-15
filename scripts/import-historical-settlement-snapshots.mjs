// Phase 2K.11A — Historical Settlement Snapshot importer (CLI).
//
// Usage:
//   node scripts/import-historical-settlement-snapshots.mjs --validate-only <xlsx>
//   node scripts/import-historical-settlement-snapshots.mjs --apply <xlsx>
//
// The workbook is the user-confirmed authoritative source (工作簿1(2).xlsx;
// sha256 pinned). The script:
//   1. computes the file sha256 and hard-STOPs unless it matches the pinned
//      hash (spec §2);
//   2. parses the sheet with EXACT quarter-title matching only (spec §16);
//   3. preserves every source value verbatim (settlement_rate is never
//      recomputed, NULL 未对清 stays NULL, region names verbatim);
//   4. --validate-only: full audit report, ZERO DB access;
//   5. --apply: hard target-DB assertion (refuses quarterly_recon), duplicate
//      protection (v1 already imported → STOP), single-transaction insert of
//      all 108 records, then an independent count verification.
//
// DATABASE_URL is read from the environment (never embedded).
// Connect as the schema owner (postgres) for the isolated test clone.

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import * as XLSX from "xlsx";
import pg from "pg";

import {
  SOURCE_FILE,
  SOURCE_SHEET,
  SOURCE_SHA256,
  assertSourceHash,
  parseHistoricalSnapshotSheet,
  validateSnapshotDataset,
  classifyExistingImport,
  assertTargetDatabase,
} from "../lib/historical-settlement-snapshots.mjs";

const { Client } = pg;

const args = process.argv.slice(2);
const modeIndex = args.findIndex((a) => a === "--validate-only" || a === "--apply");
if (modeIndex === -1) {
  console.error("usage: import-historical-settlement-snapshots.mjs --validate-only|--apply <xlsx>");
  process.exit(2);
}
const mode = args[modeIndex];
const xlsxPath = args[modeIndex + 1];
if (!xlsxPath) {
  console.error("missing <xlsx> path");
  process.exit(2);
}

function fail(message) {
  console.error(`[BLOCKED] ${message}`);
  process.exit(1);
}

function dbNameFromUrl(url) {
  try {
    return new URL(url).pathname.replace(/^\//, "").split("?")[0];
  } catch {
    return null;
  }
}

async function main() {
  const buffer = await readFile(xlsxPath);
  const fileSha256 = createHash("sha256").update(buffer).digest("hex");
  assertSourceHash(fileSha256);
  console.log(`[GATE] source sha256 ${fileSha256} == pinned ${SOURCE_SHA256} → PASS`);

  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (sheetName !== SOURCE_SHEET) {
    fail(`source sheet is "${sheetName}", expected "${SOURCE_SHEET}"`);
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

  let parsed;
  try {
    parsed = parseHistoricalSnapshotSheet({
      rows,
      sourceFile: SOURCE_FILE,
      sourceSheet: sheetName,
      sourceFileSha256: fileSha256,
    });
  } catch (err) {
    fail(err.message);
  }
  const { records, quarterBlocks } = parsed;
  const summary = validateSnapshotDataset(records, quarterBlocks);

  const line = "=".repeat(64);
  console.log(line);
  console.log(`HISTORICAL SETTLEMENT SNAPSHOT — ${mode === "--validate-only" ? "VALIDATE-ONLY" : "APPLY"}`);
  console.log(`source file      : ${path.basename(xlsxPath)} (${fileSha256})`);
  console.log(`source sheet     : ${sheetName}`);
  console.log(`records parsed   : ${records.length}`);
  console.log(`quarters         : ${summary.quarterCount} → ${summary.quarters.join(", ")}`);
  console.log(`region rows      : ${summary.totalRecordsByType.region ?? 0}`);
  console.log(`total rows       : ${summary.totalRecordsByType.total ?? 0}`);
  console.log(`per-quarter      : ${JSON.stringify(summary.perQuarterRecordCounts)}`);
  console.log(`rate audit       : maxAbsDiff=${summary.rateAudit.maxAbsDiff} mismatches=${summary.rateAudit.mismatches.length}`);
  for (const key of summary.quarters) {
    const s = summary.perQuarterSums[key];
    console.log(
      `  ${key}: region=${s.region.customer_total}/${s.region.settled_count}/${s.region.unsettled_count} ` +
        `total=${s.total.customer_total}/${s.total.settled_count}/${s.total.unsettled_count} ` +
        `MATCH=${s.match}`,
    );
  }
  console.log(`exception 2025Q4 南通      : ${JSON.stringify(summary.exceptions.nantong2025q4)}`);
  console.log(`exception 2025Q4 总计      : ${JSON.stringify(summary.exceptions.total2025q4)}`);
  console.log(`exception 2026Q1 delta     : ${JSON.stringify(summary.exceptions.delta2026q1)}`);

  if (records.length !== 108) fail(`expected 108 records, got ${records.length}`);
  if (summary.quarterCount !== 7) fail(`expected 7 quarters, got ${summary.quarterCount}`);
  if ((summary.totalRecordsByType.region ?? 0) !== 101) fail("expected 101 region records");
  if ((summary.totalRecordsByType.total ?? 0) !== 7) fail("expected 7 total records");
  const expectedCounts = { "2024 Q3": 15, "2024 Q4": 16, "2025 Q1": 16, "2025 Q2": 16, "2025 Q3": 15, "2025 Q4": 15, "2026 Q1": 15 };
  for (const [key, n] of Object.entries(expectedCounts)) {
    if (summary.perQuarterRecordCounts[key] !== n) {
      fail(`per-quarter count for ${key} is ${summary.perQuarterRecordCounts[key]}, expected ${n}`);
    }
  }
  if (!summary.exceptions.nantong2025q4.preserved) fail("2025 Q4 Nantong gap not preserved");
  if (!summary.exceptions.total2025q4.preserved) fail("2025 Q4 total gap not preserved");
  if (!summary.exceptions.delta2026q1.preserved) fail("2026 Q1 total/region delta not preserved");
  if (summary.rateAudit.mismatches.length > 0) {
    console.error(`[AUDIT] rate mismatches (report only, source preserved): ${JSON.stringify(summary.rateAudit.mismatches)}`);
  }

  if (mode === "--validate-only") {
    console.log(line);
    console.log("VALIDATE_ONLY_OK — zero DB access, zero writes.");
    return;
  }

  // ---- --apply ----
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail("DATABASE_URL is not set");
  const dbName = dbNameFromUrl(databaseUrl);
  console.log(`[GATE] target database "${dbName}"`);
  assertTargetDatabase(dbName);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows: existingRows } = await client.query(
      `SELECT count(*)::int AS n
         FROM recon.historical_settlement_snapshots
        WHERE snapshot_version = 1 AND source_file_sha256 = $1`,
      [SOURCE_SHA256],
    );
    const existing = classifyExistingImport(existingRows[0].n, 108);
    if (existing.status !== "none") {
      fail(`DUPLICATE_IMPORT_BLOCKED: v1 already imported (${JSON.stringify(existing)}). STOP — no re-insert.`);
    }

    const insertSql = `
      INSERT INTO recon.historical_settlement_snapshots (
        period_year, period_quarter, record_type, region,
        customer_total, settled_count, unsettled_count, unclassified_count,
        settlement_rate, source_file, source_file_sha256, source_sheet,
        source_row, snapshot_version, sealed, validation_note
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
      )`;

    await client.query("BEGIN");
    try {
      for (const rec of records) {
        await client.query(insertSql, [
          rec.period_year,
          rec.period_quarter,
          rec.record_type,
          rec.region,
          rec.customer_total,
          rec.settled_count,
          rec.unsettled_count,
          rec.unclassified_count,
          rec.settlement_rate,
          rec.source_file,
          rec.source_file_sha256,
          rec.source_sheet,
          rec.source_row,
          rec.snapshot_version,
          rec.sealed,
          rec.validation_note,
        ]);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }

    const { rows: verifyRows } = await client.query(
      "SELECT count(*)::int AS n FROM recon.historical_settlement_snapshots",
    );
    console.log(`[VERIFY] table rows after import: ${verifyRows[0].n}`);
    if (verifyRows[0].n !== 108) {
      fail(`post-import count is ${verifyRows[0].n}, expected 108`);
    }
    console.log(line);
    console.log("IMPORT_OK — 108 sealed records inserted (snapshot_version=1).");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
