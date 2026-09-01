import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Phase 2K.9B-1 backend contract: manual resolution status + finance attention.
//
// Pure-function tests cover the shared normalizers (single source of truth).
// Source-contract tests pin the write/read/migration behavior so a future edit
// cannot silently drop the field-isolation or the safe backfill.

import {
  MANUAL_RESOLUTION_VALUES,
  FINANCE_ATTENTION_VALUES,
  normalizeManualResolutionStatus,
  normalizeFinanceAttention,
  StateValidationError,
} from "../lib/manual-resolution-state.mjs";

// --- A. manualResolutionStatus normalization ---------------------------------
test("A1: null/undefined -> null (clear state)", () => {
  assert.equal(normalizeManualResolutionStatus(null), null);
  assert.equal(normalizeManualResolutionStatus(undefined), null);
});

test("A2: valid values pass through", () => {
  assert.equal(normalizeManualResolutionStatus("resolved"), "resolved");
  assert.equal(normalizeManualResolutionStatus("reopened"), "reopened");
  assert.equal(normalizeManualResolutionStatus(" resolved "), "resolved");
});

test("A3: invalid manualResolutionStatus throws StateValidationError", () => {
  for (const bad of ["pending", "closed", "已解决", "", 123, true, "Resolved"]) {
    assert.throws(() => normalizeManualResolutionStatus(bad), StateValidationError);
  }
});

test("A4: MANUAL_RESOLUTION_VALUES is exactly resolved/reopened", () => {
  assert.deepEqual(MANUAL_RESOLUTION_VALUES, ["resolved", "reopened"]);
});

// --- B. financeAttention normalization ---------------------------------------
test("B1: valid financeAttention values pass through", () => {
  assert.equal(normalizeFinanceAttention("none"), "none");
  assert.equal(normalizeFinanceAttention("无需关注"), "无需关注");
  assert.equal(normalizeFinanceAttention("一般关注"), "一般关注");
  assert.equal(normalizeFinanceAttention("需财务复核"), "需财务复核");
  assert.equal(normalizeFinanceAttention(" 一般关注 "), "一般关注");
});

test("B2: invalid financeAttention throws (no guessed aliases)", () => {
  for (const bad of ["general", "review", "important", "normal", "", null, undefined, 0]) {
    assert.throws(() => normalizeFinanceAttention(bad), StateValidationError);
  }
});

test("B3: FINANCE_ATTENTION_VALUES is the exact 4-value set", () => {
  assert.deepEqual(FINANCE_ATTENTION_VALUES, [
    "none",
    "无需关注",
    "一般关注",
    "需财务复核",
  ]);
});

// --- C. write.ts source contract ---------------------------------------------
const writeSrc = await readFile(
  new URL("../lib/server/recon/write.ts", import.meta.url),
  "utf8",
);

test("C1: PATCH handles manualResolutionStatus via the shared normalizer", () => {
  assert.match(writeSrc, /"manualResolutionStatus" in patch/);
  assert.match(writeSrc, /normalizeManualResolutionStatus/);
  assert.match(writeSrc, /pushSet\("manual_resolution_status", manualStatus\)/);
});

test("C2: PATCH handles financeAttention via the shared normalizer", () => {
  assert.match(writeSrc, /"financeAttention" in patch/);
  assert.match(writeSrc, /normalizeFinanceAttention/);
  assert.match(writeSrc, /pushSet\("financial_attention", financeAttention\)/);
});

test("C3: field isolation — manual/finance paths never touch other columns", () => {
  // The two new blocks must ONLY pushSet their own column (no solution /
  // solution_date / follow_status / event side-effects inside them).
  // Assert on real pushSet("...") code targets, not prose/comments.
  const manualBlock = writeSrc.slice(
    writeSrc.indexOf('// Phase 2K.9B-1: independent manual resolution state'),
    writeSrc.indexOf('// Phase 2K.9B-1: finance attention'),
  );
  const manualTargets = [...manualBlock.matchAll(/pushSet\("([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(manualTargets, ["manual_resolution_status"]);
  assert.doesNotMatch(manualBlock, /insertEvent/);
  const financeBlock = writeSrc.slice(
    writeSrc.indexOf('// Phase 2K.9B-1: finance attention'),
    writeSrc.indexOf('if (sets.length === 0)'),
  );
  const financeTargets = [...financeBlock.matchAll(/pushSet\("([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(financeTargets, ["financial_attention"]);
  assert.doesNotMatch(financeBlock, /insertEvent/);
});

test("C4: RETURNING + response expose manualResolutionStatus + financeAttention", () => {
  assert.match(writeSrc, /manual_resolution_status, financial_attention/);
  assert.match(writeSrc, /manualResolutionStatus: row\.manual_resolution_status \?\? null/);
  assert.match(writeSrc, /financeAttention: row\.financial_attention \?\? null/);
});

// --- D. recon.ts read contract ------------------------------------------------
const reconSrc = await readFile(
  new URL("../lib/server/recon/recon.ts", import.meta.url),
  "utf8",
);

test("D1: GET select + map expose manualResolutionStatus + financeAttention", () => {
  assert.match(reconSrc, /r\.manual_resolution_status/);
  assert.match(reconSrc, /r\.financial_attention/);
  assert.match(reconSrc, /manualResolutionStatus: row\.manual_resolution_status \?\? null/);
  assert.match(reconSrc, /financeAttention: row\.financial_attention \?\? null/);
});

test("D2: migration-008 column guard (SCHEMA_008_REQUIRED) is present", () => {
  assert.match(reconSrc, /assertManualResolutionColumn/);
  assert.match(reconSrc, /SCHEMA_008_REQUIRED/);
  assert.match(reconSrc, /manual_resolution_status/);
});

// --- E. migration 008 contract ------------------------------------------------
const migSrc = await readFile(
  new URL("../infra/postgres/migrations/008_manual_resolution_status.sql", import.meta.url),
  "utf8",
);

test("E1: migration adds the column + CHECK constraint", () => {
  assert.match(migSrc, /ADD COLUMN IF NOT EXISTS manual_resolution_status text/);
  assert.match(migSrc, /manual_resolution_status IS NULL/);
  assert.match(migSrc, /manual_resolution_status IN \('resolved', 'reopened'\)/);
});

test("E2: backfill is SAFE — only exact text 'true' counts, resolved wins", () => {
  assert.match(migSrc, /#>> '\{detail,resolved\}'\) = 'true'/);
  assert.match(migSrc, /#>> '\{detail,reopened\}'\) = 'true'/);
  // no untrusted ::boolean casts
  assert.doesNotMatch(migSrc, /source_payload[^\n]*::boolean/);
  // resolved branch appears before reopened branch (resolved wins)
  const resolvedIdx = migSrc.indexOf("'resolved'");
  const reopenedIdx = migSrc.indexOf("'reopened'");
  assert.ok(resolvedIdx < reopenedIdx, "resolved must be evaluated before reopened");
});

test("E3: migration is idempotent + records schema_migrations + never touches source_payload", () => {
  assert.match(migSrc, /ADD COLUMN IF NOT EXISTS/);
  assert.match(migSrc, /ON CONFLICT \(version\) DO NOTHING/);
  assert.match(migSrc, /008_manual_resolution_status/);
  assert.doesNotMatch(migSrc, /source_payload\s*=|DELETE FROM recon\.reconciliations/);
});
