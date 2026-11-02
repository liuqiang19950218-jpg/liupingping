-- 006: Ledger verification runtime (dataset metadata + verification entries).
--
-- Business background (Phase 2G.1):
--   The sales form verifies invoiceNo + date + amount against a company ledger
--   when filling 在途/退票/丢票/仪器设备/其他(有发票) difference items. Before
--   this migration that ledger lived ONLY in browser assets:
--       public/ledger_keys.json          (canonical keys: invoice|YYYYMMDD|amount)
--       public/ledger_invoice_lookup.json (invoice -> {amount, dates[]})
--   and a per-browser IndexedDB "current" record. None of it was in PostgreSQL.
--
-- This migration adds the PostgreSQL ledger runtime:
--
--   recon.ledger_datasets            -- dataset / version metadata
--     dataset_type:
--       HISTORICAL_BASE               -- all-years company invoice base (V1 = the
--                                      -- legacy JSON runtime surface; future V2..Vn
--                                      -- replace it via versioning, old never deleted)
--       CURRENT_YEAR_QUARTER          -- per-quarter current-year cumulative snapshot
--                                      -- (Q1 = 1-3月, Q2 = 1-6月, ...). One dataset
--                                      -- per quarter; later quarters NEVER overwrite
--                                      -- earlier ones.
--     quarter_id: NULL for HISTORICAL_BASE; the owning quarter for
--                 CURRENT_YEAR_QUARTER (reimport of an existing quarter is BLOCKED
--                 with 409 this phase until the policy is confirmed).
--     version + is_active: historical base V1/V2/V3...; only one active at a time,
--                 old versions kept (never physically deleted).
--     source_sha256 + source_file_name + source_payload: audit provenance of the
--                 dataset (which files/bytes produced these rows).
--
--   recon.ledger_verification_entries -- per-invoice verification rows
--     Canonical verification key: (invoice_no_normalized, invoice_date, invoice_amount)
--     - invoice_no_normalized: trimmed invoice string (leading zeros preserved,
--       18/20-digit numbers kept as TEXT so they never lose precision).
--     - invoice_date: DATE (canonical YYYYMMDD from the legacy files / UI date).
--     - invoice_amount: NUMERIC(18,2) (100 / 100.0 / 100.00 compare equal; no float).
--     - source_row_key: deterministic canonical key (invoice|YYYYMMDD|amount2dp)
--       per dataset, UNIQUE(dataset_id, source_row_key) -> replay-safe.
--     - source_payload: the original legacy record shape for provenance.
--
-- Verification contract (server-authoritative):
--   sales entering (invoiceNo, invoiceDate, amount) for quarter Q are verified
--   against:
--       active HISTORICAL_BASE dataset  UNION
--       active CURRENT_YEAR_QUARTER dataset for Q
--   Logical dedupe by canonical key; a key present in both datasets still matches
--   exactly once (never a duplicate error). Q2 does NOT include Q1's snapshot
--   (Q2 is already the 1-6月 cumulative file) - quarter isolation is enforced by
--   the query scope, not by the client.
--
-- The index (invoice_no_normalized, invoice_date, invoice_amount) serves the hot
-- verification lookup; dataset_id is indexed for scoping. 320k+ rows are expected
-- in the HISTORICAL_BASE dataset - every verification must be an index lookup,
-- never a table scan.
--
-- Scope: this migration ONLY adds ledger runtime tables. It does NOT touch any
-- existing business table, does NOT change NULL semantics
-- (customer_book_amount NULL => reconciliation_difference NULL), and does NOT
-- write any data (backfill is a separate script). Idempotent: all statements
-- are IF NOT EXISTS + schema_migrations ON CONFLICT DO NOTHING.
BEGIN;

CREATE TABLE IF NOT EXISTS recon.ledger_datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_type text NOT NULL
    CHECK (dataset_type IN ('HISTORICAL_BASE', 'CURRENT_YEAR_QUARTER')),
  year integer,
  quarter_id uuid REFERENCES recon.quarters(id),
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  source_file_name text,
  source_sha256 text NOT NULL,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count integer NOT NULL DEFAULT 0,
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- For CURRENT_YEAR_QUARTER: one dataset per quarter+version (reimport of an
  -- existing quarter is blocked this phase; the app returns 409 BEFORE inserting).
  -- For HISTORICAL_BASE: quarter_id is NULL and PostgreSQL treats NULLs as
  -- distinct, so multiple historical versions can coexist.
  UNIQUE (dataset_type, quarter_id, version)
);

-- At most one ACTIVE historical base at a time (constant-expression unique index
-- guarded by the active predicate). Old inactive versions are preserved.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_datasets_one_active_historical
  ON recon.ledger_datasets ((1))
  WHERE dataset_type = 'HISTORICAL_BASE' AND is_active;

-- Current-year quarter snapshots: one active dataset per quarter.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_datasets_quarter_active
  ON recon.ledger_datasets (quarter_id)
  WHERE dataset_type = 'CURRENT_YEAR_QUARTER' AND is_active;

CREATE TABLE IF NOT EXISTS recon.ledger_verification_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES recon.ledger_datasets(id) ON DELETE CASCADE,
  source_row_key text NOT NULL,
  invoice_no_raw text NOT NULL,
  invoice_no_normalized text NOT NULL,
  invoice_date_raw text NOT NULL,
  invoice_date date NOT NULL,
  invoice_amount numeric(18,2) NOT NULL,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dataset_id, source_row_key)
);

-- Hot verification lookup: (invoice_no_normalized, invoice_date, invoice_amount).
CREATE INDEX IF NOT EXISTS ledger_verify_lookup_idx
  ON recon.ledger_verification_entries (invoice_no_normalized, invoice_date, invoice_amount);

CREATE INDEX IF NOT EXISTS ledger_verify_dataset_idx
  ON recon.ledger_verification_entries (dataset_id);

-- Runtime access: same pattern as 005 (app role gets CRUD on the new tables).
-- The id columns are gen_random_uuid() (no sequences exist), so there is no
-- sequence GRANT for these tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE recon.ledger_datasets TO quarterly_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE recon.ledger_verification_entries TO quarterly_app;

INSERT INTO recon.schema_migrations (version)
VALUES ('006_ledger_verification_runtime')
ON CONFLICT (version) DO NOTHING;

COMMIT;
