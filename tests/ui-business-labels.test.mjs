import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatDifferenceCategoryLabel, formatFollowupStatusLabel } from "../lib/ui-business-labels.mjs";

test("followup status labels are Chinese presentation-only labels", () => {
  assert.equal(formatFollowupStatusLabel("pending"), "待解决");
  assert.equal(formatFollowupStatusLabel("closed"), "已解决");
  assert.equal(formatFollowupStatusLabel("reopened"), "已撤销");
  assert.equal(formatFollowupStatusLabel("legacy-value"), "legacy-value");
  assert.equal(formatFollowupStatusLabel(null), "未设置");
});

test("difference category labels cover every persisted canonical category", () => {
  assert.deepEqual(
    ["transit", "returned_invoice", "lost_invoice", "equipment", "other_with_invoice", "other_without_invoice"].map(formatDifferenceCategoryLabel),
    ["在途证明", "退票金额", "丢票金额", "仪器设备金额", "其他（有发票）", "其他（无发票及无法验证）"],
  );
  assert.equal(formatDifferenceCategoryLabel("unknown"), "unknown");
  assert.equal(formatDifferenceCategoryLabel(undefined), "未设置");
});

test("all known business-code render points consume the shared display helpers", async () => {
  const [cockpit, aging] = await Promise.all([
    readFile(new URL("../app/ManagementCockpit.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/DifferenceAgingAnalysis.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(cockpit, /formatFollowupStatusLabel\(r\.followStatus\)/);
  assert.match(cockpit, /formatFollowupStatusLabel\(row\.followStatus\)/);
  assert.match(cockpit, /formatDifferenceCategoryLabel\(invoice\.category\)/);
  assert.doesNotMatch(cockpit, /<td>\{invoice\.category\}<\/td>/);
  assert.match(aging, /String\(invoice\.note \?\? ""\)\.trim\(\) \|\| formatDifferenceCategoryLabel\(invoice\.category\)/);
});

test("status filters retain canonical code values while labels are Chinese", async () => {
  const cockpit = await readFile(new URL("../app/ManagementCockpit.tsx", import.meta.url), "utf8");
  assert.match(cockpit, /<option value="pending">\{formatFollowupStatusLabel\("pending"\)\}<\/option>/);
  assert.match(cockpit, /<option value="closed">\{formatFollowupStatusLabel\("closed"\)\}<\/option>/);
  assert.match(cockpit, /r\.followStatus === f\.follow/);
  const canonicalCode = "pending";
  assert.equal(formatFollowupStatusLabel(canonicalCode), "待解决");
  assert.equal(canonicalCode, "pending");
});

test("Chinese display formatting leaves export and persisted canonical codes untouched", async () => {
  const reconciliation = await readFile(new URL("../app/QuarterlyReconciliation.tsx", import.meta.url), "utf8");
  assert.match(reconciliation, /category\.label,/);
  const persistedCategory = "returned_invoice";
  assert.equal(formatDifferenceCategoryLabel(persistedCategory), "退票金额");
  assert.equal(persistedCategory, "returned_invoice");
});
