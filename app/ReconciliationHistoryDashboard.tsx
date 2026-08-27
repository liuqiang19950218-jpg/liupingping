"use client";

import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import { moneyToCents, useAllDashboardQuarterRows, useDashboardData } from "./dashboard-postgres-data";
import type { Reconciliation } from "../lib/api/reconciliation-api";
import "./history-dashboard.css";
import "./history-dashboard-extra.css";

type TrendDataItem = { quarter: string; unreconciledCustomers: number; reconciliationRate: number };
type RegionReconciliationItem = { region: string; totalCustomers: number; reconciledCustomers: number; unreconciledCustomers: number; reconciliationRate: number; order: number };
const calculateRate = (reconciled: number, total: number) => total ? Number(((reconciled / total) * 100).toFixed(1)) : 0;

const rowsToRegions = (rows: Reconciliation[]) => {
  const aggregate = new Map<string, RegionReconciliationItem>();
  rows.filter((row) => moneyToCents(row.customerBookAmount) !== null).forEach((row) => {
    const key = row.region || "未填写";
    const current = aggregate.get(key) ?? { region: key, totalCustomers: 0, reconciledCustomers: 0, unreconciledCustomers: 0, reconciliationRate: 0, order: aggregate.size };
    current.totalCustomers += 1;
    if (row.reconciliationStatus === "对清") current.reconciledCustomers += 1;
    else current.unreconciledCustomers += 1;
    aggregate.set(key, current);
  });
  return [...aggregate.values()].map((item) => ({ ...item, reconciliationRate: calculateRate(item.reconciledCustomers, item.totalCustomers) }));
};

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
      tooltip: { trigger: "axis", backgroundColor: "#fff", borderColor: "#dfe7f1", borderWidth: 1, textStyle: { color: "#34425e", fontSize: 13 }, formatter: (params: Array<{ axisValue: string; seriesName: string; value: number }>) => `${params[0]?.axisValue ?? ""}<br/>${params.map((item) => `${item.seriesName}：${item.seriesName === "未对清客户数" ? `${item.value}户` : `${item.value.toFixed(1)}%`}`).join("<br/>")}` },
      legend: { top: 2, left: "center", itemWidth: 14, itemHeight: 10, itemGap: 44, textStyle: { color: "#34425e", fontSize: 14 } },
      grid: { left: 54, right: 54, top: 64, bottom: 48 },
      xAxis: { type: "category", data: data.map((item) => item.quarter), axisTick: { show: false }, axisLine: { lineStyle: { color: "#d7dee9" } }, axisLabel: { color: "#34425e", fontSize: 13, margin: 16, formatter: (value: string) => value === currentQuarter ? `${value}\n{current|当前}` : value, rich: { current: { color: "#fff", backgroundColor: "#1267f4", padding: [3, 6], borderRadius: 4, fontSize: 11, lineHeight: 26 } } } },
      yAxis: [{ type: "value", name: "户", min: 0, max: customerAxisMax, interval: Math.max(1, customerAxisMax / 4), nameTextStyle: { color: "#71809a", fontSize: 12, padding: [0, 0, 0, -4] }, axisLabel: { color: "#71809a", fontSize: 12 }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: "#e4eaf3", type: "dashed" } } }, { type: "value", name: "对清率（%）", min: 0, max: 100, interval: 25, nameTextStyle: { color: "#71809a", fontSize: 12 }, axisLabel: { color: "#71809a", fontSize: 12, formatter: "{value}%" }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false } }],
      series: [{ name: "未对清客户数", type: "bar", yAxisIndex: 0, data: data.map((item) => item.unreconciledCustomers), barWidth: 32, itemStyle: { color: "#1267f4", borderRadius: [5, 5, 0, 0] }, label: { show: true, position: "top", color: "#18243b", fontSize: 13, fontWeight: 600 } }, { name: "对清率", type: "line", yAxisIndex: 1, data: data.map((item) => item.reconciliationRate), symbol: "circle", symbolSize: 8, lineStyle: { width: 3, color: "#ff7a1a" }, itemStyle: { color: "#ff7a1a", borderColor: "#fff", borderWidth: 2 }, label: { show: true, position: "top", formatter: "{c}%", color: "#ff7a1a", fontSize: 13, fontWeight: 700 }, z: 3 }],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [currentQuarter, data]);
  return <div className="history-combo-chart" ref={host} aria-label="未对清客户数柱状图与对清率折线图" />;
}

