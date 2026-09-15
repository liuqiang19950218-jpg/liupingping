-- 009: historical settlement snapshots (Phase 2K.11A).
--
-- Purpose: persist the user-confirmed HISTORICAL MANAGEMENT SNAPSHOT of
-- quarterly / region settlement state (2024 Q3 .. 2026 Q1) from the
-- authoritative Excel workbook (工作簿1(2).xlsx; on this host
-- /home/liupp/111/工作簿1.xlsx, sha256 31dcbba8...), as an independent
-- read-only historical fact source.
--
-- Design rules (user-approved, Phase 2K.11A spec):
--   * This table is FULLY ISOLATED from the live reconciliations family:
--     no FK to recon.reconciliations / quarters / regions / customers.
--     Historical 2026 Q1 (728/722/4) and realtime 2026 Q1 must coexist.
--   * Source values are SEALED: settlement_rate is the raw Excel value,
--     never recomputed; unsettled_count NULL stays NULL; the 2025 Q4
--     Nantong gap and the 2026 Q1 total/region delta are preserved with
--     validation_note, never auto-corrected.
--   * Corrections are append-only: a new snapshot_version, never an
--     UPDATE of v1 (sealed = true).
--   * quarterly_app gets SELECT ONLY. No INSERT/UPDATE/DELETE grants.
--     No API/UI is wired to this table in this phase.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS / guarded CHECK + UNIQUE via
-- DO-blocks / schema_migrations ON CONFLICT DO NOTHING (clone-safe).

BEGIN;

CREATE TABLE IF NOT EXISTS recon.historical_settlement_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_year smallint NOT NULL,
  period_quarter smallint NOT NULL,
  record_type text NOT NULL,
  region text NOT NULL,
  customer_total integer NOT NULL,
  settled_count integer NOT NULL,
  unsettled_count integer NULL,
  unclassified_count integer NOT NULL DEFAULT 0,
  settlement_rate numeric(18,15) NOT NULL,
  source_file text NOT NULL,
  source_file_sha256 text NOT NULL,
  source_sheet text NOT NULL,
  source_row integer NOT NULL,
  snapshot_version integer NOT NULL DEFAULT 1,
  sealed boolean NOT NULL DEFAULT true,
  validation_note text NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

-- CHECK constraints (idempotent guards, 008 style).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'historical_settlement_snapshots_period_quarter_check'
      AND conrelid = 'recon.historical_settlement_snapshots'::regclass
  ) THEN
    ALTER TABLE recon.historical_settlement_snapshots
      ADD CONSTRAINT historical_settlement_snapshots_period_quarter_check
      CHECK (period_quarter BETWEEN 1 AND 4);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'historical_settlement_snapshots_record_type_check'
      AND conrelid = 'recon.historical_settlement_snapshots'::regclass
  ) THEN
    ALTER TABLE recon.historical_settlement_snapshots
      ADD CONSTRAINT historical_settlement_snapshots_record_type_check
      CHECK (record_type IN ('region', 'total'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'historical_settlement_snapshots_customer_total_check'
      AND conrelid = 'recon.historical_settlement_snapshots'::regclass
  ) THEN
    ALTER TABLE recon.historical_settlement_snapshots
      ADD CONSTRAINT historical_settlement_snapshots_customer_total_check
      CHECK (customer_total >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'historical_settlement_snapshots_settled_count_check'
      AND conrelid = 'recon.historical_settlement_snapshots'::regclass
  ) THEN
    ALTER TABLE recon.historical_settlement_snapshots
      ADD CONSTRAINT historical_settlement_snapshots_settled_count_check
      CHECK (settled_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'historical_settlement_snapshots_unsettled_count_check'
      AND conrelid = 'recon.historical_settlement_snapshots'::regclass
  ) THEN
    ALTER TABLE recon.historical_settlement_snapshots
      ADD CONSTRAINT historical_settlement_snapshots_unsettled_count_check
      CHECK (unsettled_count IS NULL OR unsettled_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'historical_settlement_snapshots_unclassified_count_check'
      AND conrelid = 'recon.historical_settlement_snapshots'::regclass
  ) THEN
    ALTER TABLE recon.historical_settlement_snapshots
      ADD CONSTRAINT historical_settlement_snapshots_unclassified_count_check
      CHECK (unclassified_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'historical_settlement_snapshots_settlement_rate_check'
      AND conrelid = 'recon.historical_settlement_snapshots'::regclass
  ) THEN
    ALTER TABLE recon.historical_settlement_snapshots
      ADD CONSTRAINT historical_settlement_snapshots_settlement_rate_check
      CHECK (settlement_rate >= 0 AND settlement_rate <= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'historical_settlement_snapshots_snapshot_version_check'
      AND conrelid = 'recon.historical_settlement_snapshots'::regclass
  ) THEN
    ALTER TABLE recon.historical_settlement_snapshots
      ADD CONSTRAINT historical_settlement_snapshots_snapshot_version_check
      CHECK (snapshot_version >= 1);
  END IF;
END $$;

-- Unique per version: one record per (period_year, period_quarter, region,
-- snapshot_version). Duplicate-import protection backstop for the importer.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'historical_settlement_snapshots_version_unique'
      AND tablename = 'historical_settlement_snapshots'
  ) THEN
    CREATE UNIQUE INDEX historical_settlement_snapshots_version_unique
      ON recon.historical_settlement_snapshots
      (period_year, period_quarter, region, snapshot_version);
  END IF;
END $$;

-- App role: SELECT ONLY (sealed historical snapshot; no business writes).
-- The schema's default privileges (ALTER DEFAULT PRIVILEGES ... arwd on new
-- recon tables) would otherwise auto-grant INSERT/UPDATE/DELETE at CREATE
-- time — this table must stay SELECT-only for quarterly_app. Corrections are
-- a future snapshot_version written by the migration owner, never the app.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE recon.historical_settlement_snapshots FROM quarterly_app;
GRANT SELECT ON TABLE recon.historical_settlement_snapshots TO quarterly_app;

INSERT INTO recon.schema_migrations (version)
VALUES ('009_historical_settlement_snapshots')
ON CONFLICT (version) DO NOTHING;

COMMIT;
