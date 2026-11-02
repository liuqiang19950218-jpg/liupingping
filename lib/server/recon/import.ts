// Phase 2E: runtime quarterly Excel import -> PostgreSQL (recon schema).
//
// Contract: the BROWSER parses the .xlsx (the mature XLSX flow is kept) and
// submits structured, pre-validated source rows. The SERVER re-validates the
// critical fields and writes the quarter atomically in ONE transaction.
//
// Business rules (approved, do not re-derive):
//  - Each quarter is fully independent. A fresh "本季度对账详细情况表" per quarter
//    creates/updates THAT quarter only. Nothing is inherited from prior quarters.
//  - regions / account_sets: exact-name dictionary reuse only (code == name).
//    No alias guessing.
//  - customers: quarter-independent CREATE_INDEPENDENT_CUSTOMER. Never reuse a
//    customer across quarters. Duplicate business rows within ONE quarter share
//    one customer row (849 customers / 851 reconciliations for Q2).
//  - company_receivable: written as NUMERIC from a validated decimal string.
//    JS floats are never the final amount.
//  - customer_book_amount / reconciliation_difference / reconciliation_status:
//    imported ONLY if the Excel truly provides them; otherwise NULL. NEVER 0,
//    NEVER company_amount, NEVER auto "未对账".
//  - reconciliation_difference is server-computed (company - customerBook); the
//    Excel 对账差额 column is treated as a placeholder and ignored.
//  - owner: Excel 对账负责人 = owner_raw_name (provenance, preserved as-is) AND
//    owner_name (initial editable value, sentinel-filtered). owner_id stays NULL.
//  - source_row_key: stable per-row identity (content hash of the source row),
//    reused across re-imports of the same file. The 003 partial UNIQUE index on
//    source_row_key is the row-level integrity mechanism.
//  - idempotency: import_batches UNIQUE(data_type, quarter_id, source_sha256,
//    target_module) + migration_manifests.batch_key -> 409 IMPORT_ALREADY_EXISTS.
//  - A quarter that already has reconciliations is NOT overwritten (sales-filled
//    customerBook/difference/followup/material must never be wiped by a
//    re-import) -> 409 QUARTER_HAS_EXISTING_DATA until the same-quarter
//    reimport policy is explicitly confirmed.
import { createHash } from "node:crypto";
import { withPostgresTransaction } from "../../../db/postgres";
import { invalidInput, conflict } from "./errors";

export const IMPORT_TARGET_MODULE = "runtime-import";
export const IMPORT_DATA_TYPE = "reconciliation";

const QUARTER_CODE_RE = /^(\d{4})-Q([1-4])$/;
const AMOUNT_RE = /^-?\d+(\.\d{1,2})?$/;
const OWNER_NAME_SENTINELS = new Set([
  "0",
  "—",
  "-",
  "未填写",
  "未对账",
  "null",
  "undefined",
]);

type Row = Record<string, unknown>;

function isValidQuarterCode(code: string): boolean {
  return QUARTER_CODE_RE.test(code);
}

function headerIndex(headers: string[], aliases: string[]): number {
  return headers.findIndex((header) => {
    const h = String(header ?? "").replace(/\s/g, "");
    return aliases.some((alias) => h.includes(alias.replace(/\s/g, "")));
  });
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeAmount(value: unknown, field: string, rowIndex: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  let s: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalidInput(`第 ${rowIndex} 行 ${field} 必须是有效金额`);
    // XLSX parses cells as JS floats; money cells are <=2 decimals, so the
    // float noise (e.g. 63188.400000001) is normalized to cents here. No
    // downstream float arithmetic — this is the final decimal string.
    s = value.toFixed(2);
  } else if (typeof value === "string") {
    s = value.trim().replace(/,/g, "");
    if (s === "") return null;
  } else {
    throw invalidInput(`第 ${rowIndex} 行 ${field} 必须是金额或空`);
  }
  if (!AMOUNT_RE.test(s)) throw invalidInput(`第 ${rowIndex} 行 ${field} 必须是有效金额（最多2位小数）`);
  if (!s.includes(".")) s = `${s}.00`;
  const intPart = (s.startsWith("-") ? s.slice(1) : s).split(".")[0];
  if (intPart.length > 16) throw invalidInput(`第 ${rowIndex} 行 ${field} 金额超出范围`);
  return s;
}

