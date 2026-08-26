"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { latestQuarterlyCockpitRows, type CockpitRow } from "./cockpit-data";
import { quarterOptions, selectQuarter, selectedQuarter } from "./quarter-storage";
import "./history-dashboard.css";
import "./history-dashboard-extra.css";

type TrendDataItem = {
  quarter: string;
  unreconciledCustomers: number;
  reconciliationRate: number;
};

type RegionReconciliationItem = {
  region: string;
  totalCustomers: number;
  reconciledCustomers: number;
  unreconciledCustomers: number;
  reconciliationRate: number;
  order: number;
};

// These are the previously retained historical board figures. They are used only
// for quarters for which an archived quarterly detail sheet has not been imported.
const legacyTrend: TrendDataItem[] = [
  { quarter: "2024 Q3", unreconciledCustomers: 17, reconciliationRate: 97 },
  { quarter: "2024 Q4", unreconciledCustomers: 15, reconciliationRate: 98 },
  { quarter: "2025 Q1", unreconciledCustomers: 14, reconciliationRate: 98 },
  { quarter: "2025 Q2", unreconciledCustomers: 14, reconciliationRate: 98 },
  { quarter: "2025 Q3", unreconciledCustomers: 11, reconciliationRate: 98 },
  { quarter: "2025 Q4", unreconciledCustomers: 5, reconciliationRate: 99 },
  { quarter: "2026 Q1", unreconciledCustomers: 6, reconciliationRate: 99 },
];

const legacyRegions: Record<string, Array<[string, number, number, number]>> = {
  "2024 Q3": [["常州", 25, 25, 0], ["淮安", 18, 18, 0], ["连云港", 14, 14, 0], ["南京", 88, 83, 5], ["南通", 88, 83, 5], ["苏州", 176, 171, 5], ["宿迁", 4, 4, 0], ["泰州", 18, 17, 1], ["无锡", 96, 96, 0], ["徐州", 23, 23, 0], ["血站", 28, 27, 1], ["盐城", 38, 38, 0], ["扬州", 20, 20, 0], ["镇江", 19, 19, 0]],
  "2024 Q4": [["常州", 25, 25, 0], ["淮安", 18, 18, 0], ["疾控", 2, 2, 0], ["连云港", 14, 14, 0], ["南京", 91, 85, 6], ["南通", 87, 84, 3], ["苏州", 169, 166, 3], ["宿迁", 8, 8, 0], ["泰州", 16, 16, 0], ["无锡", 102, 99, 3], ["徐州", 27, 27, 0], ["血站", 19, 19, 0], ["盐城", 31, 31, 0], ["扬州", 19, 19, 0], ["镇江", 20, 20, 0]],
  "2025 Q1": [["常州", 28, 28, 0], ["淮安", 23, 23, 0], ["疾控", 2, 2, 0], ["连云港", 12, 12, 0], ["南京", 96, 93, 3], ["南通", 83, 78, 5], ["苏州", 158, 152, 6], ["宿迁", 9, 9, 0], ["泰州", 14, 14, 0], ["无锡", 101, 101, 0], ["徐州", 26, 26, 0], ["血站", 20, 20, 0], ["盐城", 31, 31, 0], ["扬州", 20, 20, 0], ["镇江", 20, 20, 0]],
  "2025 Q2": [["常州", 28, 28, 0], ["淮安", 25, 25, 0], ["疾控", 2, 2, 0], ["连云港", 13, 13, 0], ["南京", 108, 104, 4], ["南通", 91, 87, 4], ["苏州", 174, 171, 3], ["宿迁", 12, 12, 0], ["泰州", 15, 14, 1], ["无锡", 101, 101, 0], ["徐州", 24, 24, 0], ["血站", 25, 25, 0], ["盐城", 37, 37, 0], ["扬州", 21, 19, 2], ["镇江", 22, 22, 0]],
  "2025 Q3": [["常州", 28, 28, 0], ["淮安", 27, 27, 0], ["连云港", 14, 14, 0], ["南京", 119, 116, 3], ["南通", 98, 94, 4], ["苏州", 168, 168, 0], ["宿迁", 10, 10, 0], ["泰州", 14, 14, 0], ["无锡", 93, 92, 1], ["徐州", 20, 20, 0], ["血站", 25, 24, 1], ["盐城", 37, 37, 0], ["扬州", 22, 20, 2], ["镇江", 18, 18, 0]],
  "2025 Q4": [["常州", 32, 32, 0], ["淮安", 27, 27, 0], ["连云港", 13, 13, 0], ["南京", 120, 119, 1], ["南通", 101, 98, 2], ["苏州", 164, 164, 0], ["宿迁", 10, 10, 0], ["泰州", 16, 15, 1], ["无锡", 95, 95, 0], ["徐州", 27, 27, 0], ["血站", 29, 29, 0], ["盐城", 37, 37, 0], ["扬州", 23, 22, 1], ["镇江", 19, 19, 0]],
  "2026 Q1": [["常州", 36, 36, 0], ["淮安", 29, 29, 0], ["连云港", 14, 14, 0], ["南京", 117, 115, 2], ["南通", 108, 107, 1], ["苏州", 169, 169, 0], ["宿迁", 12, 12, 0], ["泰州", 18, 17, 1], ["无锡", 101, 100, 1], ["徐州", 23, 23, 0], ["血站", 24, 24, 0], ["盐城", 33, 33, 0], ["扬州", 24, 23, 1], ["镇江", 20, 20, 0]],
};

