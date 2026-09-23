const validImportOrder = (value) => Number.isSafeInteger(value) && value >= 0;

// API order is the source of truth. Only restore the original Excel order when
// every row carries its persisted source-row position; never infer it from the
// business sequence or from the current array index.
export function preserveImportedOrder(rows) {
  if (!rows.every((row) => validImportOrder(row.importOrder))) return [...rows];
  return [...rows].sort((left, right) => left.importOrder - right.importOrder);
}
