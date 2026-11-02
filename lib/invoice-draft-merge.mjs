const text = (value) => typeof value === "string" ? value.trim() : "";

// `id` and verification state are UI/persistence metadata, not sales-entered
// business data. Only an invoice draft with every editable business field
// blank may be reused by the screenshot batch.
export function isCompletelyEmptyInvoiceDraft(entry) {
  return text(entry?.invoice) === ""
    && text(entry?.date) === ""
    && text(entry?.amount) === ""
    && text(entry?.note) === "";
}

export function mergeRecognizedInvoiceDrafts(existingEntries, recognizedEntries) {
  let cursor = 0;
  const merged = existingEntries.map((entry) => {
    if (!isCompletelyEmptyInvoiceDraft(entry) || cursor >= recognizedEntries.length) return entry;
    return recognizedEntries[cursor++];
  });
  return [...merged, ...recognizedEntries.slice(cursor)];
}
