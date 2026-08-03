"use client";

import { useEffect, useRef, type RefObject } from "react";
import * as echarts from "echarts";
import type { AgeItem, CountItem, StageItem } from "./problem-dashboard-data";

type ChartProps<T> = { data: T[]; onSelect: (name: string) => void };

function useChart(
  host: RefObject<HTMLDivElement | null>,
  option: echarts.EChartsOption,
  onSelect: (name: string) => void,
) {
  useEffect(() => {
    if (!host.current) return;
    const chart = echarts.init(host.current);
    chart.setOption(option);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(host.current);
    chart.on("click", (params) => typeof params.name === "string" && onSelect(params.name));
    return () => { observer.disconnect(); chart.dispose(); };
  }, [host, onSelect, option]);
}

export function IssueStageFunnelChart({ data, onSelect }: ChartProps<StageItem>) {
  const host = useRef<HTMLDivElement>(null);
  useChart(host, {
    tooltip: { trigger: "item", formatter: (p: { name: string; value: number; percent: number }) => `${p.name}<br/>问题数：${p.value}<br/>占比：${p.percent}%` },
    series: [{ type: "funnel", left: "16%", top: 8, bottom: 8, width: "68%", min: 0, max: Math.max(1, ...data.map((item) => item.count)), minSize: "28%", maxSize: "100%", sort: "none", gap: 2, label: { show: true, position: "inside", color: "#fff", fontSize: 10, formatter: "{c}" }, labelLine: { show: false }, itemStyle: { borderColor: "#fff", borderWidth: 2 }, data: data.map((item) => ({ name: item.name, value: item.count, itemStyle: { color: item.color } })) }],
  }, onSelect);
  return <div className="pd-chart pd-funnel-chart" ref={host} role="img" aria-label="问题处理阶段分布漏斗图" />;
}

export function BlockingReasonDonutChart({ data, total, onSelect }: ChartProps<CountItem> & { total: number }) {
  const host = useRef<HTMLDivElement>(null);
  useChart(host, {
    tooltip: { trigger: "item", formatter: (p: { name: string; value: number; percent: number }) => `${p.name}<br/>问题数：${p.value}<br/>占比：${p.percent}%` },
    graphic: [{ type: "text", left: "center", top: "41%", style: { text: String(total), fill: "#17233d", font: "700 22px Microsoft YaHei", textAlign: "center" } }, { type: "text", left: "center", top: "57%", style: { text: "未关闭问题", fill: "#64748b", font: "11px Microsoft YaHei", textAlign: "center" } }],
    series: [{ type: "pie", radius: ["56%", "78%"], center: ["50%", "50%"], label: { show: false }, itemStyle: { borderColor: "#fff", borderWidth: 3 }, data: data.map((item) => ({ name: item.name, value: item.count, itemStyle: { color: item.color } })) }],
  }, onSelect);
  return <div className="pd-chart pd-donut-chart" ref={host} role="img" aria-label="阻塞原因分析环形图" />;
}

export function IssueAgeBarChart({ data, onSelect }: ChartProps<AgeItem>) {
  const host = useRef<HTMLDivElement>(null);
  useChart(host, {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (items: Array<{ dataIndex: number }>) => { const item = data[items[0]?.dataIndex ?? 0]; return `${item.name}<br/>问题数：${item.count}<br/>占比：${(item.ratio * 100).toFixed(1)}%`; } },
    grid: { left: 36, right: 10, top: 26, bottom: 44 },
    xAxis: { type: "category", data: data.map((item) => item.name), axisTick: { show: false }, axisLine: { lineStyle: { color: "#dfe7f1" } }, axisLabel: { interval: 0, fontSize: 10, lineHeight: 15, color: "#64748b", formatter: (value: string, index: number) => `${value}\n(${(data[index]?.ratio * 100 || 0).toFixed(1)}%)` } },
    yAxis: { type: "value", minInterval: 1, axisLabel: { fontSize: 10, color: "#8090a4" }, splitLine: { lineStyle: { color: "#edf1f7" } } },
    series: [{ type: "bar", barWidth: "46%", label: { show: true, position: "top", color: "#334a68", fontWeight: 700, fontSize: 11 }, data: data.map((item) => ({ value: item.count, itemStyle: { color: item.color, borderRadius: [5, 5, 0, 0] } })) }],
  }, onSelect);
  return <div className="pd-chart pd-age-chart" ref={host} role="img" aria-label="问题账龄分布柱状图" />;
}
