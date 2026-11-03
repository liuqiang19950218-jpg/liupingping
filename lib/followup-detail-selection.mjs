/**
 * A detail dialog must never keep a historical customer snapshot. The
 * reconciliation id remains stable when follow-up data is refreshed, whereas
 * a follow-up row id can change when a record is first created.
 */
export const resolveSelectedFollowupDetail = (items, reconciliationId) =>
  reconciliationId
    ? items.find((item) => item.reconciliationId === reconciliationId) ?? null
    : null;
