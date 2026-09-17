"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { formatHistoricalTrendTooltip, historicalTrend, latestHistoricalPeriod, normalizeHistoricalSettlementPeriods } from "../lib/historical-settlement-dashboard.mjs";
import { useDashboardData } from "./dashboard-postgres-data";
import { isSettled, isUnsettled, settlementRate } from "../lib/reconciliation-settlement-status.mjs";
import "./history-dashboard.css";
import "./history-dashboard-extra.css";

type TrendDataItem = { quarter: string; unsettledCustomers: number; reconciliationRate: number };
type HistoricalPeriod = {
  year: number;
  quarter: number;
  label: string;
  total: { customerTotal: number; settledCount: number; unsettledCount: number | null; settlementRate: number };
  regions: Array<{ region: string; customerTotal: number; settledCount: number; unsettledCount: number; settlementRate: number; sourceRow: number }>;
};

function UnreconciledRiskChart({ data, currentQuarter }: { data: TrendDataItem[]; currentQuarter: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element || !data.length) return;
    const chart = echarts.init(element);
    const maxCustomers = Math.max(...data.map((item) => item.unsettledCustomers));
    const customerAxisMax = Math.max(5, Math.ceil((maxCustomers + 2) / 5) * 5);
    const dense = data.length > 7;
    chart.setOption({
      animationDuration: 260,
      tooltip: { trigger: "axis", backgroundColor: "#fff", borderColor: "#dfe7f1", borderWidth: 1, textStyle: { color: "#34425e", fontSize: 13 }, formatter: formatHistoricalTrendTooltip },
      legend: { top: 2, left: "center", itemWidth: 14, itemHeight: 10, itemGap: 44, textStyle: { color: "#34425e", fontSize: 14 } },
      grid: { left: 54, right: 54, top: 64, bottom: 48 },
      xAxis: { type: "category", data: data.map((item) => item.quarter), axisTick: { show: false }, axisLine: { lineStyle: { color: "#d7dee9" } }, axisLabel: { interval: 0, color: "#34425e", fontSize: dense ? 11 : 13, margin: 16, formatter: (value: string) => value === currentQuarter ? `${value}\n{current|当前}` : value, rich: { current: { color: "#fff", backgroundColor: "#1267f4", padding: [3, 6], borderRadius: 4, fontSize: 11, lineHeight: 26 } } } },
      yAxis: [
        { type: "value", name: "户", min: 0, max: customerAxisMax, interval: Math.max(1, customerAxisMax / 4), nameTextStyle: { color: "#71809a", fontSize: 12, padding: [0, 0, 0, -4] }, axisLabel: { color: "#71809a", fontSize: 12 }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: "#e4eaf3", type: "dashed" } } },
        { type: "value", name: "对清率（%）", min: 0, max: 100, interval: 25, nameTextStyle: { color: "#71809a", fontSize: 12 }, axisLabel: { color: "#71809a", fontSize: 12, formatter: "{value}%" }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false } },
      ],
      series: [
        { name: "未对清客户数", type: "bar", yAxisIndex: 0, data: data.map((item) => item.unsettledCustomers), barWidth: dense ? 22 : 32, barGap: "28%", itemStyle: { color: "#1267f4", borderRadius: [5, 5, 0, 0] }, label: { show: true, position: "top", color: "#18243b", fontSize: dense ? 11 : 13, fontWeight: 600 } },
        { name: "对清率", type: "line", yAxisIndex: 1, data: data.map((item) => item.reconciliationRate), symbol: "circle", symbolSize: 8, lineStyle: { width: 3, color: "#ff7a1a" }, itemStyle: { color: "#ff7a1a", borderColor: "#fff", borderWidth: 2 }, label: { show: true, position: "top", formatter: ({ value }: { value: number }) => `${value.toFixed(1)}%`, color: "#ff7a1a", fontSize: 13, fontWeight: 700 }, z: 3 },
      ],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [currentQuarter, data]);
  return <div className="history-combo-chart" ref={host} aria-label="历史未对清客户数柱状图与对清率折线图" />;
}

