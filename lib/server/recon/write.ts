// PostgreSQL runtime WRITE data layer (recon schema).
// Phase 2B: business write APIs. Every write is quarter-scoped AND
// reconciliation-scoped — a child item can never be reached across quarters.
//
// Business rules:
//  - difference is ALWAYS recomputed by the server from DB values:
//      difference = company_receivable - customer_book_amount
//    a client-supplied differenceAmount / reconciliationDifference is NEVER
//    trusted as the final value.
//  - customer_book_amount = NULL  =>  difference_amount = NULL (never 0,
//    never company_receivable).
//  - reconciliation_status is stored only when explicitly provided; NULL is
//    preserved, never auto-backfilled to "unreconciled".
//  - amounts are validated as decimal strings and written as NUMERIC — no
//    binary float arithmetic anywhere in the write path.
import {
  withPostgresTransaction,
} from "../../../db/postgres";
import { invalidInput, notFound, conflict } from "./errors";
import { verifyLedgerInvoice } from "../ledger/ledger";

const AMOUNT_RE = /^-?\d+(\.\d{1,2})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const DIFFERENCE_CATEGORIES = [
  "transit",
  "returned",
  "lost",
  "instrument",
  "otherInvoice",
  "other",
] as const;

export const VERIFICATION_STATUSES = [
  "not_applicable",
  "pending",
  "matched",
  "mismatched",
] as const;

// Categories that carry an invoice and MUST be verified against the company
// ledger. Mirrors the legacy UI (`invoice: true`): transit/returned/lost/
// instrument/otherInvoice in the NEW write taxonomy, PLUS the migrated legacy
// category values verbatim (returned_invoice/lost_invoice/equipment/
// other_with_invoice) which the DB stores as-is for migrated quarters.
// `other` and `other_without_invoice` are 无发票 -> not_applicable.
export const LEDGER_VERIFICATION_CATEGORIES = new Set<string>([
  // new write taxonomy
  "transit",
  "returned",
  "lost",
  "instrument",
  "otherInvoice",
  // migrated legacy taxonomy (verbatim values in recon.difference_items)
  "returned_invoice",
  "lost_invoice",
  "equipment",
  "other_with_invoice",
]);

type Row = Record<string, unknown>;

function isValidAmountString(s: string): boolean {
  if (!AMOUNT_RE.test(s)) return false;
  const intPart = (s.startsWith("-") ? s.slice(1) : s).split(".")[0];
  return intPart.length <= 16; // numeric(18,2) -> max 16 integer digits
}

type AmountResult = { ok: true; value: string | null } | { ok: false };

export function normalizeAmount(value: unknown): AmountResult {
  if (value === null) return { ok: true, value: null };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { ok: false };
    const s = String(value);
    return isValidAmountString(s) ? { ok: true, value: s } : { ok: false };
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (t === "") return { ok: false };
    return isValidAmountString(t) ? { ok: true, value: t } : { ok: false };
  }
  return { ok: false };
}

function requiredAmount(value: unknown, field: string): string | null {
  const a = normalizeAmount(value);
  if (!a.ok) throw invalidInput(`${field} 必须是有效金额（最多2位小数）`);
  return a.value;
}

function normalizeString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw invalidInput(`${field} 必须是字符串或 null`);
  const t = value.trim();
  return t === "" ? null : t;
}

function normalizeDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw invalidInput(`${field} 必须是 YYYY-MM-DD 字符串`);
  const t = value.trim();
  if (!DATE_RE.test(t) || Number.isNaN(Date.parse(`${t}T00:00:00Z`))) {
    throw invalidInput(`${field} 必须是有效的 YYYY-MM-DD 日期`);
  }
  return t;
}

function normalizeTimestamptz(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw invalidInput(`${field} 必须是 ISO 时间字符串`);
  const t = value.trim();
  if (t === "" || Number.isNaN(Date.parse(t))) {
    throw invalidInput(`${field} 必须是有效的时间`);
  }
  return t;
}

function normalizeBoolean(value: unknown, field: string): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "boolean") throw invalidInput(`${field} 必须是布尔值或 null`);
  return value;
}

// ---------------------------------------------------------------------------
// Ownership resolution — the single gate for quarter scoping.
// ---------------------------------------------------------------------------
type ReconciliationRef = {
  id: string;
  quarterId: string;
  quarterCode: string;
  companyReceivable: string | null;
};

