/**
 * The persisted Q1 taxonomy is intentionally kept separate from the form
 * taxonomy.  This is the one place where the two vocabularies may meet.
 */
export const FORM_DIFFERENCE_CATEGORIES = [
  "transit", "returned", "lost", "instrument", "otherInvoice", "other",
];

const API_TO_FORM_CATEGORY = Object.freeze({
  transit: "transit",
  returned_invoice: "returned",
  lost_invoice: "lost",
  equipment: "instrument",
  other_with_invoice: "otherInvoice",
  other_without_invoice: "other",
});

const FORM_TO_API_CATEGORY = Object.freeze(
  Object.fromEntries(Object.entries(API_TO_FORM_CATEGORY).map(([api, form]) => [form, api])),
);

export function toFormDifferenceCategory(category) {
  const mapped = API_TO_FORM_CATEGORY[category];
  if (!mapped) throw new Error(`未知 PostgreSQL 差额类别：${String(category)}`);
  return mapped;
}

export function toApiDifferenceCategory(category) {
  const mapped = FORM_TO_API_CATEGORY[category];
  if (!mapped) throw new Error(`未知表单差额类别：${String(category)}`);
  return mapped;
}

const nullable = (value) => value || null;
const sameArray = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);

function samePersistedFields(current, desired) {
  return current.category === desired.category
    && nullable(current.invoiceNo) === nullable(desired.invoiceNo)
    && nullable(current.invoiceDate) === nullable(desired.invoiceDate)
    && nullable(current.differenceAmount) === nullable(desired.differenceAmount)
    && nullable(current.differenceDescription) === nullable(desired.differenceDescription)
    && sameArray(current.attachmentKeys ?? [], desired.attachmentKeys ?? []);
}

function changedPatch(current, desired) {
  const patch = {};
  if (nullable(current.invoiceNo) !== nullable(desired.invoiceNo)) patch.invoiceNo = desired.invoiceNo;
  if (nullable(current.invoiceDate) !== nullable(desired.invoiceDate)) patch.invoiceDate = desired.invoiceDate;
  if (nullable(current.differenceAmount) !== nullable(desired.differenceAmount)) patch.differenceAmount = desired.differenceAmount;
  if (nullable(current.differenceDescription) !== nullable(desired.differenceDescription)) patch.differenceDescription = desired.differenceDescription;
  if (!sameArray(current.attachmentKeys ?? [], desired.attachmentKeys ?? [])) patch.attachmentKeys = desired.attachmentKeys;
  return patch;
}

/**
 * Returns the exact mutation set for the currently opened reconciliation.
 * Existing rows can only be updated through their own id; their category is
 * never rewritten.  A desired id that was not loaded is rejected rather than
 * risking a positional overwrite or broad delete.
 */
export function planDifferenceItemMutations(currentItems, desiredItems) {
  const currentById = new Map(currentItems.map((item) => [item.id, item]));
  const desiredExistingIds = new Set();
  const patch = [];
  const create = [];

  for (const desired of desiredItems) {
    if (!desired.id) {
      create.push({ ...desired, category: toApiDifferenceCategory(desired.formCategory) });
      continue;
    }
    const current = currentById.get(desired.id);
    if (!current) throw new Error(`差额明细 ${desired.id} 未在当前服务端记录中，已拒绝保存以保护数据。`);
    desiredExistingIds.add(desired.id);
    if (current.category !== desired.category) {
      throw new Error(`差额明细 ${desired.id} 的分类身份不一致，已拒绝保存以保护数据。`);
    }
    if (!samePersistedFields(current, desired)) patch.push({ id: desired.id, body: changedPatch(current, desired) });
  }

  return {
    patch,
    create: create.map(({ id: _id, formCategory: _formCategory, ...body }) => body),
    delete: currentItems.filter((item) => !desiredExistingIds.has(item.id)).map((item) => item.id),
  };
}