export function ReconciliationHistoryDashboard() {
  const { quarter, rows } = useDashboardData();
  const [periods, setPeriods] = useState<HistoricalPeriod[]>([]);
  const [activeLabel, setActiveLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        setLoading(true); setError("");
        const response = await fetch("/api/historical-settlement-snapshots", { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || "历史季度快照读取失败");
        const nextPeriods = normalizeHistoricalSettlementPeriods(payload);
        setPeriods(nextPeriods);
        setActiveLabel(latestHistoricalPeriod(nextPeriods)?.label ?? "");
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "历史季度快照读取失败");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  const historicalLatest = latestHistoricalPeriod(periods);
  const realtimeTrend = useMemo(() => {
    if (!quarter || !rows.length) return null;
    const accounted = rows.filter((row) => isSettled(row) || isUnsettled(row));
    const settled = accounted.filter(isSettled).length;
    return {
      year: quarter.year,
      quarterNumber: quarter.quarter,
      trend: {
        quarter: quarter.label,
        unsettledCustomers: accounted.length - settled,
        reconciliationRate: settlementRate({ settled, unsettled: accounted.length - settled }),
      },
    };
  }, [quarter, rows]);
  const trend = useMemo(() => {
    const historical = historicalTrend(periods);
    if (!historicalLatest || !realtimeTrend) return historical;
    const isLaterThanSnapshot = realtimeTrend.year > historicalLatest.year
      || (realtimeTrend.year === historicalLatest.year && realtimeTrend.quarterNumber > historicalLatest.quarter);
    return isLaterThanSnapshot ? [...historical, realtimeTrend.trend] : historical;
  }, [historicalLatest, periods, realtimeTrend]);
  const activePeriod = periods.find((period) => period.label === activeLabel) ?? latestHistoricalPeriod(periods);
  const latest = latestHistoricalPeriod(periods);
  const previous = periods.length > 1 ? periods.at(-2) : null;
  const unsettledDelta = latest && previous ? (latest.total.unsettledCount ?? 0) - (previous.total.unsettledCount ?? 0) : 0;
  const rateDelta = latest && previous ? (latest.total.settlementRate - previous.total.settlementRate) * 100 : 0;

  if (loading) return <section className="history-dashboard" aria-busy="true"><p className="history-empty">正在读取 PostgreSQL 历史季度快照…</p></section>;
  if (error) return <section className="history-dashboard dashboard-data-error" role="alert"><p className="history-empty">历史季度快照读取失败：{error}</p></section>;
  if (!periods.length || !activePeriod) return <section className="history-dashboard"><p className="history-empty">暂无已封存的历史季度快照</p></section>;
  return <section className="history-dashboard" aria-label="历史对账情况">
    <article className="history-card history-trend-card"><header className="history-card-header"><div className="history-title"><span className="history-icon">⌁</span><h2>历史季度对清趋势</h2></div><div className="history-tags"><span className={unsettledDelta > 0 ? "up" : "down"}>{unsettledDelta > 0 ? "↑" : "↓"} 较上季度{unsettledDelta > 0 ? "增加" : "减少"}{Math.abs(unsettledDelta)}户</span><span className={rateDelta >= 0 ? "stable" : "down"}>✓ 较上季度 {rateDelta >= 0 ? "+" : ""}{rateDelta.toFixed(2)}个百分点</span></div></header><UnreconciledRiskChart data={trend} currentQuarter={realtimeTrend?.trend.quarter ?? latest?.label ?? ""} /></article>
    <article className="history-card history-region-card"><header className="history-card-header"><div className="history-title"><span className="history-icon">▦</span><h2>历史各区域对清情况</h2></div><label className="history-quarter-select">季度<select value={activePeriod.label} onChange={(event) => setActiveLabel(event.target.value)} aria-label="选择历史区域对清季度">{periods.map((period) => <option value={period.label} key={period.label}>{period.label}</option>)}</select></label></header><p className="history-summary">{activePeriod.label}：对账客户 <b>{activePeriod.total.customerTotal}</b> 户，已对清 <b>{activePeriod.total.settledCount}</b> 户，未对清 <b>{activePeriod.total.unsettledCount ?? 0}</b> 户，对清率 <strong>{(activePeriod.total.settlementRate * 100).toFixed(1)}%</strong></p><div className="history-table"><table><thead><tr><th scope="col">区域</th><th scope="col">对账客户</th><th scope="col">已对清</th><th scope="col">未对清</th><th scope="col">对清率</th></tr></thead><tbody>{activePeriod.regions.map((item) => <tr key={`${activePeriod.label}-${item.sourceRow}`}><td>{item.region}</td><td>{item.customerTotal}</td><td>{item.settledCount}</td><td className={item.unsettledCount ? "warn" : ""}>{item.unsettledCount}</td><td className="rate">{(item.settlementRate * 100).toFixed(1)}%</td></tr>)}</tbody></table></div></article>
  </section>;
}
