// Phase 2H.1 backend B: import 独立 SPD 表 -> recon.spd_dashboard_rows (SPD-B).
//
// Legacy behavior reproduced (QuarterlyReconciliation.tsx importSpdSheet):
//   - The browser parses the .xlsx and posts { sourceFileName, headers, rows }.
//   - At least one of SPD确认表/SPD确认函 or SPD库存确认函 column is required.
//   - Semantics: the current quarter's dashboard SPD dataset is REPLACED
//     atomically (the old localStorage flow overwrote the whole quarter archive).
//   - EVERY source row is preserved, including rows with blank status cells
//     (blank counts toward total / unsubmitted) and rows that cannot be linked
//     to a reconciliation (reconciliation_id stays NULL — never dropped, never
//     fuzzy-matched).
//   - 序号/账套/区域/客户名称/备注 are preserved as raw provenance.
//
// Dashboard submission semantics (unchanged, business-confirmed):
//   total = all business rows; "是" AND "否" both count as submitted;
//   blank/NULL counts as unsubmitted.
//
// Transaction: ONE transaction — record the import batch, DELETE the current
// quarter's old rows, INSERT the new rows, validate, COMMIT. Any failure
// ROLLBACKs so the previous dataset stays fully intact (the dashboard is never
// left empty by a failed replace).
import {
  cellToString,
  headerIndex,
  IMPORT_DATA_TYPES,
  indexByMatchKey,
  isValidQuarterCode,
  loadQuarterReconciliations,
  REMAINING_IMPORTS_TARGET_MODULE,
  sourceRowKey,
  sourceSha256,
  SPD_CONFIRMATION_HEADERS,
  SPD_INVENTORY_CONFIRMATION_HEADERS,
} from "./remaining-imports-common";
import { withPostgresTransaction } from "../../../db/postgres";
import { invalidInput, notFound, conflict } from "./errors";

const SEQ_HEADERS = ["序号"];
const ACCOUNT_HEADERS = ["账套"];
const REGION_HEADERS = ["区域"];
const CUSTOMER_HEADERS = ["客户名称"];
const REMARK_HEADERS = ["备注"];

type SpdImportRow = {
  rowIndex: number; // Excel data row (1-based position in the sheet's data rows)
  sourceRowKey: string;
  accountSetRaw: string | null;
  regionRaw: string | null;
  customerRaw: string | null;
  spdConfirmation: string | null;
  spdInventoryConfirmation: string | null;
  remark: string | null;
  sourcePayload: unknown[];
};

function parseRows(headers: string[], rows: unknown[][]): SpdImportRow[] {
  const confirmationAt = headerIndex(headers, SPD_CONFIRMATION_HEADERS);
  const inventoryAt = headerIndex(headers, SPD_INVENTORY_CONFIRMATION_HEADERS);
  if (confirmationAt < 0 && inventoryAt < 0) {
    throw invalidInput(
      "SPD表必须至少包含 SPD确认表/SPD确认函 或 SPD库存确认函 列（MISSING_REQUIRED_HEADER）",
    );
  }
  const seqAt = headerIndex(headers, SEQ_HEADERS);
  const accountAt = headerIndex(headers, ACCOUNT_HEADERS);
  const regionAt = headerIndex(headers, REGION_HEADERS);
  const customerAt = headerIndex(headers, CUSTOMER_HEADERS);
  const remarkAt = headerIndex(headers, REMARK_HEADERS);

  return rows.map((row, index) => {
    const rowIndex = index + 1; // 1-based data row position (legacy source_row_number)
    const payload = { source_row_index: rowIndex, row: row.map((c) => c ?? "") };
    return {
      rowIndex,
      sourceRowKey: sourceRowKey("spd", rowIndex, row),
      accountSetRaw: accountAt >= 0 ? cellToString(row[accountAt]) || null : null,
      regionRaw: regionAt >= 0 ? cellToString(row[regionAt]) || null : null,
      customerRaw: customerAt >= 0 ? cellToString(row[customerAt]) || null : null,
      spdConfirmation: confirmationAt >= 0 ? cellToString(row[confirmationAt]) || null : null,
      spdInventoryConfirmation: inventoryAt >= 0 ? cellToString(row[inventoryAt]) || null : null,
      remark: remarkAt >= 0 ? cellToString(row[remarkAt]) || null : null,
      sourcePayload: payload,
    };
  });
}

