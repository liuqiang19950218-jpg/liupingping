// Shared parsing / normalization helpers for the Phase 2H.1 remaining business
// import backends. These reproduce the EXACT legacy browser semantics
// (QuarterlyReconciliation.tsx importMaterials / importSpdSheet /
// importCompanyReceivables) so a re-import of the same Excel produces the same
// business result as the old localStorage flow.
//
// Key facts reproduced from the real legacy code (re-verified, not re-derived):
//   - headerIndex: whitespace-stripped CONTAINS match against aliases.
//   - matchKey: account/region/customer with ALL whitespace removed, joined by
//     a unit separator (legacy joined with "|"; the separator never appears in
//     the normalized values, so \u001f is equivalent and safer).
//   - material provided derivation (from the approved Q1 dry-run migrator):
//       ["已提供","已回函","是"]            -> true
//       ["未对账","","—"]                  -> null
//       anything else ("否","未提供","已盖章","未盖章","未回函", ...) -> false
//   - raw_value is preserved as-is (trimmed; empty -> NULL).
import { createHash } from "node:crypto";

export const MATERIAL_HEADERS = [
  "对账函",
  "对账确认函",
  "SPD确认表",
  "SPD库存确认函",
  "在途证明",
  "精准核销",
  "催款函送达证明",
] as const;

// SPD确认表 is the canonical material type; the legacy sheet also spells it
// "SPD确认函" (materialImportAliases in QuarterlyReconciliation.tsx).
export const MATERIAL_HEADER_ALIASES: Record<string, string[]> = {
  "SPD确认表": ["SPD确认表", "SPD确认函"],
};

// Independent SPD dashboard headers (SPD-B). 序号/账套/区域/客户名称/备注 are
// optional provenance; at least one SPD status column is required.
export const SPD_CONFIRMATION_HEADERS = ["SPD确认表", "SPD确认函"];
export const SPD_INVENTORY_CONFIRMATION_HEADERS = ["SPD库存确认函"];

// Company receivable column aliases (companyReceivableImportAliases).
export const COMPANY_RECEIVABLE_HEADERS = ["公司应收", "公司应收金额", "公司应收（元）"];

// Migration-confirmed provided derivation (see header comment).
const PROVIDED_TRUE = new Set(["已提供", "已回函", "是"]);
const PROVIDED_SENTINEL = new Set(["未对账", "", "—"]);

export function materialProvided(rawValue: string): boolean | null {
  if (PROVIDED_TRUE.has(rawValue)) return true;
  if (PROVIDED_SENTINEL.has(rawValue)) return null;
  return false;
}

export type SqlClient = {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rowCount: number | null; rows: Array<Record<string, any>> }>;
};

export function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

// Legacy key normalization: remove ALL whitespace (internal + edges), then trim.
export function normalizeKey(value: unknown): string {
  return String(value ?? "").replace(/\s/g, "").trim();
}

// Whitespace-stripped CONTAINS match against aliases (legacy headerIndex).
export function headerIndex(headers: unknown[], aliases: string[]): number {
  return headers.findIndex((header) => {
    const h = String(header ?? "").replace(/\s/g, "");
    return aliases.some((alias) => h.includes(alias.replace(/\s/g, "")));
  });
}

export function matchKey(accountSet: unknown, region: unknown, customer: unknown): string {
  return [accountSet, region, customer]
    .map((value) => normalizeKey(value))
    .join("\u001f");
}

export function sourceSha256(fileName: string, headers: string[], rows: unknown[][]): string {
  const canonical = JSON.stringify({ fileName, headers, rows });
  return createHash("sha256").update(canonical).digest("hex");
}

// Deterministic per-row source key (replay-safe across re-imports of the same file).
export function sourceRowKey(prefix: string, rowIndex: number, row: unknown[]): string {
  const canonical = JSON.stringify({ rowIndex, row: row.map((c) => String(c ?? "")) });
  return `${prefix}:${createHash("sha256").update(canonical).digest("hex").slice(0, 24)}`;
}

export const QUARTER_CODE_RE = /^(\d{4})-Q([1-4])$/;

export function isValidQuarterCode(code: string): boolean {
  return QUARTER_CODE_RE.test(code);
}

// Shared target_module for all four remaining-import entry types.
export const REMAINING_IMPORTS_TARGET_MODULE = "remaining-imports";

export const IMPORT_DATA_TYPES = {
  material: "MATERIAL_STATUS_IMPORT",
  spd: "INDEPENDENT_SPD_IMPORT",
  receivable: "COMPANY_RECEIVABLE_UPDATE",
  historical: "HISTORICAL_LEDGER_REPLACE",
} as const;

// A reconciliation row joined with its dimension names, used by the exact
// (账套 + 区域 + 客户名称) matching for material / receivable / SPD imports.
export type ReconciliationMatchRow = {
  id: string;
  quarterId: string;
  accountSetId: string;
  customerId: string;
  companyReceivable: string | null;
  customerBookAmount: string | null;
  accountSetName: string;
  regionName: string;
  customerName: string;
};

// Load the current quarter's reconciliations with their dimension names so the
// server can match a source (账套, 区域, 客户名称) triple EXACTLY. account_set
// and region use their names (code == name in the runtime dictionaries); a
// missing region (customer.region_id NULL) normalizes to "" like the legacy key.
export async function loadQuarterReconciliations(
  client: SqlClient,
  quarterId: string,
): Promise<ReconciliationMatchRow[]> {
  const res = await client.query(
    `SELECT r.id, r.quarter_id::text AS quarter_id,
            r.account_set_id::text AS account_set_id,
            r.customer_id::text AS customer_id,
            r.company_receivable::text AS company_receivable,
            r.customer_book_amount::text AS customer_book_amount,
            a.name AS account_set_name,
            coalesce(reg.name, '') AS region_name,
            c.name AS customer_name
     FROM recon.reconciliations r
     JOIN recon.account_sets a ON a.id = r.account_set_id
     JOIN recon.customers c ON c.id = r.customer_id
     LEFT JOIN recon.regions reg ON reg.id = c.region_id
     WHERE r.quarter_id = $1`,
    [quarterId],
  );
  return res.rows.map((row) => ({
    id: row.id as string,
    quarterId: row.quarter_id as string,
    accountSetId: row.account_set_id as string,
    customerId: row.customer_id as string,
    companyReceivable: (row.company_receivable as string | null) ?? null,
    customerBookAmount: (row.customer_book_amount as string | null) ?? null,
    accountSetName: (row.account_set_name as string) ?? "",
    regionName: (row.region_name as string) ?? "",
    customerName: (row.customer_name as string) ?? "",
  }));
}

// Build an exact-match index from reconciliation rows. Returns the list of
// matches per normalized key so callers can distinguish 0 / 1 / >1 matches.
export function indexByMatchKey(
  rows: ReconciliationMatchRow[],
): { byKey: Map<string, ReconciliationMatchRow[]>; ambiguousKeys: Set<string> } {
  const byKey = new Map<string, ReconciliationMatchRow[]>();
  for (const row of rows) {
    const key = matchKey(row.accountSetName, row.regionName, row.customerName);
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }
  const ambiguousKeys = new Set<string>();
  for (const [key, list] of byKey) {
    if (list.length > 1) ambiguousKeys.add(key);
  }
  return { byKey, ambiguousKeys };
}