const compareQuarters = (left: string, right: string) => left.localeCompare(right, "zh-CN", { numeric: true });
const calculateRate = (reconciled: number, total: number) => total ? Number(((reconciled / total) * 100).toFixed(1)) : 0;

const rowsToRegions = (rows: CockpitRow[]) => {
  const aggregate = new Map<string, RegionReconciliationItem>();
  rows.filter((row) => row.filled).forEach((row) => {
    const key = row.region || "未填写";
    const current = aggregate.get(key) ?? { region: key, totalCustomers: 0, reconciledCustomers: 0, unreconciledCustomers: 0, reconciliationRate: 0, order: aggregate.size };
    current.totalCustomers += 1;
    if (row.cleared) current.reconciledCustomers += 1;
    else current.unreconciledCustomers += 1;
    aggregate.set(key, current);
  });
  return [...aggregate.values()].map((item) => ({ ...item, reconciliationRate: calculateRate(item.reconciledCustomers, item.totalCustomers) }));
};

const fallbackRegionsFor = (quarter: string) => (legacyRegions[quarter] ?? []).map(([region, totalCustomers, reconciledCustomers, unreconciledCustomers], order) => ({
  region, totalCustomers, reconciledCustomers, unreconciledCustomers,
  reconciliationRate: calculateRate(reconciledCustomers, totalCustomers), order,
}));