async function resolveReconciliationInQuarter(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: Row[] }> },
  quarterCode: string,
  reconciliationId: string,
): Promise<ReconciliationRef> {
  const res = await client.query(
    `SELECT r.id, r.quarter_id, q.code AS quarter_code,
            r.company_receivable::text AS company_receivable
     FROM recon.reconciliations r
     JOIN recon.quarters q ON q.id = r.quarter_id
     WHERE r.id = $1 AND q.code = $2`,
    [reconciliationId, quarterCode],
  );
  if (res.rowCount) {
    const row = res.rows[0];
    return {
      id: row.id as string,
      quarterId: row.quarter_id as string,
      quarterCode: row.quarter_code as string,
      companyReceivable: (row.company_receivable as string | null) ?? null,
    };
  }
  const elsewhere = await client.query(
    `SELECT q.code FROM recon.reconciliations r
     JOIN recon.quarters q ON q.id = r.quarter_id
     WHERE r.id = $1`,
    [reconciliationId],
  );
  if (elsewhere.rowCount) throw conflict("对账记录不属于该季度");
  throw notFound("对账记录不存在");
}

async function resolveDifferenceItemInQuarter(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: Row[] }> },
  quarterCode: string,
  itemId: string,
): Promise<{ id: string; reconciliationId: string; invoiceNo: string | null; invoiceDate: string | null; category: string; differenceAmount: string | null }> {
  const res = await client.query(
    `SELECT d.id, d.reconciliation_id::text, d.invoice_no,
            to_char(d.invoice_date, 'YYYY-MM-DD') AS invoice_date,
            d.category, d.difference_amount::text AS difference_amount,
            q.code AS quarter_code
     FROM recon.difference_items d
     JOIN recon.reconciliations r ON r.id = d.reconciliation_id
     JOIN recon.quarters q ON q.id = r.quarter_id
     WHERE d.id = $1`,
    [itemId],
  );
  if (!res.rowCount) throw notFound("差额明细不存在");
  const row = res.rows[0];
  if (row.quarter_code !== quarterCode) throw conflict("差额明细不属于该季度");
  return {
    id: row.id as string,
    reconciliationId: row.reconciliation_id as string,
    invoiceNo: (row.invoice_no as string | null) ?? null,
    invoiceDate: (row.invoice_date as string | null) ?? null,
    category: row.category as string,
    differenceAmount: (row.difference_amount as string | null) ?? null,
  };
}

async function resolveMaterialInQuarter(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: Row[] }> },
  quarterCode: string,
  materialId: string,
): Promise<{ id: string; reconciliationId: string | null; quarterId: string; quarterCode: string }> {
  const res = await client.query(
    `SELECT m.id, m.reconciliation_id::text, m.quarter_id, q.code AS quarter_code
     FROM recon.material_status m
     JOIN recon.quarters q ON q.id = m.quarter_id
     WHERE m.id = $1`,
    [materialId],
  );
  if (!res.rowCount) throw notFound("资料状态记录不存在");
  const row = res.rows[0];
  if (row.quarter_code !== quarterCode) throw conflict("资料状态不属于该季度");
  return {
    id: row.id as string,
    reconciliationId: (row.reconciliation_id as string | null) ?? null,
    quarterId: row.quarter_id as string,
    quarterCode: row.quarter_code as string,
  };
}

async function getQuarterByCode(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: Row[] }> },
  code: string,
): Promise<{ id: string; code: string }> {
  const res = await client.query(
    `SELECT id, code FROM recon.quarters WHERE code = $1`,
    [code],
  );
  if (!res.rowCount) throw notFound("季度不存在");
  return { id: res.rows[0].id as string, code: res.rows[0].code as string };
}

