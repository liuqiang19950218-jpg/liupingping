BEGIN;

CREATE SCHEMA IF NOT EXISTS recon;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS recon.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recon.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS recon.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recon.user_roles (
  user_id uuid NOT NULL REFERENCES recon.users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES recon.roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS recon.quarters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  year integer NOT NULL,
  quarter integer NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  cutoff_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'locked', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recon.regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS recon.account_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS recon.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_code text,
  name text NOT NULL,
  region_id uuid REFERENCES recon.regions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (external_code, name)
);

CREATE TABLE IF NOT EXISTS recon.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quarter_id uuid REFERENCES recon.quarters(id),
  data_type text NOT NULL,
  original_file_name text,
  source_sha256 text,
  storage_key text,
  imported_at timestamptz,
  imported_by uuid REFERENCES recon.users(id),
  valid_record_count integer NOT NULL DEFAULT 0,
  inserted_count integer,
  updated_count integer,
  skipped_count integer,
  error_count integer,
  target_module text NOT NULL,
  status text NOT NULL CHECK (status IN ('success', 'partial', 'pending', 'failed', 'historical')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (data_type, quarter_id, source_sha256, target_module)
);

CREATE TABLE IF NOT EXISTS recon.reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text,
  quarter_id uuid NOT NULL REFERENCES recon.quarters(id),
  account_set_id uuid NOT NULL REFERENCES recon.account_sets(id),
  customer_id uuid NOT NULL REFERENCES recon.customers(id),
  owner_id uuid REFERENCES recon.users(id),
  company_receivable numeric(18,2),
  customer_book_amount numeric(18,2),
  reconciliation_difference numeric(18,2),
  reconciliation_status text NOT NULL DEFAULT 'unreconciled',
  solution_date date,
  solution text,
  bad_debt_amount numeric(18,2),
  bad_debt_reason text,
  adjustment_amount numeric(18,2),
  adjustment_reason text,
  financial_attention text NOT NULL DEFAULT 'none',
  process_stage text,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  UNIQUE (quarter_id, account_set_id, customer_id)
);

CREATE INDEX IF NOT EXISTS reconciliations_filter_idx
  ON recon.reconciliations (quarter_id, reconciliation_status, process_stage, owner_id);

CREATE TABLE IF NOT EXISTS recon.ledger_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_set_id uuid NOT NULL REFERENCES recon.account_sets(id),
  customer_id uuid REFERENCES recon.customers(id),
  invoice_no text NOT NULL,
  invoice_date date,
  invoice_amount numeric(18,2),
  source_batch_id uuid REFERENCES recon.import_batches(id),
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_set_id, invoice_no)
);

CREATE INDEX IF NOT EXISTS ledger_invoice_lookup_idx
  ON recon.ledger_invoices (account_set_id, invoice_no, invoice_date, invoice_amount);

CREATE TABLE IF NOT EXISTS recon.difference_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL REFERENCES recon.reconciliations(id) ON DELETE CASCADE,
  category text NOT NULL,
  invoice_id uuid REFERENCES recon.ledger_invoices(id),
  invoice_no text,
  invoice_date date,
  difference_amount numeric(18,2),
  difference_description text,
  attachment_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  verification_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (verification_status IN ('not_applicable', 'pending', 'matched', 'mismatched')),
  verification_message text,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT blank_invoice_not_verified CHECK (
    invoice_no IS NOT NULL OR (invoice_date IS NULL AND verification_status = 'not_applicable')
  )
);

CREATE INDEX IF NOT EXISTS difference_items_reconciliation_idx
  ON recon.difference_items (reconciliation_id, category);
CREATE INDEX IF NOT EXISTS difference_items_invoice_idx
  ON recon.difference_items (invoice_no) WHERE invoice_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS recon.followup_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL UNIQUE REFERENCES recon.reconciliations(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES recon.users(id),
  expected_complete_at timestamptz,
  next_follow_up_at timestamptz,
  latest_follow_up_at timestamptz,
  follow_status text NOT NULL DEFAULT 'pending',
  process_stage text,
  risk_level text NOT NULL DEFAULT 'low',
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS recon.followup_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  followup_item_id uuid NOT NULL REFERENCES recon.followup_items(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  content text,
  operator_id uuid REFERENCES recon.users(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS recon.material_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid REFERENCES recon.reconciliations(id) ON DELETE CASCADE,
  quarter_id uuid NOT NULL REFERENCES recon.quarters(id),
  account_set_id uuid REFERENCES recon.account_sets(id),
  customer_id uuid REFERENCES recon.customers(id),
  material_type text NOT NULL,
  provided boolean,
  raw_value text,
  source_batch_id uuid REFERENCES recon.import_batches(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS material_status_report_idx
  ON recon.material_status (quarter_id, material_type, provided);

CREATE TABLE IF NOT EXISTS recon.file_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_key text NOT NULL UNIQUE,
  original_name text NOT NULL,
  content_type text,
  size_bytes bigint,
  sha256 text,
  uploaded_by uuid REFERENCES recon.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recon.audit_logs (
  id bigserial PRIMARY KEY,
  actor_id uuid REFERENCES recon.users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  request_id text,
  ip_address inet,
  before_data jsonb,
  after_data jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_entity_idx
  ON recon.audit_logs (entity_type, entity_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS recon.legacy_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  source_sha256 text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  captured_at timestamptz,
  migrated_at timestamptz,
  migration_status text NOT NULL DEFAULT 'captured'
    CHECK (migration_status IN ('captured', 'validated', 'migrated', 'failed')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recon.migration_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_key text NOT NULL UNIQUE,
  quarter_code text,
  source_sha256 text NOT NULL,
  source_record_count integer NOT NULL,
  migrated_record_count integer,
  status text NOT NULL CHECK (status IN ('pending', 'validated', 'migrated', 'failed', 'rolled_back')),
  error_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

INSERT INTO recon.roles (code, name)
VALUES
  ('admin', '系统管理员'),
  ('management', '管理层'),
  ('finance_manager', '财务主管'),
  ('owner', '对账负责人')
ON CONFLICT (code) DO NOTHING;

INSERT INTO recon.schema_migrations (version)
VALUES ('001_foundation')
ON CONFLICT (version) DO NOTHING;

COMMIT;
