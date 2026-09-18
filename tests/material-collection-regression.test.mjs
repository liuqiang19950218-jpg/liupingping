import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("material drilldown renders Chinese labels instead of literal Unicode escape text", () => {
  const source = readFileSync("app/Q1SpecialPanels.tsx", "utf8");
  const dialog = source.slice(source.indexOf("function CollectionDrilldownDialog"), source.indexOf("function FollowAdviceCard"));

  assert.match(dialog, /资料收集与未对账客户/);
  assert.match(dialog, /<th>客户名称<\/th>/);
  assert.match(dialog, /当前条件下暂无明细数据/);
  assert.doesNotMatch(dialog, />\\u[0-9a-f]{4}/i);
  assert.doesNotMatch(dialog, /aria-label="\\u[0-9a-f]{4}/i);
});

test("material collection remains quarter-scoped and keeps independent SPD data separate", () => {
  const provider = readFileSync("app/dashboard-postgres-data.tsx", "utf8");
  const panel = readFileSync("app/Q1SpecialPanels.tsx", "utf8");

  assert.match(provider, /getMaterialStatus\(quarterCode/);
  assert.match(provider, /getSpdDashboard\(quarterCode/);
  assert.match(panel, /const \{ quarter: selected, rows, materialStatus, spdDashboard/);
  assert.match(panel, /if \(material\.kind !== "spd" && material\.kind !== "stock"\)/);
});
