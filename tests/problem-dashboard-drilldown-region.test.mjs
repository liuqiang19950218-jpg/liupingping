import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("problem dashboard uses one selected region through analysis and every drawer entry", async () => {
  const [dashboard, drawer, tracker] = await Promise.all([
    readFile(new URL("../app/ProblemDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ProblemFollowupDrawer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/UnresolvedFollowupDashboard.tsx", import.meta.url), "utf8"),
  ]);

  // The analysis data is region-filtered before stages, ratios, owners, and
  // preview rows are derived, so their numerator and denominator match.
  assert.match(dashboard, /filterProblemItemList\(currentOpenProblems, currentFilters\)/);
  assert.match(dashboard, /const dashboard = useMemo\(\(\) => buildProblemDashboard\(items, closedCount\)/);
  assert.match(dashboard, /ProblemStageDistribution data=\{dashboard\.stages\}/);
  assert.match(dashboard, /dashboard\.owners\.map/);
  assert.match(dashboard, /dashboard\.preview\.map/);

  // Central context injection covers KPI, stage, owner, preview, and
  // \"查看更多\" entries and changes the drawer key on region changes.
  assert.match(dashboard, /const activeDrawerFilterContext = drawerFilterContext &&/);
  assert.match(dashboard, /\{ region: filters\.region \}/);
  assert.match(dashboard, /key=\{JSON\.stringify\(activeDrawerFilterContext\)\}/);
  assert.match(dashboard, /onOpenFollowup\(activeDrawerFilterContext\)/);

  // The shared drawer predicate applies the received region instead of
  // rebuilding a global customer list.
  assert.match(drawer, /filterFollowupTrackerItems\(source, filterContext\)/);
  assert.match(tracker, /region: filters\.region \?\? ALL/);
  assert.match(tracker, /state\.region === ALL \|\| item\.region === state\.region/);
});
