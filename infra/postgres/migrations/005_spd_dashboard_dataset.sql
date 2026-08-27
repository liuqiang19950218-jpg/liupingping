-- 005: independent quarterly SPD dashboard dataset.
--
-- The system has TWO completely separate SPD data sources (business-confirmed):
--
--   SPD SOURCE A (recon.material_status):
--     -> uploaded together with 对账函 / 确认函 / 在途证明 / 催款函 / 精准核销
--     -> used ONLY by 本季度对账详细情况表
--     -> MUST NOT be read / written / overwritten by the SPD dashboard
--
--   SPD SOURCE B (recon.spd_dashboard_rows, THIS TABLE):
--     -> separately uploaded SPD 专项 Excel (e.g. 26年1季度SPD库存明细表.xlsx)
--     -> used ONLY by 对账看板 SPD资料已提供情况
--     -> an independent per-quarter dataset
--
-- The two datasets are NOT merged, NOT synced, NOT overwritten by each other.
-- Even if their values differ that is expected — the business口径 is different.
--
-- This migration ONLY adds the independent Dashboard SPD dataset. It does NOT
-- touch recon.material_status (no INSERT/UPDATE/DELETE of material_status) and
-- does NOT change any existing business table.
--
-- Row semantics (business-confirmed):
--   * Every source row of the SPD sheet is preserved, including rows whose
--     SPD确认表 / SPD库存确认函 are empty (empty state = "未提交", still counted
--     in total).
--   * Raw 账套 / 区域 / 客户名称 are preserved as source truth (raw text) even
--     if a reconciliation match fails — unmatched rows keep reconciliation_id
--     NULL but MUST still exist.
--   * "是" and "否" both count as submitted; only blank/NULL counts as unsubmitted.
--   * remark is stored but NOT used for statistics this phase.
--   * source_payload preserves the original row (kept server-side; not exposed
--     wholesale to the frontend).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS +
-- schema_migrations ON CONFLICT DO NOTHING.
BEGIN;

CREATE TABLE IF NOT EXISTS recon.spd_dashboard_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quarter_id uuid NOT NULL REFERENCES recon.quarters(id) ON DELETE CASCADE,
  source_row_key text NOT NULL,
  source_row_number integer,
  source_file_name text,
  account_set_raw text,
  region_raw text,
  customer_name_raw text,
  spd_confirmation_raw text,
  spd_inventory_confirmation_raw text,
  remark text,
  source_payload jsonb,
  reconciliation_id uuid REFERENCES recon.reconciliations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per source row per quarter; the content hash is deterministic so a
-- re-import of the same file is replay-safe.
CREATE UNIQUE INDEX IF NOT EXISTS spd_dashboard_rows_quarter_source_row_key
  ON recon.spd_dashboard_rows (quarter_id, source_row_key);

CREATE INDEX IF NOT EXISTS spd_dashboard_rows_quarter_id
  ON recon.spd_dashboard_rows (quarter_id);

CREATE INDEX IF NOT EXISTS spd_dashboard_rows_reconciliation_id
  ON recon.spd_dashboard_rows (reconciliation_id);

-- Runtime access: the app role reads the dashboard dataset (future import will
-- also write it). Explicit GRANT keeps parity with the other recon tables even
-- if ALTER DEFAULT PRIVILEGES was not in effect at creation time. The id column
-- is gen_random_uuid() (no sequence exists), so there is no sequence GRANT.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE recon.spd_dashboard_rows TO quarterly_app;

INSERT INTO recon.schema_migrations (version)
VALUES ('005_spd_dashboard_dataset')
ON CONFLICT (version) DO NOTHING;

COMMIT;
