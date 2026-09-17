import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("screenshot invoice flow is draft-only and keeps every detected row accountable", () => {
  const drawer = readFileSync("app/BatchInvoiceScreenshotDrawer.tsx", "utf8");
  assert.match(drawer, /onPaste/);
  assert.match(drawer, /onDrop/);
  assert.match(drawer, /手动新增一行/);
  assert.match(drawer, /MANUALLY_SKIPPED/);
  assert.match(drawer, /IMAGE_DUPLICATE/);
  assert.match(drawer, /CURRENT_DB_EXISTS/);
  assert.match(drawer, /CURRENT_DRAFT_EXISTS/);
  assert.match(drawer, /\^\\d\{7,\}\$/);
  assert.doesNotMatch(drawer, /createDifferenceItem|fetch\(.*difference-items/);
});

test("batch resolve uses the active ledger scope and performs no write", () => {
  const ledger = readFileSync("lib/server/ledger/ledger.ts", "utf8");
  const route = readFileSync("app/api/quarter/[code]/ledger/resolve/route.ts", "utf8");
  const page = readFileSync("app/QuarterlyReconciliation.tsx", "utf8");
  assert.match(ledger, /export async function resolveLedgerInvoices/);
  assert.match(ledger, /invoice_no_normalized = ANY/);
  assert.match(ledger, /HISTORICAL_BASE/);
  const resolver = ledger.slice(ledger.indexOf("export async function resolveLedgerInvoices"), ledger.indexOf("// Current-year quarter import"));
  assert.doesNotMatch(resolver, /\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
  assert.match(route, /resolveLedgerInvoices/);
  assert.match(page, /resolveLedgerInvoices\(quarter/);
  assert.match(page, /BatchInvoiceScreenshotDrawer/);
});
