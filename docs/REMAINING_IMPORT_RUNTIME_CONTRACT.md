# Remaining Business Imports — PostgreSQL Runtime Contract (Phase 2H.1)

Ledger Phase 2G is closed. This document defines the PostgreSQL backends for the
four remaining business uploads. All legacy semantics were re-verified from the
real browser code (`app/QuarterlyReconciliation.tsx` importMaterials /
importSpdSheet / importCompanyReceivables) — nothing is re-derived.

- Branch: `feature/postgres-remaining-imports-backend`
- Baseline commit: `0779aa782d1f05e6190287509638d236f8c6a802`
- Test DB: `quarterly_recon_remaining_imports_test_20260828`
- Target module: `remaining-imports`

## Overview

| # | Import | Route | Write target | Semantic |
|---|--------|-------|--------------|----------|
| A | 资料提供情况表 | `POST /api/quarter/[code]/materials/import` | `recon.material_status` | merge / upsert (SPD-A) |
| B | 独立 SPD 表 | `POST /api/quarter/[code]/spd-dashboard/import` | `recon.spd_dashboard_rows` | atomic whole-sheet replace (SPD-B) |
| C | 公司应收更新表 | `POST /api/quarter/[code]/company-receivables/import` | `recon.reconciliations` (company_receivable) | field-limited upsert |
| D | 历史往来底库替换 | `POST /api/ledger/historical/import` | `recon.ledger_datasets` + `ledger_verification_entries` | versioned atomic replace |