// ---------------------------------------------------------------------------
// Reconciliation PATCH
// ---------------------------------------------------------------------------
export async function patchReconciliation(
  quarterCode: string,
  reconciliationId: string,
  patch: Record<string, unknown>,
) {
  return withPostgresTransaction(async (client) => {
    const ref = await resolveReconciliationInQuarter(client, quarterCode, reconciliationId);

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const pushSet = (col: string, value: unknown) => {
      sets.push(`${col} = $${i++}`);
      params.push(value);
    };

    if ("customerBookAmount" in patch) {
      const a = normalizeAmount(patch.customerBookAmount);
      if (!a.ok) throw invalidInput("客户账面金额必须是有效金额（最多2位小数）");
      pushSet("customer_book_amount", a.value);
      if (a.value === null) {
        // NULL customer book => difference MUST be NULL (never 0, never company receivable)
        pushSet("reconciliation_difference", null);
      } else {
        // difference is always recomputed by the SERVER from DB values.
        sets.push(
          `reconciliation_difference = CASE WHEN company_receivable IS NULL THEN NULL ELSE company_receivable - $${i}::numeric END`,
        );
        params.push(a.value);
        i++;
      }
    }
    if ("reconciliationStatus" in patch) {
      const v = patch.reconciliationStatus;
      if (v !== null && typeof v !== "string") throw invalidInput("对账状态必须是字符串或 null");
      pushSet("reconciliation_status", v === null ? null : v);
    }
    if ("badDebtAmount" in patch) {
      pushSet("bad_debt_amount", requiredAmount(patch.badDebtAmount, "死账金额"));
    }
    if ("badDebtReason" in patch) {
      pushSet("bad_debt_reason", normalizeString(patch.badDebtReason, "死账原因"));
    }
    if ("adjustmentAmount" in patch) {
      pushSet("adjustment_amount", requiredAmount(patch.adjustmentAmount, "调账金额"));
    }
    if ("adjustmentReason" in patch) {
      pushSet("adjustment_reason", normalizeString(patch.adjustmentReason, "调账原因"));
    }
    if ("solution" in patch) {
      pushSet("solution", normalizeString(patch.solution, "解决方案"));
    }
    if ("solutionDate" in patch) {
      pushSet("solution_date", normalizeDate(patch.solutionDate, "解决日期"));
    }
    if ("ownerName" in patch) {
      // Editable business owner name. String -> trim (empty -> NULL); null -> NULL.
      // Only owner_name is written — the original import value inside
      // source_payload (provenance) is NEVER overwritten.
      const v = patch.ownerName;
      if (v !== null && typeof v !== "string") {
        throw invalidInput("负责人姓名必须是字符串或 null");
      }
      const trimmed = v === null ? null : v.trim();
      pushSet("owner_name", trimmed === "" ? null : trimmed);
    }

    if (sets.length === 0) throw invalidInput("没有可更新的字段");

    sets.push("updated_at = now()");
    sets.push("version = version + 1");
    params.push(ref.id);

    const sql =
      `UPDATE recon.reconciliations SET ${sets.join(", ")} WHERE id = $${i} ` +
      `RETURNING id::text AS id, company_receivable::text, customer_book_amount::text, ` +
      `reconciliation_difference::text, reconciliation_status, bad_debt_amount::text, ` +
      `bad_debt_reason, adjustment_amount::text, adjustment_reason, solution, ` +
      `to_char(solution_date, 'YYYY-MM-DD') AS solution_date, owner_id::text, owner_name`;
    const res = await client.query(sql, params);
    const row = res.rows[0];
    return {
      id: row.id,
      quarterCode: ref.quarterCode,
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
      ownerName: row.owner_name ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Difference items
// ---------------------------------------------------------------------------
function normalizeCategory(value: unknown): string {
  if (
    typeof value !== "string" ||
    !(DIFFERENCE_CATEGORIES as readonly string[]).includes(value)
  ) {
    throw invalidInput(
      "差额类别必须是 transit/returned/lost/instrument/otherInvoice/other 之一",
    );
  }
  return value;
}

function normalizeVerificationStatus(value: unknown): string {
  if (value === undefined || value === null) return "not_applicable";
  if (
    typeof value !== "string" ||
    !(VERIFICATION_STATUSES as readonly string[]).includes(value)
  ) {
    throw invalidInput("verificationStatus 必须是 not_applicable/pending/matched/mismatched 之一");
  }
  return value;
}

// Server-authoritative ledger verification enforcement (Phase 2G.1).
// The client may send a verificationStatus, but it is NEVER trusted as the
// final decision for invoice categories. The server queries the PostgreSQL
// ledger dataset (active HISTORICAL_BASE UNION current quarter snapshot) and
// decides matched / not_found itself. A required verification that does not
// match is REJECTED (409) so a forged "matched" cannot be persisted.
async function enforceLedgerVerification(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: Row[] }> },
  quarterCode: string,
  category: string,
  invoiceNo: string | null,
  invoiceDate: string | null,
  amount: string | null,
): Promise<{ verificationStatus: string; matchedDatasetType: string | null; matchedDatasetId: string | null }> {
  // 无发票类别 (other) is not applicable.
  if (!LEDGER_VERIFICATION_CATEGORIES.has(category)) {
    return { verificationStatus: "not_applicable", matchedDatasetType: null, matchedDatasetId: null };
  }
  // Blank invoice rows in an invoice category have no ledger requirement.
  if (!invoiceNo) {
    return { verificationStatus: "not_applicable", matchedDatasetType: null, matchedDatasetId: null };
  }
  // An invoice number present but no date/amount cannot be verified.
  if (!invoiceDate || !amount) {
    throw invalidInput("发票类差额必须提供发票日期和金额用于往来核验");
  }
  const result = await verifyLedgerInvoice(client, quarterCode, {
    invoiceNo,
    invoiceDate,
    amount,
  });
  if (!result.matched) {
    throw conflict(
      `发票 ${invoiceNo}（${invoiceDate}，${amount}）未在公司往来底账中找到（LEDGER_INVOICE_NOT_FOUND）`,
    );
  }
  return {
    verificationStatus: "matched",
    matchedDatasetType: result.matchedDatasetType,
    matchedDatasetId: result.matchedDatasetId,
  };
}

function normalizeAttachmentKeys(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (
    !Array.isArray(value) ||
    !value.every((k) => typeof k === "string")
  ) {
    throw invalidInput("attachmentKeys 必须是字符串数组");
  }
  return value as string[];
}

// Canonical difference-item resource shape, identical to the GET
// (getDifferenceItems) shape so POST / PATCH / GET all return one shape.
function toDifferenceItemResource(row: Row) {
  return {
    id: row.id as string,
    category: row.category as string,
    invoiceNo: (row.invoice_no as string | null) ?? null,
    invoiceDate: (row.invoice_date as string | null) ?? null,
    differenceAmount: (row.difference_amount as string | null) ?? null,
    differenceDescription: (row.difference_description as string | null) ?? null,
    verificationStatus: row.verification_status as string,
    attachmentKeys: Array.isArray(row.attachment_keys)
      ? (row.attachment_keys as unknown[]).filter((k) => typeof k === "string")
      : [],
  };
}

export async function createDifferenceItem(
  quarterCode: string,
  reconciliationId: string,
  input: Record<string, unknown>,
) {
  return withPostgresTransaction(async (client) => {
    const ref = await resolveReconciliationInQuarter(client, quarterCode, reconciliationId);
    const category = normalizeCategory(input.category);
    const invoiceNo = normalizeString(input.invoiceNo, "发票号");
    const invoiceDate =
      input.invoiceDate === undefined || input.invoiceDate === null
        ? null
        : normalizeDate(input.invoiceDate, "发票日期");
    if (invoiceDate && !invoiceNo) {
      throw invalidInput("提供发票日期时必须同时提供发票号");
    }
    const amount = requiredAmount(input.differenceAmount, "差额金额");
    const description = normalizeString(input.differenceDescription, "差额说明");
    // Server-authoritative: the client's verificationStatus is NOT trusted for
    // invoice categories; the server verifies against the PG ledger and decides.
    const enforced = await enforceLedgerVerification(
      client,
      quarterCode,
      category,
      invoiceNo,
      invoiceDate,
      amount,
    );
    const verificationStatus = enforced.verificationStatus;
    const attachmentKeys = normalizeAttachmentKeys(input.attachmentKeys);

    const res = await client.query(
      `INSERT INTO recon.difference_items
        (reconciliation_id, category, invoice_no, invoice_date, difference_amount,
         difference_description, verification_status, attachment_keys)
       VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, $8::jsonb)
       RETURNING id::text, category, invoice_no,
         to_char(invoice_date, 'YYYY-MM-DD') AS invoice_date,
         difference_amount::text, difference_description, verification_status,
         attachment_keys`,
      [ref.id, category, invoiceNo, invoiceDate, amount, description, verificationStatus, JSON.stringify(attachmentKeys)],
    );
    return toDifferenceItemResource(res.rows[0]);
  });
}

export async function updateDifferenceItem(
  quarterCode: string,
  reconciliationId: string,
  itemId: string,
  input: Record<string, unknown>,
) {
  return withPostgresTransaction(async (client) => {
    const item = await resolveDifferenceItemInQuarter(client, quarterCode, itemId);
    if (item.reconciliationId !== reconciliationId) {
      throw conflict("差额明细不属于该对账记录");
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const pushSet = (col: string, value: unknown) => {
      sets.push(`${col} = $${i++}`);
      params.push(value);
    };

    let nextInvoiceNo = item.invoiceNo;
    let nextInvoiceDate = item.invoiceDate;
    let nextCategory = item.category;
    let nextAmount = item.differenceAmount;
    let verificationFieldsChanged = false;
    if ("invoiceNo" in input) {
      nextInvoiceNo = normalizeString(input.invoiceNo, "发票号");
      pushSet("invoice_no", nextInvoiceNo);
      verificationFieldsChanged = true;
    }
    if ("invoiceDate" in input) {
      nextInvoiceDate =
        input.invoiceDate === null || input.invoiceDate === undefined
          ? null
          : normalizeDate(input.invoiceDate, "发票日期");
      pushSet("invoice_date", nextInvoiceDate);
      verificationFieldsChanged = true;
    }
    if (nextInvoiceDate && !nextInvoiceNo) {
      throw invalidInput("提供发票日期时必须同时提供发票号");
    }
    if ("category" in input) {
      nextCategory = normalizeCategory(input.category);
      pushSet("category", nextCategory);
      verificationFieldsChanged = true;
    }
    if ("differenceAmount" in input) {
      nextAmount = requiredAmount(input.differenceAmount, "差额金额");
      pushSet("difference_amount", nextAmount);
      verificationFieldsChanged = true;
    }
    if ("differenceDescription" in input) {
      pushSet("difference_description", normalizeString(input.differenceDescription, "差额说明"));
    }
    // Server-authoritative verification: when any verification-relevant field
    // changed (category/invoiceNo/invoiceDate/amount), re-verify against the PG
    // ledger and override verification_status. A client-supplied
    // verificationStatus is NEVER trusted for invoice categories.
    if (verificationFieldsChanged) {
      const enforced = await enforceLedgerVerification(
        client,
        quarterCode,
        nextCategory,
        nextInvoiceNo,
        nextInvoiceDate,
        nextAmount,
      );
      pushSet("verification_status", enforced.verificationStatus);
    } else if ("verificationStatus" in input) {
      pushSet("verification_status", normalizeVerificationStatus(input.verificationStatus));
    }
    if ("attachmentKeys" in input) {
      pushSet("attachment_keys", JSON.stringify(normalizeAttachmentKeys(input.attachmentKeys)));
    }
    if (sets.length === 0) throw invalidInput("没有可更新的字段");

    sets.push("updated_at = now()");
    sets.push("version = version + 1");
    params.push(itemId);

    const sql =
      `UPDATE recon.difference_items SET ${sets.join(", ")} WHERE id = $${i} ` +
      `RETURNING id::text, category, invoice_no, ` +
      `to_char(invoice_date, 'YYYY-MM-DD') AS invoice_date, difference_amount::text, ` +
      `difference_description, verification_status, attachment_keys`;
    const res = await client.query(sql, params);
    return toDifferenceItemResource(res.rows[0]);
  });
}

export async function deleteDifferenceItem(
  quarterCode: string,
  reconciliationId: string,
  itemId: string,
) {
  return withPostgresTransaction(async (client) => {
    const item = await resolveDifferenceItemInQuarter(client, quarterCode, itemId);
    if (item.reconciliationId !== reconciliationId) {
      throw conflict("差额明细不属于该对账记录");
    }
    await client.query(`DELETE FROM recon.difference_items WHERE id = $1`, [itemId]);
    return { deleted: true, id: itemId, quarter: quarterCode, reconciliationId };
  });
}

// ---------------------------------------------------------------------------
// Followups (one followup_item per reconciliation + followup_events history)
// ---------------------------------------------------------------------------
async function findFollowupItem(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: Row[] }> },
  reconciliationId: string,
): Promise<{ id: string } | null> {
  const res = await client.query(
    `SELECT id FROM recon.followup_items WHERE reconciliation_id = $1`,
    [reconciliationId],
  );
  return res.rowCount ? { id: res.rows[0].id as string } : null;
}

type FollowupEvent = { eventType: string; content: string | null; occurredAt: string };

function normalizeEvent(input: unknown): FollowupEvent | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== "object" || Array.isArray(input)) {
    throw invalidInput("event 必须是 JSON 对象");
  }
  const e = input as Record<string, unknown>;
  if (typeof e.eventType !== "string" || e.eventType.trim() === "") {
    throw invalidInput("跟进事件 eventType 必填");
  }
  const content = normalizeString(e.content, "跟进内容");
  const occurredAt =
    e.occurredAt === undefined || e.occurredAt === null
      ? new Date().toISOString()
      : (normalizeTimestamptz(e.occurredAt, "跟进时间") ?? new Date().toISOString());
  return { eventType: e.eventType.trim(), content, occurredAt };
}

