BEGIN;

-- A reconciliation is a source business row, not a customer master record.
-- Imported rows get a deterministic key for replay safety; manually-created
-- rows remain valid without an import source identity.
ALTER TABLE recon.reconciliations
  ADD COLUMN IF NOT EXISTS source_row_key text;

-- The original constraint incorrectly made one customer equal one
-- reconciliation per quarter/account set.  It blocks valid source rows that
-- share a customer but differ in their source row and receivable amount.
ALTER TABLE recon.reconciliations
  DROP CONSTRAINT IF EXISTS reconciliations_quarter_id_account_set_id_customer_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS reconciliations_source_row_key_unique
  ON recon.reconciliations (source_row_key)
  WHERE source_row_key IS NOT NULL;

-- NULL means the reconciliation status has not yet been entered.  Explicit
-- historical statuses remain unchanged, while omission no longer implies an
-- explicit business status of "unreconciled".
ALTER TABLE recon.reconciliations
  ALTER COLUMN reconciliation_status DROP NOT NULL,
  ALTER COLUMN reconciliation_status DROP DEFAULT;

INSERT INTO recon.schema_migrations (version)
VALUES ('003_reconciliation_source_row_identity')
ON CONFLICT (version) DO NOTHING;

COMMIT;
