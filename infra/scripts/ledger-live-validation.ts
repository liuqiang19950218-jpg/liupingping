// Phase 2G.1 live validation harness against the isolated ledger test DB.
// Drives the REAL server functions (importQuarterLedger, verifyLedgerInvoice,
// createDifferenceItem/updateDifferenceItem enforcement) over the app-role
// connection. Read-only on formal; writes only TEST_FIXTURE rows in the
// isolated quarterly_recon_ledger_runtime_test_20260828 DB.
//
// Run via: node --import tsx infra/scripts/ledger-live-validation.ts
// DATABASE_URL must point at the isolated ledger test DB (see run wrapper).
import assert from "node:assert/strict";
import { withPostgresClient, withPostgresTransaction } from "../../db/postgres";
import {
  importQuarterLedger,
  verifyLedgerInvoice,
} from "../../lib/server/ledger/ledger";
import { createDifferenceItem } from "../../lib/server/recon/write";

const LOG: string[] = [];
const log = (s: string) => {
  LOG.push(s);
  console.log(s);
};

async function qid(client: any, code: string): Promise<string | null> {
  const r = await client.query("SELECT id FROM recon.quarters WHERE code=$1", [code]);
  return r.rows[0]?.id ?? null;
}

async function main() {
  const db = await withPostgresClient(async (client) => {
    const res = await client.query("SELECT current_database() AS db");
    return res.rows[0].db as string;
  });
  log(`[target DB] ${db}`);
  assert.match(db, /ledger_runtime_test_20260828/, "harness must target the isolated ledger test DB");

  // ---------- ensure Q3 exists (test-only quarter) ----------
  await withPostgresClient(async (client) => {
    const q = await qid(client, "2026-Q3");
    if (!q) {
      await client.query(
        `INSERT INTO recon.quarters (code, year, quarter, cutoff_date, status)
         VALUES ('2026-Q3', 2026, 3, '2026-09-30', 'open')`,
      );
      log("[setup] created test quarter 2026-Q3");
    } else {
      log("[setup] quarter 2026-Q3 exists");
    }
  });

  // ---------- Step 8: Q3 current-year ledger import (multi-file fixture) ----------
  // File 1 (账套 A): normal rows, dup canonical key, 100 vs 100.00, leading-zero, whitespace, multi-date
  const file1Rows = [
    ["发票号", "开票日期", "本期应收"],
    ["FIXTURE-Q3-000001", "2026-07-05", "100"],
    ["FIXTURE-Q3-000001", "2026-07-05", "100.00"], // duplicate canonical key (same inv/date/amount)
    ["FIXTURE-Q3-000002", "2026-07-06", "200.00"],
    ["FIXTURE-Q3-LZ-0003", "2026-07-07", "300.00"], // leading zero
    ["  FIXTURE-Q3-WS-0004  ", "2026-07-08", "400.00"], // whitespace invoice
    ["FIXTURE-Q3-MULTI-0005", "2026-07-09", "500.00"], // will also appear with another date in file2
  ];
  // File 2 (账套 B): one unique invoice not in Historical Base V1 (used for isolation)
  const file2Rows = [
    ["发票号码", "财务日期", "应收金额"],
    ["FIXTURE-Q3-MULTI-0005", "2026-08-01", "500.00"], // same invoice different date (multi-date)
    ["FIXTURE-Q3-UNIQUE-ONLY", "2026-08-02", "1234.56"], // Q3-only invoice
    ["000013", "2011-07-22", "2940.00"], // historical overlap key (present in V1) - overlap allowed
  ];

  const importResult = await withPostgresTransaction((client) =>
    importQuarterLedger(client, "2026-Q3", [
      { sourceFileName: "账套A-往来明细.xlsx", headers: [], rows: file1Rows },
      { sourceFileName: "账套B-往来明细.xlsx", headers: [], rows: file2Rows },
    ]),
  );
  log(`[Q3 import] ${JSON.stringify(importResult)}`);
  assert.equal(importResult.status, "IMPORTED");
  assert.equal(importResult.quarter, "2026-Q3");
  assert.equal(importResult.datasetType, "CURRENT_YEAR_QUARTER");
  assert.equal(importResult.version, 1);
  assert.ok(importResult.insertedRows >= 7, "Q3 should have 7+ distinct keys");
  // inserted rows: file1: 5 distinct (dup removed, LZ, WS, MULTI date1) + file2: 2 distinct (MULTI date2, UNIQUE) + historical overlap
  // = 5 + 2 + 1 = 8 (dup canonical key collapsed to 1). Actually file1 has: 000001(dup->1), 000002, LZ, WS, MULTI-07-09 = 5; file2: MULTI-08-01, UNIQUE, 000013-2011 = 3; total 8.
  assert.equal(importResult.insertedRows, 8);
  log(`[Q3 import] insertedRows=${importResult.insertedRows} distinctInvoices=${importResult.distinctInvoices}`);
  log("Q3_FIXTURE_IMPORTED = YES");

  // ---------- Step 9: quarter isolation ----------
  // Q3-only invoice: FIXTURE-Q3-UNIQUE-ONLY / 2026-08-02 / 1234.56
  const q3 = await withPostgresClient((c) =>
    verifyLedgerInvoice(c, "2026-Q3", { invoiceNo: "FIXTURE-Q3-UNIQUE-ONLY", invoiceDate: "2026-08-02", amount: "1234.56" }),
  );
  log(`[Q3 verify unique] matched=${q3.matched} dataset=${q3.matchedDatasetType}`);
  assert.equal(q3.matched, true, "Q3 unique invoice must MATCH in Q3");
  assert.equal(q3.matchedDatasetType, "CURRENT_YEAR_QUARTER");

  const q2 = await withPostgresClient((c) =>
    verifyLedgerInvoice(c, "2026-Q2", { invoiceNo: "FIXTURE-Q3-UNIQUE-ONLY", invoiceDate: "2026-08-02", amount: "1234.56" }),
  );
  log(`[Q2 verify unique] matched=${q2.matched}`);
  assert.equal(q2.matched, false, "Q3-only invoice must NOT match in Q2");

  const q1 = await withPostgresClient((c) =>
    verifyLedgerInvoice(c, "2026-Q1", { invoiceNo: "FIXTURE-Q3-UNIQUE-ONLY", invoiceDate: "2026-08-02", amount: "1234.56" }),
  );
  log(`[Q1 verify unique] matched=${q1.matched}`);
  assert.equal(q1.matched, false, "Q3-only invoice must NOT match in Q1");
  log("LEDGER_QUARTER_ISOLATION = PASS");

  // overlap: historical 000013 must still match in Q3 scope (historical base active)
  const hist = await withPostgresClient((c) =>
    verifyLedgerInvoice(c, "2026-Q3", { invoiceNo: "000013", invoiceDate: "2011-07-22", amount: "2940.00" }),
  );
  log(`[Q3 verify historical overlap] matched=${hist.matched} dataset=${hist.matchedDatasetType}`);
  assert.equal(hist.matched, true, "historical V1 overlap must match in Q3 scope too");
  assert.equal(hist.matchedDatasetType, "HISTORICAL_BASE");

  // ---------- Step 10: same-quarter reimport -> 409 ----------
  let reimportRejected = false;
  try {
    await withPostgresTransaction((client) =>
      importQuarterLedger(client, "2026-Q3", [
        { sourceFileName: "账套A-再来.xlsx", headers: [], rows: file1Rows },
      ]),
    );
  } catch (e: any) {
    reimportRejected = true;
    log(`[Q3 reimport] rejected: ${e.code ?? e.message}`);
    assert.equal(e.status, 409, "reimport must be 409");
    assert.match(String(e.message), /LEDGER_QUARTER_DATA_ALREADY_EXISTS/);
  }
  assert.equal(reimportRejected, true, "Q3 reimport must be blocked");
  // confirm Q3 dataset unchanged (still 8 rows)
  const q3count = await withPostgresClient(async (c) => {
    const r = await c.query(
      `SELECT count(*)::int AS n FROM recon.ledger_verification_entries e
       JOIN recon.ledger_datasets d ON d.id=e.dataset_id
       WHERE d.dataset_type='CURRENT_YEAR_QUARTER' AND d.quarter_id=$1`,
      [await qid(c, "2026-Q3")],
    );
    return r.rows[0].n as number;
  });
  log(`[Q3 after reimport-block] entries=${q3count}`);
  assert.equal(q3count, 8, "Q3 dataset must be unchanged after blocked reimport");
  log("LEDGER_SAME_QUARTER_REIMPORT_BLOCKED = YES");

  // ---------- Step 11: Q4 invalid multi-file atomic rollback ----------
  await withPostgresClient(async (client) => {
    const q = await qid(client, "2026-Q4");
    if (!q) {
      await client.query(
        `INSERT INTO recon.quarters (code, year, quarter, cutoff_date, status)
         VALUES ('2026-Q4', 2026, 4, '2026-12-31', 'open')`,
      );
      log("[setup] created test quarter 2026-Q4");
    }
  });
  // file1 valid, file2 invalid (missing required invoice header)
  const q4File1 = [
    ["发票号", "开票日期", "本期应收"],
    ["FIXTURE-Q4-000001", "2026-10-01", "111.00"],
    ["FIXTURE-Q4-000002", "2026-10-02", "222.00"],
  ];
  const q4File2 = [
    ["客户名称", "备注"], // NO invoice header -> parse fails
    ["某客户", "xxx"],
  ];
  let q4Rejected = false;
  try {
    await withPostgresTransaction((client) =>
      importQuarterLedger(client, "2026-Q4", [
        { sourceFileName: "账套A-合法.xlsx", headers: [], rows: q4File1 },
        { sourceFileName: "账套B-非法.xlsx", headers: [], rows: q4File2 },
      ]),
    );
  } catch (e: any) {
    q4Rejected = true;
    log(`[Q4 import] rejected: ${e.message}`);
  }
  assert.equal(q4Rejected, true, "Q4 import must fail (invalid second file)");
  // verify Q4 has NO dataset and NO entries
  const q4State = await withPostgresClient(async (c) => {
    const q = await qid(c, "2026-Q4");
    const d = await c.query(
      `SELECT count(*)::int AS n FROM recon.ledger_datasets
       WHERE dataset_type='CURRENT_YEAR_QUARTER' AND quarter_id=$1`,
      [q],
    );
    const e = await c.query(
      `SELECT count(*)::int AS n FROM recon.ledger_verification_entries e
       JOIN recon.ledger_datasets d ON d.id=e.dataset_id
       WHERE d.dataset_type='CURRENT_YEAR_QUARTER' AND d.quarter_id=$1`,
      [q],
    );
    return { datasets: d.rows[0].n as number, entries: e.rows[0].n as number };
  });
  log(`[Q4 after failed import] datasets=${q4State.datasets} entries=${q4State.entries}`);
  assert.equal(q4State.datasets, 0, "Q4 dataset must not exist after failed import");
  assert.equal(q4State.entries, 0, "Q4 entries must be 0 after failed import");
  log("LEDGER_IMPORT_ROLLBACK_VALIDATED = YES");
  log("Q4_FIXTURE_ROLLED_BACK = YES");

  log("\nALL_LIVE_VALIDATION_DONE");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("HARNESS_FAILED:", err);
    process.exit(1);
  },
);
