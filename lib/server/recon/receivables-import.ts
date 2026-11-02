// Phase 2H.1 backend C: import 公司应收更新表 -> recon.reconciliations.company_receivable.
//
// Legacy behavior reproduced (QuarterlyReconciliation.tsx importCompanyReceivables):
//   - Columns required: 账套, 区域, 客户名称, 公司应收
//     (公司应收 aliases: 公司应收 / 公司应收金额 / 公司应收（元）).
//   - Exact (账套 + 区域 + 客户名称) match against the CURRENT quarter's
//     reconciliations (all-whitespace-removed normalization).
//   - Only non-blank 公司应收 values update the target (blank = leave unchanged,
//     never "blank -> 0"). Unmatched rows are PARTIAL (never a structural error).
//
// Server rules (approved, do not re-derive):
//   - This import may ONLY change company_receivable and the server-derived
//     reconciliation_difference. customer_book_amount, owner_name,
//     reconciliation_status, difference_items, followups, material_status,
//     SPD, and customer identity are NEVER touched.
//   - difference recompute:
//       customer_book_amount IS NOT NULL -> new_company_receivable - customer_book_amount
//       customer_book_amount IS NULL     -> NULL (never 0, never "未对账")
//   - NULL vs 0 are distinct: an empty Excel cell leaves the value untouched.
//   - AMBIGUOUS key (same quarter+account_set+region+customer matching >1
//     reconciliation, verified to exist in 2026-Q2) -> the source row is NOT
//     written and is reported in ambiguousRows. The server never guesses which
//     duplicate to update.
//
// Transaction: all writes in ONE transaction; structural failures roll back
// before any write; unmatched/ambiguous rows are business partial, not errors.
import {
  cellToString,
  COMPANY_RECEIVABLE_HEADERS,
  headerIndex,
  IMPORT_DATA_TYPES,
  indexByMatchKey,
  isValidQuarterCode,
  loadQuarterReconciliations,
  matchKey,
  REMAINING_IMPORTS_TARGET_MODULE,
  sourceRowKey,
  sourceSha256,
} from "./remaining-imports-common";
import { withPostgresTransaction } from "../../../db/postgres";
import { invalidInput, notFound, conflict } from "./errors";

const ACCOUNT_ALIASES = ["账套"];
const REGION_ALIASES = ["区域"];
const CUSTOMER_ALIASES = ["客户名称"];

const AMOUNT_RE = /^-?\d+(\.\d{1,2})?$/;

type ReceivableImportRow = {
  rowIndex: number;
  sourceRowKey: string;
  matchKey: string;
  accountSet: string;
  region: string;
  customer: string;
  companyValue: unknown; // raw cell value (number | string | null)
};

function normalizeAmountInput(value: unknown, rowIndex: number): string | null {
  if (value === null || value === undefined) return null;
  let s: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalidInput(`第 ${rowIndex} 行 公司应收 必须是有效金额`);
    s = value.toFixed(2);
  } else if (typeof value === "string") {
    s = value.trim().replace(/,/g, "");
    if (s === "") return null;
  } else {
    throw invalidInput(`第 ${rowIndex} 行 公司应收 必须是金额或空`);
  }
  if (!AMOUNT_RE.test(s)) {
    throw invalidInput(`第 ${rowIndex} 行 公司应收 必须是有效金额（最多2位小数）`);
  }
  if (!s.includes(".")) s = `${s}.00`;
  const intPart = (s.startsWith("-") ? s.slice(1) : s).split(".")[0];
  if (intPart.length > 16) throw invalidInput(`第 ${rowIndex} 行 公司应收 金额超出范围`);
  return s;
}

function parseRows(headers: string[], rows: unknown[][]): ReceivableImportRow[] {
  const accountAt = headerIndex(headers, ACCOUNT_ALIASES);
  const regionAt = headerIndex(headers, REGION_ALIASES);
  const customerAt = headerIndex(headers, CUSTOMER_ALIASES);
  const companyAt = headerIndex(headers, COMPANY_RECEIVABLE_HEADERS);
  if (accountAt < 0 || regionAt < 0 || customerAt < 0 || companyAt < 0) {
    throw invalidInput(
      "公司应收更新表必须包含 账套、区域、客户名称、公司应收 列（MISSING_REQUIRED_HEADER）",
    );
  }
  return rows.map((row, index) => {
    const rowIndex = index + 2;
    const accountSet = cellToString(row[accountAt]);
    const region = cellToString(row[regionAt]);
    const customer = cellToString(row[customerAt]);
    if (!accountSet || !region || !customer) {
      throw invalidInput(`第 ${rowIndex} 行 账套/区域/客户名称 不能为空`);
    }
    return {
      rowIndex,
      sourceRowKey: sourceRowKey("recv", rowIndex, row),
      matchKey: matchKey(accountSet, region, customer),
      accountSet,
      region,
      customer,
      companyValue: row[companyAt],
    };
  });
}