async function insertEvent(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: Row[] }> },
  followupItemId: string,
  event: FollowupEvent,
): Promise<Row> {
  const res = await client.query(
    `INSERT INTO recon.followup_events (followup_item_id, event_type, content, occurred_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id::text, event_type, content, occurred_at::text`,
    [followupItemId, event.eventType, event.content, event.occurredAt],
  );
  return res.rows[0];
}

function normalizeFollowupScalars(input: Record<string, unknown>) {
  return {
    processStage: normalizeString(input.processStage, "处理阶段"),
    expectedCompleteAt: normalizeTimestamptz(input.expectedCompleteAt, "预期完成时间"),
    nextFollowUpAt: normalizeTimestamptz(input.nextFollowUpAt, "下次跟进时间"),
    latestFollowUpAt: normalizeTimestamptz(input.latestFollowUpAt, "最近跟进时间"),
    closedAt: normalizeTimestamptz(input.closedAt, "关闭时间"),
  };
}

export async function createFollowup(
  quarterCode: string,
  reconciliationId: string,
  input: Record<string, unknown>,
) {
  return withPostgresTransaction(async (client) => {
    const ref = await resolveReconciliationInQuarter(client, quarterCode, reconciliationId);
    const existing = await findFollowupItem(client, ref.id);
    if (existing) throw conflict("该对账记录已存在跟进记录");

    const followStatus =
      input.followStatus === undefined || input.followStatus === null
        ? "pending"
        : normalizeString(input.followStatus, "跟进状态") ?? "pending";
    const riskLevel =
      input.riskLevel === undefined || input.riskLevel === null
        ? "low"
        : normalizeString(input.riskLevel, "风险等级") ?? "low";
    const scalars = normalizeFollowupScalars(input);
    const event = normalizeEvent(input.event);

    const res = await client.query(
      `INSERT INTO recon.followup_items
         (reconciliation_id, follow_status, process_stage, risk_level,
          expected_complete_at, next_follow_up_at, latest_follow_up_at, closed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id::text, follow_status, process_stage, risk_level,
         expected_complete_at::text, next_follow_up_at::text,
         latest_follow_up_at::text, closed_at::text`,
      [ref.id, followStatus, scalars.processStage, riskLevel,
       scalars.expectedCompleteAt, scalars.nextFollowUpAt,
       scalars.latestFollowUpAt, scalars.closedAt],
    );
    const item = res.rows[0];
    let eventCreated = false;
    if (event) {
      await insertEvent(client, item.id as string, event);
      eventCreated = true;
    }
    return { ...item, quarter: quarterCode, reconciliationId: ref.id, eventCreated };
  });
}

