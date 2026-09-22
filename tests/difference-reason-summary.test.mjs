import assert from "node:assert/strict";
import test from "node:test";
import { differenceReasonsByReconciliation, summarizeDifferenceReasons } from "../lib/difference-reason-summary.mjs";

const item = (overrides = {}) => ({
  reconciliationId: "reconciliation-q1-a",
  quarterCode: "2026-Q1",
  category: "other_without_invoice",
  differenceDescription: "客户未提供发票",
  ...overrides,
});

test("shows the persisted difference-item reason with its historical category label", () => {
  assert.equal(summarizeDifferenceReasons([item()]), "其他：客户未提供发票");
});

test("returns empty only when the customer has no persisted difference-item reason", () => {
  assert.equal(summarizeDifferenceReasons([item({ differenceDescription: null })]), "");
});

test("combines multiple reasons in API creation order", () => {
  assert.equal(summarizeDifferenceReasons([
    item({ category: "transit", differenceDescription: "在途单据" }),
    item({ category: "lost_invoice", differenceDescription: "丢失发票" }),
  ]), "在途：在途单据；丢票：丢失发票");
});

test("retains duplicate reasons because the historical display rule does not deduplicate", () => {
  assert.equal(summarizeDifferenceReasons([item(), item()]), "其他：客户未提供发票；其他：客户未提供发票");
});

test("keeps Q1 and Q2 strictly isolated through quarterCode and reconciliationId", () => {
  const reasons = differenceReasonsByReconciliation([
    item(),
    item({ quarterCode: "2026-Q2", reconciliationId: "reconciliation-q2-a", differenceDescription: "Q2 原因" }),
  ], "2026-Q1");
  assert.equal(reasons.get("reconciliation-q1-a"), "其他：客户未提供发票");
  assert.equal(reasons.has("reconciliation-q2-a"), false);
});

test("uses explicit reconciliation ids instead of any customer-name matching", () => {
  const reasons = differenceReasonsByReconciliation([
    item({ reconciliationId: "exact-id-a", differenceDescription: "同名客户 A" }),
    item({ reconciliationId: "exact-id-b", differenceDescription: "同名客户 B" }),
  ], "2026-Q1");
  assert.equal(reasons.get("exact-id-a"), "其他：同名客户 A");
  assert.equal(reasons.get("exact-id-b"), "其他：同名客户 B");
});
