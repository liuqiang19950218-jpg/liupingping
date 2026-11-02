import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { auditLegacyTrackerRouting, legacyTrackerTab } from "../lib/followup-tracker-routing.mjs";

test("manual resolved, reopened, and null route only inside the dated tracker scope", () => {
  const rows = [
    ...Array.from({ length: 30 }, (_, index) => ({ id: `pending-${index}`, solutionDate: "2026-06-01", manualResolutionStatus: null })),
    ...Array.from({ length: 2 }, (_, index) => ({ id: `reopened-${index}`, solutionDate: "2026-06-01", manualResolutionStatus: "reopened" })),
    ...Array.from({ length: 22 }, (_, index) => ({ id: `resolved-${index}`, solutionDate: "2026-06-01", manualResolutionStatus: "resolved" })),
    ...Array.from({ length: 55 }, (_, index) => ({ id: `old-no-date-${index}`, solution: "历史方案", solutionDate: null, manualResolutionStatus: null })),
  ];
  const audit = auditLegacyTrackerRouting(rows);
  assert.equal(audit.pending.length, 32);
  assert.equal(audit.resolved.length, 22);
  assert.equal(audit.excluded.length, 55);
  assert.equal(legacyTrackerTab("reopened"), "pending");
  assert.equal(legacyTrackerTab(null), "pending");
});

test("UI patches only the intended field and never uses derived stage as editor value", async () => {
  const page = await readFile(new URL("../app/UnresolvedFollowupDashboard.tsx", import.meta.url), "utf8");
  assert.match(page, /manualResolutionStatus: "resolved"/);
  assert.match(page, /manualResolutionStatus: "reopened"/);
  assert.match(page, /financeAttention \}/);
  assert.match(page, /updateFollowup\(quarter\.code, item\.reconciliationId, \{ processStage: nextStage \}\)/);
  assert.match(page, /value=\{item\.processStage \?\? ""\}/);
  assert.doesNotMatch(page, /value=\{stageOf\(item\)\}/);
  assert.match(page, /if \(!item\.followupId\)/);
});

test("finance attention retains none as a distinct persisted value and uses a Chinese label", async () => {
  const page = await readFile(new URL("../app/UnresolvedFollowupDashboard.tsx", import.meta.url), "utf8");
  assert.match(page, /type Finance = "none"/);
  assert.match(page, /<option value="none">未设置<\/option>/);
  assert.match(page, /value === "none" \? "未设置" : value/);
});
