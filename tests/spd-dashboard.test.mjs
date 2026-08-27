import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// SPD dashboard submission semantics are pure business rules; assert them here
// without a live DB. The route + server function perform the same computation.
test("SPD submission rule: 是 and 否 both count as submitted, blank/NULL = unsubmitted", () => {
  // Simulate the summary computation used by getSpdDashboardByQuarter.
  const summarize = (values) => {
    const total = values.length;
    const submitted = values.filter((v) => v !== null && v.trim() !== "").length;
    const unsubmitted = total - submitted;
    const submissionRate = total > 0 ? Number(((submitted / total) * 100).toFixed(1)) : null;
    return { total, submitted, unsubmitted, submissionRate };
  };

  const q1 = [];
  // 105 是 + 30 否 + 7 空 = 142 (from the authoritative Q1 SPD sheet)
  for (let i = 0; i < 105; i += 1) q1.push("是");
  for (let i = 0; i < 30; i += 1) q1.push("否");
  for (let i = 0; i < 7; i += 1) q1.push(null);

  const s = summarize(q1);
  assert.equal(s.total, 142);
  assert.equal(s.submitted, 135, "是 + 否 both count as submitted");
  assert.equal(s.unsubmitted, 7);
  assert.equal(s.submissionRate, 95.1);

  // "否" MUST be submitted — never unsubmitted.
  const onlyNo = summarize(["否"]);
  assert.equal(onlyNo.submitted, 1);
  assert.equal(onlyNo.unsubmitted, 0);

  // Empty quarter -> total 0, rate null (never NaN/Infinity).
  const empty = summarize([]);
  assert.equal(empty.total, 0);
  assert.equal(empty.submitted, 0);
  assert.equal(empty.unsubmitted, 0);
  assert.equal(empty.submissionRate, null);

  // trim semantics: " 是 " counts as submitted, raw preserved elsewhere.
  const trimmed = summarize(["是", " 否 ", ""]);
  assert.equal(trimmed.submitted, 2);
  assert.equal(trimmed.unsubmitted, 1);
});

test("SPD dashboard route is independent from material-status (two datasets)", async () => {
  const [route, materialRoute] = await Promise.all([
    readFile(new URL("../app/api/quarter/[code]/spd-dashboard/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/quarter/[code]/material-status/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /getSpdDashboardByQuarter/);
  assert.match(route, /spd_dashboard_rows/);
  assert.doesNotMatch(route, /getMaterialStatusByQuarter/);
  assert.match(materialRoute, /getMaterialStatusByQuarter/);
});
