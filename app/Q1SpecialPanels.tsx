"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { selectedQuarter, sheetForQuarter } from "./quarter-storage";
import "./q1-special-panels.css";

type SavedSheet = { headers?: string[]; rows?: unknown[][] };
type CollectionRow = { name: string; aliases: readonly string[]; completed: number; total: number; pending: string };
type LostRow = { region: string; customer: string; amount: number; note: string };
type UnaccountedRow = { region: string; customer: string; note: string };

const MATERIALS = [
  { name: "\u5bf9\u8d26\u51fd", aliases: ["\u5bf9\u8d26\u51fd"] },
  { name: "\u786e\u8ba4\u51fd", aliases: ["\u5bf9\u8d26\u786e\u8ba4\u51fd", "\u786e\u8ba4\u51fd"] },
  { name: "SPD\u786e\u8ba4\u8868", aliases: ["SPD\u786e\u8ba4\u8868", "SPD\u786e\u8ba4\u51fd"] },
  { name: "SPD\u5e93\u5b58\u786e\u8ba4\u51fd", aliases: ["SPD\u5e93\u5b58\u786e\u8ba4\u51fd"] },
  { name: "\u5728\u9014\u8bc1\u660e", aliases: ["\u5728\u9014\u8bc1\u660e"] },
  { name: "\u7cbe\u51c6\u6838\u9500", aliases: ["\u7cbe\u51c6\u6838\u9500"] },
  { name: "\u50ac\u6b3e\u51fd\u9001\u8fbe\u8bc1\u660e", aliases: ["\u50ac\u6b3e\u51fd\u9001\u8fbe\u8bc1\u660e"] },
] as const;

const cell = (row: unknown[], headers: string[], header: string) => {
  const index = headers.findIndex(
    (item) => String(item).replace(/\s/g, "") === header.replace(/\s/g, ""),
  );
  return index < 0 ? "" : String(row[index] ?? "").trim();
};
const filled = (row: unknown[], headers: string[]) =>
  cell(row, headers, "\u5ba2\u6237\u8d26\u9762\u91d1\u989d") !== "";
const materialCell = (row: unknown[], headers: string[], aliases: readonly string[]) =>
  aliases.map((header) => cell(row, headers, header)).find(Boolean) ?? "";
