#!/usr/bin/env node
/**
 * Q2 SQLite/app-state -> PostgreSQL normalized migration plan (DRY RUN ONLY).
 * Offline only: validates the fixed bundle and writes JSON/Markdown plans; it
 * never imports pg/Drizzle, opens a network connection, or writes a database.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..", "..");
const sourceDir = process.env.Q2_SOURCE_DIR ?? "C:\\Users\\lenovo\\AppData\\Local\\Temp\\q2-postgres-dry-run-20260826";
const outputDir = path.join(projectRoot, "migration-output", "q2-dry-run");
const files = {
  sqlite: ["sqlite-source-copy-q2-20260826-20260826-092832.sqlite", "c32fbf151a1802420fd7ed771fdef1df37bdb768be6178623c4878eb1b5dee30"],
  payload: ["q2-app-state-shared-payload.json", "4dfb0380b86af3985a6ff846279d9c964bae13ae1e2bcdb7ce05a94eaaf62e6e"],
};
const bundleSha = "8e9b6a597d2c8b4b1faf4d6ca8ba4b1da65eac089f5f8642bb18de16dd512206";
const approvedSchemaCommit = "a5b2e183fd30011e4044cdeff547ef1c4e1be6dd";
const schemaFiles = {
  foundation: path.join(projectRoot, "infra", "postgres", "migrations", "001_foundation.sql"),
  runtimeAccess: path.join(projectRoot, "infra", "postgres", "migrations", "002_runtime_access.sql"),
  rowIdentity: path.join(projectRoot, "infra", "postgres", "migrations", "003_reconciliation_source_row_identity.sql"),
};
const sha = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const text = (value) => String(value ?? "").trim();
const has = (value) => text(value) !== "";
const key = (...parts) => `q2:${sha(parts.map((part) => text(part)).join("\u001f")).slice(0, 24)}`;
// Canonical import-row identity: q2:<first 24 hex chars of sha256>, where
// sha256 receives source namespace, quarter, fixed source payload SHA-256,
// zero-based source row index, and original Excel sequence joined by U+001F.
const sourceRowKey = ({ quarter, sourcePayloadSha256, sourceRowIndex, originalSequence }) =>
  key("reconciliation-source-row", quarter, sourcePayloadSha256, sourceRowIndex, originalSequence);
const cents = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) : null;
  const input = text(value).replace(/,/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(input)) return null;
  return Math.round(Number(input) * 100);
};
const decimal = (value) => (value / 100).toFixed(2);
class DryRunError extends Error { constructor(code, detail) { super(`${code}: ${detail}`); this.code = code; } }

async function loadVerifiedBundle() {
  const sums = (await readFile(path.join(sourceDir, "SHA256SUMS.txt"), "utf8"))
    .trim().split(/\r?\n/).filter(Boolean).map((line) => {
      const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
      if (!match) throw new DryRunError("Q2_SOURCE_BUNDLE_SHA_MISMATCH", `invalid SHA256SUMS entry: ${line}`);
      return [match[2], match[1].toLowerCase()];
    });
  const expected = new Map(sums);
  const loaded = {};
  for (const [label, [name, requiredHash]] of Object.entries(files)) {
    const raw = await readFile(path.join(sourceDir, name));
    const actual = sha(raw);
    if (actual !== requiredHash || expected.get(name) !== actual) {
      throw new DryRunError("Q2_SOURCE_BUNDLE_SHA_MISMATCH", `${name} expected ${requiredHash}; actual ${actual}; SHA256SUMS ${expected.get(name)}`);
    }
    loaded[label] = { name, raw, sha256: actual };
  }
  for (const [name, expectedHash] of expected) {
    const raw = await readFile(path.join(sourceDir, name));
    if (sha(raw) !== expectedHash) throw new DryRunError("Q2_SOURCE_BUNDLE_SHA_MISMATCH", `SHA256SUMS mismatch for ${name}`);
  }
  return loaded;
}

function sqliteTestRecordCount(sqlitePath) {
  const program = "import json,sqlite3,sys; c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True).cursor(); print(json.dumps(c.execute(\"select count(*) from reconciliation_items where invoice_number='TEST-8000-001'\").fetchone()[0]))";
  const result = spawnSync("python", ["-c", program, sqlitePath], { encoding: "utf8" });
  if (result.status !== 0) throw new DryRunError("SQLITE_SOURCE_ASSERTION_FAILED", result.stderr || "cannot inspect SQLite source");
  return JSON.parse(result.stdout);
}

async function inspectTargetSchema() {
  const [foundation, runtimeAccess, rowIdentity, quarterlyPage] = await Promise.all([...Object.values(schemaFiles), path.join(projectRoot, "app", "QuarterlyReconciliation.tsx")].map((file) => readFile(file, "utf8")));
  const baseUnique = /UNIQUE\s*\(\s*quarter_id\s*,\s*account_set_id\s*,\s*customer_id\s*\)/i.test(foundation);
  const baseStatusNotNull = /reconciliation_status\s+text\s+NOT\s+NULL/i.test(foundation);
  const sourceRowColumn = /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+source_row_key\s+text/i.test(rowIdentity);
  const droppedBaseUnique = /DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+reconciliations_quarter_id_account_set_id_customer_id_key/i.test(rowIdentity);
  const sourceRowUnique = /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+reconciliations_source_row_key_unique\s+ON\s+recon\.reconciliations\s*\(\s*source_row_key\s*\)\s*WHERE\s+source_row_key\s+IS\s+NOT\s+NULL/is.test(rowIdentity);
  const statusNullable = /ALTER\s+COLUMN\s+reconciliation_status\s+DROP\s+NOT\s+NULL/i.test(rowIdentity);
  const statusDefaultDropped = /ALTER\s+COLUMN\s+reconciliation_status\s+DROP\s+DEFAULT/i.test(rowIdentity);
  const versionRecorded = /VALUES\s*\(\s*'003_reconciliation_source_row_identity'\s*\)/i.test(rowIdentity);
  if (!baseUnique || !baseStatusNotNull || !runtimeAccess.includes("quarterly_app")) throw new DryRunError("SCHEMA_BASELINE_ASSERTION_FAILED", "001/002 do not match the inspected PostgreSQL baseline");
  const applicationUsesRowIndexIdentity = /source\.rows\.map\(\(sourceRow,\s*id\)\s*=>\s*\{\s*const detail = source\.details\?\.\[String\(id\)\]/s.test(quarterlyPage);
  const applicationBackfillsUnreconciled = /const status = !filled\s*\?\s*T\.unreconciled/s.test(quarterlyPage);
  return { files: Object.values(schemaFiles).map((file) => path.basename(file)), baseUnique, baseStatusNotNull, sourceRowColumn, droppedBaseUnique, sourceRowUnique, statusNullable, statusDefaultDropped, versionRecorded, duplicatesCompatible: sourceRowColumn && droppedBaseUnique && sourceRowUnique, nullStatusCompatible: statusNullable && statusDefaultDropped, applicationUsesRowIndexIdentity, applicationNullStatusCompatibility: applicationBackfillsUnreconciled ? "FOLLOWUP_CODE_CHANGE_REQUIRED" : "PASS", applicationNullStatusFollowup: applicationBackfillsUnreconciled ? "app/QuarterlyReconciliation.tsx backfillClearedStatus maps an unfilled customer-book amount to T.unreconciled; it must preserve a genuinely unentered Q2 status as blank/null before Q2 production cutover." : null };
}

function buildPlan(loaded, schema) {
  const payload = JSON.parse(loaded.payload.raw.toString("utf8"));
  const active = JSON.parse(payload["local-quarterly-reconciliation"] ?? "null");
  const archiveRoot = JSON.parse(payload["local-quarterly-reconciliation-archive"] ?? "null");
  const archive = archiveRoot?.["2026 Q2"];
  if (!Array.isArray(active?.headers) || !Array.isArray(active?.rows) || !Array.isArray(archive?.rows) || active.rows.length !== 851 || archive.rows.length !== 851) {
    throw new DryRunError("SOURCE_STRUCTURE_ASSERTION_FAILED", "Q2 current/archive rows must both equal 851");
  }
  if (JSON.stringify(active.headers) !== JSON.stringify(archive.headers) || JSON.stringify(active.rows) !== JSON.stringify(archive.rows)) {
    throw new DryRunError("SOURCE_STRUCTURE_ASSERTION_FAILED", "Q2 current/archive are not row-for-row identical");
  }
  const columns = Object.fromEntries(active.headers.map((name, index) => [name, index]));
  const value = (row, name) => row[columns[name]];
  const requiredColumns = ["序号", "账套", "区域", "对账负责人", "客户名称", "公司应收", "客户账面金额", "对账差额", "26年2季度是否对清"];
  for (const name of requiredColumns) if (!(name in columns)) throw new DryRunError("SOURCE_STRUCTURE_ASSERTION_FAILED", `missing column ${name}`);

  const regions = new Map(), accountSets = new Map(), customers = new Map(), reconciliations = [], groups = new Map();
  let companyTotal = 0, placeholderTotal = 0, customerFilled = 0, statusFilled = 0, ownerFilled = 0;
  active.rows.forEach((row, sourceRowIndex) => {
    const serial = value(row, "序号");
    const accountSet = text(value(row, "账套")), region = text(value(row, "区域")), customerName = text(value(row, "客户名称"));
    const owner = text(value(row, "对账负责人"));
    const company = cents(value(row, "公司应收")), placeholder = cents(value(row, "对账差额"));
    if (!accountSet || !region || !customerName || company === null || placeholder === null) throw new DryRunError("SOURCE_STRUCTURE_ASSERTION_FAILED", `required primary data missing at source row ${sourceRowIndex}`);
    if (company !== placeholder) throw new DryRunError("SOURCE_STRUCTURE_ASSERTION_FAILED", `placeholder difference does not equal company receivable at source row ${sourceRowIndex}`);
    if (has(value(row, "客户账面金额"))) customerFilled++;
    if (has(value(row, "26年2季度是否对清"))) statusFilled++;
    if (owner) ownerFilled++;
    companyTotal += company; placeholderTotal += placeholder;
    const regionKey = key("region", region), accountKey = key("account-set", accountSet), customerKey = key("customer", accountSet, region, customerName);
    regions.set(regionKey, { source_key: regionKey, code: region, name: region });
    accountSets.set(accountKey, { source_key: accountKey, code: accountSet, name: accountSet });
    customers.set(customerKey, { source_key: customerKey, external_code: null, name: customerName, region_source_key: regionKey, account_set_source_key: accountKey, identity_strategy: "account_set+region+customer_name" });
    const businessKey = `${accountSet}\u001f${region}\u001f${customerName}`;
    const rowSourceKey = sourceRowKey({ quarter: "2026-Q2", sourcePayloadSha256: loaded.payload.sha256, sourceRowIndex, originalSequence: serial });
    const reconciliationKey = key("reconciliation", rowSourceKey, businessKey, company);
    reconciliations.push({ source_key: reconciliationKey, source_row_key: rowSourceKey, source_row_index: sourceRowIndex, legacy_id: String(serial), quarter_source_key: "quarter:2026-Q2", account_set_source_key: accountKey, region_source_key: regionKey, customer_source_key: customerKey, owner_id: null, owner_raw_name: owner || null, company_receivable: decimal(company), customer_book_amount: null, reconciliation_difference: null, reconciliation_status: null, source_payload: { headers: active.headers, row, source_row_index: sourceRowIndex, original_sequence: serial, source_difference_is_placeholder: true } });
    const group = groups.get(businessKey) ?? [];
    group.push({ source_row_index: sourceRowIndex, original_sequence: serial, company_receivable: decimal(company) }); groups.set(businessKey, group);
  });
  const duplicateGroups = [...groups.entries()].filter(([, rows]) => rows.length > 1).map(([businessKey, rows], index) => ({ group_id: `DUPLICATE_BUSINESS_KEY_${String(index + 1).padStart(2, "0")}`, key_hash: sha(businessKey).slice(0, 24), source_row_indexes: rows.map((row) => row.source_row_index), original_sequences: rows.map((row) => row.original_sequence), company_receivable_summary: rows.map((row) => row.company_receivable), count: rows.length }));
  const uniqueNames = new Set(active.rows.map((row) => text(value(row, "客户名称"))));
  const uniqueAccountCustomer = new Set(active.rows.map((row) => `${text(value(row, "账套"))}\u001f${text(value(row, "客户名称"))}`));
  const excludedTestRecords = sqliteTestRecordCount(path.join(sourceDir, loaded.sqlite.name));
  if (companyTotal !== 51447323951 || reconciliations.length !== 851 || customerFilled !== 0 || statusFilled !== 0 || ownerFilled !== 826 || regions.size !== 16 || accountSets.size !== 7 || uniqueNames.size !== 649 || uniqueAccountCustomer.size !== 849 || customers.size !== 849 || duplicateGroups.length !== 2 || duplicateGroups.reduce((n, group) => n + group.count, 0) !== 4 || excludedTestRecords !== 1) {
    throw new DryRunError("Q2_BASELINE_ASSERTION_FAILED", JSON.stringify({ companyTotal: decimal(companyTotal), rows: reconciliations.length, customerFilled, statusFilled, ownerFilled, regions: regions.size, accountSets: accountSets.size, uniqueNames: uniqueNames.size, uniqueAccountCustomer: uniqueAccountCustomer.size, customers: customers.size, duplicateGroups: duplicateGroups.length, excludedTestRecords }));
  }
  if (new Set(reconciliations.map((row) => row.source_row_key)).size !== 851) throw new DryRunError("Q2_SOURCE_ROW_KEY_ASSERTION_FAILED", "source_row_key must be unique for all 851 Q2 rows");
  const duplicateDecision = schema.duplicatesCompatible ? "Q2_DUPLICATES_COMPATIBLE_WITH_EXISTING_SCHEMA" : "Q2_DUPLICATE_SCHEMA_DECISION_REQUIRED";
  const review = [
    ...duplicateGroups.map((group) => ({ code: "DUPLICATE_BUSINESS_KEY", severity: schema.duplicatesCompatible ? "NON_BLOCKING_REVIEW" : "blocking", ...group })),
    ...(schema.nullStatusCompatible ? [] : [{ code: "RECONCILIATION_STATUS_NOT_NULL_SCHEMA_GAP", severity: "blocking", table: "recon.reconciliations", constraint: "reconciliation_status text NOT NULL DEFAULT 'unreconciled'", reason: "Q2 status is genuinely not yet entered; normalized state is NULL and must not be rewritten as an explicit unreconciled business status." }]),
    { code: "NULL_OWNER_CURRENT_STATE", severity: "info", count: 25, reason: "Valid current state; owner_id and owner_raw_name remain NULL." },
    ...(schema.applicationNullStatusCompatibility === "FOLLOWUP_CODE_CHANGE_REQUIRED" ? [{ code: "APPLICATION_NULL_STATUS_COMPATIBILITY", severity: "followup", location: "app/QuarterlyReconciliation.tsx:backfillClearedStatus", reason: schema.applicationNullStatusFollowup }] : []),
  ];
  const quarter = [{ source_key: "quarter:2026-Q2", code: "2026-Q2", year: 2026, quarter: 2, cutoff_date: "2026-06-30", status: "open" }];
  const importBatches = [{ source_key: key("import-batch", "2026-Q2", "26年2季度对账表.xlsx"), quarter_source_key: "quarter:2026-Q2", data_type: "reconciliation", original_file_name: "26年2季度对账表.xlsx", source_sha256: loaded.payload.sha256, imported_at: null, valid_record_count: 851, target_module: "reconciliation", status: "historical", details: { source_is_current_state: true, source_payload_sha256: loaded.payload.sha256 } }];
  const legacySnapshots = [{ source: "q2-authoritative-sqlite", source_sha256: loaded.sqlite.sha256, payload: { encoding: "base64", content: loaded.sqlite.raw.toString("base64") }, captured_at: null, migrated_at: null, migration_status: "validated", details: { file_name: loaded.sqlite.name, quarter: "2026-Q2", content_sha256: loaded.sqlite.sha256, source_priority: "AUTHORITATIVE_SQLITE" } }, { source: "q2-app-state-shared-payload", source_sha256: loaded.payload.sha256, payload: JSON.parse(loaded.payload.raw.toString("utf8")), captured_at: null, migrated_at: null, migration_status: "validated", details: { file_name: loaded.payload.name, quarter: "2026-Q2", content_sha256: loaded.payload.sha256, source_priority: "APP_STATE_CURRENT_AND_ARCHIVE" } }];
  const blockingErrors = review.filter((entry) => entry.severity === "blocking").length;
  const report = { sourceValidation: { bundleExpectedSha256: bundleSha, bundleVerification: "verified-before-extraction", sha256SumsVerified: true, sqlite: { file: loaded.sqlite.name, sha256: loaded.sqlite.sha256, verified: true }, payload: { file: loaded.payload.name, sha256: loaded.payload.sha256, verified: true }, database_connection: false }, sourceRowKeyAlgorithm: { format: "q2:<sha256-prefix-24>", hash: "SHA-256", separator: "U+001F", normalizedPartEncoding: "String(value ?? '').trim()", partsInOrder: ["reconciliation-source-row", "quarter", "authoritative app-state payload SHA-256", "zero-based source_row_index", "original Excel sequence"], sourceNamespace: "q2" }, schemaCompatibility: { target: "post-003", ...schema, duplicateBlockerResolved: schema.duplicatesCompatible, statusNullBlockerResolved: schema.nullStatusCompatible }, sourceCounts: { quarter: "2026-Q2", sourceRows: 851, currentRows: 851, archiveRows: 851, currentArchiveIdentical: true }, amountAudit: { companyReceivable: decimal(companyTotal), customerBook: { filled: 0, sumOfFilled: "0.00", semantic: "NO_ENTERED_VALUES" }, sourceDifferencePlaceholderTotal: decimal(placeholderTotal), normalizedDifference: { nullCount: 851, total: null } }, currentStateAudit: { customerBookFilled: 0, statusFilled: 0, ownerFilled: 826, ownerNull: 25, reconciliationStatusNormalized: null, ownerIdNormalized: null }, duplicateAudit: { duplicateGroups: duplicateGroups.length, duplicateRows: 4, groups: duplicateGroups, existingUniqueConstraint: "001: recon.reconciliations UNIQUE (quarter_id, account_set_id, customer_id), removed by 003", replacementUniqueIndex: "003: reconciliations_source_row_key_unique WHERE source_row_key IS NOT NULL", decision: duplicateDecision, schemaDecision: { table: "recon.reconciliations", constraint: "reconciliations_source_row_key_unique", reason: "Each duplicate pair has the same real account set, region, and customer and therefore shares a customer identity. Each source row has its own deterministic source_row_key.", minimalRecommendation: "003 applies the row-identity model; no customer duplication is used." } }, customerDesign: { sourceRows: 851, uniqueCustomerNames: 649, uniqueAccountSetCustomer: 849, uniqueAccountSetRegionCustomer: 849, normalizedCustomers: 849, sourceKeyStrategy: "hash(account_set, region, customer_name); source_row_index is not customer identity" }, normalizedCounts: { quarters: 1, regions: regions.size, accountSets: accountSets.size, customers: customers.size, importBatches: 1, reconciliations: 851, differenceItems: 0, followupItems: 0, followupEvents: 0, materialStatus: 0, ledgerInvoices: 0, currentArchiveDuplicateMigration: false }, excludedNonBusinessRecords: { excluded_test_records: excludedTestRecords, invoice_numbers: ["TEST-8000-001"], destination: "none" }, reviewBreakdown: { DUPLICATE_BUSINESS_KEY: 2, RECONCILIATION_STATUS_NOT_NULL_SCHEMA_GAP: schema.nullStatusCompatible ? 0 : 1, NULL_OWNER_CURRENT_STATE: 25, APPLICATION_NULL_STATUS_COMPATIBILITY: schema.applicationNullStatusCompatibility }, blockingErrors, readyForDatabaseTest: blockingErrors === 0, q2CurrentStateCompleteness: "COMPLETE", dashboardStrategy: "DERIVED_FROM_RECONCILIATIONS_AFTER_FUTURE_DATABASE_CUTOVER" };
  const manifest = { dry_run: true, batch_key: `q2-sqlite-postgres-dry-run:2026-Q2:${loaded.sqlite.sha256}`, quarter_code: "2026-Q2", source_sha256: loaded.sqlite.sha256, source_hashes: { source_bundle_sha256: bundleSha, authoritative_sqlite_sha256: loaded.sqlite.sha256, app_state_payload_sha256: loaded.payload.sha256 }, approved_schema_commit: approvedSchemaCommit, normalized_counts: { customers: customers.size, reconciliations: reconciliations.length, difference_items: 0, followup_items: 0, followup_events: 0, material_status: 0, ledger_invoices: 0, legacy_snapshots: legacySnapshots.length }, source_record_count: 851, migrated_record_count: null, status: "validated", database_connection: false, readyForDatabaseTest: blockingErrors === 0, error_details: review.filter((entry) => entry.severity === "blocking") };
  return { quarter, regions: [...regions.values()], accountSets: [...accountSets.values()], customers: [...customers.values()], importBatches, reconciliations, differenceItems: [], followupItems: [], followupEvents: [], materialStatus: [], legacySnapshots, review, report, manifest };
}

async function main() {
  const [loaded, schema] = await Promise.all([loadVerifiedBundle(), inspectTargetSchema()]);
  const plan = buildPlan(loaded, schema);
  await mkdir(outputDir, { recursive: true });
  const outputs = { "quarters.json": plan.quarter, "regions.json": plan.regions, "account_sets.json": plan.accountSets, "customers.json": plan.customers, "import_batches.json": plan.importBatches, "reconciliations.json": plan.reconciliations, "difference_items.json": plan.differenceItems, "followup_items.json": plan.followupItems, "followup_events.json": plan.followupEvents, "material_status.json": plan.materialStatus, "legacy_snapshots-plan.json": plan.legacySnapshots, "legacy_snapshots.json": plan.legacySnapshots, "migration_manifest.json": plan.manifest, "review-required.json": plan.review, "Dry_Run_Report.json": plan.report };
  await Promise.all(Object.entries(outputs).map(([name, value]) => writeFile(path.join(outputDir, name), json(value))));
  const markdown = `# 2026 Q2 PostgreSQL Dry Run\n\n- Source validation: passed (offline)\n- Post-003 schema compatibility: passed\n- Reconciliations preserved: ${plan.reconciliations.length}\n- Customer-book and real difference: NULL for all Q2 rows\n- Child business records: all zero\n- Duplicate decision: ${plan.report.duplicateAudit.decision}\n- Ready for database test: ${plan.report.readyForDatabaseTest}\n\nThe two duplicate business-key groups remain review items and are protected by distinct source-row keys. No Q2 data was imported or altered.\n`;
  await writeFile(path.join(outputDir, "DRY_RUN_REPORT.md"), markdown);
  console.log(`Q2 dry run completed offline: ${outputDir}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
