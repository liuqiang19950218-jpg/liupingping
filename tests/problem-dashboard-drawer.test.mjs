import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("all ProblemDashboard drill-downs open the secondary drawer before navigation", async () => {
  const page = await readFile(new URL("../app/ProblemDashboard.tsx", import.meta.url), "utf8");
  assert.match(page, /setDrawerFilterContext\(\{ quarter: quarter\?\.code/);
  assert.match(page, /ProblemFollowupDrawer filterContext=\{drawerFilterContext\}/);
  assert.match(page, /onEnterFollowup=\{\(\) => onOpenFollowup\(drawerFilterContext\)\}/);
  assert.doesNotMatch(page, /const drill = .*=> onOpenFollowup/);
});

test("drawer uses canonical followup filtering and difference descriptions", async () => {
  const drawer = await readFile(new URL("../app/ProblemFollowupDrawer.tsx", import.meta.url), "utf8");
  assert.match(drawer, /filterFollowupTrackerItems/);
  assert.match(drawer, /differenceReasonsByReconciliation/);
  assert.doesNotMatch(drawer, /item\.solution/);
  const tracker = await readFile(new URL("../app/UnresolvedFollowupDashboard.tsx", import.meta.url), "utf8");
  assert.match(tracker, /filterFollowupTrackerItemsByState\(items, \{ tab, region, search/);
});
