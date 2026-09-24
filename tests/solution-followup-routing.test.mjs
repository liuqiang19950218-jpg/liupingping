import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { auditSolutionRouting, solutionFollowupBucket } from "../lib/solution-followup-routing.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("solution routing follows the approved, non-intuitive rule", () => {
  assert.equal(solutionFollowupBucket("找商务撤销之前的641.25的负票", "2026-06-10"), "pending");
  assert.equal(solutionFollowupBucket("待商务确认", ""), "resolved");
  assert.equal(solutionFollowupBucket("", "2026-06-10"), null);
});

test("routing is mutually exclusive per reconciliation id", () => {
  const audit = auditSolutionRouting([
    { id: "changzhou", solution: "找商务撤销之前的641.25的负票", solutionDate: "2026-06-10" },
    { id: "no-date", solution: "待商务确认", solutionDate: null },
    { id: "blank", solution: null, solutionDate: "2026-06-10" },
  ]);
  assert.deepEqual(audit.pending.map((item) => item.id), ["changzhou"]);
  assert.deepEqual(audit.resolved.map((item) => item.id), ["no-date"]);
  assert.deepEqual(audit.blank.map((item) => item.id), ["blank"]);
  assert.equal(new Set([...audit.pending, ...audit.resolved].map((item) => item.id)).size, 2);
});

test("Q1 no-op contract has 752 forms and no followup writes", () => {
  const q1 = Array.from({ length: 752 }, (_, index) => ({ id: `recon-${index}`, solution: "", solutionDate: null }));
  const audit = auditSolutionRouting(q1);
  assert.equal(audit.blank.length, 752);
  assert.equal(audit.pending.length + audit.resolved.length, 0);
});

test("detail form has solution fields only and writes no followup", async () => {
  const page = await read("app/QuarterlyReconciliation.tsx");
  assert.match(page, /resolutionTime[\s\S]{0,450}type="date"/);
  assert.match(page, /VoiceTextField[\s\S]{0,800}resolutionSolution/);
  assert.doesNotMatch(page, /aria-label="跟进记录"/);
  assert.doesNotMatch(page, /followup-resolved-toggle/);
  assert.doesNotMatch(page, /新增跟进/);
  assert.doesNotMatch(page, /createFollowup\(activeQuarter, reconciliationId/);
  assert.doesNotMatch(page, /updateFollowup\(activeQuarter, reconciliationId/);
  assert.doesNotMatch(page, /deleteFollowup\(activeQuarter, reconciliationId/);
});

test("legacy tracker uses persisted manual status and keeps later events separate", async () => {
  const [page, qualification] = await Promise.all([
    read("app/UnresolvedFollowupDashboard.tsx"),
    read("lib/closed-reconciliation-qualification.mjs"),
  ]);
  assert.match(page, /isLegacyTrackerItem\(row\)/);
  assert.match(page, /isClosedReconciliation\(row\)/);
  assert.match(qualification, /legacyTrackerTab\(row\?\.manualResolutionStatus\)/);
  assert.doesNotMatch(page, /solutionFollowupBucket\(/);
  assert.match(page, /followUps: followup\?\.events/);
  assert.match(page, /else await reconciliationApi\.createFollowup/);
});
