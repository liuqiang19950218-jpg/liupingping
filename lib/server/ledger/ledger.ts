// PostgreSQL ledger verification runtime data layer (recon schema, Phase 2G.1).
//
// Dataset model:
//   recon.ledger_datasets
//     HISTORICAL_BASE       (version 1..n, one active) — all-years company base
//     CURRENT_YEAR_QUARTER  (one per quarter) — per-quarter cumulative snapshot
//   recon.ledger_verification_entries
//     canonical row: (invoice_no_normalized, invoice_date, invoice_amount)
//     indexed by (invoice_no_normalized, invoice_date, invoice_amount)
//
// Verification scope for quarter Q:
//   active HISTORICAL_BASE  UNION  active CURRENT_YEAR_QUARTER of Q
//   (NOT earlier quarters — Q2 is already the 1-6月 cumulative file).
//   Logical dedupe by canonical key; overlap between datasets is not an error.
//
// Server-authoritative: the client never decides matched. It submits
// invoiceNo/invoiceDate/amount; the server queries PG and decides.
import { createHash } from "node:crypto";
import {
  canonicalAmount,
  canonicalDateToIso,
  canonicalVerificationKey,
  normalizeDateToYyyymmdd,
  normalizeInvoice,
  toNumber,
} from "./normalize";
import { invalidInput, notFound, conflict } from "../recon/errors";

type SqlClient = {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rowCount: number | null; rows: Record<string, any>[] }>;
};

const DATASET_HISTORICAL = "HISTORICAL_BASE";
const DATASET_CURRENT_YEAR = "CURRENT_YEAR_QUARTER";

export type LedgerVerificationResult = {
  matched: boolean;
  status: "matched" | "not_found";
  matchedDatasetType: "HISTORICAL_BASE" | "CURRENT_YEAR_QUARTER" | null;
  matchedDatasetId: string | null;
  // canonical key used for the lookup
  invoiceNo: string;
  invoiceDate: string | null; // YYYY-MM-DD when the input date was valid
  invoiceAmount: string | null;
  matchCount: number;
};

export type LedgerDatasetInfo = {
  id: string;
  datasetType: string;
  quarterId: string | null;
  version: number;
  isActive: boolean;
  sourceSha256: string;
  rowCount: number;
};

// ---------------------------------------------------------------------------
// Dataset resolution
// ---------------------------------------------------------------------------

export async function getQuarterIdByCode(
  client: SqlClient,
  code: string,
): Promise<string | null> {
  const res = await client.query(
    "SELECT id FROM recon.quarters WHERE code = $1",
    [code],
  );
  return res.rows[0]?.id ?? null;
}

// Active historical base (the currently enabled version).
export async function getActiveHistoricalBase(
  client: SqlClient,
): Promise<LedgerDatasetInfo | null> {
  const res = await client.query(
    `SELECT id, dataset_type, quarter_id::text, version, is_active,
            source_sha256, row_count
     FROM recon.ledger_datasets
     WHERE dataset_type = $1 AND is_active = true
     ORDER BY version DESC LIMIT 1`,
    [DATASET_HISTORICAL],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    datasetType: row.dataset_type,
    quarterId: row.quarter_id,
    version: Number(row.version),
    isActive: row.is_active,
    sourceSha256: row.source_sha256,
    rowCount: Number(row.row_count),
  };
}

