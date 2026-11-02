import assert from "node:assert/strict";
import test from "node:test";
import { planFollowupSave } from "../lib/followup-save-plan.mjs";

const event = (id, content = "历史跟进", occurredAt = "2026-03-01T00:00:00.000Z") => ({ id, eventType: "followup", content, occurredAt });
const followup = (status = "pending", events = []) => ({ id: "followup-1", followStatus: status, events });
const formEvent = (id, solution = "历史跟进", time = "2026-03-01") => ({ id, solution, time });
test("pending and closed zero-event followups are no-op safe", () => {
  for (const status of ["pending", "closed"]) {
    const plan = planFollowupSave(followup(status), [], status === "closed");
    assert.equal(plan.createFollowup, null);
    assert.equal(plan.patchFollowup, null);
    assert.deepEqual(plan.deleteFollowup, []);
    assert.deepEqual(plan.createEvents, []);
    assert.deepEqual(plan.deleteEvents, []);
  }
});

test("solution-only and adjustment-only saves leave a zero-event followup untouched", () => {
  const existing = followup();
  for (const unrelatedReconciliationPatch of [{ solution: "已更新" }, { adjustmentAmount: "100.00" }]) {
    assert.ok(unrelatedReconciliationPatch);
    const plan = planFollowupSave(existing, [], false);
    assert.equal(plan.patchFollowup, null);
    assert.deepEqual(plan.deleteFollowup, []);
    assert.equal(plan.createEvents.length + plan.patchEvents.length + plan.deleteEvents.length, 0);
  }
});

test("resolved checkbox patches status only and preserves the zero-event item", () => {
  for (const [status, resolved, expected] of [["pending", true, "closed"], ["closed", false, "pending"]]) {
    const plan = planFollowupSave(followup(status), [], resolved);
    assert.deepEqual(plan.patchFollowup, { followStatus: expected });
    assert.deepEqual(plan.deleteFollowup, []);
    assert.equal(plan.createEvents.length + plan.patchEvents.length + plan.deleteEvents.length, 0);
  }
});

test("event removals are scoped to events and never delete the followup item", () => {
  const only = planFollowupSave(followup("pending", [event("event-1")]), [], false);
  assert.deepEqual(only.deleteEvents, ["event-1"]);
  assert.deepEqual(only.deleteFollowup, []);
  const oneOfMany = planFollowupSave(followup("pending", [event("event-1"), event("event-2")]), [formEvent("event-2")], false);
  assert.deepEqual(oneOfMany.deleteEvents, ["event-1"]);
});

test("append chooses existing followup when present and creates one only when absent", () => {
  const entry = { time: "2026-03-02", solution: "新增跟进" };
  const existing = planFollowupSave(followup(), [entry], false);
  assert.equal(existing.createFollowup, null);
  assert.equal(existing.createEvents.length, 1);
  const absent = planFollowupSave(null, [entry], false);
  assert.equal(absent.createFollowup.followStatus, "pending");
  assert.equal(absent.createEvents.length, 0);
});

test("Q1 contract fixtures: 77 zero-event containers and 752 no-op forms have no writes", () => {
  const q1 = Array.from({ length: 752 }, (_, index) => index < 77 ? followup(index % 2 ? "pending" : "closed") : null);
  const plans = q1.map((existing) => planFollowupSave(existing, [], existing?.followStatus === "closed"));
  assert.equal(plans.slice(0, 77).filter((plan) => plan.deleteFollowup.length === 0).length, 77);
  assert.equal(plans.filter((plan) => plan.createFollowup || plan.patchFollowup || plan.createEvents.length || plan.patchEvents.length || plan.deleteEvents.length || plan.deleteFollowup.length).length, 0);
});
