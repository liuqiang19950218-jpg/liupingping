// Phase 2H.1 backend A: import 资料提供情况表 (material status) -> recon.material_status.
//
// Legacy behavior reproduced (QuarterlyReconciliation.tsx importMaterials):
//   - The BROWSER parses the .xlsx and posts structured rows
//     { sourceFileName, headers, rows } — the server re-validates and writes.
//   - Exact (账套 + 区域 + 客户名称) match against the CURRENT quarter's
//     reconciliations, with the legacy all-whitespace-removed normalization.
//   - A source row that matches exactly -> material cells (non-blank only) are
//     merged/upserted into recon.material_status (SPD-A for SPD确认表/SPD库存确认函).
//   - A source row that matches nothing -> ignored, counted as unmatched
//     (PARTIAL success — NOT a structural error, exactly like the old flow).
//   - A source row matching MORE THAN ONE reconciliation -> skipped, counted as
//     ambiguous (the server never guesses which duplicate to write).
//   - This import NEVER creates customers/reconciliations and NEVER touches
//     company_receivable / customer_book_amount / owner / difference /
//     followups / status / independent SPD (spd_dashboard_rows).
//
// Transaction: all writes happen in ONE transaction; a structural failure
// (missing quarter, missing headers, unparseable payload) rolls back everything
// before any write. Business unmatched/ambiguous rows are NOT rollback errors.
import {
  cellToString,
  headerIndex,
  IMPORT_DATA_TYPES,
  indexByMatchKey,
  isValidQuarterCode,
  loadQuarterReconciliations,
  MATERIAL_HEADERS,
  MATERIAL_HEADER_ALIASES,
  materialProvided,
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

type MaterialImportRow = {
  rowIndex: number;
  sourceRowKey: string;
  matchKey: string;
  accountSet: string;
  region: string;
  customer: string;
  materials: Map<string, string>; // material_type -> non-blank raw value
};

function parseRows(headers: string[], rows: unknown[][]): MaterialImportRow[] {
  const accountAt = headerIndex(headers, ACCOUNT_ALIASES);
  const regionAt = headerIndex(headers, REGION_ALIASES);
  const customerAt = headerIndex(headers, CUSTOMER_ALIASES);
  if (accountAt < 0 || regionAt < 0 || customerAt < 0) {
    throw invalidInput("资料提供情况表必须包含 账套、区域、客户名称 列（MISSING_REQUIRED_HEADER）");
  }

  // Source column index per canonical material type (alias-aware).
  const materialAt = new Map<string, number>();
  for (const materialType of MATERIAL_HEADERS) {
    const aliases = MATERIAL_HEADER_ALIASES[materialType] ?? [materialType];
    const at = headerIndex(headers, aliases);
    if (at >= 0) materialAt.set(materialType, at);
  }

  const out: MaterialImportRow[] = [];
  rows.forEach((row, index) => {
    const rowIndex = index + 2; // header is Excel row 1
    const accountSet = cellToString(row[accountAt]);
    const region = cellToString(row[regionAt]);
    const customer = cellToString(row[customerAt]);
    if (!accountSet || !region || !customer) {
      throw invalidInput(`第 ${rowIndex} 行 账套/区域/客户名称 不能为空`);
    }
    const materials = new Map<string, string>();
    for (const [materialType, at] of materialAt) {
      const raw = cellToString(row[at]);
      if (raw !== "") materials.set(materialType, raw);
    }
    out.push({
      rowIndex,
      sourceRowKey: sourceRowKey("mat", rowIndex, row),
      matchKey: matchKey(accountSet, region, customer),
      accountSet,
      region,
      customer,
      materials,
    });
  });
  return out;
}

export async function importQuarterMaterials(
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

  // Validate + normalize ALL rows BEFORE opening any transaction.
  const normalized = parseRows(headers, rows);
  const sourceHash = sourceSha256(sourceFileName, headers, rows);

  return withPostgresTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `remaining-imports:${quarterCode}:material`,
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

    // Import batch audit row (idempotent via UNIQUE(data_type, quarter_id,
    // source_sha256, target_module)). Same pattern as the quarter base import.
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
        IMPORT_DATA_TYPES.material,
        sourceFileName,
        sourceHash,
        normalized.length,
        REMAINING_IMPORTS_TARGET_MODULE,
        "success",
        JSON.stringify({
          source_row_count: normalized.length,
          batch_key: `remaining-imports:${quarterCode}:material:${sourceHash}`,
        }),
      ],
    );
    if (!batch.rowCount) {
      throw conflict("该文件已导入（IMPORT_ALREADY_EXISTS）");
    }
    const batchId = batch.rows[0].id as string;

    let matchedRows = 0;
    let ambiguousRows = 0;
    let unmatchedRows = 0;
    let written = 0;
    const unmatchedKeys = new Set<string>();

    for (const row of normalized) {
      const matches = byKey.get(row.matchKey);
      if (!matches || matches.length === 0) {
        unmatchedRows += 1;
        unmatchedKeys.add(row.matchKey);
        continue;
      }
      if (matches.length > 1 || ambiguousKeys.has(row.matchKey)) {
        ambiguousRows += 1;
        continue;
      }
      matchedRows += 1;
      const target = matches[0];
      for (const [materialType, rawValue] of row.materials) {
        written += await upsertMaterialStatus(client, quarterId, target, materialType, rawValue, batchId);
      }
    }

    if (matchedRows === 0 && normalized.length > 0) {
      // Old behavior: zero matched source rows is a PARTIAL import (never a
      // structural error). Report it clearly, keep the audit row partial.
      await client.query(
        `UPDATE recon.import_batches SET status = 'partial', skipped_count = $2 WHERE id = $1`,
        [batchId, unmatchedRows + ambiguousRows],
      );
      return {
        quarter: quarterCode,
        status: "PARTIAL",
        sourceRows: normalized.length,
        matchedRows: 0,
        unmatchedRows,
        ambiguousRows,
        writtenMaterialCells: 0,
        unmatchedKeys: [...unmatchedKeys],
        sourceSha256: sourceHash,
        importBatchId: batchId,
        message: "没有任何资料行能精确匹配当前季度的对账记录（NO_MATCHING_RECONCILIATIONS）",
      };
    }

    await client.query(
      `UPDATE recon.import_batches
       SET inserted_count = $2, updated_count = $3, skipped_count = $4,
           status = $5
       WHERE id = $1`,
      [batchId, written, matchedRows, unmatchedRows + ambiguousRows, matchedRows === normalized.length ? "success" : "partial"],
    );

    return {
      quarter: quarterCode,
      status: matchedRows === normalized.length ? "IMPORTED" : "PARTIAL",
      sourceRows: normalized.length,
      matchedRows,
      unmatchedRows,
      ambiguousRows,
      writtenMaterialCells: written,
      unmatchedKeys: [...unmatchedKeys],
      sourceSha256: sourceHash,
      importBatchId: batchId,
    };
  });
}

