import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("all ProblemDashboard drill-downs use the current region in the secondary drawer", async () => {
  const page = await readFile(new URL("../app/ProblemDashboard.tsx", import.meta.url), "utf8");
  assert.match(page, /const activeDrawerFilterContext = drawerFilterContext &&/);
  assert.match(page, /filters\.region === "全部" \? \{\} : \{ region: filters\.region \}/);
  assert.match(page, /const drill = \(filter: Record<string, string> = \{\}\) => setDrawerFilterContext\(filter\)/);
  assert.match(page, /ProblemFollowupDrawer key=\{JSON\.stringify\(activeDrawerFilterContext\)\} filterContext=\{activeDrawerFilterContext\}/);
  assert.match(page, /onEnterFollowup=\{\(\) => onOpenFollowup\(activeDrawerFilterContext\)\}/);
  assert.doesNotMatch(page, /const drill = .*=> onOpenFollowup/);
});

test("drawer uses canonical followup filtering and difference descriptions", async () => {
  const drawer = await readFile(new URL("../app/ProblemFollowupDrawer.tsx", import.meta.url), "utf8");
  assert.match(drawer, /filterFollowupTrackerItems/);
  assert.match(drawer, /differenceReasonsByReconciliation/);
  assert.match(drawer, /followupStage/);
  assert.match(drawer, /解决方案/);
  assert.match(drawer, /解决时间/);
  assert.doesNotMatch(drawer, /item\.solution/);
  const tracker = await readFile(new URL("../app/UnresolvedFollowupDashboard.tsx", import.meta.url), "utf8");
  assert.match(tracker, /filterFollowupTrackerItemsByState\(items, \{ tab, region, owner, search/);
});
