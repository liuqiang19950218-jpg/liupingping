"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDashboardData } from "./dashboard-postgres-data";
import type { MaterialStatus, Reconciliation, SpdDashboardData } from "../lib/api/reconciliation-api";
import "./q1-special-panels.css";
import "./q1-special-panels-layout-overrides.css";
import "./q1-special-drilldown.css";

type SavedSheet = { headers?: string[]; rows?: unknown[][] };
type MaterialKind = "confirmation" | "letter" | "spd" | "stock" | "delivery" | "transit" | "writeoff";
type MaterialDefinition = { name: string; aliases: readonly string[]; kind: MaterialKind };
type FollowRegion = { name: string; rate: number };
type CollectionRow = MaterialDefinition & { completed: number; total: number; rate: number; followRegions: FollowRegion[]; order: number };
type ReplyRateRow = { name: string; replied: number; total: number; rate: number; order: number };
type LostRow = { region: string; customer: string; amount: number; note: string };
type UnaccountedRow = { region: string; customer: string; note: string };
type CollectionDrillRow = {
  id: string;
  accountSet: string;
  region: string;
  customer: string;
  materialStatus: string;
  reconciliationStatus: string;
  companyReceivable: string;
  customerBookAmount: string;
  differenceAmount: string;
};
type CollectionDrilldown = {
  title: string;
  description: string;
  rows: CollectionDrillRow[];
  positiveStatus: string;
  negativeStatus: string;
};
type CollectionDrillSelection =
  | { type: "material"; material: MaterialDefinition }
  | { type: "reply"; region: string };

const S = {
  specialInfo: "\u4e13\u9879\u7ba1\u7406\u4fe1\u606f",
  pageTitle: "\u8d44\u6599\u6536\u96c6\u4e0e\u672a\u5bf9\u8d26\u5ba2\u6237",
  collection: "\u8d44\u6599\u6536\u96c6",
  unaccounted: "\u672a\u5bf9\u8d26\u5ba2\u6237",
  overview: "\u8d44\u6599\u6536\u96c6\u603b\u89c8",
  effectiveReply: "\u6709\u6548\u56de\u51fd\u7387\uff08\u6309\u533a\u57df\uff09",
  materialType: "\u8d44\u6599\u7c7b\u578b",
  collected: "\u5df2\u6536\u96c6 / \u5e94\u6536\u96c6",
  rate: "\u6536\u96c6\u7387",
  followRegions: "\u9700\u8ddf\u8fdb\u533a\u57df\u4e0e\u6536\u96c6\u7387",
  noData: "\u6682\u65e0\u8d44\u6599\u6536\u96c6\u6570\u636e",
  allComplete: "\u6240\u6709\u533a\u57df100%",
  lossEmpty: "\u5f53\u524d\u5b63\u5ea6\u6682\u65e0\u4e22\u7968\u5dee\u989d\u660e\u7ec6\u3002",
  unaccountedEmpty: "\u5f53\u524d\u5b63\u5ea6\u6682\u65e0\u672a\u5bf9\u8d26\u5ba2\u6237\u3002",
  region: "\u533a\u57df",
  customer: "\u5ba2\u6237",
  note: "\u5dee\u989d\u539f\u56e0\u5907\u6ce8",
};

const MATERIALS: readonly MaterialDefinition[] = [
  { name: "\u786e\u8ba4\u51fd", aliases: ["\u5bf9\u8d26\u786e\u8ba4\u51fd", "\u786e\u8ba4\u51fd"], kind: "confirmation" },
  { name: "\u5bf9\u8d26\u51fd", aliases: ["\u5bf9\u8d26\u51fd"], kind: "letter" },
  { name: "SPD\u786e\u8ba4\u8868", aliases: ["SPD\u786e\u8ba4\u8868", "SPD\u786e\u8ba4\u51fd"], kind: "spd" },
  { name: "SPD\u5e93\u5b58\u786e\u8ba4\u51fd", aliases: ["SPD\u5e93\u5b58\u786e\u8ba4\u51fd"], kind: "stock" },
  { name: "\u50ac\u6b3e\u51fd\u9001\u8fbe\u8bc1\u660e", aliases: ["\u50ac\u6b3e\u51fd\u9001\u8fbe\u8bc1\u660e"], kind: "delivery" },
  { name: "\u5728\u9014\u8bc1\u660e", aliases: ["\u5728\u9014\u8bc1\u660e"], kind: "transit" },
  { name: "\u7cbe\u51c6\u6838\u9500", aliases: ["\u7cbe\u51c6\u6838\u9500"], kind: "writeoff" },
];