function normalizeOwner(value: unknown): string | null {
  const s = cellToString(value);
  if (s === "" || OWNER_NAME_SENTINELS.has(s)) return null;
  return s;
}

// Stable per-row source identity: content hash of the row cells + the core
// business triple, so re-importing the same file yields identical keys.
function sourceRowKey(quarterShort: string, row: unknown[], company: string | null): string {
  const canonical = JSON.stringify({
    row: row.map((c) => String(c ?? "")),
    company,
  });
  return `${quarterShort}:${createHash("sha256").update(canonical).digest("hex").slice(0, 24)}`;
}

function sourceSha256(fileName: string, headers: string[], rows: unknown[][]): string {
  const canonical = JSON.stringify({ fileName, headers, rows });
  return createHash("sha256").update(canonical).digest("hex");
}

type ImportRow = {
  rowIndex: number; // 1-based Excel data row (row 2 in the sheet)
  sourceRowKey: string;
  legacyId: string;
  accountSet: string;
  region: string;
  customer: string;
  companyReceivable: string;
  customerBookAmount: string | null;
  reconciliationStatus: string | null;
  ownerName: string | null;
  ownerRawName: string;
  timePoint: string;
  rawRow: unknown[];
};

function parseRows(
  quarterCode: string,
  headers: string[],
  rows: unknown[][],
): ImportRow[] {
  const at = (name: string) => headers.indexOf(name);
  const accountAt = headerIndex(headers, ["账套"]);
  const regionAt = headerIndex(headers, ["区域"]);
  const customerAt = headerIndex(headers, ["客户名称"]);
  const ownerAt = headerIndex(headers, ["对账负责人"]);
  const companyAt = headerIndex(headers, ["公司应收"]);
  const customerBookAt = headerIndex(headers, ["客户账面金额"]);
  const statusAt = headers.findIndex((h) => String(h ?? "").replace(/\s/g, "").includes("是否对清"));
  const timeAt = headerIndex(headers, ["对账时间点"]);

  if (accountAt < 0 || regionAt < 0 || customerAt < 0 || companyAt < 0) {
    throw invalidInput("导入表必须包含 账套、区域、客户名称、公司应收 列");
  }

  const m = QUARTER_CODE_RE.exec(quarterCode);
  if (!m) throw invalidInput("季度代码必须是 YYYY-QN 格式");
  const quarterShort = `q${m[2]}`;

  const seenKeys = new Map<string, number>();
  const out: ImportRow[] = [];
  rows.forEach((row, index) => {
    const rowIndex = index + 2; // Excel row number (header is row 1)
    const accountSet = cellToString(row[accountAt]);
    const region = cellToString(row[regionAt]);
    const customer = cellToString(row[customerAt]);
    const company = normalizeAmount(row[companyAt], "公司应收", rowIndex);
    if (!accountSet || !region || !customer) {
      throw invalidInput(`第 ${rowIndex} 行 账套/区域/客户名称 不能为空`);
    }
    if (company === null) {
      throw invalidInput(`第 ${rowIndex} 行 公司应收不能为空`);
    }
    const customerBook = normalizeAmount(row[customerBookAt >= 0 ? customerBookAt : -1], "客户账面金额", rowIndex);
    const statusRaw = cellToString(statusAt >= 0 ? row[statusAt] : "");
    const status =
      statusRaw === "" || OWNER_NAME_SENTINELS.has(statusRaw) ? null : statusRaw;
    const ownerRaw = cellToString(ownerAt >= 0 ? row[ownerAt] : "");
    const key = sourceRowKey(quarterShort, row, company);
    if (seenKeys.has(key)) {
      throw invalidInput(`第 ${rowIndex} 行 与第 ${seenKeys.get(key)} 行 source row 身份重复`);
    }
    seenKeys.set(key, rowIndex);
    out.push({
      rowIndex,
      sourceRowKey: key,
      legacyId: cellToString(at("序号") >= 0 ? row[at("序号")] : "") || String(rowIndex),
      accountSet,
      region,
      customer,
      companyReceivable: company,
      customerBookAmount: customerBook,
      reconciliationStatus: status,
      ownerName: normalizeOwner(row[ownerAt >= 0 ? ownerAt : -1]),
      ownerRawName: ownerRaw,
      timePoint: cellToString(timeAt >= 0 ? row[timeAt] : ""),
      rawRow: row.map((c) => c ?? ""),
    });
  });
  return out;
}

