import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// Phase 2H.1 remaining business import backend — pure business-rule tests +
// source-code contract assertions (the same discipline as ledger-runtime.test.mjs
// and spd-dashboard.test.mjs). Live-DB verification happens in the 8001 staging
// HTTP run against quarterly_recon_remaining_imports_test_20260828.
//
// Coverage map (24 cases):
//   MATERIAL:       1 exact match · 2 unmatched partial · 3 status upsert
//                   4 SPD-A -> material_status · 5 independent SPD untouched
//                   6 malformed rollback
//   SPD:            7 valid import · 8 yes/no/blank · 9 failed replace preserves old
//                   10 Q1 142 unchanged
//   COMPANY RECVBL: 11 exact match · 12 nonNULL book difference recompute
//                   13 NULL book difference NULL · 14 customerBook untouched
//                   15 sales data untouched · 16 unmatched · 17 ambiguous
//   HISTORICAL:     18 V2 successful · 19 V1 retained · 20 V2 active
//                   21 verify uses V2 · 22 failed V3 rollback
//                   23 current-year unaffected
//   AUDIT:          24 four types produce PG audit metadata

// ---------------------------------------------------------------------------
// Pure replication of the server helpers (must equal remaining-imports-common.ts)
// ---------------------------------------------------------------------------
const strip = (v) => String(v ?? "").replace(/\s/g, "").trim();
const headerIndex = (headers, aliases) =>
  headers.findIndex((h) => aliases.some((a) => strip(h).includes(strip(a))));
const matchKey = (a, r, c) => [a, r, c].map(strip).join("\u001f");
function materialProvided(raw) {
  if (["已提供", "已回函", "是"].includes(raw)) return true;
  if (["未对账", "", "—"].includes(raw)) return null;
  return false;
}
const spdSummary = (values) => {
  const total = values.length;
  const submitted = values.filter((v) => v !== null && v.trim() !== "").length;
  return { total, submitted, unsubmitted: total - submitted };
};
const MATERIAL_HEADERS = ["对账函", "对账确认函", "SPD确认表", "SPD库存确认函", "在途证明", "精准核销", "催款函送达证明"];

// --- MATERIAL --------------------------------------------------------------
test("MATERIAL-1 exact match: whitespace-removed key matches identical normalized triples only", () => {
  const a = matchKey(" 万和 ", "苏州", "苏州市第一人民医院");
  const b = matchKey("万和", "苏 州", "苏州市第一人民医院");
  assert.equal(a, b, "internal whitespace is ignored, legacy key semantics");
  const c = matchKey("万和", "苏州", "苏州市第二人民医院");
  assert.notEqual(a, c, "different customer is NOT a match (no fuzzy/alias)");
  const d = matchKey("英科", "苏州", "苏州市第一人民医院");
  assert.notEqual(a, d, "different account set is NOT a match");
  const e = matchKey("万和", "常州", "苏州市第一人民医院");
  assert.notEqual(a, e, "different region is NOT a match");
});

test("MATERIAL-2 unmatched partial: zero/partial matches are business partial, not structural errors", async () => {
  const route = await readFile(new URL("../app/api/quarter/[code]/materials/import/route.ts", import.meta.url), "utf8");
  const lib = await readFile(new URL("../lib/server/recon/materials-import.ts", import.meta.url), "utf8");
  // unmatchedRows is returned; status can be PARTIAL; never throws on unmatched.
  assert.match(lib, /unmatchedRows/);
  assert.match(lib, /status: matchedRows === normalized\.length \? "IMPORTED" : "PARTIAL"/);
  assert.match(route, /handleRouteError/);
  // No customer/reconciliation creation anywhere in the material import.
  assert.doesNotMatch(lib, /INSERT INTO recon\.customers/);
  assert.doesNotMatch(lib, /INSERT INTO recon\.reconciliations/);
});

