// Phase 2H.1 backend D: 历史往来底库替换 -> recon.ledger_datasets + entries.
//
// This is a GLOBAL operation (not quarter-scoped): it replaces the active
// all-years company invoice base used for sales-form verification.
//
// Version model (Phase 2G.1, unchanged):
//   HISTORICAL_BASE V1 (active=true, 355915 entries) is the migrated legacy
//   surface. Replacing the base creates a NEW version (V2, V3, ...) with
//   is_active=false, imports and validates ALL its entries, then flips
//   V1.active=false + V2.active=true inside the SAME transaction. Old versions
//   are NEVER deleted (datasets and entries are preserved forever).
//
// Input contract (future browser flow): one or more 历史往来 Excel files parsed
// by the browser into { sourceFileName, headers, rows }. The server re-runs the
// SAME Phase-2G-validated normalization (invoice_no / invoice_date /
// invoice_amount triple) via parseLedgerSourceFile. 账套/区域 columns in the
// Excel may be kept as provenance inside source_payload but NEVER change the
// verification rule — verification is still the canonical
// (invoice_no_normalized, invoice_date, invoice_amount) triple.
//
// Transaction guarantee:
//   BEGIN -> create V2 inactive -> bulk insert entries -> validate counts ->
//   deactivate old active -> activate V2 -> audit -> COMMIT.
//   Any failure ROLLBACKs so the previously-active version stays active
//   (a failed V3 must leave V2 active). CURRENT_YEAR_QUARTER datasets are
//   NEVER touched.
import { createHash } from "node:crypto";
import { parseLedgerSourceFile, type LedgerSourceFile } from "./ledger";
import { canonicalDateToIso } from "./normalize";
import { withPostgresTransaction } from "../../../db/postgres";
import { invalidInput, conflict } from "../recon/errors";
import {
  IMPORT_DATA_TYPES,
  REMAINING_IMPORTS_TARGET_MODULE,
} from "../recon/remaining-imports-common";

const DATASET_HISTORICAL = "HISTORICAL_BASE";

