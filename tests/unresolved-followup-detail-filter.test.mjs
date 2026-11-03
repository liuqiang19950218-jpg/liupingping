import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveSelectedFollowupDetail } from "../lib/followup-detail-selection.mjs";

const nanchang = { reconciliationId: "nj-1", region: "南京", owner: "叶孝彤", customer: "南京市浦口区中医院", followUps: [{ solution: "旧记录" }] };
const nantong = { reconciliationId: "nt-1", region: "南通", owner: "其他负责人", customer: "南通客户", followUps: [] };

test("detail closes when an open Nanjing customer is excluded by a Nantong filter", () => {
  assert.equal(resolveSelectedFollowupDetail([nanchang], nanchang.reconciliationId), nanchang);
  assert.equal(resolveSelectedFollowupDetail([nantong], nanchang.reconciliationId), null);
});

test("detail closes when owner or customer search excludes the selected customer", () => {
  assert.equal(resolveSelectedFollowupDetail([nantong], nanchang.reconciliationId), null);
  assert.equal(resolveSelectedFollowupDetail([], nanchang.reconciliationId), null);
});

test("detail resolves the latest record when it remains inside the active filter result", () => {
  const refreshed = { ...nanchang, followUps: [{ solution: "最新跟进" }] };
  assert.equal(resolveSelectedFollowupDetail([refreshed], nanchang.reconciliationId), refreshed);
  assert.equal(resolveSelectedFollowupDetail([refreshed], nanchang.reconciliationId).followUps[0].solution, "最新跟进");
});

test("sequential region changes never recover a removed detail snapshot", () => {
  for (const activeItems of [[nantong], [], [nantong, nanchang]]) {
    const detail = resolveSelectedFollowupDetail(activeItems, nanchang.reconciliationId);
    assert.equal(detail?.region ?? null, activeItems.includes(nanchang) ? "南京" : null);
  }
});

test("dashboard detail state is id-based and always resolved from the current visible result", async () => {
  const source = await readFile(new URL("../app/UnresolvedFollowupDashboard.tsx", import.meta.url), "utf8");
  assert.match(source, /\[detailReconciliationId, setDetailReconciliationId\] = useState<string \| null>\(null\)/);
  assert.match(source, /resolveSelectedFollowupDetail\(visible, detailReconciliationId\)/);
  assert.match(source, /if \(detailReconciliationId && !detail\) setDetailReconciliationId\(null\)/);
  assert.match(source, /const openDetail = \(item: Item\) => setDetailReconciliationId\(item\.reconciliationId\)/);
  assert.doesNotMatch(source, /const \[detail, setDetail\] = useState<Item \| null>/);
});

test("keyboard-triggered filter state follows the same id resolution path", async () => {
  const source = await readFile(new URL("../app/UnresolvedFollowupDashboard.tsx", import.meta.url), "utf8");
  assert.match(source, /onChange=\{\(event\) => setRegion\(event\.target\.value\)\}/);
  assert.match(source, /const detail = useMemo\([\s\S]*?visible, detailReconciliationId/);
});