export async function importQuarterCompanyReceivables(
  quarterCode: string,
  payload: { sourceFileName: string; headers: string[]; rows: unknown[][] },
): Promise<Record<string, unknown>> {
  const { sourceFileName, headers, rows } = payload;
  if (!isValidQuarterCode(quarterCode)) {
    throw invalidInput("季度代码必须是 YYYY-QN 格式（INVALID_QUARTER）");
  }
  if (!Array.isArray(headers) || headers.length === 0) throw invalidInput("表头不能为空");
  if (!Array.isArray(rows) || rows.length === 0) throw invalidInput("没有可导入的数据行");
  if (rows.length > 10000) throw invalidInput("导入行数超过上限（10000）");

  // Validate + normalize ALL rows (including every amount) BEFORE any write.
  const normalized = parseRows(headers, rows);
  const amounts = new Map<string, string | null>(); // sourceRowKey -> normalized amount
  for (const row of normalized) {
    amounts.set(row.sourceRowKey, normalizeAmountInput(row.companyValue, row.rowIndex));
  }
  const sourceHash = sourceSha256(sourceFileName, headers, rows);

  return withPostgresTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `remaining-imports:${quarterCode}:receivable`,
    ]);

    const quarter = await client.query("SELECT id FROM recon.quarters WHERE code = $1", [
      quarterCode,
    ]);
    if (!quarter.rowCount) {
      throw notFound(`季度 ${quarterCode} 不存在（INVALID_QUARTER）`);
    }
    const quarterId = quarter.rows[0].id as string;

    const reconRows = await loadQuarterReconciliations(client, quarterId);
    if (reconRows.length === 0) {
      throw conflict("当前季度没有可匹配的对账记录（NO_MATCHING_RECONCILIATIONS）");
    }
    const { byKey, ambiguousKeys } = indexByMatchKey(reconRows);

    const batch = await client.query(
      `INSERT INTO recon.import_batches
        (quarter_id, data_type, original_file_name, source_sha256, imported_at,
         valid_record_count, inserted_count, updated_count, skipped_count,
         target_module, status, details)
       VALUES ($1, $2, $3, $4, now(), $5, 0, 0, 0, $6, $7, $8::jsonb)
       ON CONFLICT (data_type, quarter_id, source_sha256, target_module) DO NOTHING
       RETURNING id`,
      [
        quarterId,
        IMPORT_DATA_TYPES.receivable,
        sourceFileName,
        sourceHash,
        normalized.length,
        REMAINING_IMPORTS_TARGET_MODULE,
        "success",
        JSON.stringify({
          source_row_count: normalized.length,
          batch_key: `remaining-imports:${quarterCode}:receivable:${sourceHash}`,
        }),
      ],
    );
    if (!batch.rowCount) {
      throw conflict("该文件已导入（IMPORT_ALREADY_EXISTS）");
    }
    const batchId = batch.rows[0].id as string;

    let matchedRows = 0;
    let updatedRows = 0;
    let unchangedRows = 0;
    let unmatchedRows = 0;
    let ambiguousRows = 0;

    for (const row of normalized) {
      const matches = byKey.get(row.matchKey);
      if (!matches || matches.length === 0) {
        unmatchedRows += 1;
        continue;
      }
      if (matches.length > 1 || ambiguousKeys.has(row.matchKey)) {
        ambiguousRows += 1;
        continue;
      }
      matchedRows += 1;
      const newAmount = amounts.get(row.sourceRowKey);
      if (newAmount === null) {
        // Blank Excel cell -> leave the current value untouched (never 0).
        unchangedRows += 1;
        continue;
      }
      const target = matches[0];
      if (target.companyReceivable === newAmount) {
        unchangedRows += 1;
        continue;
      }
      const res = await client.query(
        `UPDATE recon.reconciliations
         SET company_receivable = $2::numeric,
             reconciliation_difference =
               CASE WHEN customer_book_amount IS NULL
                    THEN NULL
                    ELSE $2::numeric - customer_book_amount END,
             updated_at = now(), version = version + 1
         WHERE id = $1
         RETURNING company_receivable::text, customer_book_amount::text,
                   reconciliation_difference::text`,
        [target.id, newAmount],
      );
      if (res.rowCount) updatedRows += 1;
    }

    await client.query(
      `UPDATE recon.import_batches
       SET inserted_count = $2, updated_count = $3, skipped_count = $4,
           status = $5
       WHERE id = $1`,
      [
        batchId,
        updatedRows,
        updatedRows,
        unmatchedRows + ambiguousRows + unchangedRows,
        updatedRows > 0 || matchedRows > 0 ? "success" : "partial",
      ],
    );

    return {
      quarter: quarterCode,
      status: matchedRows === 0 ? "PARTIAL" : "IMPORTED",
      sourceRows: normalized.length,
      matchedRows,
      updatedRows,
      unchangedRows,
      unmatchedRows,
      ambiguousRows,
      sourceSha256: sourceHash,
      importBatchId: batchId,
    };
  });
}
