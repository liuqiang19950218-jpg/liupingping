import { toFormDifferenceCategory } from "./difference-category-adapter.mjs";

// Kept in the same vocabulary and order as the historical PostgreSQL table
// summary.  This is a presentation helper only: persistence remains owned by
// recon.difference_items.
const SUMMARY_LABEL = Object.freeze({
  transit: "在途",
  returned: "退票",
  lost: "丢票",
  instrument: "仪器设备",
  otherInvoice: "其他（有发票）",
  other: "其他",
});

/**
 * Restores the historical difference-reason display rule: retain API order,
 * retain duplicates, and join non-empty item descriptions as `类别：原因`.
 */
export function summarizeDifferenceReasons(items) {
  return items
    .filter((item) => item.differenceDescription)
    .map((item) => `${SUMMARY_LABEL[toFormDifferenceCategory(item.category)]}：${item.differenceDescription}`)
    .join("；");
}

/**
 * Indexes only records from the selected quarter by their explicit foreign key.
 * No customer-name matching is used or needed.
 */
export function differenceReasonsByReconciliation(items, quarterCode) {
  const grouped = new Map();
  for (const item of items) {
    if (item.quarterCode !== quarterCode) continue;
    const entries = grouped.get(item.reconciliationId) ?? [];
    entries.push(item);
    grouped.set(item.reconciliationId, entries);
  }
  return new Map([...grouped].map(([reconciliationId, entries]) => [
    reconciliationId,
    summarizeDifferenceReasons(entries),
  ]));
}