export async function updateFollowup(
  quarterCode: string,
  reconciliationId: string,
  input: Record<string, unknown>,
) {
  return withPostgresTransaction(async (client) => {
    const ref = await resolveReconciliationInQuarter(client, quarterCode, reconciliationId);
    const item = await findFollowupItem(client, ref.id);
    if (!item) throw notFound("该对账记录没有跟进记录，请先创建");

    const scalars = normalizeFollowupScalars(input);
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const pushSet = (col: string, value: unknown) => {
      sets.push(`${col} = $${i++}`);
      params.push(value);
    };

    // follow_status / risk_level are NOT NULL: explicit string sets them,
    // null/undefined keeps the current value.
    if (typeof input.followStatus === "string" && input.followStatus.trim() !== "") {
      pushSet("follow_status", input.followStatus.trim());
    }
    if (typeof input.riskLevel === "string" && input.riskLevel.trim() !== "") {
      pushSet("risk_level", input.riskLevel.trim());
    }
    if ("processStage" in input) pushSet("process_stage", scalars.processStage);
    if ("expectedCompleteAt" in input) pushSet("expected_complete_at", scalars.expectedCompleteAt);
    if ("nextFollowUpAt" in input) pushSet("next_follow_up_at", scalars.nextFollowUpAt);
    if ("latestFollowUpAt" in input) pushSet("latest_follow_up_at", scalars.latestFollowUpAt);
    if ("closedAt" in input) pushSet("closed_at", scalars.closedAt);

    const event = normalizeEvent(input.event);
    if (sets.length === 0 && !event) throw invalidInput("没有可更新的字段");

    if (sets.length) {
      sets.push("updated_at = now()");
      sets.push("version = version + 1");
      params.push(item.id);
      await client.query(
        `UPDATE recon.followup_items SET ${sets.join(", ")} WHERE id = $${i}`,
        params,
      );
    }
    if (event) await insertEvent(client, item.id, event);

    const res = await client.query(
      `SELECT f.id::text, f.follow_status, f.process_stage, f.risk_level,
         f.expected_complete_at::text, f.next_follow_up_at::text,
         f.latest_follow_up_at::text, f.closed_at::text
       FROM recon.followup_items f WHERE f.id = $1`,
      [item.id],
    );
    return { ...res.rows[0], quarter: quarterCode, reconciliationId: ref.id, eventCreated: Boolean(event) };
  });
}

