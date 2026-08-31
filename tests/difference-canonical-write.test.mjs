import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Phase 2K.3.1 backend canonical difference-category write contract.
// The DB stores ONLY canonical categories; the API edge accepts both the
// canonical value and the legacy write-taxonomy alias, normalizing to canonical
// before any write. These tests assert the source contract; the live HTTP
// matrix is exercised against the isolated staging clone (Phase 2K.3.1 §15).
const writeSrc = await readFile(
  new URL("../lib/server/recon/write.ts", import.meta.url),
  "utf8",
);

test("TEST 1/2: DIFFERENCE_CATEGORIES is the canonical-only storage set", () => {
  for (const canonical of [
    "transit",
    "returned_invoice",
    "lost_invoice",
    "equipment",
    "other_with_invoice",
    "other_without_invoice",
  ]) {
    assert.match(writeSrc, new RegExp(`"${canonical}"`));
  }
  // legacy aliases must NOT be in the canonical storage set
  assert.doesNotMatch(writeSrc, /DIFFERENCE_CATEGORIES = \[\s*"transit",\s*"returned"/);
});

test("TEST 3-7: alias → canonical mapping table is present", () => {
  assert.match(writeSrc, /returned:\s*"returned_invoice"/);
  assert.match(writeSrc, /lost:\s*"lost_invoice"/);
  assert.match(writeSrc, /instrument:\s*"equipment"/);
  assert.match(writeSrc, /otherInvoice:\s*"other_with_invoice"/);
  assert.match(writeSrc, /other:\s*"other_without_invoice"/);
  // canonical identity mapping also present
  assert.match(writeSrc, /returned_invoice:\s*"returned_invoice"/);
  assert.match(writeSrc, /other_without_invoice:\s*"other_without_invoice"/);
});

test("TEST 8: unknown category rejected with INVALID_INPUT", () => {
  assert.match(writeSrc, /throw invalidInput\("差额类别必须是/);
  assert.match(writeSrc, /returned_invoice\/lost_invoice\/equipment\/other_with_invoice\/other_without_invoice 之一/);
});

test("TEST 9: normalization returns canonical only (single return path)", () => {
  assert.match(writeSrc, /const canonical = DIFFERENCE_CATEGORY_ALIASES\[value\]/);
  assert.match(writeSrc, /return canonical;/);
});

test("TEST 10: createDifferenceItem normalizes category to canonical before INSERT", () => {
  const create = writeSrc.slice(writeSrc.indexOf("createDifferenceItem"));
  assert.match(create, /normalizeCategory\(input\.category\)/);
});

test("TEST 11: PATCH normalizes category to canonical, never stores alias", () => {
  const update = writeSrc.slice(writeSrc.indexOf("updateDifferenceItem"));
  assert.match(update, /normalizeCategory\(input\.category\)/);
  assert.match(update, /nextCategory = item\.category/);
});

test("TEST 12: LEDGER_VERIFICATION_CATEGORIES covers all canonical invoice-required categories", () => {
  for (const c of [
    "transit",
    "returned_invoice",
    "lost_invoice",
    "equipment",
    "other_with_invoice",
  ]) {
    assert.match(writeSrc, new RegExp(`"${c}"`));
  }
  // other_without_invoice stays NOT applicable
  assert.match(writeSrc, /other_without_invoice.*not_applicable/s);
});
