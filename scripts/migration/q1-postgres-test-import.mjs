#!/usr/bin/env node
/**
 * Q1 normalized dry-run output -> recon PostgreSQL test importer.
 *
 * This file deliberately does not connect unless --validate-only or --apply is
 * explicitly supplied.  It never parses the original browser backups: the
 * approved migration-output/q1-dry-run normalized records are its only input.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..", "..");
const inputDir = path.join(projectRoot, "migration-output", "q1-dry-run");
const approvedCommit = "7532be1ad2dad9c114708e635238ad0602276628";
const batchKey = "q1-browser-postgres-test-import:2026-Q1:563ad4d865c098085db7ae5c293d052cc286581c0fbca53ad9030a08b01c5e55";
const exitCode = { input: 2, schema: 3, alreadyApplied: 4, connection: 5, write: 6, validation: 7, unexpected: 8 };
const inputFiles = ["quarters", "regions", "account_sets", "customers", "import_batches", "reconciliations", "difference_items", "followup_items", "followup_events", "material_status", "legacy_snapshots-plan"];
const expectedDifference = {
  transit: [594, "22359796.64"], returned_invoice: [21, "746094.12"], lost_invoice: [14, "246295.74"],
  equipment: [45, "7999218.00"], other_with_invoice: [16, "-1160300.45"], other_without_invoice: [166, "15428899.32"],
};

class ImporterError extends Error {
  constructor(code, message, codeValue) { super(`${code}: ${message}`); this.code = code; this.exitCode = codeValue; }
}

const required = (condition, code, message, codeValue = exitCode.input) => {
  if (!condition) throw new ImporterError(code, message, codeValue);
};
const asJson = (value) => JSON.stringify(value ?? {});
const decimal = (value, field) => {
  if (value === null || value === undefined) return null;
  required(typeof value === "string" && /^-?\d+\.\d{2}$/.test(value), "UNAPPROVED_DRY_RUN_INPUT", `${field} must be a decimal string`);
  return value;
};
const dateOrNull = (value, field) => {
  if (value === null || value === undefined || value === "") return null;
  required(/^\d{4}-\d{2}-\d{2}$/.test(value), "UNAPPROVED_DRY_RUN_INPUT", `${field} must be YYYY-MM-DD or null`);
  return value;
};
const amountSum = (rows) => rows.reduce((sum, row) => sum + BigInt(decimal(row, "amount").replace(".", "")), 0n);
const centsToDecimal = (cents) => `${cents < 0n ? "-" : ""}${(cents < 0n ? -cents : cents) / 100n}.${String((cents < 0n ? -cents : cents) % 100n).padStart(2, "0")}`;

function usage() {
  console.log("Usage: node scripts/migration/q1-postgres-test-import.mjs --validate-only | --apply");
  console.log("--validate-only connects only to inspect recon schema and conflicts; it never writes.");
  console.log("--apply performs one transaction and rolls back on every blocking error.");
}

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return "help";
  required(argv.length === 1 && ["--validate-only", "--apply"].includes(argv[0]), "INVALID_ARGUMENT", "choose exactly one of --validate-only or --apply", exitCode.unexpected);
  return argv[0];
}

async function loadInputs() {
  const files = Object.fromEntries(await Promise.all(inputFiles.map(async (name) => [name, JSON.parse(await readFile(path.join(inputDir, `${name}.json`), "utf8"))])));
  const [manifest, report] = await Promise.all(["migration_manifest.json", "Dry_Run_Report.json"].map(async (name) => JSON.parse(await readFile(path.join(inputDir, name), "utf8"))));
  return { ...files, manifest, report };
}

function validateApprovedInput(data) {
  const { manifest, report } = data;
  required(manifest.dry_run === true && report.dry_run === true, "UNAPPROVED_DRY_RUN_INPUT", "dry_run must be true");
  required(manifest.database_connection === false && report.database_connection === false, "UNAPPROVED_DRY_RUN_INPUT", "database_connection must be false");
  required(manifest.readyForDatabaseTest === true && report.readyForDatabaseTest === true, "UNAPPROVED_DRY_RUN_INPUT", "readyForDatabaseTest must be true");
  const checks = [[data.reconciliations.length, 752, "rows/reconciliations"], [data.difference_items.length, 856, "difference_items"], [data.followup_items.length, 109, "followup_items"], [data.followup_events.length, 37, "followup_events"], [data.material_status.length, 5527, "material_status"]];
  for (const [actual, expected, name] of checks) required(actual === expected, "UNAPPROVED_DRY_RUN_INPUT", `${name} expected ${expected}, got ${actual}`);
  required(report.summary?.blockingErrors === 0, "UNAPPROVED_DRY_RUN_INPUT", "blocking errors must be 0");
  required(report.summary?.companyReceivable === "510901013.72" && report.summary?.customerBook === "431217494.61", "UNAPPROVED_DRY_RUN_INPUT", "approved amount baseline mismatch");
  required(report.followupAudit?.generatedFollowUpEventCount === 37 && report.materialAudit?.generatedMaterialStatusCount === 5527, "UNAPPROVED_DRY_RUN_INPUT", "approved follow-up/material baseline mismatch");
  required(data.quarters.length === 1 && data.quarters[0].code === "2026-Q1", "UNAPPROVED_DRY_RUN_INPUT", "only 2026-Q1 is permitted");

  const reconciliationKeys = new Set(data.reconciliations.map((row) => row.source_key));
  const followupKeys = new Set(data.followup_items.map((row) => row.source_key));
  for (const row of data.reconciliations) ["company_receivable", "customer_book_amount", "reconciliation_difference", "bad_debt_amount", "adjustment_amount"].forEach((field) => decimal(row[field], `reconciliations.${field}`));
  for (const row of data.difference_items) {
    required(reconciliationKeys.has(row.reconciliation_source_key), "UNAPPROVED_DRY_RUN_INPUT", "difference reconciliation source key is missing");
    decimal(row.difference_amount, "difference_items.difference_amount"); dateOrNull(row.invoice_date, "difference_items.invoice_date");
    required(row.invoice_id === null, "UNAPPROVED_DRY_RUN_INPUT", "ledger invoice ids are prohibited for Q1 evidence");
    required(["pending", "not_applicable"].includes(row.verification_status), "UNAPPROVED_DRY_RUN_INPUT", "only pending/not_applicable verification is allowed");
  }
  for (const row of data.followup_items) required(reconciliationKeys.has(row.reconciliation_source_key), "UNAPPROVED_DRY_RUN_INPUT", "follow-up reconciliation source key is missing");
  for (const row of data.followup_events) { required(followupKeys.has(row.followup_item_source_key), "UNAPPROVED_DRY_RUN_INPUT", "follow-up event parent is missing"); required(row.event_type === "followup", "UNAPPROVED_DRY_RUN_INPUT", "legacy_state events are prohibited"); required(dateOrNull(row.occurred_at, "followup_events.occurred_at"), "UNAPPROVED_DRY_RUN_INPUT", "follow-up events require historical occurred_at"); }
  for (const row of data.material_status) required(row.quarter_source_key === "quarter:2026-q1", "UNAPPROVED_DRY_RUN_INPUT", "material is outside Q1 scope");
}

function validateLocalTotals(data) {
  const reconciliation = data.reconciliations;
  const company = centsToDecimal(amountSum(reconciliation.map((row) => row.company_receivable ?? "0.00")));
  const customer = centsToDecimal(amountSum(reconciliation.map((row) => row.customer_book_amount ?? "0.00")));
  required(company === "510901013.72" && customer === "431217494.61", "UNAPPROVED_DRY_RUN_INPUT", "normalized reconciliation sums do not match approval");
  for (const [status, expected] of Object.entries({ "已对清": 726, "未对账": 22, "未对清": 4 })) required(reconciliation.filter((row) => row.reconciliation_status === status).length === expected, "UNAPPROVED_DRY_RUN_INPUT", `status ${status} baseline mismatch`);
  for (const [category, [count, amount]] of Object.entries(expectedDifference)) {
    const rows = data.difference_items.filter((row) => row.category === category);
    required(rows.length === count && centsToDecimal(amountSum(rows.map((row) => row.difference_amount ?? "0.00"))) === amount, "UNAPPROVED_DRY_RUN_INPUT", `difference baseline mismatch for ${category}`);
  }
  required(data.followup_items.filter((row) => row.follow_status === "pending").length === 54 && data.followup_items.filter((row) => row.follow_status === "closed").length === 55, "UNAPPROVED_DRY_RUN_INPUT", "follow-up status baseline mismatch");
}

async function connect() {
  required(process.env.DATABASE_URL, "DATABASE_URL_REQUIRED", "DATABASE_URL is required only for a database mode", exitCode.connection);
  try {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    return client;
  } catch (error) { throw new ImporterError("DATABASE_CONNECTION_FAILED", error.message, exitCode.connection); }
}

async function verifySchema(client) {
  const requiredColumns = {
    quarters: ["id", "code", "year", "quarter", "cutoff_date", "status"], regions: ["id", "code", "name"], account_sets: ["id", "code", "name"],
    customers: ["id", "external_code", "name", "region_id"], import_batches: ["id", "quarter_id", "data_type", "details", "status"],
    reconciliations: ["id", "legacy_id", "quarter_id", "account_set_id", "customer_id", "owner_id", "company_receivable", "customer_book_amount", "reconciliation_difference", "reconciliation_status", "source_payload"],
    difference_items: ["reconciliation_id", "category", "invoice_id", "invoice_no", "invoice_date", "difference_amount", "verification_status", "source_payload"],
    followup_items: ["id", "reconciliation_id", "owner_id", "follow_status"], followup_events: ["followup_item_id", "event_type", "occurred_at", "payload"],
    material_status: ["reconciliation_id", "quarter_id", "account_set_id", "customer_id", "material_type", "provided", "source_batch_id"],
    legacy_snapshots: ["source", "source_sha256", "payload", "migration_status", "details"], migration_manifests: ["batch_key", "quarter_code", "source_sha256", "source_record_count", "migrated_record_count", "status", "error_details", "completed_at"],
  };
  const requiredTables = Object.keys(requiredColumns);
  const { rows } = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'recon' AND table_name = ANY($1::text[])", [requiredTables]);
  required(rows.length === requiredTables.length, "TARGET_MAPPING_GAP", "recon target tables do not match 001_foundation.sql", exitCode.schema);
  const columns = await client.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'recon' AND table_name = ANY($1::text[])", [requiredTables]);
  const available = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  for (const [table, names] of Object.entries(requiredColumns)) for (const name of names) required(available.has(`${table}.${name}`), "TARGET_MAPPING_GAP", `recon.${table}.${name} required by importer is absent`, exitCode.schema);
  const foundation = await client.query("SELECT 1 FROM recon.schema_migrations WHERE version = '001_foundation'");
  required(foundation.rowCount === 1, "TARGET_MAPPING_GAP", "001_foundation is not applied", exitCode.schema);
}

async function ensureNotApplied(client) {
  const result = await client.query("SELECT id FROM recon.migration_manifests WHERE batch_key = $1", [batchKey]);
  if (result.rowCount) throw new ImporterError("MIGRATION_ALREADY_APPLIED", `migration id ${batchKey}`, exitCode.alreadyApplied);
}

async function insertOne(client, text, values) { return client.query(text, values); }

async function applyImport(client, data) {
  const ids = { quarters: new Map(), regions: new Map(), accountSets: new Map(), customers: new Map(), batches: new Map(), reconciliations: new Map(), followups: new Map() };
  const quarter = data.quarters[0];
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [batchKey]);
    await ensureNotApplied(client);
    for (const row of data.quarters) { const r = await insertOne(client, "INSERT INTO recon.quarters (code, year, quarter, cutoff_date, status) VALUES ($1,$2,$3,$4,$5) RETURNING id", [row.code, row.year, row.quarter, dateOrNull(row.cutoff_date, "quarter.cutoff_date"), row.status]); ids.quarters.set(row.source_key, r.rows[0].id); }
    for (const row of data.regions) { const r = await insertOne(client, "INSERT INTO recon.regions (code, name) VALUES ($1,$2) RETURNING id", [row.code, row.name]); ids.regions.set(row.source_key, r.rows[0].id); }
    for (const row of data.account_sets) { const r = await insertOne(client, "INSERT INTO recon.account_sets (code, name) VALUES ($1,$2) RETURNING id", [row.code, row.name]); ids.accountSets.set(row.source_key, r.rows[0].id); }
    for (const row of data.customers) { const r = await insertOne(client, "INSERT INTO recon.customers (external_code, name, region_id) VALUES ($1,$2,$3) RETURNING id", [row.external_code, row.name, ids.regions.get(row.region_source_key) ?? null]); ids.customers.set(row.source_key, r.rows[0].id); }
    for (const row of data.import_batches) { const r = await insertOne(client, "INSERT INTO recon.import_batches (quarter_id,data_type,original_file_name,source_sha256,storage_key,imported_at,imported_by,valid_record_count,inserted_count,updated_count,skipped_count,error_count,target_module,status,details) VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10,$11,$12,$13,$14::jsonb) RETURNING id", [ids.quarters.get(row.quarter_source_key), row.data_type, row.original_file_name, row.source_sha256, row.storage_key, dateOrNull(row.imported_at, "import_batch.imported_at"), row.valid_record_count, row.inserted_count, row.updated_count, row.skipped_count, row.error_count, row.target_module, row.status, asJson({ ...row.details, source_key: row.source_key, migration_id: batchKey })]); ids.batches.set(row.source_key, r.rows[0].id); }
    for (const row of data.reconciliations) { const r = await insertOne(client, "INSERT INTO recon.reconciliations (legacy_id,quarter_id,account_set_id,customer_id,owner_id,company_receivable,customer_book_amount,reconciliation_difference,reconciliation_status,solution_date,solution,bad_debt_amount,bad_debt_reason,adjustment_amount,adjustment_reason,financial_attention,process_stage,source_payload) VALUES ($1,$2,$3,$4,NULL,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb) RETURNING id", [row.legacy_id, ids.quarters.get(row.quarter_source_key), ids.accountSets.get(row.account_set_source_key), ids.customers.get(row.customer_source_key), decimal(row.company_receivable, "company_receivable"), decimal(row.customer_book_amount, "customer_book_amount"), decimal(row.reconciliation_difference, "reconciliation_difference"), row.reconciliation_status, dateOrNull(row.solution_date, "solution_date"), row.solution, decimal(row.bad_debt_amount, "bad_debt_amount"), row.bad_debt_reason, decimal(row.adjustment_amount, "adjustment_amount"), row.adjustment_reason, row.financial_attention, row.process_stage, asJson({ ...row.source_payload, source_key: row.source_key, owner_raw_name: row.owner_raw_name, responsible_raw_name: row.responsible_raw_name })]); ids.reconciliations.set(row.source_key, r.rows[0].id); }
    for (const row of data.difference_items) await insertOne(client, "INSERT INTO recon.difference_items (reconciliation_id,category,invoice_id,invoice_no,invoice_date,difference_amount,difference_description,attachment_keys,verification_status,verification_message,source_payload) VALUES ($1,$2,NULL,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb)", [ids.reconciliations.get(row.reconciliation_source_key), row.category, row.invoice_no, dateOrNull(row.invoice_date, "invoice_date"), decimal(row.difference_amount, "difference_amount"), row.difference_description, asJson(row.attachment_keys), row.verification_status, row.verification_message, asJson({ ...row.source_payload, source_key: row.source_key, classification: "DIFFERENCE_INVOICE_EVIDENCE" })]);
    for (const row of data.followup_items) { const r = await insertOne(client, "INSERT INTO recon.followup_items (reconciliation_id,owner_id,expected_complete_at,next_follow_up_at,latest_follow_up_at,follow_status,process_stage,risk_level,closed_at) VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8) RETURNING id", [ids.reconciliations.get(row.reconciliation_source_key), dateOrNull(row.expected_complete_at, "expected_complete_at"), row.next_follow_up_at, row.latest_follow_up_at, row.follow_status, row.process_stage, row.risk_level, row.closed_at]); ids.followups.set(row.source_key, r.rows[0].id); }
    for (const row of data.followup_events) await insertOne(client, "INSERT INTO recon.followup_events (followup_item_id,event_type,content,operator_id,occurred_at,payload) VALUES ($1,$2,$3,NULL,$4,$5::jsonb)", [ids.followups.get(row.followup_item_source_key), row.event_type, row.content, dateOrNull(row.occurred_at, "followup_events.occurred_at"), asJson({ ...row.payload, source_key: row.source_key })]);
    for (const row of data.material_status) await insertOne(client, "INSERT INTO recon.material_status (reconciliation_id,quarter_id,account_set_id,customer_id,material_type,provided,raw_value,source_batch_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [ids.reconciliations.get(row.reconciliation_source_key) ?? null, ids.quarters.get(row.quarter_source_key), ids.accountSets.get(row.account_set_source_key) ?? null, ids.customers.get(row.customer_source_key) ?? null, row.material_type, row.provided, row.raw_value, ids.batches.get(row.source_batch_source_key) ?? null]);
    for (const row of data["legacy_snapshots-plan"]) await insertOne(client, "INSERT INTO recon.legacy_snapshots (source,source_sha256,payload,captured_at,migrated_at,migration_status,details) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7::jsonb)", [row.source, row.source_sha256, asJson(row.payload), row.captured_at ?? null, row.migrated_at ?? null, row.migration_status, asJson({ ...row.details, migration_id: batchKey, snapshot_strategy: "one snapshot per approved legacy source; no per-reconciliation full-copy" })]);
    await validateDatabase(client, ids.quarters.get(quarter.source_key));
    await insertOne(client, "INSERT INTO recon.migration_manifests (batch_key,quarter_code,source_sha256,source_record_count,migrated_record_count,status,error_details,completed_at) VALUES ($1,$2,$3,$4,$5,'migrated',$6::jsonb,now())", [batchKey, quarter.code, data.manifest.sources.manifest.sha256, 752, 752, asJson([{ approved_dry_run_commit: approvedCommit, source_hashes: data.manifest.sources, normalized_counts: { reconciliations: 752, difference_items: 856, followup_items: 109, followup_events: 37, material_status: 5527 }, validation: "passed" }])]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}

async function validateDatabase(client, quarterId) {
  const checks = [
    ["reconciliations", "SELECT count(*)::int AS count, coalesce(sum(company_receivable),0)::text AS company, coalesce(sum(customer_book_amount),0)::text AS customer FROM recon.reconciliations WHERE quarter_id=$1", (r) => r.count === 752 && r.company === "510901013.72" && r.customer === "431217494.61"],
    ["statuses", "SELECT reconciliation_status, count(*)::int AS count FROM recon.reconciliations WHERE quarter_id=$1 GROUP BY reconciliation_status", (r) => new Map(r.map((x) => [x.reconciliation_status, x.count])).get("已对清") === 726 && new Map(r.map((x) => [x.reconciliation_status, x.count])).get("未对账") === 22 && new Map(r.map((x) => [x.reconciliation_status, x.count])).get("未对清") === 4],
    ["difference_items", "SELECT category,count(*)::int AS count,coalesce(sum(difference_amount),0)::text AS amount FROM recon.difference_items d JOIN recon.reconciliations r ON r.id=d.reconciliation_id WHERE r.quarter_id=$1 GROUP BY category", (r) => Object.entries(expectedDifference).every(([key,[count,amount]]) => r.some((x) => x.category === key && x.count === count && x.amount === amount))],
    ["followup_items", "SELECT follow_status,count(*)::int AS count FROM recon.followup_items f JOIN recon.reconciliations r ON r.id=f.reconciliation_id WHERE r.quarter_id=$1 GROUP BY follow_status", (r) => r.some((x) => x.follow_status === "pending" && x.count === 54) && r.some((x) => x.follow_status === "closed" && x.count === 55)],
    ["followup_events", "SELECT count(*)::int AS count FROM recon.followup_events e JOIN recon.followup_items f ON f.id=e.followup_item_id JOIN recon.reconciliations r ON r.id=f.reconciliation_id WHERE r.quarter_id=$1", (r) => r.count === 37],
    ["material_status", "SELECT count(*)::int AS count FROM recon.material_status WHERE quarter_id=$1", (r) => r.count === 5527],
  ];
  for (const [name, sql, pass] of checks) { const result = await client.query(sql, [quarterId]); const value = result.rows.length === 1 && Object.hasOwn(result.rows[0], "count") && name !== "statuses" && name !== "difference_items" && name !== "followup_items" ? result.rows[0] : result.rows; required(pass(value), "TEST_MIGRATION_VALIDATION_FAILED", `${name} validation failed`, exitCode.validation); }
}

async function main() {
  const mode = parseArgs(process.argv.slice(2));
  if (mode === "help") return usage();
  const data = await loadInputs();
  validateApprovedInput(data); validateLocalTotals(data);
  console.log(`migration_id=${batchKey}`);
  console.log("normalized baseline: reconciliations=752 difference_items=856 followup_items=109 followup_events=37 material_status=5527");
  const client = await connect();
  try {
    await verifySchema(client);
    await ensureNotApplied(client);
    if (mode === "--validate-only") { console.log("validation_result=VALIDATED_NO_WRITES"); return; }
    await applyImport(client, data);
    console.log("validation_result=APPLIED_AND_VALIDATED");
  } finally { await client.end(); }
}

main().catch((error) => { console.error(`error_code=${error.code ?? "UNEXPECTED_BLOCKING_ERROR"}`); console.error(error.message); process.exitCode = error.exitCode ?? exitCode.unexpected; });
