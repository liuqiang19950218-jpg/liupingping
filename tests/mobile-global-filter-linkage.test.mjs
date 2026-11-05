import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("the follow-up dashboard uses one exact owner state for mobile, desktop, KPIs, and details", async () => {
  const source = await read("app/UnresolvedFollowupDashboard.tsx");

  assert.match(source, /const \[owner, setOwner\] = useState\("全部"\)/);
  assert.match(source, /\(state\.owner === "全部" \|\| item\.owner === state\.owner\)/);
  assert.match(source, /\(\) => \(\{ region, owner, search, risk, finance, processStage, dashboardMetricFilter, tableFilters \}\)/);
  assert.match(source, /filterFollowupTrackerItemsByState\(items, \{ tab, region, owner, search/);
  assert.match(source, /className="uf-mobile-owner"[\s\S]*?value=\{owner\}[\s\S]*?setOwner\(event\.target\.value\)/);
  assert.match(source, /aria-label="按负责人筛选"[\s\S]*?value=\{owner\}/);
  assert.match(source, /setOwner\(filter\.owner \|\| filter\.baseOwner \|\| "全部"\)/);
  assert.match(source, /setOwner\("全部"\)/);
});

test("cockpit unresolved balance and its drill-down share filtered pending rows", async () => {
  const source = await read("app/ManagementCockpit.tsx");

  assert.match(source, /const pendingFollowUpRows = useMemo/);
  assert.match(source, /row\.quarter === f\.quarter[\s\S]*?f\.region === "全部" \|\| row\.region === f\.region[\s\S]*?f\.owner === "全部" \|\| row\.owner === f\.owner/);
  assert.match(source, /unresolved: pendingFollowUpRows\.reduce/);
  assert.match(source, /name: "未解决差额"[\s\S]*?list: pendingFollowUpRows/);
  assert.match(source, /setModal\(null\);[\s\S]*?setAgingBucket\(null\);/);
});

test("problem-dashboard PC and mobile presentation derive from the same filtered issue collection", async () => {
  const source = await read("app/ProblemDashboard.tsx");

  assert.match(source, /filterProblemItemList\(currentOpenProblems, currentFilters\)/);
  assert.match(source, /selectedProblemIds\.has\(item\.id\)/);
  assert.match(source, /buildProblemDashboard\(items, closedCount\)/);
  assert.match(source, /key=\{JSON\.stringify\(activeDrawerFilterContext\)\}/);
});