// Exact-name dictionary resolution (regions / account_sets) with independent
// per-quarter customer creation.
async function resolveQuarter(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: Row[] }> },
  quarterCode: string,
): Promise<{ id: string; existed: boolean }> {
  const found = await client.query(
    "SELECT id, code FROM recon.quarters WHERE code = $1",
    [quarterCode],
  );
  if (found.rowCount) {
    return { id: found.rows[0].id as string, existed: true };
  }
  const m = QUARTER_CODE_RE.exec(quarterCode);
  if (!m) throw invalidInput("季度代码必须是 YYYY-QN 格式");
  const year = Number(m[1]);
  const quarter = Number(m[2]);
  const cutoff = new Date(Date.UTC(year, quarter * 3, 0));
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const created = await client.query(
    "INSERT INTO recon.quarters (code, year, quarter, cutoff_date, status) VALUES ($1, $2, $3, $4, 'open') RETURNING id",
    [quarterCode, year, quarter, cutoffDate],
  );
  return { id: created.rows[0].id as string, existed: false };
}

async function dimensionId(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: Row[] }> },
  table: "regions" | "account_sets",
  name: string,
): Promise<string> {
  const found = await client.query(
    `SELECT id FROM recon.${table} WHERE name = $1`,
    [name],
  );
  if (found.rowCount) return found.rows[0].id as string;
  const created = await client.query(
    `INSERT INTO recon.${table} (code, name) VALUES ($1, $1) RETURNING id`,
    [name],
  );
  return created.rows[0].id as string;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------
export async function importQuarter(
  quarterCode: string,
  payload: { sourceFileName: string; headers: string[]; rows: unknown[][] },
): Promise<Record<string, unknown>> {
  const { sourceFileName, headers, rows } = payload;
  if (!isValidQuarterCode(quarterCode)) throw invalidInput("季度代码必须是 YYYY-QN 格式");
  if (!Array.isArray(headers) || headers.length === 0) throw invalidInput("表头不能为空");
  if (!Array.isArray(rows) || rows.length === 0) throw invalidInput("没有可导入的数据行");
  if (rows.length > 10000) throw invalidInput("导入行数超过上限（10000）");

  // Validate + normalize all rows BEFORE opening any transaction.
  const normalized = parseRows(quarterCode, headers, rows);
  const sourceHash = sourceSha256(sourceFileName, headers, rows);
  const batchKey = `runtime-import:${quarterCode}:${sourceHash}`;

  return withPostgresTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [batchKey]);

    // Duplicate / already-imported guard.
    const existingManifest = await client.query(
      "SELECT 1 FROM recon.migration_manifests WHERE batch_key = $1",
      [batchKey],
    );
    if (existingManifest.rowCount) {
      throw conflict("该文件已导入（IMPORT_ALREADY_EXISTS）");
    }

    // Never silently overwrite a quarter that already has data.
    const { id: quarterId, existed } = await resolveQuarter(client, quarterCode);
    if (existed) {
      const existing = await client.query(
        "SELECT count(*)::int AS count FROM recon.reconciliations WHERE quarter_id = $1",
        [quarterId],
      );
      if ((existing.rows[0]?.count as number) > 0) {
        throw conflict(
          `季度 ${quarterCode} 已有对账数据（${existing.rows[0]?.count} 条）。同季度重新导入会覆盖销售填写结果，需先确认导入策略（QUARTER_HAS_EXISTING_DATA）`,
        );
      }
    }

    // Exact-name reuse for regions / account_sets; independent customers.
    const regionIds = new Map<string, string>();
    const accountIds = new Map<string, string>();
    const customerIds = new Map<string, string>();
    const customerTripleKey = (accountSet: string, region: string, customer: string) =>
      `${accountSet}\u001f${region}\u001f${customer}`;

    for (const row of normalized) {
      if (!accountIds.has(row.accountSet)) {
        accountIds.set(row.accountSet, await dimensionId(client, "account_sets", row.accountSet));
      }
      if (!regionIds.has(row.region)) {
        regionIds.set(row.region, await dimensionId(client, "regions", row.region));
      }
      const triple = customerTripleKey(row.accountSet, row.region, row.customer);
      if (!customerIds.has(triple)) {
        const created = await client.query(
          "INSERT INTO recon.customers (external_code, name, region_id) VALUES (NULL, $1, $2) RETURNING id",
          [row.customer, regionIds.get(row.region)],
        );
        customerIds.set(triple, created.rows[0].id as string);
      }
    }

    // import_batches — idempotent via its UNIQUE constraint.
    const batch = await client.query(
      `INSERT INTO recon.import_batches
        (quarter_id, data_type, original_file_name, source_sha256, imported_at,
         valid_record_count, inserted_count, target_module, status, details)
       VALUES ($1, $2, $3, $4, now(), $5, $6, $7, 'success', $8::jsonb)
       ON CONFLICT (data_type, quarter_id, source_sha256, target_module)
       DO NOTHING
       RETURNING id`,
      [
        quarterId,
        IMPORT_DATA_TYPE,
        sourceFileName,
        sourceHash,
        normalized.length,
        normalized.length,
        IMPORT_TARGET_MODULE,
        JSON.stringify({
          source_row_count: normalized.length,
          valid_record_count: normalized.length,
          mapping_version: 1,
          batch_key: batchKey,
        }),
      ],
    );
    if (!batch.rowCount) {
      throw conflict("该文件已导入（IMPORT_ALREADY_EXISTS）");
    }

    // Reconciliations.
    for (const row of normalized) {
      const payload = JSON.stringify({
        headers,
        row: row.rawRow,
        source_row_index: row.rowIndex,
        timepoint: row.timePoint,
        owner_raw_name: row.ownerRawName,
        source_row_key: row.sourceRowKey,
        source_difference_is_placeholder: true,
      });
      await client.query(
        `INSERT INTO recon.reconciliations
          (legacy_id, quarter_id, account_set_id, customer_id, owner_id,
           company_receivable, customer_book_amount, reconciliation_difference,
           reconciliation_status, source_row_key, source_payload, owner_name)
         VALUES ($1, $2, $3, $4, NULL, $5::numeric, $6::numeric, NULL, $7, $8, $9, $10)`,
        [
          row.legacyId,
          quarterId,
          accountIds.get(row.accountSet),
          customerIds.get(customerTripleKey(row.accountSet, row.region, row.customer)),
          row.companyReceivable,
          row.customerBookAmount,
          row.reconciliationStatus,
          row.sourceRowKey,
          payload,
          row.ownerName,
        ],
      );
    }

    await client.query(
      `INSERT INTO recon.migration_manifests
        (batch_key, quarter_code, source_sha256, source_record_count,
         migrated_record_count, status, error_details, completed_at)
       VALUES ($1, $2, $3, $4, $4, 'migrated', '[]'::jsonb, now())`,
      [batchKey, quarterCode, sourceHash, normalized.length],
    );

    // Independent post-import validation.
    const check = await client.query(
      `SELECT count(*)::int AS count,
              coalesce(sum(company_receivable), 0)::text AS company,
              count(customer_book_amount)::int AS customer_nonnull,
              count(reconciliation_difference)::int AS difference_nonnull,
              count(reconciliation_status)::int AS status_nonnull,
              count(DISTINCT source_row_key)::int AS key_distinct
       FROM recon.reconciliations WHERE quarter_id = $1`,
      [quarterId],
    );
    const c = check.rows[0];
    if (
      c.count !== normalized.length ||
      c.key_distinct !== normalized.length ||
      c.customer_nonnull !== normalized.filter((r) => r.customerBookAmount !== null).length ||
      c.difference_nonnull !== 0
    ) {
      throw new Error("POST_IMPORT_VALIDATION_FAILED");
    }

    const ownerRes = await client.query(
      `SELECT count(*)::int AS n FROM recon.reconciliations WHERE quarter_id = $1 AND owner_name IS NOT NULL`,
      [quarterId],
    );
    const ownerNameNonNull = Number((ownerRes.rows[0] as Row | undefined)?.n ?? 0);

    return {
      quarter: quarterCode,
      status: "IMPORTED",
      importedRows: normalized.length,
      sourceSha256: sourceHash,
      batchKey,
      summary: {
        companyTotal: c.company,
        customerBookNonNull: c.customer_nonnull,
        differenceNonNull: c.difference_nonnull,
        statusNonNull: c.status_nonnull,
        ownerNameNonNull,
        customerCount: customerIds.size,
        regionCount: regionIds.size,
        accountSetCount: accountIds.size,
      },
    };
  });
}