All four are audited through `recon.import_batches` (see [Audit](#audit)).

---

## A. Material Status Import (资料提供情况表)

### Route
`POST /api/quarter/[code]/materials/import`
Body: `{ sourceFileName, headers, rows }` — the browser parses the .xlsx and posts
structured rows (same contract as the quarter base import). The server resolves
`[code] -> quarter_id`; the client never supplies a quarter UUID.

### Source headers (legacy aliases supported)
- Required: `账套`, `区域`, `客户名称`
- Material columns (7 canonical types; `SPD确认表` also matches `SPD确认函`):
  `对账函`, `对账确认函`, `SPD确认表`, `SPD库存确认函`, `在途证明`, `精准核销`, `催款函送达证明`

### Matching
Exact (账套 + 区域 + 客户名称) against the CURRENT quarter's reconciliations,
using the legacy normalization (ALL whitespace removed, then trim). No fuzzy,
no customer aliasing, no cross-quarter matching.

### Unmatched policy — `MATERIAL_UNMATCHED_POLICY`
Legacy: matched rows are merged, unmatched rows are IGNORED (partial success —
never a structural error). Reproduced: unmatched source rows are counted and
reported in `unmatchedKeys`; the import completes with status `PARTIAL`. Only a
genuinely structural failure (missing quarter / missing required header /
unparseable payload / no reconciliations in the quarter) fails the whole batch
with a rollback.

### Write target & upsert
`recon.material_status` (SPD-A for `SPD确认表` / `SPD库存确认函`). For each
matched reconciliation + material type with a non-blank cell:
- if a row exists for `(reconciliation_id, material_type)` → update the OLDEST
  one in place (`provided`, `raw_value`, `source_batch_id`, `updated_at`)
- else insert a new row.
`raw_value` is preserved as-is (trimmed). `provided` derivation (migration-confirmed):

| raw_value | provided |
|-----------|----------|
| `已提供` / `已回函` / `是` | `true` |
| `未对账` / `""` / `—` | `null` |
| anything else (`否`, `未提供`, `已盖章`, `未盖章`, `未回函`, ...) | `false` |

### Invariants
- NEVER creates customers or reconciliations.
- NEVER writes `recon.spd_dashboard_rows` (SPD-B untouched).
- NEVER touches `company_receivable`, `customer_book_amount`, `owner_name`,
  `reconciliation_difference`, `difference_items`, `followups`,
  `reconciliation_status`.

### Transaction
All writes in ONE transaction. Validation of ALL rows happens BEFORE the
transaction opens. Structural errors → `400/404`, full rollback (nothing is
written half-way). Business unmatched/ambiguous rows are partial, not rollbacks.

---

## B. Independent SPD Import (独立 SPD 表)

### Route
`POST /api/quarter/[code]/spd-dashboard/import`
Body: `{ sourceFileName, headers, rows }`. Server-scoped quarter resolution.

### Source headers
Required: at least one of `SPD确认表`/`SPD确认函` OR `SPD库存确认函`.
Optional provenance: `序号`, `账套`, `区域`, `客户名称`, `备注`.

### Replacement semantics — atomic whole-sheet replace
Legacy: the quarter's SPD dashboard archive is fully overwritten. Reproduced:
inside ONE transaction — record import batch → `DELETE` the current quarter's
`spd_dashboard_rows` → `INSERT` all new rows → validate → `COMMIT`. Any failure
`ROLLBACK`s so the previous dataset stays fully intact (the dashboard is never
left empty by a failed replace).

### Row preservation & reconciliation link
Every source row is preserved, including rows with blank status cells and rows
that cannot be linked. `reconciliation_id`:
- exact (账套 + 区域 + 客户名称, whitespace-removed) match to a UNIQUE
  reconciliation → set;
- no match / ambiguous → `NULL`.
No fuzzy matching, no dropping rows. Raw fields are kept verbatim
(`account_set_raw`, `region_raw`, `customer_name_raw`, SPD raw values, `remark`,
`source_row_number`, `source_file_name`, `source_payload`).

### Dashboard semantics (unchanged)
`total` = all business rows. `是` AND `否` both count as submitted; blank/NULL
counts as unsubmitted.

### Q1 historical protection
Q1 (`142` rows, authoritative migrated history) is never used as a replace
fixture; the import is strictly quarter-scoped.

---

## C. Company Receivable Update (公司应收更新表)

### Route
`POST /api/quarter/[code]/company-receivables/import`
Body: `{ sourceFileName, headers, rows }`. Server-scoped quarter resolution.

### Source headers
Required: `账套`, `区域`, `客户名称`, `公司应收`
(aliases: `公司应收`, `公司应收金额`, `公司应收（元）`).

### Matching
Exact (账套 + 区域 + 客户名称) against the CURRENT quarter's reconciliations
(legacy whitespace-removed normalization). Unmatched → `unmatchedRows`
(partial, never an error).

### Field-update limit
This import may ONLY change:
- `company_receivable`
- server-derived `reconciliation_difference`

It NEVER changes `customer_book_amount`, `owner_name`, `reconciliation_status`,
`difference_items`, `followups`, `material_status`, `SPD`, or customer identity.
`source_row_key` / customer identity are never rewritten.

### Difference recompute (server-authoritative)
```
customer_book_amount IS NOT NULL  ->  reconciliation_difference = new_company_receivable - customer_book_amount
customer_book_amount IS NULL      ->  reconciliation_difference = NULL
```
NULL and 0 are distinct. An empty Excel cell leaves the value untouched
(never `blank -> 0`); an invalid non-empty amount is a `400` structural error.

### Ambiguous match policy — `COMPANY_RECEIVABLE_AMBIGUOUS_MATCH_POLICY`
Audited real data: 2026-Q1 keys are all unique; 2026-Q2 contains 2 duplicate
(账套, 区域, 客户名称) keys (万和/苏州/苏州市吴江区北厍社区卫生服务中心 and
万和/苏州/苏州市相城区漕湖人民医院), each mapping to 2 reconciliations with
different company_receivable values. For any source row whose key matches
>1 reconciliation the row is NOT written and reported in `ambiguousRows`.
The server never guesses (never first-match, never all-match, never amount-guess).

### Response
`sourceRows, matchedRows, updatedRows, unchangedRows, unmatchedRows,
ambiguousRows, sourceSha256, importBatchId`.

---

## D. Historical Ledger Replace (历史往来底库替换)

### Route
`POST /api/ledger/historical/import` — GLOBAL (not quarter-scoped).
Body: `{ sourceFiles: [{ sourceFileName, headers, rows }] }` — one or more
历史往来 Excel files parsed by the browser, same contract as the current-year
ledger import. The server reuses the Phase-2G-validated normalization
(`parseLedgerSourceFile`: invoice_no / invoice_date / invoice_amount triple).
账套/region columns may be kept as provenance inside `source_payload` but never
change the verification rule.

### Version model & active switching
- Existing: `HISTORICAL_BASE V1` (active=true, 355915 entries).
- Replace creates `HISTORICAL_BASE V2` (is_active=false), imports + validates
  ALL entries, then flips `V1.active=false` + `V2.active=true` inside the SAME
  transaction.
- Old versions and their entries are NEVER deleted.
- `CURRENT_YEAR_QUARTER` datasets are NEVER touched.

### Transaction
```
BEGIN
  advisory lock (global)
  reject re-import of a source_sha256 already present as a historical version (409)
  nextVersion = max(version)+1
  INSERT dataset (HISTORICAL_BASE, quarter_id NULL, is_active=false)
  bulk INSERT verification entries (chunked)
  validate counts (entries == distinct keys == expected)
  deactivate old active; activate new version
  INSERT import_batches (quarter_id NULL)
COMMIT
```
Any failure ROLLBACKs so the previously-active version stays active (a failed
V3 leaves V2 active).

### Verification scope (unchanged)
Verify continues to use `active HISTORICAL_BASE UNION current-quarter
CURRENT_YEAR_QUARTER`; canonical key = (invoice_no_normalized, invoice_date,
invoice_amount).

---

## Audit (`recon.import_batches`)

| data_type | quarter_id | target_module | notes |
|-----------|-----------|---------------|-------|
| `MATERIAL_STATUS_IMPORT` | quarter | `remaining-imports` | counts + status |
| `INDEPENDENT_SPD_IMPORT` | quarter | `remaining-imports` | replacement flag |
| `COMPANY_RECEIVABLE_UPDATE` | quarter | `remaining-imports` | matched/updated/ambiguous counts |
| `HISTORICAL_LEDGER_REPLACE` | NULL (global) | `remaining-imports` | new/previous version |

Each row persists `original_file_name`, `source_sha256`, `imported_at`,
`valid_record_count`, `inserted/updated/skipped/error` counts, `status`,
`details` (metadata). Dedup: `UNIQUE(data_type, quarter_id, source_sha256,
target_module)` for quarter imports; `import_batches_global_dedup` partial index
(data_type, source_sha256, target_module WHERE quarter_id IS NULL) for the
global historical import. Original xlsx binary is NOT stored (deferred).

### Re-import behavior
Re-importing the SAME file (identical source_sha256) → `409 IMPORT_ALREADY_EXISTS`
(same pattern as the quarter base import). A MODIFIED file is a new import.

---

## Migration 007

`infra/postgres/migrations/007_remaining_business_imports.sql`:
1. `recon.spd_dashboard_rows.source_batch_id uuid REFERENCES import_batches(id)` —
   SPD import audit link (parity with material_status).
2. `material_status_batch_unique` — PARTIAL unique index
   `(reconciliation_id, material_type) WHERE reconciliation_id IS NOT NULL AND
   source_batch_id IS NOT NULL`. Scoped to batch-imported rows only because the
   migrated baseline holds 208 historical duplicate (reconciliation_id,
   material_type) pairs (SPD-A "已提供" vs SPD_SOURCE "是" artifacts) that must
   not fail the migration.
3. `import_batches_global_dedup` — PARTIAL unique index
   `(data_type, source_sha256, target_module) WHERE quarter_id IS NULL` so the
   global historical import dedups correctly (the table UNIQUE treats NULL
   quarter_id as distinct).

## Error contract

| code | meaning |
|------|---------|
| `INVALID_QUARTER` | quarter code malformed / quarter does not exist |
| `INVALID_IMPORT_FORMAT` | unparseable payload / no usable rows |
| `MISSING_REQUIRED_HEADER` | required source column missing |
| `IMPORT_ALREADY_EXISTS` | identical file already imported |
| `NO_MATCHING_RECONCILIATIONS` | quarter has no reconciliations to match |
| `POST_IMPORT_VALIDATION_FAILED` | internal count validation failed (rolls back) |

Internal SQL / DATABASE_URL / filesystem paths are never returned to the
browser (existing `handleRouteError` + `sanitizePostgresError`).
