// PostgreSQL runtime read data layer (recon schema).
// Phase 2A: READ ONLY. No INSERT/UPDATE/DELETE.
// Amounts are returned as strings (numeric::text) so JS numbers never corrupt precision.
import { withPostgresClient } from "../../../db/postgres";
import { ApiError } from "./errors";

export type QuarterSummary = {
  code: string;
  year: number;
  quarter: number;
  cutoffDate: string | null;
  status: string;
  reconciliationCount: number;
};

export type ReconciliationRead = {
  id: string;
  sourceRowKey: string | null;
  quarterCode: string;
  region: string | null;
  accountSet: string | null;
  customer: string | null;
  companyReceivable: string | null;
  customerBookAmount: string | null;
  reconciliationDifference: string | null;
  reconciliationStatus: string | null;
  badDebtAmount: string | null;
  badDebtReason: string | null;
  adjustmentAmount: string | null;
  adjustmentReason: string | null;
  solution: string | null;
  solutionDate: string | null;
  ownerId: string | null;
  ownerName: string | null;
};

export type DifferenceItemRead = {
  id: string;
  category: string;
  invoiceNo: string | null;
  invoiceDate: string | null;
  differenceAmount: string | null;
  differenceDescription: string | null;
  verificationStatus: string;
  attachmentKeys: string[];
};

export type FollowupEventRead = {
  id: string;
  eventType: string;
  content: string | null;
  occurredAt: string;
};

export type FollowupItemRead = {
  id: string;
  followStatus: string;
  processStage: string | null;
  riskLevel: string;
  expectedCompleteAt: string | null;
  nextFollowUpAt: string | null;
  latestFollowUpAt: string | null;
  closedAt: string | null;
  events: FollowupEventRead[];
};

export type MaterialStatusRead = {
  id: string;
  materialType: string;
  provided: boolean | null;
  rawValue: string | null;
  reconciliationId: string | null;
};

const QUARTER_CODE_RE = /^\d{4}-Q[1-4]$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidQuarterCode(code: string): boolean {
  return QUARTER_CODE_RE.test(code);
}

export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}

// Owner-name semantics:
//  - editable column owner_name (added by migration 004) holds the CURRENT
//    business owner; sales edits write ONLY this column.
//  - source_payload->>'owner_raw_name' is the preserved import provenance and is
//    never overwritten. When the editable column is empty, it is used as the
//    display fallback so the page owner column does not go blank after PG cutover.
//  - sentinel values (import artifacts / "未填写") are treated as "no owner".
const OWNER_NAME_SENTINELS = new Set([
  "0",
  "—",
  "-",
  "未填写",
  "未对账",
  "null",
  "undefined",
]);

function resolveOwnerName(editable: unknown, raw: unknown): string | null {
  const e = typeof editable === "string" ? editable.trim() : "";
  if (e !== "") return e;
  const r = typeof raw === "string" ? raw.trim() : "";
  if (r === "" || OWNER_NAME_SENTINELS.has(r)) return null;
  return r;
}

