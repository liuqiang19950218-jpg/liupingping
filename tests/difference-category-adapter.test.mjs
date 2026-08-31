import assert from "node:assert/strict";
import test from "node:test";
import {
  planDifferenceItemMutations,
  toApiDifferenceCategory,
  toFormDifferenceCategory,
} from "../lib/difference-category-adapter.mjs";

const canonical = {
  transit: "transit",
  returned_invoice: "returned",
  lost_invoice: "lost",
  equipment: "instrument",
  other_with_invoice: "otherInvoice",
  other_without_invoice: "other",
};
const item = (id, category, extra = {}) => ({
  id, category, invoiceNo: "INV-001", invoiceDate: "2026-01-02",
  differenceAmount: "100.00", differenceDescription: "原始备注",
  verificationStatus: category === "other_without_invoice" ? "not_applicable" : "pending",
  attachmentKeys: [], ...extra,
});
const desired = (source, overrides = {}) => ({
  id: source.id, formCategory: toFormDifferenceCategory(source.category), category: source.category,
  invoiceNo: source.invoiceNo, invoiceDate: source.invoiceDate,
  differenceAmount: source.differenceAmount, differenceDescription: source.differenceDescription,
  attachmentKeys: source.attachmentKeys, ...overrides,
});

for (const [api, form] of Object.entries(canonical)) {
  test(`${api} hydrates to ${form} and round-trips to its canonical API category`, () => {
    assert.equal(toFormDifferenceCategory(api), form);
    assert.equal(toApiDifferenceCategory(form), api);
  });
}

test("other_without_invoice stays isolated and preserves not_applicable without invoice fields", () => {
  const source = item("other-1", "other_without_invoice", {
    invoiceNo: null, invoiceDate: null, verificationStatus: "not_applicable", differenceAmount: "25201.08",
  });
  assert.equal(toFormDifferenceCategory(source.category), "other");
  assert.equal(source.invoiceNo, null);
  assert.equal(source.invoiceDate, null);
  assert.equal(source.verificationStatus, "not_applicable");
  assert.equal(toApiDifferenceCategory("otherInvoice"), "other_with_invoice");
});

test("DIFFERENCE_FORM_NOOP_ROUNDTRIP_SAFE = PASS", () => {
  const current = Object.keys(canonical).map((category, index) => item(`id-${index}`, category));
  const result = planDifferenceItemMutations(current, current.map((row) => desired(row)));
  assert.deepEqual(result, { patch: [], create: [], delete: [] });
});

test("only a returned_invoice description change patches that id", () => {
  const current = [item("returned-id", "returned_invoice"), item("lost-id", "lost_invoice")];
  const result = planDifferenceItemMutations(current, [
    desired(current[0], { differenceDescription: "退票改赠送" }), desired(current[1]),
  ]);
  assert.deepEqual(result, {
    patch: [{ id: "returned-id", body: { differenceDescription: "退票改赠送" } }], create: [], delete: [],
  });
});

test("a real lost deletion cannot delete equipment, other, returned, or transit", () => {
  const current = ["transit", "returned_invoice", "lost_invoice", "equipment", "other_without_invoice"]
    .map((category, index) => item(`id-${index}`, category));
  const result = planDifferenceItemMutations(current, current.filter((row) => row.category !== "lost_invoice").map(desired));
  assert.deepEqual(result.delete, ["id-2"]);
  assert.deepEqual(result.patch, []);
  assert.deepEqual(result.create, []);
});

test("a new instrument entry creates the canonical equipment category", () => {
  const result = planDifferenceItemMutations([], [{
    formCategory: "instrument", category: "equipment", invoiceNo: "EQ-1", invoiceDate: "2026-01-02",
    differenceAmount: "45.00", differenceDescription: "仪器", attachmentKeys: [],
  }]);
  assert.equal(result.create.length, 1);
  assert.equal(result.create[0].category, "equipment");
});

test("856-item Q1 category fixture maps losslessly with no unknown category", () => {
  const counts = { transit: 594, returned_invoice: 21, lost_invoice: 14, equipment: 45, other_with_invoice: 16, other_without_invoice: 166 };
  const rows = Object.entries(counts).flatMap(([category, count]) => Array.from({ length: count }, (_, index) => item(`${category}-${index}`, category)));
  assert.equal(rows.length, 856);
  assert.equal(rows.filter((row) => toApiDifferenceCategory(toFormDifferenceCategory(row.category)) !== row.category).length, 0);
});