export async function importQuarterSpdDashboard(
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
      `remaining-imports:${quarterCode}:spd`,
    ]);

    const quarter = await client.query("SELECT id FROM recon.quarters WHERE code = $1", [
      quarterCode,
    ]);
    if (!quarter.rowCount) {
      throw notFound(`季度 ${quarterCode} 不存在（INVALID_QUARTER）`);
    }
    const quarterId = quarter.rows[0].id as string;

    // Import batch audit row (idempotent dedup on the same file).
    const batch = await client.query(
      `INSERT INTO recon.import_batches
        (quarter_id, data_type, original_file_name, source_sha256, imported_at,
         valid_record_count, inserted_count, updated_count, skipped_count,
         target_module, status, details)
       VALUES ($1, $2, $3, $4, now(), $5, $6, 0, 0, $7, 'success', $8::jsonb)
       ON CONFLICT (data_type, quarter_id, source_sha256, target_module) DO NOTHING
       RETURNING id`,
      [
        quarterId,
        IMPORT_DATA_TYPES.spd,
        sourceFileName,
        sourceHash,
        normalized.length,
        normalized.length,
        REMAINING_IMPORTS_TARGET_MODULE,
        JSON.stringify({
          source_row_count: normalized.length,
          replacement: "atomic_whole_sheet",
          batch_key: `remaining-imports:${quarterCode}:spd:${sourceHash}`,
        }),
      ],
    );
    if (!batch.rowCount) {
      throw conflict("该文件已导入（IMPORT_ALREADY_EXISTS）");
    }
    const batchId = batch.rows[0].id as string;

    // Exact reconciliation link (optional, never fuzzy, never drops rows).
    let linked = 0;
    const reconRows = await loadQuarterReconciliations(client, quarterId);
    const { byKey, ambiguousKeys } = indexByMatchKey(reconRows);

    // Atomic whole-sheet replace: delete old quarter rows, insert new ones.
    await client.query(`DELETE FROM recon.spd_dashboard_rows WHERE quarter_id = $1`, [quarterId]);

    const CHUNK = 500;
    for (let i = 0; i < normalized.length; i += CHUNK) {
      const slice = normalized.slice(i, i + CHUNK);
      const values: string[] = [];
      const params: unknown[] = [];
      let p = 1;
      for (const row of slice) {
        let reconciliationId: string | null = null;
        if (row.accountSetRaw && row.regionRaw && row.customerRaw) {
          const key = [row.accountSetRaw, row.regionRaw, row.customerRaw]
            .map((v) => String(v ?? "").replace(/\s/g, "").trim())
            .join("\u001f");
          const matches = byKey.get(key);
          if (matches && matches.length === 1 && !ambiguousKeys.has(key)) {
            reconciliationId = matches[0].id;
            linked += 1;
          }
        }
        values.push(
          `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`,
        );
        params.push(
          quarterId,
          row.sourceRowKey,
          row.rowIndex,
          sourceFileName,
          row.accountSetRaw,
          row.regionRaw,
          row.customerRaw,
          row.spdConfirmation,
          row.spdInventoryConfirmation,
          row.remark,
          JSON.stringify(row.sourcePayload),
          reconciliationId,
          batchId,
        );
      }
      await client.query(
        `INSERT INTO recon.spd_dashboard_rows
           (quarter_id, source_row_key, source_row_number, source_file_name,
            account_set_raw, region_raw, customer_name_raw,
            spd_confirmation_raw, spd_inventory_confirmation_raw, remark,
            source_payload, reconciliation_id, source_batch_id)
         VALUES ${values.join(", ")}
         ON CONFLICT (quarter_id, source_row_key) DO NOTHING`,
        params,
      );
    }

    // Post-import independent validation inside the same transaction.
    const check = await client.query(
      `SELECT count(*)::int AS count, count(DISTINCT source_row_key)::int AS distinct_keys
       FROM recon.spd_dashboard_rows WHERE quarter_id = $1`,
      [quarterId],
    );
    const c = check.rows[0];
    if (Number(c.count) !== normalized.length || Number(c.distinct_keys) !== normalized.length) {
      throw new Error("POST_IMPORT_VALIDATION_FAILED");
    }

    return {
      quarter: quarterCode,
      status: "REPLACED",
      sourceRows: normalized.length,
      replacedRows: normalized.length,
      linkedReconciliations: linked,
      sourceSha256: sourceHash,
      importBatchId: batchId,
    };
  });
}
