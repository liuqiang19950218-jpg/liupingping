import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { businessDayDistance, normalizeDateOnly } from "../lib/date-only.mjs";

for (const value of [
  "2026-07-01",
  "2026-07-01 00:00:00+00",
  "2026-07-01 00:00:00+00:00",
  "2026-07-01T00:00:00Z",
  "2026-07-01T00:00:00.000Z",
]) test(`${value} normalizes without timezone conversion`, () => assert.equal(normalizeDateOnly(value), "2026-07-01"));

test("null and invalid input normalize safely to empty", () => {
  assert.equal(normalizeDateOnly(null), "");
  assert.equal(normalizeDateOnly(undefined), "");
  assert.equal(normalizeDateOnly("not-a-date"), "");
  assert.equal(normalizeDateOnly("2026-02-30"), "");
});

test("timestamps and date-only values have identical overdue days", () => {
  const today = "2026-09-01";
  assert.equal(businessDayDistance("2026-06-29", today), 64);
  assert.equal(businessDayDistance("2026-06-29 00:00:00+00", today), 64);
  assert.equal(businessDayDistance("2026-07-01T00:00:00Z", today), 62);
});

test("dashboard uses the one date-only normalizer for display and overdue days", async () => {
  const page = await readFile(new URL("../app/UnresolvedFollowupDashboard.tsx", import.meta.url), "utf8");
  assert.match(page, /normalizeDateOnly\(\[\.\.\.item\.followUps\]/);
  assert.match(page, /const dayDistance = \(value: string\) => businessDayDistance\(value\)/);
  assert.doesNotMatch(page, /new Date\(`\$\{value\}T00:00:00`\)/);
});
