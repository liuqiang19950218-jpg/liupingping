// Phase 2G.1 server-authoritative difference enforcement live validation.
// CASE A: real historical invoice -> save succeeds, server sets matched.
// CASE B: nonexistent invoice -> 409, no row inserted.
// CASE C: nonexistent invoice + client-forged "matched" -> still 409.
// Uses a safe test reconciliation in the isolated ledger test DB, cleans up.
import assert from "node:assert/strict";
import { withPostgresClient, withPostgresTransaction } from "../../db/postgres";
import { createDifferenceItem } from "../../lib/server/recon/write";
import { verifyLedgerInvoice } from "../../lib/server/ledger/ledger";

const log = (s: string) => console.log(s);

async function qid(client: any, code: string): Promise<string | null> {
  const r = await client.query("SELECT id FROM recon.quarters WHERE code=$1", [code]);
  return r.rows[0]?.id ?? null;
}

async function main() {
  const db = await withPostgresClient(async (client) => {
    const r = await client.query("SELECT current_database() AS db");
    return r.rows[0].db as string;
  });
  log(`[target DB] ${db}`);
  assert.match(db, /ledger_runtime_test_20260828/);

  // A real historical invoice from V1 (000013 / 2011-07-22 / 2940.00) and a
  // guaranteed-not-in-ledger probe.
  const hist = await withPostgresClient((c) =>
    verifyLedgerInvoice(c, "2026-Q2", { invoiceNo: "000013", invoiceDate: "2011-07-22", amount: "2940.00" }),
  );
  log(`[historical probe] matched=${hist.matched}`);
  assert.equal(hist.matched, true, "historical invoice must match before write test");

  const missing = await withPostgresClient((c) =>
    verifyLedgerInvoice(c, "2026-Q2", { invoiceNo: "NF-FORGE-TEST-999", invoiceDate: "2026-05-01", amount: "888.00" }),
  );
  log(`[missing probe] matched=${missing.matched}`);
  assert.equal(missing.matched, false);

  // Create a safe test reconciliation in Q2 (will be deleted at cleanup).
  const testRecId = await withPostgresTransaction(async (client) => {
    const q = await qid(client, "2026-Q2");
    // find an existing Q2 reconciliation to attach to (never fabricate a business
    // row we can't cleanly scope). Pick one with an unused category slot.
    const r = await client.query(
      `SELECT r.id FROM recon.reconciliations r
       JOIN recon.quarters q ON q.id = r.quarter_id
       WHERE q.code = '2026-Q2'
       ORDER BY r.id LIMIT 1`,
    );
    return r.rows[0].id as string;
  });
  log(`[setup] test reconciliation=${testRecId}`);

  // Remove any stale FIXTURE rows left by an earlier interrupted run.
  await withPostgresClient(async (client) => {
    await client.query(
      `DELETE FROM recon.difference_items WHERE reconciliation_id=$1 AND difference_description LIKE 'FIXTURE-%'`,
      [testRecId],
    );
  });
  log("[setup] cleared stale FIXTURE rows");

  // CASE A: real historical invoice in required category (transit) -> success, matched
  // NOTE: createDifferenceItem manages its own transaction; it is NOT passed a client.
  const created = await createDifferenceItem("2026-Q2", testRecId, {
    category: "transit",
    invoiceNo: "000013",
    invoiceDate: "2011-07-22",
    differenceAmount: "2940.00",
    differenceDescription: "FIXTURE-A",
    verificationStatus: "mismatched", // client attempts to forge a non-matched state
    attachmentKeys: [],
  });
  log(`[CASE A] created id=${created.id} status=${created.verificationStatus}`);
  assert.equal(created.verificationStatus, "matched", "server must set matched for a real historical invoice");

  // CASE B: nonexistent invoice -> rejected, nothing inserted
  let bRejected = false;
  try {
    await createDifferenceItem("2026-Q2", testRecId, {
      category: "transit",
      invoiceNo: "NF-FORGE-TEST-999",
      invoiceDate: "2026-05-01",
      differenceAmount: "888.00",
      differenceDescription: "FIXTURE-B",
      verificationStatus: "matched",
      attachmentKeys: [],
    });
  } catch (e: any) {
    bRejected = true;
    log(`[CASE B] rejected: status=${e.status} code=${e.code ?? "?"} msg=${e.message}`);
    assert.equal(e.status, 409, "CASE B must be 409");
    assert.match(String(e.message), /LEDGER_INVOICE_NOT_FOUND/);
  }
  assert.equal(bRejected, true, "CASE B must be rejected");

  // CASE C: nonexistent invoice + forged "matched" -> still rejected.
  // Note: the write API accepts only the NEW category taxonomy
  // (transit/returned/lost/instrument/otherInvoice/other); legacy migrated
  // category values (returned_invoice etc.) exist in DB rows but cannot be
  // re-created via this API — they are enforced on UPDATE via item.category.
  let cRejected = false;
  try {
    await createDifferenceItem("2026-Q2", testRecId, {
      category: "returned", // new taxonomy, required verification
      invoiceNo: "NF-FORGE-TEST-999",
      invoiceDate: "2026-05-01",
      differenceAmount: "888.00",
      differenceDescription: "FIXTURE-C",
      verificationStatus: "matched", // forged
      attachmentKeys: [],
    });
  } catch (e: any) {
    cRejected = true;
    log(`[CASE C] rejected (forged matched ignored): status=${e.status} msg=${e.message}`);
    assert.equal(e.status, 409, "CASE C must be 409");
  }
  assert.equal(cRejected, true, "CASE C must be rejected");

  // Verify only CASE A row exists for this reconciliation
  const rows = await withPostgresClient(async (client) => {
    const r = await client.query(
      `SELECT category, invoice_no, verification_status FROM recon.difference_items
       WHERE reconciliation_id=$1 AND difference_description LIKE 'FIXTURE-%'`,
      [testRecId],
    );
    return r.rows;
  });
  log(`[cleanup check] fixture rows: ${JSON.stringify(rows)}`);
  assert.equal(rows.length, 1, "only CASE A row may exist");
  assert.equal(rows[0].verification_status, "matched");

  // Cleanup: delete the CASE A fixture row + any FIXTURE rows
  await withPostgresClient(async (client) => {
    await client.query(
      `DELETE FROM recon.difference_items WHERE reconciliation_id=$1 AND difference_description LIKE 'FIXTURE-%'`,
      [testRecId],
    );
  });
  log("[cleanup] fixture difference rows removed");

  log("SERVER_AUTHORITATIVE_LEDGER_VERIFICATION = YES");
  log("CLIENT_CANNOT_FORGE_LEDGER_MATCH = YES");
  log("ENFORCEMENT_LIVE_VALIDATION_DONE");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("HARNESS_FAILED:", err);
    process.exit(1);
  },
);
