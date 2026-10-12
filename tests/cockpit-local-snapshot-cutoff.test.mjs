import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("production cockpit loads business data through DashboardDataProvider APIs", async () => {
  const [page, cockpit, provider] = await Promise.all([
    read("app/page.tsx"),
    read("app/ManagementCockpit.tsx"),
    read("app/dashboard-postgres-data.tsx"),
  ]);

  assert.match(page, /<DashboardDataProvider>/);
  assert.match(cockpit, /const dashboard = useDashboardData\(\)/);
  assert.doesNotMatch(cockpit, /local-quarterly-reconciliation(?:-dashboard|-archive)?/);
  assert.doesNotMatch(cockpit, /cockpitRows|latestQuarterlyCockpitRows/);
  for (const method of ["listQuarters", "listQuarterDifferenceItems", "listQuarterFollowups", "getMaterialStatus", "getSpdDashboard"]) {
    assert.match(provider, new RegExp(`reconciliationApi\\.${method}`));
  }
});

test("problem dashboard and its presentation helpers have no legacy snapshot source", async () => {
  const [dashboard, data, insights] = await Promise.all([
    read("app/ProblemDashboard.tsx"),
    read("app/problem-dashboard-data.ts"),
    read("app/reconciliation-insights.ts"),
  ]);

  assert.match(dashboard, /useDashboardData\(\)/);
  assert.doesNotMatch(data, /reconciliation-insights|cockpit-data|localStorage|quarter-storage/);
  assert.doesNotMatch(insights, /cockpit-data|localStorage|quarter-storage/);
  assert.match(insights, /allIssuesForQuarter\(\s*source:/);
  assert.match(insights, /issuesForQuarter\(\s*source:/);
});

test("cockpit compatibility exports cannot read or write browser business snapshots", async () => {
  const source = await read("app/cockpit-data.ts");

  assert.match(source, /export const latestQuarterlyCockpitRows = \(\): CockpitRow\[\] =>\s*\[\]/);
  assert.match(source, /export const cockpitRows: CockpitRow\[\] = \[\]/);
  assert.doesNotMatch(source, /export const cockpitRows = new Proxy/);
  const update = source.slice(source.indexOf("export const updateDashboardSnapshot"), source.indexOf("export const cockpitRows"));
  assert.doesNotMatch(update, /localStorage|ensureArchiveFromActive/);
});