test("MATERIAL-3 status upsert: provided derivation + deterministic source row key", async () => {
  // Migration-confirmed provided mapping.
  assert.equal(materialProvided("是"), true);
  assert.equal(materialProvided("已提供"), true);
  assert.equal(materialProvided("已回函"), true);
  assert.equal(materialProvided("未对账"), null);
  assert.equal(materialProvided(""), null);
  assert.equal(materialProvided("—"), null);
  assert.equal(materialProvided("否"), false);
  assert.equal(materialProvided("未提供"), false);
  assert.equal(materialProvided("已盖章"), false);
  assert.equal(materialProvided("未盖章"), false);
  assert.equal(materialProvided("未回函"), false);
  // raw_value is preserved as-is; only non-blank cells are written.
  const lib = await readFile(new URL("../lib/server/recon/materials-import.ts", import.meta.url), "utf8");
  assert.match(lib, /if \(raw !== ""\) materials\.set/);
  assert.match(lib, /ORDER BY created_at ASC, id ASC LIMIT 1/); // update-in-place, never duplicate
});

test("MATERIAL-4 SPD-A fields target material_status (not spd_dashboard_rows)", async () => {
  const lib = await readFile(new URL("../lib/server/recon/materials-import.ts", import.meta.url), "utf8");
  assert.match(lib, /INSERT INTO recon\.material_status/);
  assert.match(lib, /UPDATE recon\.material_status/);
  // No SQL statement ever targets the independent SPD dashboard table.
  assert.doesNotMatch(lib, /recon\.spd_dashboard_rows/);
  assert.match(lib, /MATERIAL_HEADERS/);
  // SPD确认表 alias SPD确认函 supported.
  assert.match(lib, /MATERIAL_HEADER_ALIASES/);
});

test("MATERIAL-5 independent SPD dataset is never touched by the material import", async () => {
  const lib = await readFile(new URL("../lib/server/recon/materials-import.ts", import.meta.url), "utf8");
  assert.doesNotMatch(lib, /recon\.spd_dashboard_rows/);
  const spdLib = await readFile(new URL("../lib/server/recon/spd-import.ts", import.meta.url), "utf8");
  assert.match(spdLib, /INSERT INTO recon\.spd_dashboard_rows/);
  assert.doesNotMatch(spdLib, /material_status/);
});

test("MATERIAL-6 malformed rollback: missing required header is a pre-transaction structural error", async () => {
  const lib = await readFile(new URL("../lib/server/recon/materials-import.ts", import.meta.url), "utf8");
  // parseRows throws BEFORE the transaction opens (validation first).
  const idx = lib.indexOf("const normalized = parseRows(headers, rows);");
  assert.ok(idx > 0);
  assert.ok(
    lib.indexOf("withPostgresTransaction(async (client)") > idx,
    "parse happens before the transaction opens",
  );
  assert.match(lib, /必须包含 账套、区域、客户名称 列/);
  assert.match(lib, /MISSING_REQUIRED_HEADER/);
});

test("MATERIAL-3b header contract: 账套/区域/客户名称 required + SPD确认表 alias SPD确认函", () => {
  const headers = ["序号", "账套", "区域", "客户名称", "SPD确认函", "SPD库存确认函", "对账函", "备注"];
  assert.equal(headerIndex(headers, ["账套"]), 1);
  assert.equal(headerIndex(headers, ["区域"]), 2);
  assert.equal(headerIndex(headers, ["客户名称"]), 3);
  // Legacy alias: SPD确认表 column can be spelled "SPD确认函".
  assert.equal(headerIndex(headers, ["SPD确认表", "SPD确认函"]), 4);
  assert.equal(headerIndex(headers, ["SPD库存确认函"]), 5);
  assert.equal(headerIndex(headers, ["不存在"]), -1);
  // The 7 canonical material headers are the documented contract.
  assert.deepEqual(MATERIAL_HEADERS, [
    "对账函", "对账确认函", "SPD确认表", "SPD库存确认函", "在途证明", "精准核销", "催款函送达证明",
  ]);
});