function historicalSourceSha(fileNames: string[], keys: string[]): string {
  const canonical = JSON.stringify({
    type: DATASET_HISTORICAL,
    files: [...fileNames].sort(),
    keys: [...keys].sort(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export async function replaceHistoricalLedger(
  sourceFiles: LedgerSourceFile[],
): Promise<Record<string, unknown>> {
  if (!Array.isArray(sourceFiles) || sourceFiles.length === 0) {
    throw invalidInput("必须提供至少一个历史往来明细文件（INVALID_IMPORT_FORMAT）");
  }

  // Parse + normalize EVERYTHING before opening the transaction.
  const fileNames: string[] = [];
  const seen = new Set<string>();
  const rows: {
    sourceRowKey: string;
    invoice: string;
    date8: string;
    amountCents: string;
    sourceFile: string;
  }[] = [];
  let qualifiedTotal = 0;

  for (const file of sourceFiles) {
    const name = String(file.sourceFileName || "未命名文件").trim();
    fileNames.push(name);
    const parsed = parseLedgerSourceFile(file);
    if (!parsed.headerRowFound) {
      throw invalidInput(`文件 ${name} 未找到包含发票号的表头行（INVALID_IMPORT_FORMAT）`);
    }
    if (parsed.qualified === 0) {
      throw invalidInput(`文件 ${name} 未解析到可核验的发票记录（INVALID_IMPORT_FORMAT）`);
    }
    qualifiedTotal += parsed.qualified;
    for (const row of parsed.rows) {
      if (seen.has(row.key)) continue; // intra-batch canonical dedupe
      seen.add(row.key);
      rows.push({
        sourceRowKey: row.key, // invoice|YYYYMMDD|amount2dp (V1 backfill format)
        invoice: row.invoice,
        date8: row.date8,
        amountCents: row.amountCents,
        sourceFile: name,
      });
    }
  }

  if (rows.length === 0) {
    throw invalidInput("没有可核验的发票记录（INVALID_IMPORT_FORMAT）");
  }
  const sourceSha = historicalSourceSha(fileNames, rows.map((r) => r.sourceRowKey));

  return withPostgresTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "remaining-imports:historical-ledger-replace",
    ]);

    // Never re-import a file already present as a historical base version.
    const existing = await client.query(
      `SELECT version FROM recon.ledger_datasets
       WHERE dataset_type = $1 AND source_sha256 = $2`,
      [DATASET_HISTORICAL, sourceSha],
    );
    if (existing.rowCount) {
      throw conflict(
        `该历史往来底库已作为 V${existing.rows[0].version} 导入（IMPORT_ALREADY_EXISTS）`,
      );
    }

    // Next free version number.
    const versionRes = await client.query(
      `SELECT coalesce(max(version), 0)::int AS max_version
       FROM recon.ledger_datasets WHERE dataset_type = $1`,
      [DATASET_HISTORICAL],
    );
    const nextVersion = Number(versionRes.rows[0].max_version) + 1;

    // 1) Create the new dataset INACTIVE.
    const datasetRes = await client.query(
      `INSERT INTO recon.ledger_datasets
         (dataset_type, year, quarter_id, version, is_active,
          source_file_name, source_sha256, source_payload, row_count, imported_at)
       VALUES ($1, NULL, NULL, $2, false, $3, $4, $5::jsonb, $6, now())
       RETURNING id`,
      [
        DATASET_HISTORICAL,
        nextVersion,
        fileNames.join("、"),
        sourceSha,
        JSON.stringify({
          canonical_count: rows.length,
          qualified_total: qualifiedTotal,
          source_file_names: fileNames,
        }),
        rows.length,
      ],
    );
    const datasetId = datasetRes.rows[0].id as string;

    // 2) Bulk insert entries (chunked, same pattern as current-year import).
    const CHUNK = 2000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const values: string[] = [];
      const params: unknown[] = [];
      let p = 1;
      for (const row of slice) {
        const iso = canonicalDateToIso(row.date8);
        if (!iso) throw invalidInput(`非法发票日期 ${row.date8}`);
        values.push(
          `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`,
        );
        params.push(
          datasetId,
          row.sourceRowKey,
          row.invoice,
          row.invoice,
          row.date8,
          iso,
          row.amountCents,
          JSON.stringify({ sourceFile: row.sourceFile }),
        );
      }
      await client.query(
        `INSERT INTO recon.ledger_verification_entries
           (dataset_id, source_row_key, invoice_no_raw, invoice_no_normalized,
            invoice_date_raw, invoice_date, invoice_amount, source_payload)
         VALUES ${values.join(", ")}
         ON CONFLICT (dataset_id, source_row_key) DO NOTHING`,
        params,
      );
    }

    // 3) Post-import independent validation inside the transaction.
    const check = await client.query(
      `SELECT count(*)::int AS entries,
              count(DISTINCT source_row_key)::int AS distinct_keys
       FROM recon.ledger_verification_entries WHERE dataset_id = $1`,
      [datasetId],
    );
    const c = check.rows[0];
    if (
      Number(c.entries) !== rows.length ||
      Number(c.distinct_keys) !== rows.length
    ) {
      throw new Error("POST_IMPORT_VALIDATION_FAILED");
    }

    // 4) Atomic active switch: old active -> false, new -> true.
    await client.query(
      `UPDATE recon.ledger_datasets SET is_active = false, updated_at = now()
       WHERE dataset_type = $1 AND is_active = true`,
      [DATASET_HISTORICAL],
    );
    await client.query(
      `UPDATE recon.ledger_datasets SET is_active = true, updated_at = now()
       WHERE id = $1`,
      [datasetId],
    );

    // 5) Import audit (quarter_id NULL -> partial unique index guards dedup).
    const batch = await client.query(
      `INSERT INTO recon.import_batches
         (quarter_id, data_type, original_file_name, source_sha256, imported_at,
          valid_record_count, inserted_count, updated_count, skipped_count,
          target_module, status, details)
       VALUES (NULL, $1, $2, $3, now(), $4, $5, 0, 0, $6, 'success', $7::jsonb)
       ON CONFLICT (data_type, source_sha256, target_module)
         WHERE quarter_id IS NULL
       DO NOTHING
       RETURNING id`,
      [
        IMPORT_DATA_TYPES.historical,
        fileNames.join("、"),
        sourceSha,
        rows.length,
        rows.length,
        REMAINING_IMPORTS_TARGET_MODULE,
        JSON.stringify({
          new_version: nextVersion,
          previous_active_version: nextVersion - 1,
          source_file_names: fileNames,
          qualified_total: qualifiedTotal,
        }),
      ],
    );

    return {
      status: "REPLACED",
      datasetId,
      datasetType: DATASET_HISTORICAL,
      version: nextVersion,
      sourceFiles: fileNames,
      sourceSha256: sourceSha,
      insertedRows: rows.length,
      distinctInvoices: Number(c.entries),
      previousVersion: nextVersion - 1,
      importBatchId: batch.rowCount ? (batch.rows[0].id as string) : null,
    };
  });
}
