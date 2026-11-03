import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("ProblemDashboard preserves the full filter intersection for every drawer route", async () => {
  const [dashboard, drawer, tracker] = await Promise.all([
    read("app/ProblemDashboard.tsx"),
    read("app/ProblemFollowupDrawer.tsx"),
    read("app/UnresolvedFollowupDashboard.tsx"),
  ]);

  for (const key of ["baseOwner", "problemRisk", "problemCause", "baseStage", "problemAging", "problemFollow"]) {
    assert.match(dashboard, new RegExp(key));
    assert.match(tracker, new RegExp(key));
  }
  assert.match(dashboard, /\.\.\.selectedFilterContext,[\s\S]*?\.\.\.drawerFilterContext/);
  assert.match(tracker, /filterProblemItemList\(\[\{/);
  assert.match(drawer, /filterContext\.stage === "已关闭" \|\| filterContext\.baseStage === "已关闭"/);
  assert.match(dashboard, /key=\{JSON\.stringify\(activeDrawerFilterContext\)\}/);
});

test("all dashboard detail state is invalidated or rebuilt from filtered rows", async () => {
  const [cockpit, followup] = await Promise.all([
    read("app/ManagementCockpit.tsx"),
    read("app/UnresolvedFollowupDashboard.tsx"),
  ]);

  assert.match(cockpit, /const reconciliationTotalRows = rows;/);
  assert.match(cockpit, /setModal\(null\);[\s\S]*?setAgingBucket\(null\);[\s\S]*?if \(key === "quarter"\)/);
  assert.match(cockpit, /row\.quarter === f\.quarter[\s\S]*?row\.filled[\s\S]*?\(f\.follow === "全部" \|\| row\.followStatus === f\.follow\)/);
  assert.match(followup, /const regionStats = useMemo[\s\S]*?const list =[\s\S]*?\? overdue/);
  assert.match(followup, /const selectedOverdue = \[\.\.\.overdue\]/);
  assert.match(followup, /待解决清单（\{pendingCount\}）/);
  assert.match(followup, /已解决档案（\{resolvedCount\}）/);
});