// The provided-materials sheet uses a strict yes/no convention: only "\u5df2\u63d0\u4f9b" or "\u662f" is collected.
const provided = (value: string) => ["\u5df2\u63d0\u4f9b", "\u662f"].includes(value.replace(/\s/g, ""));
const money = (value: number) =>
  value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const numberOf = (value: string) => {
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

function specialData(sheet?: SavedSheet) {
  const headers = sheet?.headers ?? [];
  const source = sheet?.rows ?? [];
  const reconciled = source.filter((row) => filled(row, headers));
  const regions = [...new Set(reconciled.map((row) => cell(row, headers, "\u533a\u57df") || "\u672a\u586b\u5199"))];
  const collection: CollectionRow[] = MATERIALS.map(({ name, aliases }) => {
    const completed = reconciled.filter((row) =>
      provided(materialCell(row, headers, aliases)),
    ).length;
    const pending = regions
      .map((region) => {
        const regional = reconciled.filter(
          (row) => (cell(row, headers, "\u533a\u57df") || "\u672a\u586b\u5199") === region,
        );
        const collected = regional.filter((row) =>
          provided(materialCell(row, headers, aliases)),
        ).length;
        const rate = regional.length ? (collected / regional.length) * 100 : 0;
        return rate < 100 ? `${region}${rate.toFixed(0)}%` : "";
      })
      .filter(Boolean)
      .join("\u3001");
    return { name, aliases, completed, total: reconciled.length, pending: pending || "\u5176\u4ed6\u533a\u57df100%" };
  });
  const lost: LostRow[] = reconciled
    .map((row) => ({
      region: cell(row, headers, "\u533a\u57df") || "\u672a\u586b\u5199",
      customer: cell(row, headers, "\u5ba2\u6237\u540d\u79f0") || "\u2014",
      amount: numberOf(cell(row, headers, "\u4e22\u7968\u91d1\u989d")),
      note: cell(row, headers, "\u5dee\u989d\u539f\u56e0\u5907\u6ce8"),
    }))
    .filter((row) => row.amount !== 0);
  const unaccounted: UnaccountedRow[] = source
    .filter((row) => !filled(row, headers))
    .map((row) => ({
      region: cell(row, headers, "\u533a\u57df") || "\u672a\u586b\u5199",
      customer: cell(row, headers, "\u5ba2\u6237\u540d\u79f0") || "\u2014",
      note: cell(row, headers, "\u5dee\u989d\u539f\u56e0\u5907\u6ce8"),
    }));
  return { collection, lost, unaccounted };
}

function VerticalScrollList({ children, label }: { children: ReactNode; label: string }) {
  const listRef = useRef<HTMLDivElement>(null);
  const scroll = (top: number) => listRef.current?.scrollBy({ top, behavior: "smooth" });
  return <div className="special-scroll-shell">
    <div className="special-scroll-list" ref={listRef}>{children}</div>
    <div className="special-scroll-actions" aria-label={`${label}上下滚动`}>
      <button type="button" onClick={() => scroll(-180)} aria-label="向上滚动">⌃</button>
      <button type="button" onClick={() => scroll(180)} aria-label="向下滚动">⌄</button>
    </div>
  </div>;
}

export function Q1SpecialPanels() {
  const [quarter, setQuarter] = useState("");
  const [sheet, setSheet] = useState<SavedSheet>();
  const [tab, setTab] = useState<"collection" | "lost" | "unaccounted">("collection");
  useEffect(() => {
    const sync = () => {
      const nextQuarter = selectedQuarter();
      setQuarter(nextQuarter);
      setSheet(sheetForQuarter(nextQuarter) as SavedSheet | undefined);
    };
    sync();
    window.addEventListener("reconciliation-quarter-selected", sync);
    window.addEventListener("reconciliation-quarter-updated", sync);
    window.addEventListener("reconciliation-updated", sync);
    return () => {
      window.removeEventListener("reconciliation-quarter-selected", sync);
      window.removeEventListener("reconciliation-quarter-updated", sync);
      window.removeEventListener("reconciliation-updated", sync);
    };
  }, []);
  const data = useMemo(() => specialData(sheet), [sheet]);
  if (!quarter) return null;
  return (
    <section className="q1-special">
      <div className="special-head">
        <div>
          <p>{quarter} 专项管理信息</p>
          <h2>资料收集、丢票与未对账客户</h2>
        </div>
        <div className="special-tabs">
          <button className={tab === "collection" ? "active" : ""} onClick={() => setTab("collection")}>资料收集</button>
          <button className={tab === "lost" ? "active" : ""} onClick={() => setTab("lost")}>丢票情况</button>
          <button className={tab === "unaccounted" ? "active" : ""} onClick={() => setTab("unaccounted")}>未对账客户</button>
        </div>
      </div>
      {tab === "collection" ? (
        <table>
          <thead><tr><th>资料类型</th><th>已收集 / 应收集</th><th>需跟进区域与收集率</th></tr></thead>
          <tbody>{data.collection.map((item) => <tr key={item.name}><td>{item.name}</td><td>{item.completed} / {item.total} ({item.total ? ((item.completed / item.total) * 100).toFixed(1) : "0.0"}%)</td><td>{item.pending}</td></tr>)}</tbody>
        </table>
      ) : tab === "lost" ? (
        <VerticalScrollList label="丢票情况"><div className="loss-list">{data.lost.length ? data.lost.map((item) => <article key={`${item.region}-${item.customer}`}><b>{item.region}：{item.customer}</b><span>丢票金额 {money(item.amount)} 元{item.note ? `；${item.note}` : ""}</span></article>) : <p className="special-empty">当前季度暂无丢票差额明细。</p>}</div></VerticalScrollList>
      ) : (
        <VerticalScrollList label="未对账客户"><table>
          <thead><tr><th>区域</th><th>客户</th><th>差额原因备注</th></tr></thead>
          <tbody>{data.unaccounted.length ? data.unaccounted.map((item) => <tr key={`${item.region}-${item.customer}`}><td>{item.region}</td><td>{item.customer}</td><td>{item.note || "—"}</td></tr>) : <tr><td colSpan={3}>当前季度暂无未对账客户。</td></tr>}</tbody>
        </table></VerticalScrollList>
      )}
    </section>
  );
}
