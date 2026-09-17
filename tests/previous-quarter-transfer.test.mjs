import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { previousQuarterCode } from "../lib/previous-quarter-transfer-rules.mjs";

test("previous quarter follows natural calendar boundaries", () => {
  assert.equal(previousQuarterCode("2026-Q2"), "2026-Q1");
  assert.equal(previousQuarterCode("2026-Q1"), "2025-Q4");
  assert.throws(() => previousQuarterCode("2026-Q5"));
});

test("transfer implementation keeps provenance, exact matching, atomic audit, and narrow locks", () => {
  const source = readFileSync("lib/server/recon/previous-quarter-transfer.ts", "utf8");
  const drawer = readFileSync("app/PreviousQuarterDifferenceTransferDrawer.tsx", "utf8");
  assert.match(source, /q\.code = \$1 AND a\.name = \$2 AND c\.name = \$3/);
  assert.match(source, /source_difference_item_id/);
  assert.match(source, /TRANSFER_PREVIOUS_QUARTER_DIFFERENCE_ITEMS/);
  assert.match(source, /BEGIN|withPostgresTransaction/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /FOR KEY SHARE/);
  assert.match(source, /ISOLATION LEVEL SERIALIZABLE/);
  assert.doesNotMatch(source, /LOCK TABLE|pg_advisory_lock/);
  assert.doesNotMatch(source, /followup_items|followup_events|material_status/);
  assert.match(drawer, /转入上季度差额明细/);
  assert.match(drawer, /确认转入/);
  assert.match(drawer, /本季度已存在/);
});
