/**
 * Phase 2K.9B-1 manual resolution + finance attention state contract.
 *
 * Single source of truth for the two new reconciliation state dimensions:
 *
 *   manual_resolution_status  -> 'resolved' | 'reopened' | null
 *   financial_attention       -> 'none' | '无需关注' | '一般关注' | '需财务复核'
 *
 * Both are validated PURE functions so the write path and the unit tests share
 * exactly one definition (no duplicate literals between tests and server code).
 *
 * Manual resolution is an INDEPENDENT dimension: it is never derived from
 * solution / solutionDate / follow_status (Phase 2K.9A proved the old routing
 * lost the 22 manually-resolved customers that way).
 *
 * Finance attention: 'none' (default, historical empty) is a DISTINCT stored
 * value from 无需关注 (an explicit user choice). They must never be conflated.
 */

export const MANUAL_RESOLUTION_VALUES = ["resolved", "reopened"];

export const FINANCE_ATTENTION_VALUES = [
  "none",
  "无需关注",
  "一般关注",
  "需财务复核",
];

/** Typed error carrying a user-facing Chinese message; write.ts maps it to a 400. */
export class StateValidationError extends Error {}

/**
 * Normalize a manualResolutionStatus input.
 * Accepts 'resolved' | 'reopened' | null | undefined (null/undefined -> null).
 * Anything else throws StateValidationError.
 */
export function normalizeManualResolutionStatus(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new StateValidationError(
      "manualResolutionStatus 必须是 'resolved' / 'reopened' / null",
    );
  }
  const trimmed = value.trim();
  if (!MANUAL_RESOLUTION_VALUES.includes(trimmed)) {
    throw new StateValidationError(
      "manualResolutionStatus 只能是 'resolved' 或 'reopened' 或 null",
    );
  }
  return trimmed;
}

/**
 * Normalize a financeAttention input.
 * Accepts 'none' | '无需关注' | '一般关注' | '需财务复核' only.
 * null/undefined/anything else throws StateValidationError (financial_attention
 * is NOT NULL with default 'none'; there is no null clearing value).
 */
export function normalizeFinanceAttention(value) {
  if (typeof value !== "string") {
    throw new StateValidationError(
      "financeAttention 必须是字符串：none / 无需关注 / 一般关注 / 需财务复核",
    );
  }
  const trimmed = value.trim();
  if (!FINANCE_ATTENTION_VALUES.includes(trimmed)) {
    throw new StateValidationError(
      "financeAttention 只能是 none / 无需关注 / 一般关注 / 需财务复核",
    );
  }
  return trimmed;
}
