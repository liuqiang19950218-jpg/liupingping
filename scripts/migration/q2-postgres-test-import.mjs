#!/usr/bin/env node
/** Q2 approved normalized bundle -> PostgreSQL test importer. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const inputDir = process.env.Q2_IMPORT_INPUT_DIR ?? path.join(root, "migration-output", "q2-dry-run");
const schemaCommit = "a5b2e183fd30011e4044cdeff547ef1c4e1be6dd";
const source = { bundle: "8e9b6a597d2c8b4b1faf4d6ca8ba4b1da65eac089f5f8642bb18de16dd512206", sqlite: "c32fbf151a1802420fd7ed771fdef1df37bdb768be6178623c4878eb1b5dee30", payload: "4dfb0380b86af3985a6ff846279d9c964bae13ae1e2bcdb7ce05a94eaaf62e6e" };
const batchKey = `q2-sqlite-postgres-test-import:2026-Q2:${source.sqlite}:${source.payload}`;
const code = { input: 2, schema: 3, alreadyApplied: 4, connection: 5, write: 6, validation: 7, unexpected: 8, ambiguous: 9, sourceMismatch: 10 };
const files = ["quarters", "regions", "account_sets", "customers", "import_batches", "reconciliations", "difference_items", "followup_items", "followup_events", "material_status", "legacy_snapshots", "review-required"];
class ImporterError extends Error { constructor(name, message, exitCode = code.input) { super(`${name}: ${message}`); this.name = name; this.exitCode = exitCode; } }
const required = (ok, name, message, exitCode) => { if (!ok) throw new ImporterError(name, message, exitCode); };
const j = (value) => JSON.stringify(value ?? {});
const decimal = (value, field) => { required(value === null || (typeof value === "string" && /^-?\d+\.\d{2}$/.test(value)), "Q2_NORMALIZED_SOURCE_MISMATCH", `${field} must be a decimal string or null`, code.sourceMismatch); return value; };
const cents = (rows, field) => rows.reduce((n, row) => n + BigInt((decimal(row[field], field) ?? "0.00").replace(".", "")), 0n);
const fmt = (n) => `${n < 0n ? "-" : ""}${(n < 0n ? -n : n) / 100n}.${String((n < 0n ? -n : n) % 100n).padStart(2, "0")}`;
const key = (accountSet, region, customer) => `${accountSet}\u001f${region}\u001f${customer}`;

function usage() { console.log("Usage: node scripts/migration/q2-postgres-test-import.mjs --offline-validate-input | --validate-only | --apply"); console.log("--validate-only performs SELECT-only target validation; --apply uses one transaction."); }
function args(argv) { if (argv.includes("--help") || argv.includes("-h")) return "help"; required(argv.length === 1 && ["--offline-validate-input", "--validate-only", "--apply"].includes(argv[0]), "INVALID_ARGUMENT", "choose exactly one mode", code.unexpected); return argv[0]; }
async function load() { const data = Object.fromEntries(await Promise.all(files.map(async (name) => [name.replaceAll("-", "_"), JSON.parse(await readFile(path.join(inputDir, `${name}.json`), "utf8"))]))); const [manifest, report] = await Promise.all(["migration_manifest.json", "Dry_Run_Report.json"].map(async (name) => JSON.parse(await readFile(path.join(inputDir, name), "utf8")))); return { ...data, manifest, report }; }

function validateInput(d) {
  const h = d.manifest.source_hashes;
  required(d.manifest.dry_run === true && d.manifest.readyForDatabaseTest === true && d.report.readyForDatabaseTest === true && d.report.blockingErrors === 0, "Q2_NORMALIZED_SOURCE_MISMATCH", "approved dry-run status is invalid", code.sourceMismatch);
  required(d.manifest.approved_schema_commit === schemaCommit && h?.source_bundle_sha256 === source.bundle && h?.authoritative_sqlite_sha256 === source.sqlite && h?.app_state_payload_sha256 === source.payload, "Q2_NORMALIZED_SOURCE_MISMATCH", "approved source/schema hashes differ", code.sourceMismatch);
  required(d.quarters.length === 1 && d.quarters[0].code === "2026-Q2" && d.regions.length === 16 && d.account_sets.length === 7 && d.customers.length === 849 && d.reconciliations.length === 851, "Q2_NORMALIZED_SOURCE_MISMATCH", "Q2 dimension or reconciliation baseline differs", code.sourceMismatch);
  for (const name of ["difference_items", "followup_items", "followup_events", "material_status"]) required(d[name].length === 0, "Q2_NORMALIZED_DETAIL_COUNT_MISMATCH", `${name} must be empty`, code.sourceMismatch);
  required(d.import_batches.length === 1 && d.import_batches[0].original_file_name === "26年2季度对账表.xlsx" && d.import_batches[0].imported_at === null, "Q2_NORMALIZED_SOURCE_MISMATCH", "Q2 import batch must be singular and historical time null", code.sourceMismatch);
  const rows = d.reconciliations, sourceRows = new Set(rows.map((r) => r.source_row_key));
  required(!sourceRows.has(null) && !sourceRows.has("") && sourceRows.size === 851, "Q2_NORMALIZED_SOURCE_MISMATCH", "851 non-null distinct source_row_key values required", code.sourceMismatch);
  required(fmt(cents(rows, "company_receivable")) === "514473239.51" && rows.every((r) => r.customer_book_amount === null && r.reconciliation_difference === null && r.reconciliation_status === null && r.owner_id === null), "Q2_NORMALIZED_SOURCE_MISMATCH", "Q2 amount/status/owner null policy differs", code.sourceMismatch);
  required(d.report.currentStateAudit?.ownerFilled === 826 && d.report.currentStateAudit?.ownerNull === 25 && d.report.duplicateAudit?.duplicateGroups === 2 && d.report.duplicateAudit?.duplicateRows === 4 && d.report.excludedNonBusinessRecords?.excluded_test_records === 1, "Q2_NORMALIZED_SOURCE_MISMATCH", "Q2 audit baseline differs", code.sourceMismatch);
  required(d.legacy_snapshots.length === 2 && d.legacy_snapshots.every((s) => s.payload && s.source_sha256), "Q2_LEGACY_SNAPSHOT_INPUT_INCOMPLETE", "two self-contained legacy snapshots required", code.sourceMismatch);
  const sqlite = d.legacy_snapshots.find((s) => s.source === "q2-authoritative-sqlite");
  required(sqlite?.payload?.encoding === "base64" && createHash("sha256").update(Buffer.from(sqlite.payload.content, "base64")).digest("hex") === source.sqlite, "Q2_LEGACY_SNAPSHOT_INPUT_INCOMPLETE", "SQLite snapshot content/hash mismatch", code.sourceMismatch);
  const duplicateReviews = d.review_required.filter((r) => r.code === "DUPLICATE_BUSINESS_KEY");
  required(duplicateReviews.length === 2 && duplicateReviews.every((r) => r.severity === "NON_BLOCKING_REVIEW"), "Q2_NORMALIZED_SOURCE_MISMATCH", "duplicate reviews must remain non-blocking", code.sourceMismatch);
  // Q2 customers are quarter-independent: deterministic source keys must be
  // distinct and collision-free; mappings distinct by account_set+region+customer_name.
  const acctName = new Map(d.account_sets.map((a) => [a.source_key, a.name]));
  const regionName = new Map(d.regions.map((r) => [r.source_key, r.name]));
  required(new Set(d.customers.map((c) => c.source_key)).size === d.customers.length, "Q2_NORMALIZED_SOURCE_MISMATCH", "Q2 customer source keys must be distinct", code.sourceMismatch);
  required(new Set(d.customers.map((c) => key(acctName.get(c.account_set_source_key), regionName.get(c.region_source_key), c.name))).size === d.customers.length, "Q2_NORMALIZED_SOURCE_MISMATCH", "Q2 customer mappings must be distinct by account_set+region+customer_name", code.sourceMismatch);
  // Customers table UNIQUE(external_code, name): with external_code NULL,
  // PostgreSQL treats NULLs as distinct so duplicate names cannot block the insert.
  // If a future bundle ever sets external_code, verify (external_code, name) is unique.
  const nonNullExternal = d.customers.filter((c) => c.external_code !== null && c.external_code !== undefined);
  required(nonNullExternal.every((c) => !d.customers.some((o) => o !== c && o.external_code === c.external_code && o.name === c.name)), "Q2_CUSTOMER_INSERT_CONSTRAINT_BLOCKER", "non-null external_code + name pairs must be unique", code.sourceMismatch);
}

async function connect() { required(process.env.DATABASE_URL, "DATABASE_URL_REQUIRED", "required only for --validate-only or --apply", code.connection); try { const { Client } = await import("pg"); const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect(); return client; } catch (e) { throw new ImporterError("DATABASE_CONNECTION_FAILED", e.message, code.connection); } }
async function q(client, text, values = []) { return client.query(text, values); }
async function verifySchema(client) {
  const migration = await q(client, "SELECT 1 FROM recon.schema_migrations WHERE version='003_reconciliation_source_row_identity'");
  const columns = await q(client, "SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='recon' AND table_name='reconciliations' AND column_name = ANY($1::text[])", [["source_row_key", "reconciliation_status"]]);
  const by = new Map(columns.rows.map((r) => [r.column_name, r]));
  const old = await q(client, "SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='recon' AND t.relname='reconciliations' AND c.contype='u' AND pg_get_constraintdef(c.oid) ~* 'UNIQUE \\(quarter_id, account_set_id, customer_id\\)'");
  const index = await q(client, "SELECT indexdef FROM pg_indexes WHERE schemaname='recon' AND indexname='reconciliations_source_row_key_unique'");
  required(migration.rowCount === 1 && by.get("source_row_key")?.data_type === "text" && by.get("source_row_key")?.is_nullable === "YES" && by.get("reconciliation_status")?.is_nullable === "YES" && by.get("reconciliation_status")?.column_default === null && old.rowCount === 0 && index.rowCount === 1 && /UNIQUE.*\(source_row_key\).*WHERE.*source_row_key IS NOT NULL/i.test(index.rows[0].indexdef), "Q2_REQUIRED_SCHEMA_003_MISSING_OR_INCOMPATIBLE", "003 schema contract is absent or incompatible", code.schema);
}
async function q1Baseline(client) {
  const checks = await Promise.all([
    q(client, "SELECT count(*)::int count,coalesce(sum(company_receivable),0)::text company,coalesce(sum(customer_book_amount),0)::text customer FROM recon.reconciliations r JOIN recon.quarters q ON q.id=r.quarter_id WHERE q.code='2026-Q1'"),
    q(client, "SELECT reconciliation_status,count(*)::int count FROM recon.reconciliations r JOIN recon.quarters q ON q.id=r.quarter_id WHERE q.code='2026-Q1' GROUP BY reconciliation_status"),
    q(client, "SELECT count(*)::int count FROM recon.difference_items d JOIN recon.reconciliations r ON r.id=d.reconciliation_id JOIN recon.quarters q ON q.id=r.quarter_id WHERE q.code='2026-Q1'"),
    q(client, "SELECT count(*)::int count FROM recon.followup_items f JOIN recon.reconciliations r ON r.id=f.reconciliation_id JOIN recon.quarters q ON q.id=r.quarter_id WHERE q.code='2026-Q1'"),
    q(client, "SELECT count(*)::int count FROM recon.followup_events e JOIN recon.followup_items f ON f.id=e.followup_item_id JOIN recon.reconciliations r ON r.id=f.reconciliation_id JOIN recon.quarters q ON q.id=r.quarter_id WHERE q.code='2026-Q1'"),
    q(client, "SELECT count(*)::int count FROM recon.material_status m JOIN recon.quarters q ON q.id=m.quarter_id WHERE q.code='2026-Q1'"),
    q(client, "SELECT count(*)::int count FROM recon.migration_manifests WHERE quarter_code='2026-Q1'")
  ]);
  const [r,statuses,d,f,e,m,manifest] = checks.map((x) => x.rows);
  const status = new Map(statuses.map((x) => [x.reconciliation_status, x.count]));
  required(r[0].count === 752 && r[0].company === "510901013.72" && r[0].customer === "431217494.61" && status.get("已对清") === 726 && status.get("未对账") === 22 && status.get("未对清") === 4 && d[0].count === 856 && f[0].count === 109 && e[0].count === 37 && m[0].count === 5527 && manifest[0].count === 1, "Q1_PROTECTION_BASELINE_MISMATCH", "target Q1 baseline differs from approved test state", code.validation);
}
async function ensureNotApplied(client) { const r = await q(client, "SELECT 1 FROM recon.migration_manifests WHERE batch_key=$1", [batchKey]); if (r.rowCount) throw new ImporterError("MIGRATION_ALREADY_APPLIED", batchKey, code.alreadyApplied); }
async function resolveDimensions(client, d) {
  // Q2 is quarter-independent. Only exact-name dictionary reuse is allowed for
  // regions and account_sets (no alias guessing). Customer mappings are resolved
  // within this quarter only and never look into Q1 reconciliation history.
  const [regions, accounts] = await Promise.all([
    q(client, "SELECT id,code,name FROM recon.regions"),
    q(client, "SELECT id,code,name FROM recon.account_sets"),
  ]);
  const exact = (rows, row, label) => { const found = rows.filter((x) => x.code === row.code && x.name === row.name); required(found.length <= 1, "Q2_DIMENSION_RESOLUTION_AMBIGUOUS", `${label} has multiple exact matches`, code.ambiguous); return found[0]?.id ?? null; };
  const regionIds = new Map(d.regions.map((r) => [r.source_key, exact(regions.rows, r, "region")]));
  const accountIds = new Map(d.account_sets.map((r) => [r.source_key, exact(accounts.rows, r, "account set")]));
  // Every approved Q2 customer mapping resolves to its own new customer for this
  // quarter. No REUSE_EXISTING_CUSTOMER, no cross-quarter identity inference.
  const customers = new Map(d.customers.map((row) => [row.source_key, { id: null, action: "CREATE_INDEPENDENT_CUSTOMER" }]));
  return {
    regionIds, accountIds, customers,
    summary: {
      normalized_region_mappings: d.regions.length,
      existing_regions_reused: [...regionIds.values()].filter(Boolean).length,
      new_regions_to_insert: [...regionIds.values()].filter((x) => !x).length,
      normalized_account_set_mappings: d.account_sets.length,
      existing_account_sets_reused: [...accountIds.values()].filter(Boolean).length,
      new_account_sets_to_insert: [...accountIds.values()].filter((x) => !x).length,
      normalized_customer_mappings: d.customers.length,
      customer_mappings_independently_resolved: d.customers.length,
      cross_quarter_customer_reuse: "DISABLED",
      cross_quarter_customer_inference: "DISABLED",
    },
  };
}
async function targetQ2State(client) { const row = await q(client, "SELECT q.id,(SELECT count(*)::int FROM recon.reconciliations r WHERE r.quarter_id=q.id) reconciliations FROM recon.quarters q WHERE q.code='2026-Q2'"); required(row.rowCount <= 1 && (!row.rowCount || row.rows[0].reconciliations === 0), "Q2_PARTIAL_EXISTING_DATA_CONFLICT", "2026-Q2 already contains reconciliations without this manifest", code.validation); return row.rows[0]?.id ?? null; }
async function validateOnly(client, d) { await verifySchema(client); await ensureNotApplied(client); await q1Baseline(client); await targetQ2State(client); const resolution = await resolveDimensions(client, d); console.log(JSON.stringify({ status: "VALIDATED_NO_WRITES", batch_key: batchKey, dimension_resolution: resolution.summary }, null, 2)); }
async function apply(client, d) {
  await q(client, "BEGIN");
  try {
    await q(client, "SELECT pg_advisory_xact_lock(hashtext($1))", [batchKey]); await verifySchema(client); await ensureNotApplied(client); await q1Baseline(client); const ledgerBefore = (await q(client, "SELECT count(*)::int count FROM recon.ledger_invoices")).rows[0].count;
    let quarterId = await targetQ2State(client); const resolution = await resolveDimensions(client, d);
    if (!quarterId) quarterId = (await q(client, "INSERT INTO recon.quarters (code,year,quarter,cutoff_date,status) VALUES ('2026-Q2',2026,2,'2026-06-30','open') RETURNING id")).rows[0].id;
    for (const row of d.regions) if (!resolution.regionIds.get(row.source_key)) resolution.regionIds.set(row.source_key, (await q(client, "INSERT INTO recon.regions (code,name) VALUES ($1,$2) RETURNING id", [row.code,row.name])).rows[0].id);
    for (const row of d.account_sets) if (!resolution.accountIds.get(row.source_key)) resolution.accountIds.set(row.source_key, (await q(client, "INSERT INTO recon.account_sets (code,name) VALUES ($1,$2) RETURNING id", [row.code,row.name])).rows[0].id);
    for (const row of d.customers) { const item = resolution.customers.get(row.source_key); if (!item.id) item.id = (await q(client, "INSERT INTO recon.customers (external_code,name,region_id) VALUES (NULL,$1,$2) RETURNING id", [row.name,resolution.regionIds.get(row.region_source_key)])).rows[0].id; }
    const batch = d.import_batches[0]; const batchId = (await q(client, "INSERT INTO recon.import_batches (quarter_id,data_type,original_file_name,source_sha256,imported_at,valid_record_count,target_module,status,details) VALUES ($1,$2,$3,$4,NULL,$5,$6,$7,$8::jsonb) RETURNING id", [quarterId,batch.data_type,batch.original_file_name,batch.source_sha256,batch.valid_record_count,batch.target_module,batch.status,j({...batch.details,migration_id:batchKey})])).rows[0].id;
    for (const row of d.reconciliations) await q(client, "INSERT INTO recon.reconciliations (legacy_id,quarter_id,account_set_id,customer_id,owner_id,company_receivable,customer_book_amount,reconciliation_difference,reconciliation_status,source_row_key,source_payload) VALUES ($1,$2,$3,$4,NULL,$5,NULL,NULL,NULL,$6,$7::jsonb)", [row.legacy_id,quarterId,resolution.accountIds.get(row.account_set_source_key),resolution.customers.get(row.customer_source_key).id,decimal(row.company_receivable,"company_receivable"),row.source_row_key,j({...row.source_payload,source_key:row.source_key,owner_raw_name:row.owner_raw_name,source_row_key:row.source_row_key})]);
    for (const snapshot of d.legacy_snapshots) await q(client, "INSERT INTO recon.legacy_snapshots (source,source_sha256,payload,captured_at,migration_status,details) VALUES ($1,$2,$3::jsonb,$4,$5,$6::jsonb)", [snapshot.source,snapshot.source_sha256,j(snapshot.payload),snapshot.captured_at,snapshot.migration_status,j({...snapshot.details,migration_id:batchKey})]);
    await validateApplied(client, quarterId, d, ledgerBefore); await q(client, "INSERT INTO recon.migration_manifests (batch_key,quarter_code,source_sha256,source_record_count,migrated_record_count,status,error_details,completed_at) VALUES ($1,'2026-Q2',$2,851,851,'migrated','[]'::jsonb,now())", [batchKey,source.sqlite]);
    const manifest = await q(client, "SELECT count(*)::int count FROM recon.migration_manifests WHERE batch_key=$1", [batchKey]); required(manifest.rows[0].count === 1, "Q2_POST_IMPORT_VALIDATION_FAILED", "Q2 manifest missing", code.validation); await q1Baseline(client); await q(client, "COMMIT"); console.log(JSON.stringify({ status: "APPLIED", batch_key: batchKey, dimension_resolution: resolution.summary, import_batch_id: batchId }, null, 2));
  } catch (e) { await q(client, "ROLLBACK"); throw e; }
}
async function validateApplied(client, quarterId, d, ledgerBefore) {
  const [r,children,ledger] = await Promise.all([q(client, "SELECT count(*)::int count,coalesce(sum(company_receivable),0)::text company,count(customer_book_amount)::int customer_nonnull,count(reconciliation_difference)::int difference_nonnull,count(reconciliation_status)::int status_nonnull,count(source_row_key)::int key_nonnull,count(DISTINCT source_row_key)::int key_distinct FROM recon.reconciliations WHERE quarter_id=$1", [quarterId]), q(client, "SELECT (SELECT count(*)::int FROM recon.difference_items x JOIN recon.reconciliations r ON r.id=x.reconciliation_id WHERE r.quarter_id=$1) difference_items,(SELECT count(*)::int FROM recon.followup_items x JOIN recon.reconciliations r ON r.id=x.reconciliation_id WHERE r.quarter_id=$1) followup_items,(SELECT count(*)::int FROM recon.followup_events x JOIN recon.followup_items f ON f.id=x.followup_item_id JOIN recon.reconciliations r ON r.id=f.reconciliation_id WHERE r.quarter_id=$1) followup_events,(SELECT count(*)::int FROM recon.material_status x WHERE x.quarter_id=$1) material_status", [quarterId]), q(client, "SELECT count(*)::int count FROM recon.ledger_invoices")]);
  const x=r.rows[0], c=children.rows[0]; required(x.count===851&&x.company==='514473239.51'&&x.customer_nonnull===0&&x.difference_nonnull===0&&x.status_nonnull===0&&x.key_nonnull===851&&x.key_distinct===851&&c.difference_items===0&&c.followup_items===0&&c.followup_events===0&&c.material_status===0&&ledger.rows[0].count===ledgerBefore, "Q2_POST_IMPORT_VALIDATION_FAILED", "Q2 row/null/count validation failed", code.validation);
  for (const group of d.review_required.filter((x) => x.code === "DUPLICATE_BUSINESS_KEY")) { const keys = group.source_row_indexes.map((i) => d.reconciliations[i].source_row_key); const rows = await q(client, "SELECT customer_id,company_receivable::text amount FROM recon.reconciliations WHERE quarter_id=$1 AND source_row_key = ANY($2::text[])", [quarterId,keys]); required(rows.rowCount===2&&new Set(rows.rows.map((z)=>z.customer_id)).size===1&&new Set(rows.rows.map((z)=>z.amount)).size===2, "Q2_POST_IMPORT_VALIDATION_FAILED", `duplicate group ${group.group_id} was not preserved`, code.validation); }
}
async function main() { const mode=args(process.argv.slice(2)); if(mode==="help") return usage(); const data=await load(); validateInput(data); if(mode==="--offline-validate-input") return console.log("OFFLINE_INPUT_VALIDATED"); const client=await connect(); try { if(mode==="--validate-only") await validateOnly(client,data); else await apply(client,data); } finally { await client.end(); } }
main().catch((e)=>{ console.error(e.message); process.exitCode=e.exitCode??code.unexpected; });