export async function addFollowupEvent(
  quarterCode: string,
  reconciliationId: string,
  input: Record<string, unknown>,
) {
  return withPostgresTransaction(async (client) => {
    const ref = await resolveReconciliationInQuarter(client, quarterCode, reconciliationId);
    const item = await findFollowupItem(client, ref.id);
    if (!item) throw notFound("该对账记录没有跟进记录，请先创建");
    const event = normalizeEvent(input);
    if (!event) throw invalidInput("缺少跟进事件内容");
    const inserted = await insertEvent(client, item.id, event);
    return { ...inserted, quarter: quarterCode, reconciliationId: ref.id };
  });
}

export async function deleteFollowup(
  quarterCode: string,
  reconciliationId: string,
) {
  return withPostgresTransaction(async (client) => {
    const ref = await resolveReconciliationInQuarter(client, quarterCode, reconciliationId);
    const item = await findFollowupItem(client, ref.id);
    if (!item) throw notFound("该对账记录没有跟进记录");
    // DELETE cascades to followup_events via FK ON DELETE CASCADE.
    await client.query(`DELETE FROM recon.followup_items WHERE id = $1`, [item.id]);
    return { deleted: true, id: item.id, quarter: quarterCode, reconciliationId: ref.id };
  });
}

// ---------------------------------------------------------------------------
// Material status (reconciliation-level and quarter-level)
// ---------------------------------------------------------------------------
function normalizeMaterialType(value: unknown): string {
  const t = normalizeString(value, "materialType");
  if (!t) throw invalidInput("materialType 必填");
  if (t.length > 200) throw invalidInput("materialType 过长");
  return t;
}

