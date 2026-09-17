import { createHash, randomUUID } from "node:crypto";
import { withPostgresClient, withPostgresTransaction } from "../../../db/postgres";
import { ApiError, conflict, invalidInput, notFound } from "./errors";
import { previousQuarterCode } from "../../previous-quarter-transfer-rules.mjs";

type SqlClient = { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: Record<string, unknown>[] }> };
type TransferItem = { id: string; category: string; invoiceNo: string | null; invoiceDate: string | null; differenceAmount: string | null; differenceDescription: string | null; transferStatus: "AVAILABLE" | "ALREADY_TRANSFERRED" | "CURRENT_INVOICE_EXISTS" };
type Target = { id: string; quarter: string; previousQuarter: string; accountSet: string; customer: string };

const previewTokens = new Map<string, { expiresAt: number; targetId: string; sourceId: string; targetQuarter: string; previousQuarter: string; snapshot: string }>();
const CONCURRENT = (message = "本季度差额明细已被其他用户更新，请重新预览后再操作。") => new ApiError(409, "CONCURRENT_CHANGE", message);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function targetFor(client: SqlClient, quarter: string, reconciliationId: string): Promise<Target> {
  const result = await client.query(
    `SELECT r.id::text, q.code AS quarter, a.name AS account_set, c.name AS customer
     FROM recon.reconciliations r
     JOIN recon.quarters q ON q.id = r.quarter_id
     JOIN recon.account_sets a ON a.id = r.account_set_id
     JOIN recon.customers c ON c.id = r.customer_id
     WHERE r.id = $1 AND q.code = $2`, [reconciliationId, quarter],
  );
  if (!result.rowCount) throw notFound("当前季度客户记录不存在");
  const row = result.rows[0];
  return { id: String(row.id), quarter: String(row.quarter), previousQuarter: previousQuarterCode(quarter), accountSet: String(row.account_set), customer: String(row.customer) };
}

async function matchingSources(client: SqlClient, target: Target) {
  const result = await client.query(
    `SELECT r.id::text, r.legacy_id::text AS sequence, g.name AS region,
            r.source_payload->>'timepoint' AS timepoint,
            r.company_receivable::text AS company_receivable,
            r.customer_book_amount::text AS customer_book_amount
     FROM recon.reconciliations r
     JOIN recon.quarters q ON q.id = r.quarter_id
     JOIN recon.account_sets a ON a.id = r.account_set_id
     JOIN recon.customers c ON c.id = r.customer_id
     LEFT JOIN recon.regions g ON g.id = c.region_id
     WHERE q.code = $1 AND a.name = $2 AND c.name = $3
     ORDER BY r.source_row_key NULLS LAST, r.created_at ASC, r.id ASC`,
    [target.previousQuarter, target.accountSet, target.customer],
  );
  return result.rows.map((row) => ({ id: String(row.id), sequence: row.sequence ?? null, region: row.region ?? null, timepoint: row.timepoint ?? null, companyReceivable: row.company_receivable ?? null, customerBookAmount: row.customer_book_amount ?? null }));
}

async function itemsForPreview(client: SqlClient, targetId: string, sourceId: string): Promise<{ items: TransferItem[]; snapshot: string }> {
  const [sourceResult, targetResult] = await Promise.all([
    client.query(`SELECT d.id::text, d.category, d.invoice_no, to_char(d.invoice_date, 'YYYY-MM-DD') AS invoice_date,
                         d.difference_amount::text, d.difference_description, d.version
                  FROM recon.difference_items d WHERE d.reconciliation_id = $1 ORDER BY d.created_at, d.id`, [sourceId]),
    client.query(`SELECT d.id::text, d.invoice_no, d.version,
                         d.source_payload #>> '{transfer_previous_quarter,source_difference_item_id}' AS source_difference_item_id
                  FROM recon.difference_items d WHERE d.reconciliation_id = $1 ORDER BY d.created_at, d.id`, [targetId]),
  ]);
  const transferred = new Set(targetResult.rows.map((row) => row.source_difference_item_id).filter(Boolean).map(String));
  const invoiceNos = new Set(targetResult.rows.map((row) => row.invoice_no).filter((value): value is string => typeof value === "string" && value !== ""));
  const items = sourceResult.rows.map((row) => {
    const id = String(row.id);
    const invoiceNo = row.invoice_no === null ? null : String(row.invoice_no);
    return {
      id, category: String(row.category), invoiceNo,
      invoiceDate: row.invoice_date === null ? null : String(row.invoice_date),
      differenceAmount: row.difference_amount === null ? null : String(row.difference_amount),
      differenceDescription: row.difference_description === null ? null : String(row.difference_description),
      transferStatus: transferred.has(id) ? "ALREADY_TRANSFERRED" : invoiceNo && invoiceNos.has(invoiceNo) ? "CURRENT_INVOICE_EXISTS" : "AVAILABLE",
    } as TransferItem;
  });
  return { items, snapshot: digest({ source: sourceResult.rows.map((row) => [row.id, row.version]), target: targetResult.rows.map((row) => [row.id, row.version, row.invoice_no, row.source_difference_item_id]) }) };
}