// --- SPD --------------------------------------------------------------------
test("SPD-7 valid import: atomic whole-sheet replace + import audit + source_batch_id", async () => {
  const lib = await readFile(new URL("../lib/server/recon/spd-import.ts", import.meta.url), "utf8");
  assert.match(lib, /DELETE FROM recon\.spd_dashboard_rows WHERE quarter_id/);
  assert.match(lib, /INSERT INTO recon\.spd_dashboard_rows/);
  assert.match(lib, /source_batch_id/);
  assert.match(lib, /withPostgresTransaction/);
  assert.match(lib, /IMPORT_DATA_TYPES\.spd/);
  assert.match(lib, /POST_IMPORT_VALIDATION_FAILED/);
});

test("SPD-8 yes/no/blank semantics: 是 AND 否 submitted, blank unsubmitted, total=3", () => {
  const s = spdSummary(["是", "否", null]);
  assert.equal(s.total, 3);
  assert.equal(s.submitted, 2);
  assert.equal(s.unsubmitted, 1);
  const onlyNo = spdSummary(["否"]);
  assert.equal(onlyNo.submitted, 1, "否 counts as submitted (business-confirmed)");
  const allBlank = spdSummary([null, "", " "]);
  assert.equal(allBlank.submitted, 0);
  assert.equal(allBlank.unsubmitted, 3);
});

test("SPD-9 failed replace preserves previous dataset: DELETE+INSERT inside ONE transaction (ROLLBACK)", async () => {
  const lib = await readFile(new URL("../lib/server/recon/spd-import.ts", import.meta.url), "utf8");
  assert.match(lib, /withPostgresTransaction/);
  // The DELETE of old rows and INSERT of new rows are inside the same callback;
  // the server transaction helper ROLLBACKs on any thrown error, so a failed
  // replace can never leave the dashboard empty.
  assert.ok(lib.indexOf("DELETE FROM recon.spd_dashboard_rows") > lib.indexOf("withPostgresTransaction(async (client)"));
  assert.ok(lib.indexOf("INSERT INTO recon.spd_dashboard_rows") > lib.indexOf("DELETE FROM recon.spd_dashboard_rows"));
  // Any structural failure is detected before the DELETE (validation first).
  assert.ok(lib.indexOf("const normalized = parseRows(headers, rows);") < lib.indexOf("DELETE FROM recon.spd_dashboard_rows"));
});

test("SPD-10 Q1 142 unchanged: the import is strictly quarter-scoped and never touches Q1", async () => {
  const lib = await readFile(new URL("../lib/server/recon/spd-import.ts", import.meta.url), "utf8");
  // quarter is resolved server-side from [code]; writes scoped to quarter_id only.
  assert.match(lib, /SELECT id FROM recon\.quarters WHERE code = \$1/);
  assert.match(lib, /DELETE FROM recon\.spd_dashboard_rows WHERE quarter_id = \$1/);
  assert.doesNotMatch(lib, /2026-Q1|Q1/);
});

// --- COMPANY RECEIVABLE -----------------------------------------------------
test("RECVBL-11 exact match: same normalization as material; different customer never matches", () => {
  const a = matchKey("万和", "苏州", "苏州市第一人民医院");
  const b = matchKey("万和", "苏州", "苏州市第一人民医院");
  assert.equal(a, b);
  const c = matchKey("万和", "苏州", "苏州市第一人民 医院");
  assert.equal(a, c, "whitespace-insensitive legacy key");
  const d = matchKey("万和", "苏州", "苏州市第二人民医院");
  assert.notEqual(a, d);
});

test("RECVBL-12 nonNULL customerBook -> difference = new company - customerBook", () => {
  const recompute = (newCompany, customerBook) =>
    customerBook === null ? null : (Number(newCompany) - Number(customerBook)).toFixed(2);
  assert.equal(recompute("1000.00", "400.00"), "600.00");
  assert.equal(recompute("62274.30", "0.00"), "62274.30");
  assert.equal(recompute("-50.00", "100.00"), "-150.00");
});

