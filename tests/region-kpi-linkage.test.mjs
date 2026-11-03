import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("dashboard KPI sources derive from their complete active filter collection", async () => {
  const [cockpit, followup, problem] = await Promise.all([
    read("app/ManagementCockpit.tsx"),
    read("app/UnresolvedFollowupDashboard.tsx"),
    read("app/ProblemDashboard.tsx"),
  ]);

  assert.match(cockpit, /const reconciliationTotalRows = rows;/);
  assert.match(cockpit, /row\.quarter === f\.quarter[\s\S]*?row\.filled[\s\S]*?f\.region === "全部" \|\| row\.region === f\.region/);
  assert.match(cockpit, /f\.accountSet === "全部" \|\| row\.accountSet === f\.accountSet/);
  assert.match(cockpit, /f\.owner === "全部" \|\| row\.owner === f\.owner/);
  assert.match(cockpit, /!f\.customer \|\| row\.customer\.includes\(f\.customer\)/);
  assert.match(cockpit, /row\.quarter === f\.quarter[\s\S]*?row\.filled[\s\S]*?matchesSettlementFilter\(row, f\.cleared\)/);

  assert.match(followup, /const filteredPending = useMemo/);
  assert.match(followup, /filterFollowupTrackerItemsByState\(items, \{ \.\.\.activeFilterState, tab: "pending" \}\)/);
  for (const source of ["filteredPending.length", "overdue.length", "filteredFinanceItems.length", "filteredWeekNew"]) {
    assert.match(followup, new RegExp(source.replaceAll(".", "\\.")));
  }

  assert.match(problem, /const filteredOpenTrackerProblems = useMemo/);
  assert.match(problem, /selectedProblemIds\.has\(item\.id\)/);
  assert.doesNotMatch(problem, /countProblemDashboardStage\(currentOpenTrackerProblems/);
  assert.match(problem, /countProblemDashboardStage\(filteredOpenTrackerProblems, "leader_review"\)/);
});
