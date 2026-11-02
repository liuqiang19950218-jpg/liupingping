import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("regional KPI sources use the existing selected-region state", async () => {
  const [cockpit, followup, problem] = await Promise.all([
    read("app/ManagementCockpit.tsx"),
    read("app/UnresolvedFollowupDashboard.tsx"),
    read("app/ProblemDashboard.tsx"),
  ]);

  assert.match(cockpit, /row\.quarter === f\.quarter[\s\S]*?row\.filled[\s\S]*?f\.region === "全部" \|\| row\.region === f\.region/);
  assert.match(cockpit, /\[f\.quarter, f\.region, dashboardRows\]/);

  assert.match(followup, /const regionalPending = useMemo/);
  assert.match(followup, /region === ALL \? pending : pending\.filter\(\(item\) => item\.region === region\)/);
  for (const source of ["regionalPending.length", "regionalOverdue.length", "regionalFinanceItems.length", "regionalWeekNew"]) {
    assert.match(followup, new RegExp(source.replaceAll(".", "\\.")));
  }

  assert.match(problem, /const regionalOpenTrackerProblems = useMemo/);
  assert.match(problem, /item\.region === filters\.region/);
  assert.doesNotMatch(problem, /countProblemDashboardStage\(currentOpenTrackerProblems/);
  assert.match(problem, /countProblemDashboardStage\(regionalOpenTrackerProblems, "leader_review"\)/);
});