export async function upsertReconciliationMaterial(
  quarterCode: string,
  reconciliationId: string,
  input: Record<string, unknown>,
) {
  return withPostgresTransaction(async (client) => {
    const ref = await resolveReconciliationInQuarter(client, quarterCode, reconciliationId);
    const materialType = normalizeMaterialType(input.materialType);
    const provided = normalizeBoolean(input.provided, "provided");
    const rawValue = normalizeString(input.rawValue, "raw_value");

    const existing = await client.query(
      `SELECT id FROM recon.material_status
       WHERE reconciliation_id = $1 AND material_type = $2`,
      [ref.id, materialType],
    );
    if (existing.rowCount) {
      const res = await client.query(
        `UPDATE recon.material_status SET provided = $1, raw_value = $2, updated_at = now()
         WHERE id = $3
         RETURNING id::text, material_type, provided, raw_value, reconciliation_id::text`,
        [provided, rawValue, existing.rows[0].id],
      );
      return { ...res.rows[0], quarter: quarterCode, reconciliationId: ref.id, scope: "reconciliation" };
    }
    const res = await client.query(
      `INSERT INTO recon.material_status
         (reconciliation_id, quarter_id, account_set_id, customer_id, material_type, provided, raw_value)
       SELECT $1, r.quarter_id, r.account_set_id, r.customer_id, $2, $3, $4
       FROM recon.reconciliations r WHERE r.id = $1
       RETURNING id::text, material_type, provided, raw_value, reconciliation_id::text`,
      [ref.id, materialType, provided, rawValue],
    );
    return { ...res.rows[0], quarter: quarterCode, reconciliationId: ref.id, scope: "reconciliation" };
  });
}

