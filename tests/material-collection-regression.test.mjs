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

test("material collection keeps independent SPD data separate and enables its existing SPD drilldown branch", () => {
  const provider = readFileSync("app/dashboard-postgres-data.tsx", "utf8");
  const panel = readFileSync("app/Q1SpecialPanels.tsx", "utf8");
  const render = panel.slice(panel.indexOf("return <section className=\"q1-special\""));

  assert.match(provider, /getMaterialStatus\(quarterCode/);
  assert.match(provider, /getSpdDashboard\(quarterCode/);
  assert.match(panel, /const \{ quarter: selected, rows, differenceItems, materialStatus, spdDashboard/);
  assert.match(render, /onDrilldown=\{\(material\) => setDrillSelection\(\{ type: "material", material \}\)\}/);
  assert.doesNotMatch(render, /if \(material\.kind !== "spd" && material\.kind !== "stock"\)/);
  assert.match(panel, /const sourceSheet = fromSpd \? spdSheet : sheet/);
  assert.match(panel, /const aliases = fromSpd \? spdFieldAliases\(material\) : material\.aliases/);
  assert.match(panel, /isSpdCollected\(materialCell\(row, headers, aliases\)\)/);
});

test("SPD drilldowns use only independent SPD columns while ordinary material drilldowns retain reconciliation columns", () => {
  const panel = readFileSync("app/Q1SpecialPanels.tsx", "utf8");
  const dialog = panel.slice(panel.indexOf("function CollectionDrilldownDialog"), panel.indexOf("export function Q1SpecialPanels"));
  const spdTable = dialog.match(/\{data\.isSpd \? <table className="spd-drilldown-table">[\s\S]*?<\/table> : <table>/)?.[0] ?? "";

  assert.match(panel, /statusColumnLabel: material\.kind === "spd" \? "SPD\\u786e\\u8ba4\\u72b6\\u6001" : material\.kind === "stock" \? "SPD\\u5e93\\u5b58\\u786e\\u8ba4\\u72b6\\u6001"/);
  assert.match(panel, /displayMaterialStatus: displayValue\(sourceStatus\)/);
  assert.match(spdTable, /<th>序号<\/th><th>账套<\/th><th>区域<\/th><th>客户名称<\/th><th>\{data\.statusColumnLabel\}<\/th>/);
  assert.match(spdTable, /displayMaterialStatus/);
  assert.doesNotMatch(spdTable, /reconciliationStatus|companyReceivable|customerBookAmount|differenceAmount/);
  assert.match(dialog, /: <table><thead><tr><th>序号<\/th><th>账套<\/th><th>区域<\/th><th>客户名称<\/th><th>资料状态<\/th><th>对账状态<\/th><th>公司应收<\/th><th>客户账面金额<\/th><th>对账差额<\/th>/);
});
