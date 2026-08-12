"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { selectedQuarter, sheetForQuarter } from "./quarter-storage";
import "./q1-special-panels.css";
import "./q1-special-panels-layout-overrides.css";

type SavedSheet = { headers?: string[]; rows?: unknown[][] };
type MaterialKind = "confirmation" | "letter" | "spd" | "stock" | "delivery" | "transit" | "writeoff";
type MaterialDefinition = { name: string; aliases: readonly string[]; kind: MaterialKind };
type FollowRegion = { name: string; rate: number };
type CollectionRow = MaterialDefinition & { completed: number; total: number; rate: number; followRegions: FollowRegion[]; order: number };
type ReplyRateRow = { name: string; replied: number; total: number; rate: number; order: number };
type LostRow = { region: string; customer: string; amount: number; note: string };
type UnaccountedRow = { region: string; customer: string; note: string };

const S = {
  specialInfo: "\u4e13\u9879\u7ba1\u7406\u4fe1\u606f",
  pageTitle: "\u8d44\u6599\u6536\u96c6\u4e0e\u672a\u5bf9\u8d26\u5ba2\u6237",
  collection: "\u8d44\u6599\u6536\u96c6",
  unaccounted: "\u672a\u5bf9\u8d26\u5ba2\u6237",
  overview: "\u8d44\u6599\u6536\u96c6\u603b\u89c8",
  effectiveReply: "\u6709\u6548\u56de\u51fd\u7387\uff08\u6309\u533a\u57df\uff09",
  advice: "\u91cd\u70b9\u8ddf\u8fdb\u5efa\u8bae",
  materialType: "\u8d44\u6599\u7c7b\u578b",
  collected: "\u5df2\u6536\u96c6 / \u5e94\u6536\u96c6",
  rate: "\u6536\u96c6\u7387",
  followRegions: "\u9700\u8ddf\u8fdb\u533a\u57df\u4e0e\u6536\u96c6\u7387",
  lowReply: "\u4f4e\u6709\u6548\u56de\u51fd\u7387\u533a\u57df\uff08<60%\uff09",
  followTypes: "\u9700\u91cd\u70b9\u8ddf\u8fdb\u7684\u8d44\u6599\u7c7b\u578b",
  viewAll: "\u67e5\u770b\u5168\u90e8",
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
type ReplyRateLevel = "excellent" | "good" | "warning";
const getReplyRateLevel = (rate: number): ReplyRateLevel =>
  rate >= 80 ? "excellent" : rate >= 60 ? "good" : "warning";
const REPLY_RATE_LEVELS: ReadonlyArray<{ level: ReplyRateLevel; label: string; range: string }> = [
  { level: "excellent", label: "\u4f18\u79c0", range: "\u226580%" },
  { level: "good", label: "\u826f\u597d", range: "60%\uff5e<80%" },
  { level: "warning", label: "\u5f85\u63d0\u5347", range: "<60%" },
];

function specialData(sheet?: SavedSheet) {
  const headers = sheet?.headers ?? [];
  const source = sheet?.rows ?? [];
  const reconciled = source.filter((row) => isReconciled(row, headers));
  const regions = [...new Set(reconciled.map((row) => cell(row, headers, "\u533a\u57df") || "\u672a\u586b\u5199"))];
  const collection = MATERIALS.map((material, order): CollectionRow => {
    const completed = reconciled.filter((row) => isCollected(material.name, materialCell(row, headers, material.aliases))).length;
    const followRegions = regions.map((name, regionOrder) => {
      const regional = reconciled.filter((row) => (cell(row, headers, "\u533a\u57df") || "\u672a\u586b\u5199") === name);
      const received = regional.filter((row) => isCollected(material.name, materialCell(row, headers, material.aliases))).length;
      return { name, rate: percent(received, regional.length), order: regionOrder };
    }).filter((item) => item.rate < 100).sort((a, b) => b.rate - a.rate || a.order - b.order).map(({ name, rate }) => ({ name, rate }));
    return { ...material, completed, total: reconciled.length, rate: percent(completed, reconciled.length), followRegions, order };
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

function InfoTip({ text }: { text: string }) {
  return <span className="collection-info" tabIndex={0} title={text} aria-label={text}>i</span>;
}

function MaterialIcon({ kind }: { kind: MaterialKind }) {
  const glyph: Record<MaterialKind, string> = { confirmation: "✓", letter: "✉", spd: "▤", stock: "◆", delivery: "↗", transit: "▰", writeoff: "◎" };
  return <span className={`collection-material-icon ${kind}`} aria-hidden="true">{glyph[kind]}</span>;
}

function ReplyLevelDot({ rank, rate }: { rank: number; rate: number }) {
  const level = getReplyRateLevel(rate);
  return <span className={`reply-rank ${level}`}>{rank}</span>;
}

function ReplyRateLegend({ compact = false }: { compact?: boolean }) {
  return <div className={`reply-legend ${compact ? "compact" : ""}`} aria-label="\u6709\u6548\u56de\u51fd\u7387\u72b6\u6001\u8bf4\u660e">
    {REPLY_RATE_LEVELS.map((item) => <span key={item.level}><i className={item.level} />{item.label}\uff08{item.range}\uff09</span>)}
  </div>;
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

function CollectionOverviewCard({ rows }: { rows: CollectionRow[] }) {
  return <article className="collection-card overview-card">
    <header className="collection-card-head"><h3>{S.overview} <InfoTip text="\u5c55\u793a\u5404\u7c7b\u8d44\u6599\u7684\u6536\u96c6\u5b8c\u6210\u60c5\u51b5\u53ca\u9700\u91cd\u70b9\u8ddf\u8fdb\u533a\u57df\u3002" /></h3></header>
    <div className="collection-table-wrap"><table className="collection-overview-table"><thead><tr><th>{S.materialType}</th><th>{S.collected}</th><th>{S.rate}</th><th>{S.followRegions}</th></tr></thead>
      <tbody>{rows.length ? rows.map((item) => <tr key={item.name}>
        <td><div className="collection-material-name"><MaterialIcon kind={item.kind} /><span>{item.name}</span></div></td>
        <td className="collection-numeric">{item.completed} / {item.total}</td>
        <td className={`collection-rate ${item.rate < 90 ? "low" : ""}`}>{formatPercent(item.rate)}</td>
        <td className="collection-follow">{item.followRegions.length ? item.followRegions.map((region) => `${region.name}${formatPercent(region.rate)}`).join("、") : S.allComplete}</td>
      </tr>) : <tr><td colSpan={4} className="collection-empty">{S.noData}</td></tr>}</tbody>
    </table></div>
  </article>;
}

function ReplyRateCard({ rows }: { rows: ReplyRateRow[] }) {
  return <article className="collection-card reply-card">
    <header className="collection-card-head reply-card-head"><div><h3>{S.effectiveReply} <InfoTip text="\u6309\u533a\u57df\u5c55\u793a\u6709\u6548\u56de\u51fd\u5ba2\u6237\u6570 / \u5df2\u53d1\u51fd\u5ba2\u6237\u6570\u53ca\u6709\u6548\u56de\u51fd\u7387\u3002" /></h3><p>\u6309\u533a\u57df\u5c55\u793a\u6709\u6548\u56de\u51fd\u5ba2\u6237\u6570 / \u5df2\u53d1\u51fd\u5ba2\u6237\u6570\u53ca\u56de\u51fd\u7387</p></div><ReplyRateLegend /></header>
    <div className="reply-rate-list">{rows.length ? rows.map((item, index) => <button className="reply-rate-row" type="button" key={item.name} title={`${item.name}${formatPercent(item.rate)}`}>
      <ReplyLevelDot rank={index + 1} rate={item.rate} /><strong>{item.name}</strong><span className="reply-count">{item.replied} / {item.total}</span><b>{formatPercent(item.rate)}</b>
    </button>) : <p className="collection-empty">{S.noData}</p>}</div>
    <footer><ReplyRateLegend compact /></footer>
  </article>;
}

function FollowAdviceCard({ collection, replyRates }: { collection: CollectionRow[]; replyRates: ReplyRateRow[] }) {
  const lowRegions = replyRates.filter((item) => item.rate < 60);
  const followTypes = collection
    .filter((item) => item.rate < 95 || (item.name === "\u5bf9\u8d26\u51fd" && item.followRegions.length > 0))
    .slice()
    .sort((a, b) => a.rate - b.rate || a.order - b.order)
    .slice(0, 3);
  return <article className="collection-card advice-card"><header className="collection-card-head"><h3>{S.advice}</h3></header>
    <section className="advice-section"><div className="advice-title"><span className="advice-symbol warning">!</span><h4>{S.lowReply}</h4><button type="button">{S.viewAll}</button></div>
      <div className="low-region-grid">{lowRegions.length ? lowRegions.map((item) => <span key={item.name}><i />{item.name} {formatPercent(item.rate)}</span>) : <p>{S.allComplete}</p>}</div>
    </section>
    <section className="advice-section"><div className="advice-title"><span className="advice-symbol document">{"\u25a4"}</span><h4>{S.followTypes}</h4><button type="button">{S.viewAll}</button></div>
      <ul className="advice-list">{followTypes.length ? followTypes.map((item) => <li key={item.name}><strong>{item.name}</strong><br /><span>{item.followRegions.length ? item.followRegions.map((region) => `${region.name}${formatPercent(region.rate)}`).join("\u3001") : `${S.rate}${formatPercent(item.rate)}`}</span></li>) : <li>{S.allComplete}</li>}</ul>
    </section>
  </article>;
}

export function Q1SpecialPanels() {
  const [quarter, setQuarter] = useState("");
  const [sheet, setSheet] = useState<SavedSheet>();
  const [tab, setTab] = useState<"collection" | "unaccounted">("collection");
  useEffect(() => {
    const sync = () => { const nextQuarter = selectedQuarter(); setQuarter(nextQuarter); setSheet(sheetForQuarter(nextQuarter) as SavedSheet | undefined); };
    sync();
    window.addEventListener("reconciliation-quarter-selected", sync); window.addEventListener("reconciliation-quarter-updated", sync); window.addEventListener("reconciliation-updated", sync);
    return () => { window.removeEventListener("reconciliation-quarter-selected", sync); window.removeEventListener("reconciliation-quarter-updated", sync); window.removeEventListener("reconciliation-updated", sync); };
  }, []);
  const data = useMemo(() => specialData(sheet), [sheet]);
  if (!quarter) return null;
  return <section className="q1-special">
    <div className="special-head"><div><p>{quarter} {S.specialInfo}</p><h2>{S.pageTitle}</h2></div><div className="special-tabs" role="tablist" aria-label={S.pageTitle}>
      <button role="tab" aria-selected={tab === "collection"} className={tab === "collection" ? "active" : ""} onClick={() => setTab("collection")}>{S.collection}</button>
      <button role="tab" aria-selected={tab === "unaccounted"} className={tab === "unaccounted" ? "active" : ""} onClick={() => setTab("unaccounted")}>{S.unaccounted}</button>
    </div></div>
    {tab === "collection" ? <div className="collection-dashboard"><CollectionOverviewCard rows={data.collection} /><ReplyRateCard rows={data.replyRates} /><FollowAdviceCard collection={data.collection} replyRates={data.replyRates} /></div>
      : <div className="special-legacy-panel"><VerticalScrollList label={S.unaccounted}><table><thead><tr><th>{S.region}</th><th>{S.customer}</th><th>{S.note}</th></tr></thead><tbody>{data.unaccounted.length ? data.unaccounted.map((item) => <tr key={`${item.region}-${item.customer}`}><td>{item.region}</td><td>{item.customer}</td><td>{item.note || "—"}</td></tr>) : <tr><td colSpan={3}>{S.unaccountedEmpty}</td></tr>}</tbody></table></VerticalScrollList></div>}
  </section>;
}