const PG_HEADERS = ["账套", "区域", "客户名称", "公司应收", "客户账面金额", "对账差额", "是否对清", "差额原因备注", ...MATERIALS.map((item) => item.name)];
const materialValue = (material: MaterialStatus | undefined) => material?.rawValue ?? (material?.provided ? "已提供" : "");
function pgSheet(rows: Reconciliation[], materialStatus: MaterialStatus[]): SavedSheet {
  const materialsByReconciliation = materialStatus.reduce((map, item) => {
    if (!item.reconciliationId) return map;
    const entries = map.get(item.reconciliationId) ?? new Map<string, MaterialStatus>();
    entries.set(item.materialType, item); map.set(item.reconciliationId, entries); return map;
  }, new Map<string, Map<string, MaterialStatus>>());
  return { headers: PG_HEADERS, rows: rows.map((row) => {
    const materials = materialsByReconciliation.get(row.id);
    return [row.accountSet ?? "", row.region ?? "", row.customer ?? "", row.companyReceivable ?? "", row.customerBookAmount ?? "", row.reconciliationDifference ?? "", row.reconciliationStatus ?? "", "", ...MATERIALS.map((definition) => materialValue(materials?.get(definition.name) ?? [...(materials?.values() ?? [])].find((item) => definition.aliases.includes(item.materialType))))];
  }) };
}
function pgSpdSheet(data: SpdDashboardData | null): SavedSheet {
  return { headers: ["账套", "区域", "客户名称", "SPD确认表", "SPD库存确认函"], rows: (data?.items ?? []).map((item) => [item.accountSet ?? "", item.region ?? "", item.customer ?? "", item.spdConfirmation ?? "", item.spdInventoryConfirmation ?? ""]) };
}

const normalize = (value: unknown) => String(value ?? "").replace(/\s/g, "");
const cell = (row: unknown[], headers: string[], header: string) => {
  const index = headers.findIndex((item) => normalize(item) === normalize(header));
  return index < 0 ? "" : String(row[index] ?? "").trim();
};
const materialCell = (row: unknown[], headers: string[], aliases: readonly string[]) =>
  aliases.map((header) => cell(row, headers, header)).find(Boolean) ?? "";
const isReconciledAmount = (value: string) =>
  !["", "—", "-", "\u672a\u586b\u5199", "\u672a\u5bf9\u8d26", "null", "undefined"].includes(normalize(value));
const isMarkedUnreconciled = (row: unknown[], headers: string[]) => {
  const statusIndex = headers.findIndex((header) => normalize(header).includes("\u662f\u5426\u5bf9\u6e05"));
  const status = statusIndex < 0 ? "" : normalize(row[statusIndex]);
  return status === "\u672a\u5bf9\u8d26" || MATERIALS.some(({ aliases }) => normalize(materialCell(row, headers, aliases)) === "\u672a\u5bf9\u8d26");
};
const isReconciled = (row: unknown[], headers: string[]) =>
  !isMarkedUnreconciled(row, headers) && isReconciledAmount(cell(row, headers, "\u5ba2\u6237\u8d26\u9762\u91d1\u989d"));
const isProvided = (value: string) => ["\u5df2\u63d0\u4f9b", "\u662f"].includes(normalize(value));
// SPD表的是/否都表示已经填报；只有空白才是未收集。
const isSpdCollected = (value: string) => value.trim() !== "";
const isReply = (value: string) => ["\u5df2\u76d6\u7ae0", "\u672a\u76d6\u7ae0", "\u5df2\u56de\u51fd", "\u5df2\u63d0\u4f9b", "\u662f"].includes(normalize(value));
const isConfirmationReply = (value: string) => ["\u5df2\u56de\u51fd", "\u662f", "\u5df2\u63d0\u4f9b"].includes(normalize(value));
const isCollected = (name: string, value: string) =>
  name === "\u5bf9\u8d26\u51fd" ? isReply(value) : name === "\u786e\u8ba4\u51fd" ? isConfirmationReply(value) : isProvided(value);