function UnreconciledRiskChart({ data, currentQuarter }: { data: TrendDataItem[]; currentQuarter: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element || !data.length) return;
    const chart = echarts.init(element);
    const maxCustomers = Math.max(...data.map((item) => item.unreconciledCustomers));
    const customerAxisMax = Math.max(5, Math.ceil((maxCustomers + 2) / 5) * 5);
    chart.setOption({
      animationDuration: 260,
      tooltip: {
        trigger: "axis",
        backgroundColor: "#fff",
        borderColor: "#dfe7f1",
        borderWidth: 1,
        textStyle: { color: "#34425e", fontSize: 13 },
        formatter: (params: Array<{ axisValue: string; seriesName: string; value: number }>) => `${params[0]?.axisValue ?? ""}<br/>${params.map((item) => `${item.seriesName}：${item.seriesName === "未对清客户数" ? `${item.value}户` : `${item.value.toFixed(1)}%`}`).join("<br/>")}`,
      },
      legend: { top: 2, left: "center", itemWidth: 14, itemHeight: 10, itemGap: 44, textStyle: { color: "#34425e", fontSize: 14 } },
      grid: { left: 54, right: 54, top: 64, bottom: 48 },
      xAxis: {
        type: "category", data: data.map((item) => item.quarter), axisTick: { show: false }, axisLine: { lineStyle: { color: "#d7dee9" } },
        axisLabel: { color: "#34425e", fontSize: 13, margin: 16, formatter: (value: string) => value === currentQuarter ? `${value}\n{current|当前}` : value, rich: { current: { color: "#fff", backgroundColor: "#1267f4", padding: [3, 6], borderRadius: 4, fontSize: 11, lineHeight: 26 } },
      },
      },
      yAxis: [
        { type: "value", name: "户", min: 0, max: customerAxisMax, interval: Math.max(1, customerAxisMax / 4), nameTextStyle: { color: "#71809a", fontSize: 12, padding: [0, 0, 0, -4] }, axisLabel: { color: "#71809a", fontSize: 12 }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: "#e4eaf3", type: "dashed" } } },
        { type: "value", name: "对清率（%）", min: 90, max: 100, interval: 5, nameTextStyle: { color: "#71809a", fontSize: 12 }, axisLabel: { color: "#71809a", fontSize: 12, formatter: "{value}%" }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false } },
      ],
      series: [
        { name: "未对清客户数", type: "bar", yAxisIndex: 0, data: data.map((item) => item.unreconciledCustomers), barWidth: 32, itemStyle: { color: "#1267f4", borderRadius: [5, 5, 0, 0] }, label: { show: true, position: "top", color: "#18243b", fontSize: 13, fontWeight: 600 } },
        { name: "对清率", type: "line", yAxisIndex: 1, data: data.map((item) => item.reconciliationRate), symbol: "circle", symbolSize: 8, lineStyle: { width: 3, color: "#ff7a1a" }, itemStyle: { color: "#ff7a1a", borderColor: "#fff", borderWidth: 2 }, label: { show: true, position: "top", formatter: "{c}%", color: "#ff7a1a", fontSize: 13, fontWeight: 700 }, z: 3 },
      ],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [currentQuarter, data]);
  return <div className="history-combo-chart" ref={host} aria-label="未对清客户数柱状图与对清率折线图" />;
}