export async function previewPreviousQuarterTransfer(quarter: string, targetId: string, sourceId?: string) {
  return withPostgresClient(async (client) => {
    const target = await targetFor(client, quarter, targetId);
    const sources = await matchingSources(client, target);
    if (!sources.length) return { matchStatus: "ZERO_MATCH" as const, target, candidates: [], items: [], previewToken: null };
    if (sources.length > 1 && !sourceId) return { matchStatus: "MULTI_MATCH" as const, target, candidates: sources, items: [], previewToken: null };
    const source = sources.find((candidate) => candidate.id === sourceId) ?? (sources.length === 1 ? sources[0] : null);
    if (!source) throw conflict("所选来源客户不属于上一季度精确匹配结果");
    const { items, snapshot } = await itemsForPreview(client, target.id, source.id);
    const token = randomUUID();
    previewTokens.set(token, { expiresAt: Date.now() + 15 * 60_000, targetId: target.id, sourceId: source.id, targetQuarter: target.quarter, previousQuarter: target.previousQuarter, snapshot });
    return { matchStatus: "READY" as const, target, source, candidates: sources, items, previewToken: token };
  });
}

export async function executePreviousQuarterTransfer(quarter: string, targetId: string, input: Record<string, unknown>) {
  const token = typeof input.previewToken === "string" ? input.previewToken : "";
  const selected = Array.isArray(input.sourceDifferenceItemIds) && input.sourceDifferenceItemIds.every((id) => typeof id === "string") ? [...new Set(input.sourceDifferenceItemIds as string[])] : [];
  const preview = previewTokens.get(token);
  previewTokens.delete(token);
  if (!preview || preview.expiresAt < Date.now() || preview.targetQuarter !== quarter || preview.targetId !== targetId) throw conflict("预检令牌无效、已过期或目标已变化（PREVIEW_REQUIRED）");
  if (!selected.length) throw invalidInput("请至少选择一条可转入差额明细");
  if (selected.some((id) => !UUID_RE.test(id))) throw invalidInput("来源差额明细标识无效");

  return withPostgresTransaction(async (client) => {
    // Serializable predicate checks catch a concurrently inserted target row;
    // explicit row locks below keep the ordinary path narrowly scoped.
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    const target = await targetFor(client, quarter, targetId);
    // The target row is the serialization point. This is a row lock only, never
    // a quarter/table/advisory lock; a second batch re-checks after it waits.
    await client.query(`SELECT id FROM recon.reconciliations WHERE id = $1 FOR UPDATE`, [target.id]);
    const sources = await matchingSources(client, target);
    const source = sources.find((candidate) => candidate.id === preview.sourceId);
    if (!source || target.previousQuarter !== preview.previousQuarter) throw CONCURRENT();
    await client.query(`SELECT id FROM recon.reconciliations WHERE id = $1 FOR KEY SHARE`, [source.id]);
    await client.query(`SELECT id FROM recon.difference_items WHERE reconciliation_id = $1 FOR UPDATE`, [target.id]);
    const sourceItems = await client.query(
      `SELECT d.id::text, d.category, d.invoice_no, d.invoice_date, d.difference_amount::text, d.difference_description, d.version
       FROM recon.difference_items d
       WHERE d.reconciliation_id = $1 AND d.id = ANY($2::uuid[]) FOR UPDATE`, [source.id, selected],
    );
    if (sourceItems.rows.length !== selected.length) throw CONCURRENT("上一季度差额明细已变化，请重新预览后再操作。");
    const before = await itemsForPreview(client, target.id, source.id);
    if (before.snapshot !== preview.snapshot) throw CONCURRENT();
    const statuses = new Map(before.items.map((item) => [item.id, item.transferStatus]));
    if (selected.some((id) => statuses.get(id) !== "AVAILABLE")) throw CONCURRENT();

    const batchId = randomUUID();
    const targetIds: string[] = [];
    for (const item of sourceItems.rows) {
      const inserted = await client.query(
        `INSERT INTO recon.difference_items
           (reconciliation_id, category, invoice_no, invoice_date, difference_amount, difference_description, verification_status, attachment_keys, source_payload)
         VALUES ($1, $2, $3, $4, $5::numeric, $6, 'not_applicable', '[]'::jsonb,
           jsonb_build_object('transfer_previous_quarter', jsonb_build_object('source_quarter', $7, 'source_difference_item_id', $8, 'source_reconciliation_id', $9, 'batch_id', $10)))
         RETURNING id::text`,
        [target.id, item.category, item.invoice_no, item.invoice_date, item.difference_amount, item.difference_description, target.previousQuarter, item.id, source.id, batchId],
      );
      targetIds.push(String(inserted.rows[0].id));
    }
    await client.query(
      `INSERT INTO recon.audit_logs(action, entity_type, entity_id, request_id, before_data, after_data)
       VALUES($1, 'reconciliation', $2, $3, $4::jsonb, $5::jsonb)`,
      ["TRANSFER_PREVIOUS_QUARTER_DIFFERENCE_ITEMS", target.id, batchId,
        JSON.stringify({ target_quarter: quarter, source_quarter: target.previousQuarter, target_reconciliation_id: target.id, source_reconciliation_id: source.id, account_set: target.accountSet, customer_name: target.customer }),
        JSON.stringify({ batch_id: batchId, selected_count: selected.length, inserted_count: targetIds.length, skipped_duplicate_count: 0, source_difference_item_ids: selected, target_difference_item_ids: targetIds })],
    );
    return { batchId, targetQuarter: quarter, sourceQuarter: target.previousQuarter, insertedCount: targetIds.length, targetDifferenceItemIds: targetIds };
  });
}