const numberOf = (value: string) => {
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
const percent = (numerator: number, denominator: number) => denominator ? (numerator / denominator) * 100 : 0;
const formatPercent = (value: number) => `${value.toFixed(1)}%`;
const hasReconciliationDifference = (row: unknown[], headers: string[]) =>
  Math.abs(numberOf(cell(row, headers, "\u5bf9\u8d26\u5dee\u989d"))) > 0.000001;

const spdFieldAliases = (material: MaterialDefinition) =>
  material.name === "SPD\u786e\u8ba4\u8868"
    ? ["SPD\u786e\u8ba4\u8868", "SPD\u786e\u8ba4\u51fd"]
    : ["SPD\u5e93\u5b58\u786e\u8ba4\u51fd"];

function spdCollectionRows(sheet?: SavedSheet) {
  const headers = sheet?.headers ?? [];
  const source = sheet?.rows ?? [];
  const accountAt = headers.findIndex((header) => normalize(header) === "\u8d26\u5957");
  const regionAt = headers.findIndex((header) => normalize(header) === "\u533a\u57df");
  const customerAt = headers.findIndex((header) => normalize(header) === "\u5ba2\u6237\u540d\u79f0");
  const hasIdentity = accountAt >= 0 || regionAt >= 0 || customerAt >= 0;
  const unique = new Map<string, unknown[]>();
  source.forEach((row, index) => {
    const key = hasIdentity
      ? [row[accountAt], row[regionAt], row[customerAt]]
          .map((value) => normalize(value))
          .join("|")
      : String(index);
    if (key.replace(/\|/g, "")) unique.set(key, row);
  });
  return [...unique.values()];
}

function spdCollectionForMaterial(
  material: MaterialDefinition,
  spdSheet?: SavedSheet,
  order = 0,
): CollectionRow | null {
  if (material.kind !== "spd" && material.kind !== "stock") return null;
  const headers = spdSheet?.headers ?? [];
  if (!headers.length) return null;
  const population = spdCollectionRows(spdSheet);
  const aliases = spdFieldAliases(material);
  const regions = [...new Set(population.map((row) => cell(row, headers, "\u533a\u57df") || "\u672a\u586b\u5199"))];
  const completed = population.filter((row) =>
    isSpdCollected(materialCell(row, headers, aliases)),
  ).length;
  const followRegions = regions
    .map((name, regionOrder) => {
      const regional = population.filter(
        (row) => (cell(row, headers, "\u533a\u57df") || "\u672a\u586b\u5199") === name,
      );
      const received = regional.filter((row) =>
        isSpdCollected(materialCell(row, headers, aliases)),
      ).length;
      return { name, rate: percent(received, regional.length), order: regionOrder };
    })
    .filter((item) => item.rate < 100)
    .sort((a, b) => b.rate - a.rate || a.order - b.order)
    .map(({ name, rate }) => ({ name, rate }));
  return {
    ...material,
    completed,
    total: population.length,
    rate: percent(completed, population.length),
    followRegions,
    order,
  };
}

function specialData(sheet?: SavedSheet, spdSheet?: SavedSheet) {
  const headers = sheet?.headers ?? [];
  const source = sheet?.rows ?? [];
  const reconciled = source.filter((row) => isReconciled(row, headers));
  // 在途证明只面向有对账差额、且已对账的客户。未对账客户在前一步
  // 已被排除，因此不会进入该资料的应收集数、已收集数或区域收集率。
  const transitApplicable = reconciled.filter((row) => hasReconciliationDifference(row, headers));
  const regions = [...new Set(reconciled.map((row) => cell(row, headers, "\u533a\u57df") || "\u672a\u586b\u5199"))];
  const collection = MATERIALS.map((material, order): CollectionRow => {
    const fromSpdSheet = spdCollectionForMaterial(material, spdSheet, order);
    if (fromSpdSheet) return fromSpdSheet;
    const population = material.kind === "transit" ? transitApplicable : reconciled;
    const materialRegions = material.kind === "transit"
      ? [...new Set(population.map((row) => cell(row, headers, "\u533a\u57df") || "\u672a\u586b\u5199"))]
      : regions;
    const completed = population.filter((row) => isCollected(material.name, materialCell(row, headers, material.aliases))).length;
    const followRegions = materialRegions.map((name, regionOrder) => {
      const regional = population.filter((row) => (cell(row, headers, "\u533a\u57df") || "\u672a\u586b\u5199") === name);
      const received = regional.filter((row) => isCollected(material.name, materialCell(row, headers, material.aliases))).length;
      return { name, rate: percent(received, regional.length), order: regionOrder };
    }).filter((item) => item.rate < 100).sort((a, b) => b.rate - a.rate || a.order - b.order).map(({ name, rate }) => ({ name, rate }));
    return { ...material, completed, total: population.length, rate: percent(completed, population.length), followRegions, order };
  }).sort((a, b) => b.rate - a.rate || a.order - b.order);
  const replyRates = regions.map((name, order): ReplyRateRow => {
    const regional = reconciled.filter((row) => (cell(row, headers, "\u533a\u57df") || "\u672a\u586b\u5199") === name);
    const replied = regional.filter((row) => normalize(materialCell(row, headers, ["\u5bf9\u8d26\u51fd"])) === "\u5df2\u76d6\u7ae0").length;
    return { name, replied, total: regional.length, rate: percent(replied, regional.length), order };
  }).sort((a, b) => b.rate - a.rate || a.order - b.order);
  const lost: LostRow[] = reconciled.map((row) => ({
    region: cell(row, headers, "\u533a\u57df") || "\u672a\u586b\u5199",
    customer: cell(row, headers, "\u5ba2\u6237\u540d\u79f0") || "—",
    amount: numberOf(cell(row, headers, "\u4e22\u7968\u91d1\u989d")),
    note: cell(row, headers, "\u5dee\u989d\u539f\u56e0\u5907\u6ce8"),
  })).filter((row) => row.amount !== 0);
  const unaccounted: UnaccountedRow[] = source.filter((row) => !isReconciled(row, headers)).map((row) => ({
    region: cell(row, headers, "\u533a\u57df") || "\u672a\u586b\u5199",
    customer: cell(row, headers, "\u5ba2\u6237\u540d\u79f0") || "—",
    note: cell(row, headers, "\u5dee\u989d\u539f\u56e0\u5907\u6ce8"),
  }));
  return { collection, replyRates, lost, unaccounted };
}

function withSpdSummary(data: ReturnType<typeof specialData>, spdDashboard: SpdDashboardData | null) {
  if (!spdDashboard) return data;
  const summaryFor = (kind: MaterialKind) => kind === "spd" ? spdDashboard.summary.spdConfirmation : spdDashboard.summary.spdInventoryConfirmation;
  return {
    ...data,
    collection: data.collection.map((item) => {
      if (item.kind !== "spd" && item.kind !== "stock") return item;
      const summary = summaryFor(item.kind);
      return { ...item, completed: summary.submitted, total: summary.total, rate: summary.submissionRate ?? 0, followRegions: [] };
    }),
  };
}

const displayValue = (value: string) => value.trim() || "—";
const reconciliationStatus = (row: unknown[], headers: string[]) =>
  cell(row, headers, "\u662f\u5426\u5bf9\u6e05") || (isReconciled(row, headers) ? "\u5df2\u5bf9\u6e05" : "\u672a\u5bf9\u8d26");

function toCollectionDrillRow(
  row: unknown[],
  headers: string[],
  materialStatus: string,
  index: number,
): CollectionDrillRow {
  return {
    id: [cell(row, headers, "\u8d26\u5957"), cell(row, headers, "\u533a\u57df"), cell(row, headers, "\u5ba2\u6237\u540d\u79f0"), index].join("|"),
    accountSet: displayValue(cell(row, headers, "\u8d26\u5957")),
    region: displayValue(cell(row, headers, "\u533a\u57df")),
    customer: displayValue(cell(row, headers, "\u5ba2\u6237\u540d\u79f0")),
    materialStatus,
    reconciliationStatus: displayValue(reconciliationStatus(row, headers)),
    companyReceivable: displayValue(cell(row, headers, "\u516c\u53f8\u5e94\u6536")),
    customerBookAmount: displayValue(cell(row, headers, "\u5ba2\u6237\u8d26\u9762\u91d1\u989d")),
    differenceAmount: displayValue(cell(row, headers, "\u5bf9\u8d26\u5dee\u989d")),
  };
}

function buildCollectionDrilldown(
  selection: CollectionDrillSelection,
  sheet?: SavedSheet,
  spdSheet?: SavedSheet,
): CollectionDrilldown {
  if (selection.type === "reply") {
    const headers = sheet?.headers ?? [];
    const rows = (sheet?.rows ?? [])
      .filter((row) => isReconciled(row, headers))
      .filter((row) => (cell(row, headers, "\u533a\u57df") || "\u672a\u586b\u5199") === selection.region)
      .map((row, index) =>
        toCollectionDrillRow(
          row,
          headers,
          normalize(materialCell(row, headers, ["\u5bf9\u8d26\u51fd"])) === "\u5df2\u76d6\u7ae0" ? "\u6709\u6548\u56de\u51fd" : "\u672a\u6709\u6548\u56de\u51fd",
          index,
        ),
      );
    return {
      title: `${selection.region}\u6709\u6548\u56de\u51fd\u660e\u7ec6`,
      description: "\u5f53\u524d\u5bf9\u8d26\u5b63\u5ea6\u3001\u5f53\u524d\u533a\u57df\u7684\u5df2\u5bf9\u8d26\u5ba2\u6237\u3002\u6709\u6548\u56de\u51fd\u4ec5\u8ba4\u5b9a\u4e3a\u300c\u5df2\u76d6\u7ae0\u300d\u3002",
      rows,
      positiveStatus: "\u6709\u6548\u56de\u51fd",
      negativeStatus: "\u672a\u6709\u6548\u56de\u51fd",
    };
  }

  const { material } = selection;
  const fromSpd = material.kind === "spd" || material.kind === "stock";
  const sourceSheet = fromSpd ? spdSheet : sheet;
  const headers = sourceSheet?.headers ?? [];
  const source = sourceSheet?.rows ?? [];
  const population = fromSpd
    ? spdCollectionRows(sourceSheet)
    : source.filter((row) => isReconciled(row, headers)).filter(
        (row) => material.kind !== "transit" || hasReconciliationDifference(row, headers),
      );
  const aliases = fromSpd ? spdFieldAliases(material) : material.aliases;
  const rows = population.map((row, index) => {
    const collected = fromSpd
      ? isSpdCollected(materialCell(row, headers, aliases))
      : isCollected(material.name, materialCell(row, headers, aliases));
    return toCollectionDrillRow(
      row,
      headers,
      collected ? "\u5df2\u6536\u96c6" : "\u672a\u6536\u96c6",
      index,
    );
  });
  return {
    title: `${material.name}\u6536\u96c6\u660e\u7ec6`,
    description: fromSpd
      ? "\u6570\u636e\u6765\u6e90\uff1a\u72ec\u7acb\u5bfc\u5165\u7684SPD\u8868\u3002"
      : "\u6570\u636e\u6765\u6e90\uff1a\u5f53\u524d\u5b63\u5ea6\u5df2\u5bf9\u8d26\u5ba2\u6237\u3002",
    rows,
    positiveStatus: "\u5df2\u6536\u96c6",
    negativeStatus: "\u672a\u6536\u96c6",
  };
}

function InfoTip({ text }: { text: string }) {
  return <span className="collection-info" tabIndex={0} title={text} aria-label={text}>i</span>;
}

function MaterialIcon({ kind }: { kind: MaterialKind }) {
  const glyph: Record<MaterialKind, string> = { confirmation: "✓", letter: "✉", spd: "▤", stock: "◆", delivery: "↗", transit: "▰", writeoff: "◎" };
  return <span className={`collection-material-icon ${kind}`} aria-hidden="true">{glyph[kind]}</span>;
}

function ReplyLevelDot({ rank, rate }: { rank: number; rate: number }) {
  const level = rate >= 80 ? "excellent" : rate >= 60 ? "good" : "warning";
  return <span className={`reply-rank ${level}`}>{rank}</span>;
}

function VerticalScrollList({ children, label }: { children: ReactNode; label: string }) {
  const listRef = useRef<HTMLDivElement>(null);
  const scroll = (top: number) => listRef.current?.scrollBy({ top, behavior: "smooth" });
  return <div className="special-scroll-shell">
    <div className="special-scroll-list" ref={listRef}>{children}</div>
    <div className="special-scroll-actions" aria-label={`${label}\u4e0a\u4e0b\u6eda\u52a8`}>
      <button type="button" onClick={() => scroll(-180)} aria-label="\u5411\u4e0a\u6eda\u52a8">⌃</button>
      <button type="button" onClick={() => scroll(180)} aria-label="\u5411\u4e0b\u6eda\u52a8">⌄</button>
    </div>
  </div>;
}

function CollectionOverviewCard({ rows, onDrilldown }: { rows: CollectionRow[]; onDrilldown: (material: MaterialDefinition) => void }) {
  return <article className="collection-card overview-card">
    <header className="collection-card-head"><h3>{S.overview} <InfoTip text="\u5c55\u793a\u5404\u7c7b\u8d44\u6599\u7684\u6536\u96c6\u5b8c\u6210\u60c5\u51b5\u53ca\u9700\u91cd\u70b9\u8ddf\u8fdb\u533a\u57df\u3002" /></h3></header>
    <div className="collection-table-wrap"><table className="collection-overview-table"><thead><tr><th>{S.materialType}</th><th>{S.collected}</th><th>{S.rate}</th><th>{S.followRegions}</th></tr></thead>
      <tbody>{rows.length ? rows.map((item) => <tr key={item.name} className="collection-drill-row" tabIndex={0} onClick={() => onDrilldown(item)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onDrilldown(item); } }}>
        <td><div className="collection-material-name"><MaterialIcon kind={item.kind} /><span>{item.name}</span></div></td>
        <td className="collection-numeric">{item.completed} / {item.total}</td>
        <td className={`collection-rate ${item.rate < 90 ? "low" : ""}`}>{formatPercent(item.rate)}</td>
        <td className="collection-follow">{item.followRegions.length ? item.followRegions.map((region) => `${region.name}${formatPercent(region.rate)}`).join("、") : S.allComplete}</td>
      </tr>) : <tr><td colSpan={4} className="collection-empty">{S.noData}</td></tr>}</tbody>
    </table></div>
  </article>;
}

