import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { crossQuarterAccountSetMatchMode, normalizeAccountSetForCrossQuarterMatch, previousQuarterCode } from "../lib/previous-quarter-transfer-rules.mjs";

test("previous quarter follows natural calendar boundaries", () => {
  assert.equal(previousQuarterCode("2026-Q2"), "2026-Q1");
  assert.equal(previousQuarterCode("2026-Q1"), "2025-Q4");
  assert.throws(() => previousQuarterCode("2026-Q5"));
});

test("configured account-set equivalence groups are symmetric and exact wins", () => {
  const groups = [["江苏英科", "英科"], ["江苏生一", "生一"], ["国药控股", "国控"], ["万和", "苏州万和"], ["明生医疗", "明生"]];
  for (const [left, right] of groups) for (const current of [left, right]) for (const source of [left, right]) {
    assert.ok(crossQuarterAccountSetMatchMode(current, source));
  }
  assert.equal(crossQuarterAccountSetMatchMode("英科", "英科"), "EXACT_ACCOUNT_SET");
  assert.equal(crossQuarterAccountSetMatchMode("英科", "江苏英科"), "EQUIVALENT_ACCOUNT_SET");
  assert.equal(normalizeAccountSetForCrossQuarterMatch("未知简称"), "未知简称");
  assert.equal(crossQuarterAccountSetMatchMode("未知简称", "英科"), null);
});

test("transfer implementation keeps provenance, exact matching, atomic audit, and narrow locks", () => {
  const source = readFileSync("lib/server/recon/previous-quarter-transfer.ts", "utf8");
  const drawer = readFileSync("app/PreviousQuarterDifferenceTransferDrawer.tsx", "utf8");
  assert.match(source, /q\.code = \$1 AND c\.name = \$2/);
  assert.match(source, /crossQuarterAccountSetMatchMode/);
  assert.match(source, /current_account_set/);
  assert.match(source, /account_match_mode/);
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
  assert.match(drawer, /匹配方式/);
});