// Active current-year dataset for a quarter (null when not yet uploaded).
export async function getQuarterLedgerDataset(
  client: SqlClient,
  quarterId: string,
): Promise<LedgerDatasetInfo | null> {
  const res = await client.query(
    `SELECT id, dataset_type, quarter_id::text, version, is_active,
            source_sha256, row_count
     FROM recon.ledger_datasets
     WHERE dataset_type = $1 AND quarter_id = $2 AND is_active = true`,
    [DATASET_CURRENT_YEAR, quarterId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    datasetType: row.dataset_type,
    quarterId: row.quarter_id,
    version: Number(row.version),
    isActive: row.is_active,
    sourceSha256: row.source_sha256,
    rowCount: Number(row.row_count),
  };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

// Normalize a client-supplied verification probe to canonical lookup inputs.
// Returns null when the amount/date cannot be normalized (caller decides 400).
export type VerifyProbe = {
  invoiceNo: string;
  date8: string;
  amountCents: string;
  isoDate: string;
};

export function normalizeVerifyProbe(input: {
  invoiceNo?: unknown;
  invoiceDate?: unknown;
  amount?: unknown;
}): VerifyProbe | null {
  const invoiceNo = normalizeInvoice(input.invoiceNo);
  if (!invoiceNo) return null;
  const date8 = normalizeDateToYyyymmdd(input.invoiceDate);
  if (date8.length !== 8) return null;
  const amountCents = canonicalAmount(input.amount);
  if (amountCents === null) return null;
  const isoDate = canonicalDateToIso(date8);
  if (!isoDate) return null;
  return { invoiceNo, date8, amountCents, isoDate };
}

// Server-authoritative verification of one invoice probe for quarter code Q.
export async function verifyLedgerInvoice(
  client: SqlClient,
  quarterCode: string,
  input: { invoiceNo?: unknown; invoiceDate?: unknown; amount?: unknown },
): Promise<LedgerVerificationResult> {
  const probe = normalizeVerifyProbe(input);
  if (!probe) {
    throw invalidInput("发票号/日期/金额必须提供且可规范化");
  }

  const quarterId = await getQuarterIdByCode(client, quarterCode);
  if (!quarterId) throw notFound(`季度 ${quarterCode} 不存在`);

  // Scope = active HISTORICAL_BASE UNION active CURRENT_YEAR_QUARTER of Q.
  // Single index-seek query; never a scan of the 320k+ rows.
  const res = await client.query(
    `SELECT e.invoice_no_normalized, e.invoice_date::text, e.invoice_amount::text,
            d.dataset_type, d.id AS dataset_id
     FROM recon.ledger_verification_entries e
     JOIN recon.ledger_datasets d ON d.id = e.dataset_id
     WHERE e.invoice_no_normalized = $1
       AND e.invoice_date = $2
       AND e.invoice_amount = $3
       AND d.is_active = true
       AND (
         d.dataset_type = 'HISTORICAL_BASE'
         OR (d.dataset_type = 'CURRENT_YEAR_QUARTER' AND d.quarter_id = $4)
       )
     LIMIT 2`,
    [probe.invoiceNo, probe.isoDate, probe.amountCents, quarterId],
  );

  const row = res.rows[0];
  if (!row) {
    return {
      matched: false,
      status: "not_found",
      matchedDatasetType: null,
      matchedDatasetId: null,
      invoiceNo: probe.invoiceNo,
      invoiceDate: probe.isoDate,
      invoiceAmount: probe.amountCents,
      matchCount: 0,
    };
  }
  return {
    matched: true,
    status: "matched",
    matchedDatasetType: row.dataset_type,
    matchedDatasetId: row.dataset_id,
    invoiceNo: probe.invoiceNo,
    invoiceDate: probe.isoDate,
    invoiceAmount: probe.amountCents,
    matchCount: res.rowCount ?? 1,
  };
}

// ---------------------------------------------------------------------------
// Current-year quarter import
// ---------------------------------------------------------------------------

export type LedgerSourceFile = {
  sourceFileName: string;
  headers: string[];
  rows: unknown[][];
};

// Extract canonical verification keys from parsed Excel source rows, using the
// legacy header detection (QuarterlyReconciliation.tsx readLedgerFiles):
//   invoice: 发票号 / 发票代码 / 单据编号 / 摘要
//   date:    开票日期 / 业务日期 / 财务日期 / 交易日期 / 日期
//   amount:  本期应收 / 应收金额 / 开票金额 / 含税金额 / 借方 / 金额
// A row qualifies when it yields a non-empty invoice + 8-digit date + amount.
const INVOICE_ALIASES = ["发票号", "发票代码", "单据编号", "摘要"];
const DATE_ALIASES = ["开票日期", "业务日期", "财务日期", "交易日期", "日期"];
const AMOUNT_ALIASES = ["本期应收", "应收金额", "开票金额", "含税金额", "借方", "金额"];

function headerIndex(headers: unknown[], names: string[]): number {
  return headers.findIndex((header) => {
    const text = String(header ?? "").replace(/\s/g, "");
    return names.some((name) => text.includes(name));
  });
}

// Resolve the effective header row + the rows that follow it.
//
// Two input contracts are accepted (both are produced by real callers):
//   Format A (current browser, readLedgerSourceFiles):
//     { headers: ["发票号", "开票日期", "本期应收", ...], rows: [[...data...], ...] }
//     -> use file.headers directly; every file.rows entry is a data row.
//   Format B (legacy harness / inline payload):
//     { headers: [], rows: [[可能说明行], ["发票号", ...], [...data...]] }
//     -> scan the first 5 rows of file.rows for a recognized header row.
// Priority: a valid separated `headers` array wins; otherwise fall back to the
// in-rows scan. This keeps the browser contract clean (headers + data rows)
// while preserving backward compatibility with the old inline-header shape.
export function parseLedgerSourceFile(file: LedgerSourceFile): {
  keys: string[];
  rows: { invoice: string; date8: string; amountCents: string; key: string }[];
  qualified: number;
  headerRowFound: boolean;
} {
  const all = file.rows;
  const separatedHeaders = Array.isArray(file.headers)
    ? file.headers.map((header) => String(header ?? "").replace(/\s/g, ""))
    : [];

  // Format A: separated headers array that actually recognizes ALL THREE of the
  // invoice/date/amount fields. If any field is missing we fall through to the
  // in-rows scan (the separated array may be a malformed/partial caller value
  // while the real header row lives in rows[0..5]).
  if (
    separatedHeaders.length > 0 &&
    separatedHeaders.some((header) =>
      INVOICE_ALIASES.some((alias) => header.includes(alias)),
    )
  ) {
    const invoiceAt = headerIndex(separatedHeaders, INVOICE_ALIASES);
    const dateAt = headerIndex(separatedHeaders, DATE_ALIASES);
    const amountAt = headerIndex(separatedHeaders, AMOUNT_ALIASES);
    if (invoiceAt >= 0 && dateAt >= 0 && amountAt >= 0) {
      const rows: { invoice: string; date8: string; amountCents: string; key: string }[] = [];
      const seen = new Set<string>();
      for (const row of all) {
        const invoice = normalizeInvoice(row[invoiceAt]);
        const date8 = normalizeDateToYyyymmdd(row[dateAt]);
        const amount = toNumber(row[amountAt]);
        if (!invoice || date8.length !== 8) continue;
        const amountCents = amount.toFixed(2);
        const key = canonicalVerificationKey(invoice, date8, amount);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        rows.push({ invoice, date8, amountCents, key });
      }
      return { keys: [...seen], rows, qualified: seen.size, headerRowFound: true };
    }
    // Partial/invalid separated headers -> fall through to Format B scan.
  }

  // Format B (fallback): scan the first 5 rows of file.rows for a header row.
  const headerRow = all
    .slice(0, 5)
    .find((row) => headerIndex(row, INVOICE_ALIASES) >= 0);
  if (!headerRow) return { keys: [], rows: [], qualified: 0, headerRowFound: false };
  const invoiceAt = headerIndex(headerRow, INVOICE_ALIASES);
  const dateAt = headerIndex(headerRow, DATE_ALIASES);
  const amountAt = headerIndex(headerRow, AMOUNT_ALIASES);
  if (invoiceAt < 0 || dateAt < 0 || amountAt < 0) {
    return { keys: [], rows: [], qualified: 0, headerRowFound: true };
  }
  const start = all.indexOf(headerRow) + 1;
  const rows: { invoice: string; date8: string; amountCents: string; key: string }[] = [];
  const seen = new Set<string>();
  for (const row of all.slice(start)) {
    const invoice = normalizeInvoice(row[invoiceAt]);
    const date8 = normalizeDateToYyyymmdd(row[dateAt]);
    const amount = toNumber(row[amountAt]);
    if (!invoice || date8.length !== 8) continue;
    const amountCents = amount.toFixed(2);
    const key = canonicalVerificationKey(invoice, date8, amount);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push({ invoice, date8, amountCents, key });
  }
  return { keys: [...seen], rows, qualified: seen.size, headerRowFound: true };
}

// Import one quarter's current-year ledger from one or more account-set files.
// Atomic: all files in ONE transaction; any invalid file rolls back everything.
export async function importQuarterLedger(
  client: SqlClient,
  quarterCode: string,
  sourceFiles: LedgerSourceFile[],
): Promise<Record<string, unknown>> {
  if (!Array.isArray(sourceFiles) || sourceFiles.length === 0) {
    throw invalidInput("必须提供至少一个往来明细文件");
  }
  const m = /^(\d{4})-Q([1-4])$/.exec(quarterCode);
  if (!m) throw invalidInput("季度代码必须是 YYYY-QN 格式");

  const quarterId = await getQuarterIdByCode(client, quarterCode);
  if (!quarterId) throw notFound(`季度 ${quarterCode} 不存在`);

  // Block re-import of a quarter that already has a current-year dataset.
  const existing = await getQuarterLedgerDataset(client, quarterId);
  if (existing) {
    throw conflict(
      `季度 ${quarterCode} 已有本年往来明细数据（版本 ${existing.version}）。` +
        "同季度重新上传策略尚未确认，当前不允许覆盖（LEDGER_QUARTER_DATA_ALREADY_EXISTS）",
    );
  }

  const quarterShort = `q${m[2]}`;
  const year = Number(m[1]);
  const fileNames: string[] = [];
  const seenKeys = new Set<string>();
  const rows: {
    sourceRowKey: string;
    invoice: string;
    date8: string;
    amountCents: string;
    sourceFile: string;
  }[] = [];

  for (const file of sourceFiles) {
    const name = String(file.sourceFileName || "未命名文件").trim();
    fileNames.push(name);
    const parsed = parseLedgerSourceFile(file);
    if (!parsed.headerRowFound) {
      throw invalidInput(`文件 ${name} 未找到包含发票号的表头行`);
    }
    if (parsed.qualified === 0) {
      throw invalidInput(`文件 ${name} 未解析到可核验的发票记录`);
    }
    for (const row of parsed.rows) {
      if (seenKeys.has(row.key)) continue; // intra-batch dedupe
      seenKeys.add(row.key);
      rows.push({
        sourceRowKey: `lg:${quarterShort}:${row.key}`,
        invoice: row.invoice,
        date8: row.date8,
        amountCents: row.amountCents,
        sourceFile: name,
      });
    }
  }

  if (rows.length === 0) {
    throw invalidInput("没有可核验的发票记录");
  }

  // Dataset metadata (audit provenance).
  const sourceSha = canonicalDatasetSha(quarterCode, fileNames, rows);
  const datasetRes = await client.query(
    `INSERT INTO recon.ledger_datasets
       (dataset_type, year, quarter_id, version, is_active,
        source_file_name, source_sha256, source_payload, row_count, imported_at)
     VALUES ($1, $2, $3, 1, true, $4, $5, $6::jsonb, $7, now())
     RETURNING id`,
    [
      DATASET_CURRENT_YEAR,
      year,
      quarterId,
      fileNames.join("、"),
      sourceSha,
      JSON.stringify({
        quarter: quarterCode,
        files: fileNames,
        canonicalCount: rows.length,
      }),
      rows.length,
    ],
  );
  const datasetId = datasetRes.rows[0].id as string;

  // Bulk insert entries (multi-row, chunked; no per-row transactions).
  const CHUNK = 2000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    for (const row of slice) {
      const iso = canonicalDateToIso(row.date8);
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

  // Post-import independent validation inside the same transaction.
  const check = await client.query(
    `SELECT count(*)::int AS entries,
            count(DISTINCT source_row_key)::int AS distinct_keys,
            count(DISTINCT invoice_no_normalized)::int AS distinct_invoices
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

  return {
    quarter: quarterCode,
    status: "IMPORTED",
    datasetId,
    datasetType: DATASET_CURRENT_YEAR,
    version: 1,
    sourceFiles: fileNames,
    sourceSha256: sourceSha,
    insertedRows: rows.length,
    distinctInvoices: Number(c.distinct_invoices),
  };
}

export function canonicalDatasetSha(
  quarterCode: string,
  fileNames: string[],
  rows: { key?: string; sourceRowKey?: string }[],
): string {
  const canonical = JSON.stringify({
    quarter: quarterCode,
    files: fileNames,
    keys: rows.map((r) => (r.key ?? r.sourceRowKey) ?? "").sort(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