export function ReconciliationHistoryDashboard() {
  const { quarters, quarter, selectQuarter } = useDashboardData();
  const { rowsByQuarter, loading, error } = useAllDashboardQuarterRows();
  const { trend, regionByQuarter } = useMemo(() => {
    const regions = new Map<string, RegionReconciliationItem[]>();
    const nextTrend = quarters.map((item) => {
      const value = rowsToRegions(rowsByQuarter[item.code] ?? []);
      regions.set(item.code, value);
      const total = value.reduce((sum, region) => sum + region.totalCustomers, 0);
      const clear = value.reduce((sum, region) => sum + region.reconciledCustomers, 0);
      return { quarter: item.label, unreconciledCustomers: total - clear, reconciliationRate: calculateRate(clear, total) };
    }).reverse();
    return { trend: nextTrend, regionByQuarter: regions };
  }, [quarters, rowsByQuarter]);
  const activeCode = quarter?.code ?? "";
  const regionalRows = [...(regionByQuarter.get(activeCode) ?? [])].sort((left, right) => right.unreconciledCustomers - left.unreconciledCustomers || left.reconciliationRate - right.reconciliationRate || left.order - right.order);
  const summary = regionalRows.reduce((total, item) => ({ total: total.total + item.totalCustomers, clear: total.clear + item.reconciledCustomers }), { total: 0, clear: 0 });
  const currentTrend = trend.find((item) => item.quarter === quarter?.label) ?? trend.at(-1);
  const firstTrend = trend[0];
  const previousTrend = trend.length > 1 ? trend.at(-2) : undefined;
  const historicalDrop = currentTrend && firstTrend ? firstTrend.unreconciledCustomers - currentTrend.unreconciledCustomers : 0;
  const quarterlyChange = currentTrend && previousTrend ? currentTrend.unreconciledCustomers - previousTrend.unreconciledCustomers : 0;
  if (loading) return <section className="history-dashboard" aria-busy="true"><p className="history-empty">正在读取 PostgreSQL 历史季度数据…</p></section>;
  if (error) return <section className="history-dashboard dashboard-data-error" role="alert"><p className="history-empty">历史对账趋势读取失败：{error}</p></section>;
  if (!trend.length) return <section className="history-dashboard"><p className="history-empty">PostgreSQL 暂无历史对账趋势数据</p></section>;
  return <section className="history-dashboard" aria-label="历史对账情况">
    <article className="history-card history-trend-card"><header className="history-card-header"><div className="history-title"><span className="history-icon">⌁</span><h2>未对清风险趋势</h2></div><div className="history-tags"><span className="down">↓ 较{firstTrend?.quarter}减少{Math.abs(historicalDrop)}户</span><span className={quarterlyChange > 0 ? "up" : "down"}>{quarterlyChange > 0 ? "↑" : "↓"} 较上季度{quarterlyChange > 0 ? "增加" : "减少"}{Math.abs(quarterlyChange)}户</span><span className="stable">✓ 对清率保持{Math.round(currentTrend?.reconciliationRate ?? 0)}%</span></div></header><UnreconciledRiskChart data={trend} currentQuarter={quarter?.label ?? ""} /></article>
    <article className="history-card history-region-card"><header className="history-card-header"><div className="history-title"><span className="history-icon">▦</span><h2>各区域对清情况</h2></div><label className="history-quarter-select">季度<select value={activeCode} onChange={(event) => selectQuarter(event.target.value)} aria-label="选择区域对清季度">{quarters.map((item) => <option value={item.code} key={item.code}>{item.label}</option>)}</select></label></header>{regionalRows.length ? <><p className="history-summary">{quarter?.label}：对账客户 <b>{summary.total}</b> 户，已对清 <b>{summary.clear}</b> 户，未对清 <b>{summary.total - summary.clear}</b> 户，对清率 <strong>{calculateRate(summary.clear, summary.total).toFixed(1)}%</strong></p><div className="history-table"><table><thead><tr><th scope="col">区域</th><th scope="col">对账客户</th><th scope="col">已对清</th><th scope="col">未对清</th><th scope="col">对清率</th></tr></thead><tbody>{regionalRows.map((item) => <tr key={item.region}><td>{item.region}</td><td>{item.totalCustomers}</td><td>{item.reconciledCustomers}</td><td className={item.unreconciledCustomers ? "warn" : ""}>{item.unreconciledCustomers}</td><td className="rate">{item.reconciliationRate.toFixed(1)}%</td></tr>)}</tbody></table></div></> : <p className="history-empty">当前季度暂无区域对账数据</p>}</article>
  </section>;
}
