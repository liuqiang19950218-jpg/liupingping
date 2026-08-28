-- 007: remaining business imports backend support (Phase 2H.1).
--
-- Business background:
--   Ledger Phase 2G is closed. This phase adds PostgreSQL backends for the four
--   remaining business uploads, WITHOUT touching the ledger main chain:
--     A. MATERIAL_STATUS_IMPORT    -> recon.material_status     (普通资料 SPD-A)
--     B. INDEPENDENT_SPD_IMPORT    -> recon.spd_dashboard_rows  (SPD-B, dashboard)
--     C. COMPANY_RECVBLE_UPDATE    -> recon.reconciliations     (company_receivable)
--     D. HISTORICAL_LEDGER_REPLACE -> recon.ledger_datasets / ledger_verification_entries
--
-- The four entry types are audited through recon.import_batches, which already
-- carries data_type / quarter_id / original_file_name / source_sha256 / counts /
-- status / details / target_module. No new import-audit table is introduced.
--
-- This migration makes ONLY the minimal schema adjustments that the real data
-- forces (checked against the live test baseline quarterly_recon_remaining_imports_test_20260828):
--
--   1. recon.spd_dashboard_rows gets source_batch_id so each independent SPD
--      import row can be traced to its recon.import_batches audit record
--      (parity with recon.material_status.source_batch_id). The column is
--      nullable; legacy Q1 rows keep NULL (provenance is unchanged).
--
--   2. recon.material_status gets a PARTIAL unique index so batch-imported rows
--      can never produce a duplicate (reconciliation_id, material_type). It is
--      deliberately scoped to source_batch_id IS NOT NULL because the migrated
--      baseline contains 208 historical duplicate (reconciliation_id,
--      material_type) pairs (SPD-A "已提供" vs SPD_SOURCE "是" merge artifacts)
--      whose source_batch_id is NULL — a full unique index would fail the
--      migration, and the legacy duplicates are business truth that must be
--      preserved, not "cleaned".
--
--   3. recon.import_batches gets a PARTIAL unique index for global
--      (quarter_id IS NULL) imports. The table's UNIQUE(data_type, quarter_id,
--      source_sha256, target_module) treats NULL quarter_id as distinct, so it
--      would NOT dedupe HISTORICAL_LEDGER_REPLACE — the partial index closes
--      that gap so re-importing the same historical file is rejected (409)
--      instead of creating a duplicate version.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS /
-- schema_migrations ON CONFLICT DO NOTHING.
BEGIN;

ALTER TABLE recon.spd_dashboard_rows
  ADD COLUMN IF NOT EXISTS source_batch_id uuid REFERENCES recon.import_batches(id);

-- Batch-imported material rows: one active status per reconciliation + type.
CREATE UNIQUE INDEX IF NOT EXISTS material_status_batch_unique
  ON recon.material_status (reconciliation_id, material_type)
  WHERE reconciliation_id IS NOT NULL AND source_batch_id IS NOT NULL;

-- Global (quarter-less) imports must dedupe on (data_type, source_sha256).
CREATE UNIQUE INDEX IF NOT EXISTS import_batches_global_dedup
  ON recon.import_batches (data_type, source_sha256, target_module)
  WHERE quarter_id IS NULL;

-- Runtime access parity with 005/006. The id columns are gen_random_uuid() so
-- there is no sequence GRANT.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE recon.spd_dashboard_rows TO quarterly_app;

INSERT INTO recon.schema_migrations (version)
VALUES ('007_remaining_business_imports')
ON CONFLICT (version) DO NOTHING;

COMMIT;
