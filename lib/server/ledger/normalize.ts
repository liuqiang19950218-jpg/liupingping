// Pure normalization helpers for the PostgreSQL ledger verification runtime.
// These MUST reproduce the legacy browser behavior exactly (QuarterlyReconciliation.tsx):
//   num()        -> Number(String(value).replace(/,/g, "")), finite or 0
//   normalizeDate-> 8-digit YYYYMMDD when parseable, else ""
//   ledgerKey    -> `${invoice.trim()}|${dateDigits(8)}|${amount.toFixed(2)}`
//   validLedgerEntry: matches if EITHER
//       (A) lookup[invoice.trim()] exists AND dates includes entry.date (YYYY-MM-DD)
//           AND |lookup.amount - num(entry.amount)| < 0.01
//     OR (B) keys.has(`${invoice.trim()}|${YYYYMMDD}|${amount.toFixed(2)}`)
// The PostgreSQL dataset stores exactly the UNION surface of (A)+(B) as
// (invoice_no_normalized, invoice_date, invoice_amount) with a composite index.
import { createHash } from "node:crypto";

export function normalizeInvoice(value: unknown): string {
  return String(value ?? "").trim();
}

// num() equivalent: strip commas, parse, finite else 0.
export function toNumber(value: unknown): number {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// Legacy normalizeDate: 8-digit YYYYMMDD string, "" when not parseable.
export function normalizeDateToYyyymmdd(value: unknown): string {
  const text = String(value ?? "").trim();
  const digits = text.replace(/[^0-9]/g, "");
  if (digits.length === 8) return digits;
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) {
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(
      date.getDate(),
    ).padStart(2, "0")}`;
  }
  return "";
}

// Amount as canonical 2-decimal string (JS toFixed(2), matching ledgerKey).
export function normalizeAmountToCents(value: unknown): string {
  return toNumber(value).toFixed(2);
}

// Strict AMOUNT_RE used by the server write layer: numeric with <=2 decimals.
const AMOUNT_RE = /^-?\d+(\.\d{1,2})?$/;

// Returns "1234.56" (2dp, right-padded) or null when the input is not a valid
// <=2dp amount. Mirrors normalizeAmountToCents for money written to numeric(18,2).
export function canonicalAmount(value: unknown): string | null {
  const s = normalizeAmountToCents(value);
  if (!AMOUNT_RE.test(s)) return null;
  return s;
}

// The canonical verification key (legacy ledgerKey): invoice|YYYYMMDD|amount2dp.
// Returned only when all three parts are present and the date is 8 digits.
export function canonicalVerificationKey(
  invoice: unknown,
  date: unknown,
  amount: unknown,
): string | null {
  const inv = normalizeInvoice(invoice);
  const d = normalizeDateToYyyymmdd(date);
  if (!inv || d.length !== 8) return null;
  const amt = canonicalAmount(amount);
  if (amt === null) return null;
  return `${inv}|${d}|${amt}`;
}

// Deterministic content hash for a source row key (stable per row across
// re-imports of the same file). Same shape as the quarter import sourceRowKey.
export function ledgerSourceRowKey(quarterShort: string, key: string): string {
  return `lg:${quarterShort}:${createHash("sha256")
    .update(key)
    .digest("hex")
    .slice(0, 24)}`;
}

export function canonicalDateToIso(d8: string): string | null {
  if (!/^\d{8}$/.test(d8)) return null;
  const year = Number(d8.slice(0, 4));
  const month = Number(d8.slice(4, 6));
  const day = Number(d8.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${d8.slice(0, 4)}-${d8.slice(4, 6)}-${d8.slice(6, 8)}`;
}