function ReplyRateCard({ rows, onDrilldown }: { rows: ReplyRateRow[]; onDrilldown: (region: string) => void }) {
  return <article className="collection-card reply-card">
    <header className="collection-card-head"><h3>{S.effectiveReply} <InfoTip text="\u6709\u6548\u56de\u51fd\u7387 = \u5df2\u6709\u6548\u56de\u51fd\u5ba2\u6237\u6570 \u00f7 \u5df2\u5bf9\u8d26\u5ba2\u6237\u6570\u3002" /></h3></header>
    <div className="reply-rate-list">{rows.length ? rows.map((item, index) => <button className="reply-rate-row" type="button" key={item.name} title={`${item.name}${formatPercent(item.rate)}`} onClick={() => onDrilldown(item.name)}>
      <ReplyLevelDot rank={index + 1} rate={item.rate} /><strong>{item.name}</strong><span className="reply-count">{item.replied} / {item.total}</span><b>{formatPercent(item.rate)}</b>
    </button>) : <p className="collection-empty">{S.noData}</p>}</div>
    <footer className="reply-legend"><span><i className="excellent" />{"\u4f18\u79c0\uff08\u226580%\uff09"}</span><span><i className="good" />{"\u826f\u597d\uff0860%\uff5e80%\uff09"}</span><span><i className="warning" />{"\u5f85\u63d0\u5347\uff08\u4f4e\u4e8e60%\uff09"}</span></footer>
  </article>;
}