// Migration 004 is required for the ownerName contract. If the column is missing
// the API must fail with a recognizable server error (not a silent SQL 500) so a
// deployment against an un-migrated database is obvious.
async function assertOwnerNameColumn(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
): Promise<void> {
  const res = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'recon' AND table_name = 'reconciliations' AND column_name = 'owner_name'
     ) AS present`,
  );
  if (res.rows[0]?.present !== true) {
    throw new ApiError(
      500,
      "SCHEMA_004_REQUIRED",
      "负责人字段需要先应用迁移 004_reconciliation_owner_name",
    );
  }
}

export async function listQuarters(): Promise<QuarterSummary[]> {
  return withPostgresClient(async (client) => {
    const result = await client.query(
      `SELECT q.code, q.year, q.quarter,
              to_char(q.cutoff_date, 'YYYY-MM-DD') AS cutoff_date,
              q.status,
              (SELECT count(*)::int FROM recon.reconciliations x WHERE x.quarter_id = q.id) AS reconciliation_count
       FROM recon.quarters q
       ORDER BY q.year DESC, q.quarter DESC`,
    );
    return result.rows.map((row) => ({
      code: row.code,
      year: Number(row.year),
      quarter: Number(row.quarter),
      cutoffDate: row.cutoff_date ?? null,
      status: row.status,
      reconciliationCount: Number(row.reconciliation_count),
    }));
  });
}

export async function getQuarter(code: string): Promise<QuarterSummary | null> {
  const quarters = await listQuarters();
  return quarters.find((q) => q.code === code) ?? null;
}

export async function getReconciliations(code: string): Promise<ReconciliationRead[]> {
  return withPostgresClient(async (client) => {
    await assertOwnerNameColumn(client);
    const result = await client.query(
      `SELECT r.id::text,
              r.source_row_key,
              q.code AS quarter_code,
              reg.name AS region,
              a.name AS account_set,
              c.name AS customer,
              r.company_receivable::text,
              r.customer_book_amount::text,
              r.reconciliation_difference::text,
              r.reconciliation_status,
              r.bad_debt_amount::text,
              r.bad_debt_reason,
              r.adjustment_amount::text,
              r.adjustment_reason,
              r.solution,
              to_char(r.solution_date, 'YYYY-MM-DD') AS solution_date,
              r.owner_id::text,
              r.owner_name,
              r.source_payload->>'owner_raw_name' AS owner_raw_name
       FROM recon.reconciliations r
       JOIN recon.quarters q ON q.id = r.quarter_id
       JOIN recon.account_sets a ON a.id = r.account_set_id
       JOIN recon.customers c ON c.id = r.customer_id
       LEFT JOIN recon.regions reg ON reg.id = c.region_id
       WHERE q.code = $1
       ORDER BY r.source_row_key NULLS LAST, r.created_at ASC`,
      [code],
    );
    return result.rows.map((row) => ({
      id: row.id,
      sourceRowKey: row.source_row_key ?? null,
      quarterCode: row.quarter_code,
      region: row.region ?? null,
      accountSet: row.account_set ?? null,
      customer: row.customer ?? null,
      companyReceivable: row.company_receivable ?? null,
      customerBookAmount: row.customer_book_amount ?? null,
      reconciliationDifference: row.reconciliation_difference ?? null,
      reconciliationStatus: row.reconciliation_status ?? null,
      badDebtAmount: row.bad_debt_amount ?? null,
      badDebtReason: row.bad_debt_reason ?? null,
      adjustmentAmount: row.adjustment_amount ?? null,
      adjustmentReason: row.adjustment_reason ?? null,
      solution: row.solution ?? null,
      solutionDate: row.solution_date ?? null,
      ownerId: row.owner_id ?? null,
      ownerName: resolveOwnerName(row.owner_name, row.owner_raw_name),
    }));
  });
}

export async function getDifferenceItems(reconciliationId: string): Promise<DifferenceItemRead[]> {
  return withPostgresClient(async (client) => {
    const result = await client.query(
      `SELECT d.id::text, d.category, d.invoice_no,
              to_char(d.invoice_date, 'YYYY-MM-DD') AS invoice_date,
              d.difference_amount::text,
              d.difference_description,
              d.verification_status,
              d.attachment_keys
       FROM recon.difference_items d
       WHERE d.reconciliation_id = $1
       ORDER BY d.created_at ASC, d.id ASC`,
      [reconciliationId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      category: row.category,
      invoiceNo: row.invoice_no ?? null,
      invoiceDate: row.invoice_date ?? null,
      differenceAmount: row.difference_amount ?? null,
      differenceDescription: row.difference_description ?? null,
      verificationStatus: row.verification_status,
      attachmentKeys: Array.isArray(row.attachment_keys)
        ? (row.attachment_keys as unknown[]).filter((k) => typeof k === "string")
        : [],
    }));
  });
}

export async function getFollowups(reconciliationId: string): Promise<FollowupItemRead[]> {
  return withPostgresClient(async (client) => {
    const items = await client.query(
      `SELECT f.id::text, f.follow_status, f.process_stage, f.risk_level,
              f.expected_complete_at::text, f.next_follow_up_at::text,
              f.latest_follow_up_at::text, f.closed_at::text
       FROM recon.followup_items f
       WHERE f.reconciliation_id = $1
       ORDER BY f.created_at ASC, f.id ASC`,
      [reconciliationId],
    );
    const result: FollowupItemRead[] = [];
    for (const item of items.rows) {
      const events = await client.query(
        `SELECT e.id::text, e.event_type, e.content, e.occurred_at::text
         FROM recon.followup_events e
         WHERE e.followup_item_id = $1
         ORDER BY e.occurred_at ASC, e.id ASC`,
        [item.id],
      );
      result.push({
        id: item.id,
        followStatus: item.follow_status,
        processStage: item.process_stage ?? null,
        riskLevel: item.risk_level,
        expectedCompleteAt: item.expected_complete_at ?? null,
        nextFollowUpAt: item.next_follow_up_at ?? null,
        latestFollowUpAt: item.latest_follow_up_at ?? null,
        closedAt: item.closed_at ?? null,
        events: events.rows.map((event) => ({
          id: event.id,
          eventType: event.event_type,
          content: event.content ?? null,
          occurredAt: event.occurred_at,
        })),
      });
    }
    return result;
  });
}

export async function getMaterialStatusByReconciliation(
  reconciliationId: string,
): Promise<MaterialStatusRead[]> {
  return withPostgresClient(async (client) => {
    const result = await client.query(
      `SELECT m.id::text, m.material_type, m.provided, m.raw_value, m.reconciliation_id::text
       FROM recon.material_status m
       WHERE m.reconciliation_id = $1
       ORDER BY m.material_type ASC, m.id ASC`,
      [reconciliationId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      materialType: row.material_type,
      provided: row.provided,
      rawValue: row.raw_value ?? null,
      reconciliationId: row.reconciliation_id ?? null,
    }));
  });
}

export async function getMaterialStatusByQuarter(code: string): Promise<MaterialStatusRead[]> {
  return withPostgresClient(async (client) => {
    const result = await client.query(
      `SELECT m.id::text, m.material_type, m.provided, m.raw_value, m.reconciliation_id::text
       FROM recon.material_status m
       JOIN recon.quarters q ON q.id = m.quarter_id
       WHERE q.code = $1
       ORDER BY m.material_type ASC, m.id ASC`,
      [code],
    );
    return result.rows.map((row) => ({
      id: row.id,
      materialType: row.material_type,
      provided: row.provided,
      rawValue: row.raw_value ?? null,
      reconciliationId: row.reconciliation_id ?? null,
    }));
  });
}

// ---------------------------------------------------------------------------
// Quarter-scoped dashboard aggregate reads (Phase 2F.1)
// ---------------------------------------------------------------------------
// These are the ONLY quarter-level bulk reads for Dashboard charts. They return
// every difference item / followup (+ its events) for ONE quarter with a single
// (or a small, fixed) number of SQL statements — never a per-reconciliation loop.
//
// Join contract: each item carries `reconciliationId`; the Dashboard already has
// the shared `GET /api/quarter/[code]/reconciliations` dataset keyed by id, so it
// can Map-join for customer / region / accountSet / owner / reconciliationStatus
// without any extra HTTP. Amounts stay NUMERIC-as-string ("1234.56"); NULL stays
// NULL (never coerced to 0). invoiceDate is the real date or null.

export type QuarterDifferenceItemRead = {
  id: string;
  reconciliationId: string;
  quarterCode: string;
  category: string;
  invoiceNo: string | null;
  invoiceDate: string | null;
  differenceAmount: string | null;
  differenceDescription: string | null;
  verificationStatus: string;
  attachmentKeys: string[];
};

export type QuarterFollowupEventRead = {
  id: string;
  eventType: string;
  content: string | null;
  occurredAt: string;
};

export type QuarterFollowupItemRead = {
  id: string;
  reconciliationId: string;
  quarterCode: string;
  followStatus: string;
  processStage: string | null;
  riskLevel: string;
  expectedCompleteAt: string | null;
  nextFollowUpAt: string | null;
  latestFollowUpAt: string | null;
  closedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  events: QuarterFollowupEventRead[];
  latestEvent: QuarterFollowupEventRead | null;
};

export async function getDifferenceItemsByQuarter(code: string): Promise<QuarterDifferenceItemRead[]> {
  return withPostgresClient(async (client) => {
    const result = await client.query(
      `SELECT d.id::text, d.category, d.invoice_no,
              to_char(d.invoice_date, 'YYYY-MM-DD') AS invoice_date,
              d.difference_amount::text,
              d.difference_description,
              d.verification_status,
              d.attachment_keys,
              r.id::text AS reconciliation_id,
              q.code AS quarter_code
       FROM recon.difference_items d
       JOIN recon.reconciliations r ON r.id = d.reconciliation_id
       JOIN recon.quarters q ON q.id = r.quarter_id
       WHERE q.code = $1
       ORDER BY d.created_at ASC, d.id ASC`,
      [code],
    );
    return result.rows.map((row) => ({
      id: row.id,
      reconciliationId: row.reconciliation_id,
      quarterCode: row.quarter_code,
      category: row.category,
      invoiceNo: row.invoice_no ?? null,
      invoiceDate: row.invoice_date ?? null,
      differenceAmount: row.difference_amount ?? null,
      differenceDescription: row.difference_description ?? null,
      verificationStatus: row.verification_status,
      attachmentKeys: Array.isArray(row.attachment_keys)
        ? (row.attachment_keys as unknown[]).filter((k) => typeof k === "string")
        : [],
    }));
  });
}

export async function getFollowupsByQuarter(code: string): Promise<QuarterFollowupItemRead[]> {
  return withPostgresClient(async (client) => {
    const items = await client.query(
      `SELECT f.id::text, r.id::text AS reconciliation_id,
              f.follow_status, f.process_stage, f.risk_level,
              f.expected_complete_at::text, f.next_follow_up_at::text,
              f.latest_follow_up_at::text, f.closed_at::text,
              f.created_at::text, f.updated_at::text,
              q.code AS quarter_code
       FROM recon.followup_items f
       JOIN recon.reconciliations r ON r.id = f.reconciliation_id
       JOIN recon.quarters q ON q.id = r.quarter_id
       WHERE q.code = $1
       ORDER BY f.created_at ASC, f.id ASC`,
      [code],
    );
    if (items.rows.length === 0) return [];
    const itemIds = items.rows.map((row) => row.id as string);
    // Batch-load ALL events for this quarter's followup items in ONE query
    // (never a per-item event GET — that would be N+1).
    const events = await client.query(
      `SELECT e.id::text, e.followup_item_id::text, e.event_type, e.content,
              e.occurred_at::text
       FROM recon.followup_events e
       WHERE e.followup_item_id = ANY($1::uuid[])
       ORDER BY e.occurred_at ASC, e.id ASC`,
      [itemIds],
    );
    const eventsByItem = new Map<string, QuarterFollowupEventRead[]>();
    for (const row of events.rows) {
      const itemId = row.followup_item_id as string;
      const list = eventsByItem.get(itemId) ?? [];
      list.push({
        id: row.id,
        eventType: row.event_type,
        content: row.content ?? null,
        occurredAt: row.occurred_at,
      });
      eventsByItem.set(itemId, list);
    }
    return items.rows.map((row) => {
      const eventsList = eventsByItem.get(row.id as string) ?? [];
      const latest = eventsList.length > 0 ? eventsList[eventsList.length - 1] : null;
      return {
        id: row.id,
        reconciliationId: row.reconciliation_id,
        quarterCode: row.quarter_code,
        followStatus: row.follow_status,
        processStage: row.process_stage ?? null,
        riskLevel: row.risk_level,
        expectedCompleteAt: row.expected_complete_at ?? null,
        nextFollowUpAt: row.next_follow_up_at ?? null,
        latestFollowUpAt: row.latest_follow_up_at ?? null,
        closedAt: row.closed_at ?? null,
        createdAt: row.created_at ?? null,
        updatedAt: row.updated_at ?? null,
        events: eventsList,
        latestEvent: latest,
      };
    });
  });
}

// ---------------------------------------------------------------------------
// Independent quarterly SPD dashboard dataset (Phase 2F.4)
// ---------------------------------------------------------------------------
// This is SPD SOURCE B — the separately-uploaded SPD 专项 Excel, stored in
// recon.spd_dashboard_rows. It is COMPLETELY independent from recon.material_status
// (SPD SOURCE A, used by 本季度对账详细情况表). The two are never merged/synced.
//
// Row semantics (business-confirmed):
//  - Every source row is preserved (including empty-status rows).
//  - "是" and "否" both count as submitted; only blank/NULL counts as unsubmitted.
//  - Raw 账套/区域/客户名称 are source truth; unmatched rows keep
//    reconciliation_id NULL but still exist.
//  - remark is stored but not used for statistics this phase.
//  - source_payload is kept server-side and never exposed wholesale to the frontend.

export type SpdDashboardRowRead = {
  id: string;
  sourceRowNumber: number | null;
  accountSet: string | null;
  region: string | null;
  customer: string | null;
  spdConfirmation: string | null;
  spdInventoryConfirmation: string | null;
  reconciliationId: string | null;
};

export type SpdDashboardSummary = {
  total: number;
  submitted: number;
  unsubmitted: number;
  submissionRate: number | null;
};

export type SpdDashboardRead = {
  quarter: string;
  count: number;
  summary: {
    spdConfirmation: SpdDashboardSummary;
    spdInventoryConfirmation: SpdDashboardSummary;
  };
  items: SpdDashboardRowRead[];
};

function spdSummary(total: number, values: Array<string | null>): SpdDashboardSummary {
  const submitted = values.filter((v) => v !== null && v.trim() !== "").length;
  const unsubmitted = total - submitted;
  const submissionRate = total > 0 ? Number(((submitted / total) * 100).toFixed(1)) : null;
  return { total, submitted, unsubmitted, submissionRate };
}

// Exported for unit tests (pure function — no DB).
export const computeSpdSummary = spdSummary;

export async function getSpdDashboardByQuarter(code: string): Promise<SpdDashboardRead> {
  return withPostgresClient(async (client) => {
    const result = await client.query(
      `SELECT s.id::text, s.source_row_number, s.account_set_raw,
              s.region_raw, s.customer_name_raw,
              s.spd_confirmation_raw, s.spd_inventory_confirmation_raw,
              s.reconciliation_id::text
       FROM recon.spd_dashboard_rows s
       JOIN recon.quarters q ON q.id = s.quarter_id
       WHERE q.code = $1
       ORDER BY s.source_row_number ASC, s.id ASC`,
      [code],
    );
    const items: SpdDashboardRowRead[] = result.rows.map((row) => ({
      id: row.id,
      sourceRowNumber: row.source_row_number ?? null,
      accountSet: row.account_set_raw ?? null,
      region: row.region_raw ?? null,
      customer: row.customer_name_raw ?? null,
      spdConfirmation: row.spd_confirmation_raw ?? null,
      spdInventoryConfirmation: row.spd_inventory_confirmation_raw ?? null,
      reconciliationId: row.reconciliation_id ?? null,
    }));
    return {
      quarter: code,
      count: items.length,
      summary: {
        spdConfirmation: spdSummary(items.length, items.map((i) => i.spdConfirmation)),
        spdInventoryConfirmation: spdSummary(items.length, items.map((i) => i.spdInventoryConfirmation)),
      },
      items,
    };
  });
}