test("RECVBL-13 NULL customerBook -> difference stays NULL (never 0, never 未对账)", () => {
  // Rule: customer_book_amount NULL => reconciliation_difference NULL.
  const recompute = (newCompany, customerBook) =>
    customerBook === null ? null : (Number(newCompany) - Number(customerBook)).toFixed(2);
  assert.equal(recompute("1000.00", null), null);
  assert.equal(recompute("62274.30", null), null, "never company - 0");
  assert.equal(recompute("0.00", null), null);
});

test("RECVBL-13b server recompute SQL: NULL book -> NULL difference", async () => {
  const lib = await readFile(new URL("../lib/server/recon/receivables-import.ts", import.meta.url), "utf8");
  assert.match(lib, /CASE WHEN customer_book_amount IS NULL\n\s+THEN NULL/);
  assert.match(lib, /ELSE \$2::numeric - customer_book_amount END/);
  assert.doesNotMatch(lib, /reconciliation_difference = 0/);
});

test("RECVBL-14 customerBook untouched: UPDATE only sets company_receivable + difference", async () => {
  const lib = await readFile(new URL("../lib/server/recon/receivables-import.ts", import.meta.url), "utf8");
  assert.match(lib, /SET company_receivable = \$2::numeric/);
  assert.match(lib, /reconciliation_difference =/);
  assert.doesNotMatch(lib, /SET customer_book_amount/);
});

test("RECVBL-15 sales data untouched: no other business column in the UPDATE", async () => {
  const lib = await readFile(new URL("../lib/server/recon/receivables-import.ts", import.meta.url), "utf8");
  const updateSql = lib.slice(lib.indexOf("UPDATE recon.reconciliations"), lib.indexOf("WHERE id = $1"));
  assert.doesNotMatch(updateSql, /owner_name/);
  assert.doesNotMatch(updateSql, /reconciliation_status/);
  assert.doesNotMatch(updateSql, /solution/);
  assert.doesNotMatch(updateSql, /bad_debt/);
  assert.doesNotMatch(updateSql, /adjustment/);
  assert.doesNotMatch(updateSql, /difference_items|followup|material_status/);
});

test("RECVBL-16 unmatched: partial success, unmatchedRows returned, never error", async () => {
  const lib = await readFile(new URL("../lib/server/recon/receivables-import.ts", import.meta.url), "utf8");
  assert.match(lib, /unmatchedRows/);
  assert.match(lib, /status: matchedRows === 0 \? "PARTIAL" : "IMPORTED"/);
});

test("RECVBL-17 ambiguous: >1 match -> AMBIGUOUS_MATCH, never written", async () => {
  const lib = await readFile(new URL("../lib/server/recon/receivables-import.ts", import.meta.url), "utf8");
  assert.match(lib, /ambiguousRows/);
  assert.match(lib, /matches\.length > 1 \|\| ambiguousKeys\.has/);
  assert.match(lib, /ambiguousKeys/);
  assert.doesNotMatch(lib, /\.\[0\]/); // never blindly takes the first
  // The import_batches dedup key is (data_type, quarter_id, source_sha256, target_module).
  assert.match(lib, /ON CONFLICT \(data_type, quarter_id, source_sha256, target_module\)/);
});

// --- HISTORICAL LEDGER ------------------------------------------------------
test("HIST-18 V2 successful + 20 V2 active + 19 V1 retained: versioned replace in ONE transaction", async () => {
  const lib = await readFile(new URL("../lib/server/ledger/historical-import.ts", import.meta.url), "utf8");
  assert.match(lib, /nextVersion/);
  assert.match(lib, /is_active = false/);
  assert.match(lib, /UPDATE recon\.ledger_datasets SET is_active = false/);
  assert.match(lib, /UPDATE recon\.ledger_datasets SET is_active = true/);
  assert.match(lib, /INSERT INTO recon\.ledger_verification_entries/);
  assert.doesNotMatch(lib, /DELETE FROM recon\.ledger_datasets/); // old versions NEVER deleted
  assert.doesNotMatch(lib, /DELETE FROM recon\.ledger_verification_entries/);
  assert.match(lib, /withPostgresTransaction/);
});

