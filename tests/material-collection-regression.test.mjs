import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("material and effective-reply drilldowns render Chinese static UI text instead of literal Unicode escapes", () => {
  const source = readFileSync("app/Q1SpecialPanels.tsx", "utf8");
  const dialog = source.slice(source.indexOf("function CollectionDrilldownDialog"), source.indexOf("function FollowAdviceCard"));

  assert.match(dialog, /资料收集与未对账客户/);
  assert.match(dialog, /<th>客户名称<\/th>/);
  assert.match(dialog, /当前条件下暂无明细数据/);
  assert.doesNotMatch(dialog, />\\u[0-9a-f]{4}/i);
  assert.doesNotMatch(dialog, /aria-label="\\u[0-9a-f]{4}/i);
  assert.doesNotMatch(source, /(?:aria-label|text)="\\u[0-9a-f]{4}/i);
  assert.match(source, /展示各类资料的收集完成情况及需重点跟进区域。/);
  assert.match(source, /有效回函率 = 已有效回函客户数 ÷ 已对账客户数。/);
  assert.match(source, /title: `\$\{selection\.region\}\\u6709\\u6548\\u56de\\u51fd\\u660e\\u7ec6`/);
  assert.match(source, /positiveStatus: "\\u6709\\u6548\\u56de\\u51fd"/);
  assert.match(source, /negativeStatus: "\\u672a\\u6709\\u6548\\u56de\\u51fd"/);
});

test("material collection remains quarter-scoped and keeps independent SPD data separate", () => {
  const provider = readFileSync("app/dashboard-postgres-data.tsx", "utf8");
  const panel = readFileSync("app/Q1SpecialPanels.tsx", "utf8");

  assert.match(provider, /getMaterialStatus\(quarterCode/);
  assert.match(provider, /getSpdDashboard\(quarterCode/);
  assert.match(panel, /const \{ quarter: selected, rows, materialStatus, spdDashboard/);
  assert.match(panel, /if \(material\.kind !== "spd" && material\.kind !== "stock"\)/);
});
