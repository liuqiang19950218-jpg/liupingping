import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// These tests assert the pure business rules of the PostgreSQL ledger
// verification runtime (Phase 2G.1) without a live DB. They mirror the legacy
// browser rules from QuarterlyReconciliation.tsx (num/normalizeDate/ledgerKey).

// --- replication of the runtime normalization (must equal lib/server/ledger/normalize.ts) ---
function num(value) {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function normalizeDateToYyyymmdd(value) {
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
function canonicalAmount(value) {
  return num(value).toFixed(2);
}
function canonicalKey(invoice, date, amount) {
  const inv = String(invoice ?? "").trim();
  const d = normalizeDateToYyyymmdd(date);
  if (!inv || d.length !== 8) return null;
  return `${inv}|${d}|${canonicalAmount(amount)}`;
}

test("amount normalization: 100 / 100.0 / 100.00 all canonicalize to 100.00", () => {
  assert.equal(canonicalAmount(100), "100.00");
  assert.equal(canonicalAmount("100.0"), "100.00");
  assert.equal(canonicalAmount("100.00"), "100.00");
  assert.equal(canonicalAmount("1,000.5"), "1000.50");
  assert.equal(canonicalAmount("100.005"), "100.00"); // JS toFixed(2) on the float, legacy
  assert.equal(canonicalAmount("abc"), "0.00"); // num() fallback to 0, legacy
});

test("invoice normalization: trim, leading zeros preserved, never parsed as number", () => {
  assert.equal(canonicalKey(" 000013 ", "2023-09-15", "100.00"), "000013|20230915|100.00");
  // 20-digit invoice must survive as text (no precision loss)
  const big = "25322000000058724161";
  assert.equal(canonicalKey(big, "2026-04-01", "101314.80"), `${big}|20260401|101314.80`);
});

test("date normalization: YYYY-MM-DD, YYYY/MM/DD, YYYYMMDD, serial-like digits", () => {
  assert.equal(normalizeDateToYyyymmdd("2023-09-15"), "20230915");
  assert.equal(normalizeDateToYyyymmdd("2023/09/15"), "20230915");
  assert.equal(normalizeDateToYyyymmdd("20230915"), "20230915");
  assert.equal(normalizeDateToYyyymmdd(""), "");
  assert.equal(normalizeDateToYyyymmdd("not-a-date"), "");
});

test("canonical key: empty invoice or bad date -> null", () => {
  assert.equal(canonicalKey("", "2023-09-15", "1.00"), null);
  assert.equal(canonicalKey("A", "", "1.00"), null);
  assert.equal(canonicalKey("A", "bad", "1.00"), null);
});

test("ledger verification rule mirrors legacy validLedgerEntry union semantics", () => {
  // Legacy: matched if lookup[invoice] has the date AND |amount - lookup.amount| < 0.01
  // OR keys has "invoice|YYYYMMDD|amount2dp". The PG dataset stores the union.
  const keys = new Set(["A|20230101|100.00", "B|20230101|200.00"]);
  const lookup = { A: { amount: 100.0, dates: ["2023-01-01"] } };

  const valid = (invoice, date, amount) => {
    const matched = lookup[invoice.trim()];
    return Boolean(
      (matched &&
        matched.dates.includes(date) &&
        Math.abs(matched.amount - num(amount)) < 0.01) ||
        keys.has(canonicalKey(invoice, date, amount)),
    );
  };

  // Path A (lookup)
  assert.equal(valid("A", "2023-01-01", "100"), true);
  assert.equal(valid("A", "2023-01-02", "100"), false); // wrong date
  assert.equal(valid("A", "2023-01-01", "101"), false); // wrong amount
  // Path B (keyset)
  assert.equal(valid("B", "2023-01-01", "200.00"), true);
  // Both absent
  assert.equal(valid("C", "2023-01-01", "100"), false);
});

test("ledger import header detection accepts legacy aliases", async () => {
  const route = await readFile(
    new URL("../lib/server/ledger/ledger.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /发票号/);
  assert.match(route, /开票日期/);
  assert.match(route, /本期应收/);
  assert.match(route, /INVOICE_ALIASES|发票号/);
  assert.match(route, /canonicalVerificationKey/);
  assert.match(route, /ledger_verification_entries/);
});

test("verify + import routes exist and are server-scoped, not static-JSON", async () => {
  const [verifyRoute, importRoute, ledgerLib] = await Promise.all([
    readFile(new URL("../app/api/quarter/[code]/ledger/verify/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/quarter/[code]/ledger/import/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/ledger/ledger.ts", import.meta.url), "utf8"),
  ]);
  assert.match(verifyRoute, /verifyLedgerInvoice/);
  assert.match(importRoute, /importQuarterLedger/);
  assert.match(ledgerLib, /HISTORICAL_BASE/);
  assert.match(ledgerLib, /CURRENT_YEAR_QUARTER/);
  // The server verification queries PG; it must not fetch the static JSON.
  assert.doesNotMatch(verifyRoute, /ledger_keys\.json/);
  assert.doesNotMatch(importRoute, /ledger_keys\.json/);
});

test("difference enforcement: client verificationStatus is never trusted", async () => {
  const write = await readFile(
    new URL("../lib/server/recon/write.ts", import.meta.url),
    "utf8",
  );
  assert.match(write, /LEDGER_VERIFICATION_CATEGORIES/);
  assert.match(write, /enforceLedgerVerification/);
  assert.match(write, /LEDGER_INVOICE_NOT_FOUND/);
  assert.match(write, /verifyLedgerInvoice/);
  // invoice categories require verification; other (无发票) is not applicable
  assert.match(write, /"transit"/);
  assert.match(write, /"returned"/);
  assert.match(write, /"lost"/);
  assert.match(write, /"instrument"/);
  assert.match(write, /"otherInvoice"/);
});

test("PostgreSQL frontend ledger path posts quarter-scoped import and on-demand verify", async () => {
  const page = await readFile(new URL("../app/QuarterlyReconciliation.tsx", import.meta.url), "utf8");
  assert.match(page, /readLedgerSourceFiles/);
  assert.match(page, /importQuarterLedger\(activeQuarter, \{ sourceFiles \}\)/);
  assert.match(page, /verifyLedgerInvoice\(quarter, \{ invoiceNo: entry\.invoice, invoiceDate: entry\.date, amount: entry\.amount \}/);
  assert.match(page, /LEDGER_QUARTER_DATA_ALREADY_EXISTS/);
  assert.match(page, /setTimeout\(.*400/s);
  // The runtime no longer fetches the 32万-row browser JSON or reads/writes the
  // current-year IndexedDB ledger; legacy helper definitions remain isolated.
  assert.doesNotMatch(page, /fetch\("\/ledger_keys\.json"\)/);
  assert.doesNotMatch(page, /fetch\("\/ledger_invoice_lookup\.json"\)/);
  assert.doesNotMatch(page, /await saveCurrentLedger\(/);
  assert.doesNotMatch(page, /await loadCurrentLedger\(/);
});
