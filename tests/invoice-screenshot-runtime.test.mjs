import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isCompletelyEmptyInvoiceDraft, mergeRecognizedInvoiceDrafts } from "../lib/invoice-draft-merge.mjs";

test("screenshot invoice flow is draft-only and keeps every detected row accountable", () => {
  const drawer = readFileSync("app/BatchInvoiceScreenshotDrawer.tsx", "utf8");
  assert.match(drawer, /onPaste/);
  assert.match(drawer, /onDrop/);
  assert.match(drawer, /手动新增一行/);
  assert.match(drawer, /MANUALLY_SKIPPED/);
  assert.match(drawer, /AUTO_DEDUPED/);
  assert.match(drawer, /CURRENT_DB_EXISTS/);
  assert.match(drawer, /CURRENT_DRAFT_EXISTS/);
  assert.match(drawer, /\^\\d\{7,\}\$/);
  assert.doesNotMatch(drawer, /createDifferenceItem|fetch\(.*difference-items/);
});

test("screenshot candidates dedupe before resolving and only ready rows can be appended", () => {
  const drawer = readFileSync("app/BatchInvoiceScreenshotDrawer.tsx", "utf8");
  // Case A/F: one normalized first occurrence is kept; later OCR or edited duplicates are non-active.
  assert.match(drawer, /resolverCandidates = normalized\.filter/);
  assert.match(drawer, /!seen\.has\(row\.invoiceNumber\) && !!seen\.add\(row\.invoiceNumber\)/);
  assert.match(drawer, /if \(seen\.has\(row\.invoiceNumber\)\).*AUTO_DEDUPED/s);
  // Cases B-D: only unresolved active rows block. Skipped and existing rows do not.
  assert.match(drawer, /const blockingRows = useMemo\(\(\) => rows\.filter\(\(row\) => row\.status === "NEEDS_REVIEW" \|\| row\.status === "AMBIGUOUS" \|\| row\.status === "NOT_FOUND"\)/);
  assert.match(drawer, /const addableRows = useMemo\(\(\) => rows\.filter\(\(row\) => row\.status === "RECOGNIZED"\)/);
  // Case E: a batch is disabled if nothing can be added. Button count is the addable count.
  assert.match(drawer, /disabled=\{busy \|\| blockingRows\.length > 0 \|\| addableRows\.length === 0\}/);
  assert.match(drawer, /批量填入差额明细（\{addableRows\.length\}条）/);
  assert.match(drawer, /当前没有可填入的发票明细/);
});

test("recognized invoices reuse only fully empty invoice drafts in display order", () => {
  const blank = () => ({ invoice: "", date: "", amount: "", note: "" });
  const item = (invoice) => ({ invoice, date: `2026-01-${invoice}`, amount: "2400", note: "" });
  const partial = { invoice: "", date: "", amount: "", note: "客户反馈待确认" };
  // Cases A/B/E/F/G: empty placeholders are filled first, with no extra row.
  assert.deepEqual(mergeRecognizedInvoiceDrafts([blank()], [item("A"), item("B"), item("C")]).map((row) => row.invoice), ["A", "B", "C"]);
  assert.deepEqual(mergeRecognizedInvoiceDrafts([blank(), blank()], [item("A"), item("B"), item("C")]).map((row) => row.invoice), ["A", "B", "C"]);
  assert.deepEqual(mergeRecognizedInvoiceDrafts([blank()], [item("A")]).map((row) => row.invoice), ["A"]);
  // Cases C/D: business content is never overwritten; remaining batch rows append.
  assert.deepEqual(mergeRecognizedInvoiceDrafts([item("OLD1"), item("OLD2")], [item("A"), item("B")]).map((row) => row.invoice), ["OLD1", "OLD2", "A", "B"]);
  assert.deepEqual(mergeRecognizedInvoiceDrafts([blank(), partial, blank()], [item("A"), item("B"), item("C")]).map((row) => row.invoice), ["A", "", "B", "C"]);
  assert.equal(mergeRecognizedInvoiceDrafts([blank()], [item("A")])[0].date, "2026-01-A");
  assert.equal(mergeRecognizedInvoiceDrafts([blank()], [item("A")])[0].amount, "2400");
  assert.equal(isCompletelyEmptyInvoiceDraft({ ...blank(), id: "metadata", verificationStatus: "pending" }), true);
  assert.equal(isCompletelyEmptyInvoiceDraft(partial), false);
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
