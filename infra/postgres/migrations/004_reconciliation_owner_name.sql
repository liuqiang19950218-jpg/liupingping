-- 004: current editable owner name (business-level, NOT the system account owner_id).
--
-- Business rule (owner): 对账负责人 comes from the quarterly Excel import as an
-- INITIAL VALUE, but afterwards it is EDITABLE business data:
--   - Excel import name = initial owner_name (backfilled below from the preserved
--     provenance field source_payload.owner_raw_name)
--   - sales edits update owner_name only
--   - the original import value stays untouched inside source_payload (historical
--     evidence / provenance) — never overwritten
--   - owner_id is reserved for the future account/role system and is NOT used here
--
-- Scope: this migration ONLY adds the editable owner-name field. It does NOT add
-- permissions / RBAC / regions / users / import-history. It does NOT change any
-- existing business value (company_receivable, customer_book_amount, status, ...).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + backfill only rows where owner_name IS
-- NULL + schema_migrations ON CONFLICT DO NOTHING.
--
-- Backfill provenance mapping (verified against real data structure):
--   source_payload -> 'owner_raw_name'  (present in both Q1 and Q2)
--   Values that are NOT a real name ('' or import sentinels '0' / '—' / '-' /
--   '未填写' / '未对账' / 'null' / 'undefined') map to NULL — they are "no owner".
BEGIN;

ALTER TABLE recon.reconciliations
  ADD COLUMN IF NOT EXISTS owner_name text;

UPDATE recon.reconciliations
SET owner_name = CASE
      WHEN source_payload ? 'owner_raw_name'
       AND btrim(coalesce(source_payload->>'owner_raw_name', '')) <> ''
       AND btrim(coalesce(source_payload->>'owner_raw_name', ''))
             NOT IN ('0', '—', '-', '未填写', '未对账', 'null', 'undefined')
      THEN btrim(source_payload->>'owner_raw_name')
      ELSE NULL
    END
WHERE owner_name IS NULL
  AND source_payload ? 'owner_raw_name';

INSERT INTO recon.schema_migrations (version)
VALUES ('004_reconciliation_owner_name')
ON CONFLICT (version) DO NOTHING;

COMMIT;
