"use client";

import { useEffect, useMemo, useState } from "react";
import { selectedQuarter, sheetForQuarter } from "./quarter-storage";
import "./q1-special-panels.css";

type SavedSheet = { headers?: string[]; rows?: unknown[][] };
type CollectionRow = { name: string; completed: number; total: number; pending: string };
type LostRow = { region: string; customer: string; amount: number; note: string };
type UnaccountedRow = { region: string; customer: string; note: string };

const MATERIALS = [
  "\u5bf9\u8d26\u51fd",
  "\u786e\u8ba4\u51fd",
  "SPD\u786e\u8ba4\u8868",
  "SPD\u5e93\u5b58\u786e\u8ba4\u51fd",
  "\u5728\u9014\u8bc1\u660e",
  "\u7cbe\u51c6\u6838\u9500",
  "\u50ac\u6b3e\u51fd\u9001\u8fbe\u8bc1\u660e",
] as const;

const cell = (row: unknown[], headers: string[], header: string) => {
  const index = headers.findIndex(
    (item) => String(item).replace(/\s/g, "") === header.replace(/\s/g, ""),
  );
  return index < 0 ? "" : String(row[index] ?? "").trim();
};
const filled = (row: unknown[], headers: string[]) =>
  cell(row, headers, "\u5ba2\u6237\u8d26\u9762\u91d1\u989d") !== "";
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
  const collection: CollectionRow[] = MATERIALS.map((name) => {
    const completed = reconciled.filter((row) => cell(row, headers, name) !== "").length;
    const pending = regions
      .map((region) => {
        const regional = reconciled.filter(
          (row) => (cell(row, headers, "\u533a\u57df") || "\u672a\u586b\u5199") === region,
        );
        const collected = regional.filter((row) => cell(row, headers, name) !== "").length;
        const rate = regional.length ? (collected / regional.length) * 100 : 0;
        return rate < 100 ? `${region}${rate.toFixed(0)}%` : "";
      })
      .filter(Boolean)
      .join("\u3001");
    return { name, completed, total: reconciled.length, pending: pending || "\u5176\u4ed6\u533a\u57df100%" };
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
          <p>{quarter} \u4e13\u9879\u7ba1\u7406\u4fe1\u606f</p>
          <h2>\u8d44\u6599\u6536\u96c6\u3001\u4e22\u7968\u4e0e\u672a\u5bf9\u8d26\u5ba2\u6237</h2>
        </div>
        <div className="special-tabs">
          <button className={tab === "collection" ? "active" : ""} onClick={() => setTab("collection")}>\u8d44\u6599\u6536\u96c6</button>
          <button className={tab === "lost" ? "active" : ""} onClick={() => setTab("lost")}>\u4e22\u7968\u60c5\u51b5</button>
          <button className={tab === "unaccounted" ? "active" : ""} onClick={() => setTab("unaccounted")}>\u672a\u5bf9\u8d26\u5ba2\u6237</button>
        </div>
      </div>
      {tab === "collection" ? (
        <table>
          <thead><tr><th>\u8d44\u6599\u7c7b\u578b</th><th>\u5df2\u6536\u96c6 / \u5e94\u6536\u96c6</th><th>\u9700\u8ddf\u8fdb\u533a\u57df\u4e0e\u6536\u96c6\u7387</th></tr></thead>
          <tbody>{data.collection.map((item) => <tr key={item.name}><td>{item.name}</td><td>{item.completed} / {item.total} ({item.total ? ((item.completed / item.total) * 100).toFixed(1) : "0.0"}%)</td><td>{item.pending}</td></tr>)}</tbody>
        </table>
      ) : tab === "lost" ? (
        <div className="loss-list">{data.lost.length ? data.lost.map((item) => <article key={`${item.region}-${item.customer}`}><b>{item.region}\uff1a{item.customer}</b><span>\u4e22\u7968\u91d1\u989d {money(item.amount)} \u5143{item.note ? `\uff1b${item.note}` : ""}</span></article>) : <p className="special-empty">\u5f53\u524d\u5b63\u5ea6\u6682\u65e0\u4e22\u7968\u5dee\u989d\u660e\u7ec6\u3002</p>}</div>
      ) : (
        <table>
          <thead><tr><th>\u533a\u57df</th><th>\u5ba2\u6237</th><th>\u5dee\u989d\u539f\u56e0\u5907\u6ce8</th></tr></thead>
          <tbody>{data.unaccounted.length ? data.unaccounted.map((item) => <tr key={`${item.region}-${item.customer}`}><td>{item.region}</td><td>{item.customer}</td><td>{item.note || "\u2014"}</td></tr>) : <tr><td colSpan={3}>\u5f53\u524d\u5b63\u5ea6\u6682\u65e0\u672a\u5bf9\u8d26\u5ba2\u6237\u3002</td></tr>}</tbody>
        </table>
      )}
    </section>
  );
}