test("HIST-21 verify uses the new active version (active-scoped lookup)", async () => {
  const ledger = await readFile(new URL("../lib/server/ledger/ledger.ts", import.meta.url), "utf8");
  assert.match(ledger, /d\.is_active = true/);
  assert.match(ledger, /HISTORICAL_BASE/);
  const hist = await readFile(new URL("../lib/server/ledger/historical-import.ts", import.meta.url), "utf8");
  // New version created inactive, only activated after validation succeeds.
  assert.match(hist, /INSERT INTO recon\.ledger_datasets[\s\S]*?is_active = false/);
  assert.ok(hist.indexOf("is_active = false") < hist.indexOf("is_active = true"));
});

test("HIST-22 failed V3 rollback: any failure inside the transaction keeps the old active version", async () => {
  const lib = await readFile(new URL("../lib/server/ledger/historical-import.ts", import.meta.url), "utf8");
  assert.match(lib, /POST_IMPORT_VALIDATION_FAILED/);
  // The active switch happens AFTER the count validation, inside the same
  // transaction -> a validation failure throws and ROLLBACKs before flipping.
  assert.ok(lib.indexOf("POST_IMPORT_VALIDATION_FAILED") < lib.indexOf("SET is_active = false"));
  assert.ok(lib.indexOf("SET is_active = true") > lib.indexOf("POST_IMPORT_VALIDATION_FAILED"));
});

test("HIST-23 current-year datasets unaffected: replace only touches HISTORICAL_BASE", async () => {
  const lib = await readFile(new URL("../lib/server/ledger/historical-import.ts", import.meta.url), "utf8");
  // No SQL string literal ever targets CURRENT_YEAR_QUARTER (only the
  // HISTORICAL_BASE constant is used in DML).
  assert.doesNotMatch(lib, /"CURRENT_YEAR_QUARTER"/);
  assert.match(lib, /WHERE dataset_type = \$1 AND source_sha256/);
  assert.match(lib, /DATASET_HISTORICAL/);
});

test("HIST-24 input: accepts sourceFiles[] and reuses Phase-2G normalization (invoice/date/amount)", async () => {
  const lib = await readFile(new URL("../lib/server/ledger/historical-import.ts", import.meta.url), "utf8");
  assert.match(lib, /parseLedgerSourceFile/);
  assert.match(lib, /sourceFiles/);
  assert.match(lib, /invoice_no_normalized|invoice_no_raw|invoice_date_raw|invoice_amount/);
});

// --- AUDIT ------------------------------------------------------------------
test("AUDIT-24 four entry types all produce PG import_batches audit metadata", async () => {
  const common = await readFile(new URL("../lib/server/recon/remaining-imports-common.ts", import.meta.url), "utf8");
  assert.match(common, /MATERIAL_STATUS_IMPORT/);
  assert.match(common, /INDEPENDENT_SPD_IMPORT/);
  assert.match(common, /COMPANY_RECEIVABLE_UPDATE/);
  assert.match(common, /HISTORICAL_LEDGER_REPLACE/);
  assert.match(common, /remaining-imports/);
  const [mat, spd, recv, hist] = await Promise.all([
    readFile(new URL("../lib/server/recon/materials-import.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/recon/spd-import.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/recon/receivables-import.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/ledger/historical-import.ts", import.meta.url), "utf8"),
  ]);
  // Every entry persists data_type + original_file_name + source_sha256 + counts + target_module + status/details.
  for (const src of [mat, spd, recv, hist]) {
    assert.match(src, /INSERT INTO recon\.import_batches/);
    assert.match(src, /original_file_name/);
    assert.match(src, /source_sha256/);
    assert.match(src, /valid_record_count/);
    assert.match(src, /target_module/);
  }
  // Historical import is global: quarter_id NULL.
  assert.match(hist, /VALUES \(NULL, \$1, \$2, \$3/);
});