function CollectionDrilldownDialog({ data, onClose }: { data: CollectionDrilldown; onClose: () => void }) {
  const [category, setCategory] = useState<"all" | "positive" | "negative">("all");
  useEffect(() => setCategory("all"), [data.title]);
  const rows = useMemo(() => {
    if (category === "positive") return data.rows.filter((row) => row.materialStatus === data.positiveStatus);
    if (category === "negative") return data.rows.filter((row) => row.materialStatus === data.negativeStatus);
    return data.rows;
  }, [category, data]);
  const categoryCount = (status: string) => data.rows.filter((row) => row.materialStatus === status).length;
  return <div className="collection-drill-mask" role="presentation" onMouseDown={onClose}>
    <section className="collection-drill-dialog detail-table-tool" role="dialog" aria-modal="true" aria-label={data.title} onMouseDown={(event) => event.stopPropagation()}>
      <header className="collection-drill-head">
        <div><p>资料收集与未对账客户</p><h2>{data.title}</h2><span>{data.description}</span></div>
        <button type="button" aria-label="关闭明细" onClick={onClose}>×</button>
      </header>
      <div className="collection-drill-tabs" role="tablist" aria-label="明细分类">
        <button type="button" role="tab" aria-selected={category === "all"} className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>全部 <b>{data.rows.length}</b></button>
        <button type="button" role="tab" aria-selected={category === "positive"} className={category === "positive" ? "active" : ""} onClick={() => setCategory("positive")}>{data.positiveStatus} <b>{categoryCount(data.positiveStatus)}</b></button>
        <button type="button" role="tab" aria-selected={category === "negative"} className={category === "negative" ? "active" : ""} onClick={() => setCategory("negative")}>{data.negativeStatus} <b>{categoryCount(data.negativeStatus)}</b></button>
      </div>
      <div className="collection-drill-summary">当前分类共 <b>{rows.length}</b> 家客户，明细范围与来源看板保持一致。</div>
      <div className="collection-drill-table local-table">
        <table><thead><tr><th>序号</th><th>账套</th><th>区域</th><th>客户名称</th><th>资料状态</th><th>对账状态</th><th>公司应收</th><th>客户账面金额</th><th>对账差额</th></tr></thead>
          <tbody>{rows.length ? rows.map((row, index) => <tr key={row.id} className={Math.abs(numberOf(row.differenceAmount)) > 0.000001 ? "has-difference" : ""}>
            <td>{index + 1}</td><td>{row.accountSet}</td><td>{row.region}</td><td className="collection-drill-customer">{row.customer}</td><td><span className={`collection-drill-status ${row.materialStatus.includes("\u672a") ? "pending" : "done"}`}>{row.materialStatus}</span></td><td>{row.reconciliationStatus}</td><td className="money-cell">{row.companyReceivable}</td><td className="money-cell">{row.customerBookAmount}</td><td className="money-cell difference-cell">{row.differenceAmount}</td>
          </tr>) : <tr><td colSpan={9} className="table-empty">当前条件下暂无明细数据</td></tr>}</tbody>
        </table>
      </div>
    </section>
  </div>;
}

