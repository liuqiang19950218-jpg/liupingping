-- 008: manual resolution status (Phase 2K.9B-1).
--
-- Background: Phase 2K.9A forensic audit proved the historical "人工已解决/撤销"
-- state is a REAL independent business dimension that the current solution+date
-- routing (and follow_status) cannot carry. It survives in the preserved legacy
-- Detail: reconciliations.source_payload.detail.resolved / .reopened.
--
-- This migration adds ONE independent, queryable column:
--   recon.reconciliations.manual_resolution_status
--   values: 'resolved' | 'reopened' | NULL  (CHECK-enforced, nothing else)
--
-- It is deliberately SEPARATE from solution / solution_date / follow_status:
--   - NOT derived from solutionDate presence/absence (that routing was judged
--     CURRENT_ROUTING_LOSES_MANUAL_STATUS in 2K.9A);
--   - NOT stored in follow_status (proved unable to carry it unambiguously).
--
-- source_payload is NEVER modified: it stays the permanent historical provenance.
-- Only the new business column is added and backfilled.
--
-- SAFE boolean parse: only the exact text 'true' (JSON boolean true or the
-- literal string "true") counts as true; false / empty / NULL / missing / any
-- other value are all treated as not-set. No untrusted ::boolean casts.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / guarded CHECK / deterministic UPDATE /
-- schema_migrations ON CONFLICT DO NOTHING.

BEGIN;

ALTER TABLE recon.reconciliations
  ADD COLUMN IF NOT EXISTS manual_resolution_status text;

-- CHECK constraint (idempotent guard so re-application on a clone never fails).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reconciliations_manual_resolution_status_check'
      AND conrelid = 'recon.reconciliations'::regclass
  ) THEN
    ALTER TABLE recon.reconciliations
      ADD CONSTRAINT reconciliations_manual_resolution_status_check
      CHECK (manual_resolution_status IS NULL
             OR manual_resolution_status IN ('resolved', 'reopened'));
  END IF;
END $$;

-- One-time backfill from the preserved legacy Detail. 'resolved' wins over
-- 'reopened' (per the 2K.9A audit: the 22 resolved are resolved=true, the 2
-- reopened are reopened=true AND resolved=false — no conflict in the data).
-- Q2 and every row without an explicit legacy true stays NULL (never derived
-- from solution / solution_date / follow_status).
UPDATE recon.reconciliations
SET manual_resolution_status = CASE
  WHEN (source_payload #>> '{detail,resolved}') = 'true' THEN 'resolved'
  WHEN (source_payload #>> '{detail,reopened}') = 'true' THEN 'reopened'
  ELSE NULL
END;

-- App role parity with the rest of the runtime GRANTs (table-level; a new
-- column is covered by the existing table GRANT, this is an explicit re-affirm).
GRANT SELECT, UPDATE ON TABLE recon.reconciliations TO quarterly_app;

INSERT INTO recon.schema_migrations (version)
VALUES ('008_manual_resolution_status')
ON CONFLICT (version) DO NOTHING;

COMMIT;
