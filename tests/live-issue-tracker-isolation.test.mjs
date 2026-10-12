import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("LiveIssueTracker is explicitly marked as a non-production legacy component", async () => {
  const source = await read("app/LiveIssueTracker.tsx");

  assert.match(source, /Historical local-storage tracker retained only for migration\/audit reference/);
  assert.match(source, /Do not mount this component in production business flows/);
  assert.match(source, /Use UnresolvedFollowupDashboard instead/);
});

test("production navigation and business entry points do not import or render LiveIssueTracker", async () => {
  const paths = [
    "app/page.tsx",
    "app/QuarterlyReconciliation.tsx",
    "app/UnresolvedFollowupDashboard.tsx",
    "app/ProblemDashboard.tsx",
    "app/ManagementCockpit.tsx",
  ];
  const sources = await Promise.all(paths.map(read));

  for (const source of sources) {
    assert.doesNotMatch(source, /(?:from\s+["']\.\/LiveIssueTracker["']|import\s*\(\s*["']\.\/LiveIssueTracker["']\s*\))/);
    assert.doesNotMatch(source, /<LiveIssueTracker\b/);
  }
});

test("UnresolvedFollowupDashboard keeps PostgreSQL provider and API writes without local business storage", async () => {
  const source = await read("app/UnresolvedFollowupDashboard.tsx");

  assert.match(source, /import\s+\{\s*useDashboardData\s*\}\s+from\s+["']\.\/dashboard-postgres-data["']/);
  assert.match(source, /const\s+\{\s*quarter,\s*reconciliationById,\s*followups,\s*refresh\s*\}\s*=\s*useDashboardData\(\)/);
  for (const write of ["createFollowup", "createFollowupEvent", "updateFollowup", "patch"]) {
    assert.match(source, new RegExp(`reconciliationApi\\.${write}\\(`));
  }
  assert.doesNotMatch(source, /localStorage/);
  assert.doesNotMatch(source, /quarter-storage/);
});