export function ReconciliationHistoryDashboard() {
  const [selected, setSelected] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  useEffect(() => {
    const sync = () => { setSelected(selectedQuarter()); setRefreshToken((value) => value + 1); };
    sync();
    window.addEventListener("reconciliation-quarter-selected", sync);
    window.addEventListener("reconciliation-quarter-updated", sync);
    window.addEventListener("reconciliation-updated", sync);
    return () => { window.removeEventListener("reconciliation-quarter-selected", sync); window.removeEventListener("reconciliation-quarter-updated", sync); window.removeEventListener("reconciliation-updated", sync); };
  }, []);

  const { trend, regionByQuarter, options } = useMemo(() => {
    const liveRows = latestQuarterlyCockpitRows();
    const byQuarter = new Map<string, CockpitRow[]>();
    liveRows.forEach((row) => byQuarter.set(row.quarter, [...(byQuarter.get(row.quarter) ?? []), row]));
    const knownQuarters = new Set([...legacyTrend.map((item) => item.quarter), ...byQuarter.keys(), ...quarterOptions()]);
    const optionList = [...knownQuarters].sort(compareQuarters);
    const regionMap = new Map<string, RegionReconciliationItem[]>();
    const derivedTrend = optionList.map((quarter) => {
      const realRegions = rowsToRegions(byQuarter.get(quarter) ?? []);
      const regions = realRegions.length ? realRegions : fallbackRegionsFor(quarter);
      regionMap.set(quarter, regions);
      const total = regions.reduce((sum, item) => sum + item.totalCustomers, 0);
      const cleared = regions.reduce((sum, item) => sum + item.reconciledCustomers, 0);
      const fallback = legacyTrend.find((item) => item.quarter === quarter);
      return regions.length ? { quarter, unreconciledCustomers: total - cleared, reconciliationRate: calculateRate(cleared, total) } : fallback ?? { quarter, unreconciledCustomers: 0, reconciliationRate: 0 };
    });
    return { trend: derivedTrend, regionByQuarter: regionMap, options: optionList };
  }, [refreshToken]);

  const activeQuarter = selected && options.includes(selected) ? selected : options.at(-1) ?? "";
  const regionalRows = useMemo(() => [...(regionByQuarter.get(activeQuarter) ?? [])].sort((left, right) => right.unreconciledCustomers - left.unreconciledCustomers || left.reconciliationRate - right.reconciliationRate || left.order - right.order), [activeQuarter, regionByQuarter]);
  const summary = useMemo(() => {
    const total = regionalRows.reduce((sum, item) => sum + item.totalCustomers, 0);
    const cleared = regionalRows.reduce((sum, item) => sum + item.reconciledCustomers, 0);
    return { total, cleared, unreconciled: total - cleared, rate: calculateRate(cleared, total) };
  }, [regionalRows]);
  const currentTrend = trend.find((item) => item.quarter === activeQuarter) ?? trend.at(-1);
  const firstTrend = trend[0];
  const previousTrend = trend.length > 1 ? trend.at(-2) : undefined;
  const historicalDrop = currentTrend && firstTrend ? firstTrend.unreconciledCustomers - currentTrend.unreconciledCustomers : 0;
  const quarterlyChange = currentTrend && previousTrend ? currentTrend.unreconciledCustomers - previousTrend.unreconciledCustomers : 0;

  if (!trend.length) return <section className="history-dashboard"><p className="history-empty">暂无历史对账趋势数据</p></section>;
  return <section className="history-dashboard" aria-label="历史对账情况">
    <article className="history-card history-trend-card">
      <header className="history-card-header"><div className="history-title"><span className="history-icon">⌁</span><h2>未对清风险趋势</h2></div><div className="history-tags"><span className="down">↓ 较{firstTrend?.quarter}减少{Math.abs(historicalDrop)}户</span><span className={quarterlyChange > 0 ? "up" : "down"}>{quarterlyChange > 0 ? "↑" : "↓"} 较上季度{quarterlyChange > 0 ? "增加" : "减少"}{Math.abs(quarterlyChange)}户</span><span className="stable">✓ 对清率保持{Math.round(currentTrend?.reconciliationRate ?? 0)}%</span></div></header>
      <UnreconciledRiskChart data={trend} currentQuarter={activeQuarter} />
    </article>
    <article className="history-card history-region-card">
      <header className="history-card-header"><div className="history-title"><span className="history-icon">▦</span><h2>各区域对清情况</h2></div><label className="history-quarter-select">季度<select value={activeQuarter} onChange={(event) => { setSelected(event.target.value); if (quarterOptions().includes(event.target.value)) selectQuarter(event.target.value); }} aria-label="选择区域对清季度">{options.map((quarter) => <option value={quarter} key={quarter}>{quarter}</option>)}</select></label></header>
      {regionalRows.length ? <><p className="history-summary">{activeQuarter}：对账客户 <b>{summary.total}</b> 户，已对清 <b>{summary.cleared}</b> 户，未对清 <b>{summary.unreconciled}</b> 户，对清率 <strong>{summary.rate.toFixed(1)}%</strong></p><div className="history-table"><table><thead><tr><th scope="col">区域</th><th scope="col">对账客户</th><th scope="col">已对清</th><th scope="col">未对清</th><th scope="col">对清率</th></tr></thead><tbody>{regionalRows.map((item) => <tr key={item.region}><td>{item.region}</td><td>{item.totalCustomers}</td><td>{item.reconciledCustomers}</td><td className={item.unreconciledCustomers ? "warn" : ""}>{item.unreconciledCustomers}</td><td className="rate">{item.reconciliationRate.toFixed(1)}%</td></tr>)}</tbody></table></div></> : <p className="history-empty">暂无区域对账数据</p>}
    </article>
  </section>;
}
