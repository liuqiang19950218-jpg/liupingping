import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/QuarterlyReconciliation.tsx", import.meta.url), "utf8");
const api = await readFile(new URL("../lib/api/reconciliation-api.ts", import.meta.url), "utf8");
const read = await readFile(new URL("../lib/server/recon/recon.ts", import.meta.url), "utf8");
const write = await readFile(new URL("../lib/server/recon/write.ts", import.meta.url), "utf8");

for (const [name, form, apiField, column] of [
  ["呆账金额", "badDebt", "badDebtAmount", "bad_debt_amount"],
  ["调账金额", "adjustment", "adjustmentAmount", "adjustment_amount"],
  ["呆账原因", "badDebtReason", "badDebtReason", "bad_debt_reason"],
  ["调账原因", "adjustmentReason", "adjustmentReason", "adjustment_reason"],
  ["解决时间", "resolutionTime", "solutionDate", "solution_date"],
  ["解决方案", "resolutionSolution", "solution", "solution"],
]) {
  test(`${name} is returned by API, hydrated into form, and mapped for save`, () => {
    assert.match(api, new RegExp(apiField));
    assert.match(read, new RegExp(column));
    assert.match(write, new RegExp(column));
    assert.match(page, new RegExp(form));
  });
}
test("the restored section has six always-rendered two-column fields", () => {
  assert.match(page, /writeoff-adjustment-section/);
  for (const label of ["呆账金额", "调账金额", "呆账原因", "调账原因", "解决时间", "解决方案"]) assert.match(page, new RegExp(label));
});
test("solution time remains a date input and solution uses the shared voice field", () => {
  assert.match(page, /resolutionTime[\s\S]{0,500}type="date"/);
  assert.match(page, /VoiceTextField[\s\S]{0,800}resolutionSolution/);
  assert.match(page, /VoiceInputButton/);
});
test("detail form excludes followup controls", () => {
  assert.doesNotMatch(page, /aria-label="跟进记录"/);
  assert.doesNotMatch(page, /followup-resolved-toggle/);
  assert.doesNotMatch(page, /新增跟进/);
});
test("no-op save skips the reconciliation patch and never mutates followups", () => {
  assert.match(page, /if \(Object\.keys\(reconciliationPatch\)\.length\) await reconciliationApi\.patch/);
  assert.doesNotMatch(page, /planFollowupSave/);
  assert.doesNotMatch(page, /createFollowup\(activeQuarter, reconciliationId/);
  assert.doesNotMatch(page, /updateFollowup\(activeQuarter, reconciliationId/);
  assert.doesNotMatch(page, /deleteFollowup\(activeQuarter, reconciliationId\)/);
});
test("six-category adapter and shared dashboard settlement helper remain in the source tree", async () => {
  const [adapter, settlement] = await Promise.all([
    readFile(new URL("../lib/difference-category-adapter.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/reconciliation-settlement-status.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(adapter, /other_without_invoice/);
  assert.match(settlement, /已对清/);
});