export async function updateReconciliationMaterial(
  quarterCode: string,
  reconciliationId: string,
  materialId: string,
  input: Record<string, unknown>,
) {
  return withPostgresTransaction(async (client) => {
    const m = await resolveMaterialInQuarter(client, quarterCode, materialId);
    if (m.reconciliationId !== reconciliationId) {
      throw conflict("资料状态不属于该对账记录");
    }
    const provided = normalizeBoolean(input.provided, "provided");
    const rawValue = normalizeString(input.rawValue, "raw_value");
    const res = await client.query(
      `UPDATE recon.material_status SET provided = $1, raw_value = $2, updated_at = now()
       WHERE id = $3
       RETURNING id::text, material_type, provided, raw_value, reconciliation_id::text`,
      [provided, rawValue, materialId],
    );
    return { ...res.rows[0], quarter: quarterCode, reconciliationId: m.reconciliationId, scope: "reconciliation" };
  });
}

export async function deleteReconciliationMaterial(
  quarterCode: string,
  reconciliationId: string,
  materialId: string,
) {
  return withPostgresTransaction(async (client) => {
    const m = await resolveMaterialInQuarter(client, quarterCode, materialId);
    if (m.reconciliationId !== reconciliationId) {
      throw conflict("资料状态不属于该对账记录");
    }
    await client.query(`DELETE FROM recon.material_status WHERE id = $1`, [materialId]);
    return { deleted: true, id: materialId, quarter: quarterCode, reconciliationId };
  });
}

export async function upsertQuarterMaterial(
  quarterCode: string,
  input: Record<string, unknown>,
) {
  return withPostgresTransaction(async (client) => {
    const quarter = await getQuarterByCode(client, quarterCode);
    const materialType = normalizeMaterialType(input.materialType);
    const provided = normalizeBoolean(input.provided, "provided");
    const rawValue = normalizeString(input.rawValue, "raw_value");

    const existing = await client.query(
      `SELECT id FROM recon.material_status
       WHERE quarter_id = $1 AND material_type = $2 AND reconciliation_id IS NULL`,
      [quarter.id, materialType],
    );
    if (existing.rowCount) {
      const res = await client.query(
        `UPDATE recon.material_status SET provided = $1, raw_value = $2, updated_at = now()
         WHERE id = $3
         RETURNING id::text, material_type, provided, raw_value`,
        [provided, rawValue, existing.rows[0].id],
      );
      return { ...res.rows[0], quarter: quarterCode, scope: "quarter", reconciliationId: null };
    }
    const res = await client.query(
      `INSERT INTO recon.material_status (quarter_id, material_type, provided, raw_value)
       VALUES ($1, $2, $3, $4)
       RETURNING id::text, material_type, provided, raw_value`,
      [quarter.id, materialType, provided, rawValue],
    );
    return { ...res.rows[0], quarter: quarterCode, scope: "quarter", reconciliationId: null };
  });
}

export async function deleteQuarterMaterial(
  quarterCode: string,
  materialId: string,
) {
  return withPostgresTransaction(async (client) => {
    const m = await resolveMaterialInQuarter(client, quarterCode, materialId);
    if (m.reconciliationId !== null) {
      throw conflict("该记录不是季度级资料状态");
    }
    await client.query(`DELETE FROM recon.material_status WHERE id = $1`, [materialId]);
    return { deleted: true, id: materialId, quarter: quarterCode };
  });
}