export function Q1SpecialPanels() {
  const { quarter: selected, rows, materialStatus, spdDashboard, loading, error } = useDashboardData();
  const [tab, setTab] = useState<"collection" | "unaccounted">("collection");
  const [drillSelection, setDrillSelection] = useState<CollectionDrillSelection | null>(null);
  const quarter = selected?.label ?? "";
  const sheet = useMemo(() => pgSheet(rows, materialStatus), [rows, materialStatus]);
  const spdSheet = useMemo(() => pgSpdSheet(spdDashboard), [spdDashboard]);
  const data = useMemo(() => withSpdSummary(specialData(sheet, spdSheet), spdDashboard), [sheet, spdSheet, spdDashboard]);
  const drilldown = useMemo(
    () => drillSelection ? buildCollectionDrilldown(drillSelection, sheet, spdSheet) : null,
    [drillSelection, sheet, spdSheet],
  );
  if (!quarter) return null;
  if (error) return <section className="q1-special"><p className="collection-empty">无法读取本季度资料看板：{error}</p></section>;
  if (loading) return <section className="q1-special"><p className="collection-empty">正在读取本季度资料看板…</p></section>;
  return <section className="q1-special">
    <div className="special-head"><div><p>{quarter} {S.specialInfo}</p><h2>{S.pageTitle}</h2></div><div className="special-tabs" role="tablist" aria-label={S.pageTitle}>
      <button role="tab" aria-selected={tab === "collection"} className={tab === "collection" ? "active" : ""} onClick={() => setTab("collection")}>{S.collection}</button>
      <button role="tab" aria-selected={tab === "unaccounted"} className={tab === "unaccounted" ? "active" : ""} onClick={() => setTab("unaccounted")}>{S.unaccounted}</button>
    </div></div>
    {tab === "collection" ? <div className="collection-dashboard"><CollectionOverviewCard rows={data.collection} onDrilldown={(material) => { if (material.kind !== "spd" && material.kind !== "stock") setDrillSelection({ type: "material", material }); }} /><ReplyRateCard rows={data.replyRates} onDrilldown={(region) => setDrillSelection({ type: "reply", region })} /></div>
      : <div className="special-legacy-panel"><VerticalScrollList label={S.unaccounted}><table><thead><tr><th>{S.region}</th><th>{S.customer}</th><th>{S.note}</th></tr></thead><tbody>{data.unaccounted.length ? data.unaccounted.map((item) => <tr key={`${item.region}-${item.customer}`}><td>{item.region}</td><td>{item.customer}</td><td>{item.note || "—"}</td></tr>) : <tr><td colSpan={3}>{S.unaccountedEmpty}</td></tr>}</tbody></table></VerticalScrollList></div>}
    {drilldown && <CollectionDrilldownDialog data={drilldown} onClose={() => setDrillSelection(null)} />}
  </section>;
}