// Upsert one material_status row for a matched reconciliation. If a row already
// exists for (reconciliation_id, material_type) the OLDEST one is updated in
// place (deterministic; the migration baseline may hold SPD-A + SPD_SOURCE
// duplicates — only a single row is ever batch-tagged, which the partial unique
// index material_status_batch_unique enforces). Otherwise a new row is created.
async function upsertMaterialStatus(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: Array<Record<string, any>> }> },
  quarterId: string,
  target: { id: string; accountSetId: string; customerId: string },
  materialType: string,
  rawValue: string,
  batchId: string,
): Promise<number> {
  const provided = materialProvided(rawValue);
  const existing = await client.query(
    `SELECT id FROM recon.material_status
     WHERE reconciliation_id = $1 AND material_type = $2
     ORDER BY created_at ASC, id ASC LIMIT 1`,
    [target.id, materialType],
  );
  if (existing.rowCount) {
    const res = await client.query(
      `UPDATE recon.material_status
       SET provided = $1, raw_value = $2, source_batch_id = $3, updated_at = now()
       WHERE id = $4
       RETURNING id`,
      [provided, rawValue, batchId, existing.rows[0].id],
    );
    return res.rowCount ?? 0;
  }
  const res = await client.query(
    `INSERT INTO recon.material_status
       (reconciliation_id, quarter_id, account_set_id, customer_id,
        material_type, provided, raw_value, source_batch_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [target.id, quarterId, target.accountSetId, target.customerId, materialType, provided, rawValue, batchId],
  );
  return res.rowCount ?? 0;
}
