"use client";

import { useEffect, useRef, type RefObject } from "react";
import * as echarts from "echarts";
import type { AgeItem, CountItem } from "./problem-dashboard-data";

type ChartProps<T> = { data: T[]; onSelect: (name: string) => void };

type TooltipDatum = {
  name?: string;
  value?: unknown;
  percent?: number;
  dataIndex?: number;
};

function getTooltipDatum(value: unknown): TooltipDatum {
  if (Array.isArray(value)) return (value[0] ?? {}) as TooltipDatum;
  return (value ?? {}) as TooltipDatum;
}

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

export function BlockingReasonDonutChart({ data, total, onSelect }: ChartProps<CountItem> & { total: number }) {
  const host = useRef<HTMLDivElement>(null);
  useChart(host, {
    tooltip: { trigger: "item", formatter: (raw: unknown) => { const item = getTooltipDatum(raw); return `${item.name ?? ""}<br/>问题数：${String(item.value ?? 0)}<br/>占比：${Number(item.percent ?? 0).toFixed(1)}%`; } },
    graphic: [{ type: "text", left: "center", top: "41%", style: { text: String(total), fill: "#17233d", font: "700 22px Microsoft YaHei" } }, { type: "text", left: "center", top: "57%", style: { text: "未关闭问题", fill: "#64748b", font: "11px Microsoft YaHei" } }],
    series: [{ type: "pie", radius: ["56%", "78%"], center: ["50%", "50%"], label: { show: false }, itemStyle: { borderColor: "#fff", borderWidth: 3 }, data: data.map((item) => ({ name: item.name, value: item.count, itemStyle: { color: item.color } })) }],
  }, onSelect);
  return <div className="pd-chart pd-donut-chart" ref={host} role="img" aria-label="阻塞原因分析环形图" />;
}

export function IssueAgeBarChart({ data, onSelect }: ChartProps<AgeItem>) {
  const host = useRef<HTMLDivElement>(null);
  useChart(host, {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (raw: unknown) => { const datum = getTooltipDatum(raw); const item = data[datum.dataIndex ?? 0]; if (!item) return "暂无数据"; return `${item.name}<br/>问题数：${item.count}<br/>占比：${(item.ratio * 100).toFixed(1)}%`; } },
    grid: { left: 36, right: 10, top: 26, bottom: 44 },
    xAxis: { type: "category", data: data.map((item) => item.name), axisTick: { show: false }, axisLine: { lineStyle: { color: "#dfe7f1" } }, axisLabel: { interval: 0, fontSize: 10, lineHeight: 15, color: "#64748b", formatter: (value: string, index: number) => `${value}\n(${(data[index]?.ratio * 100 || 0).toFixed(1)}%)` } },
    yAxis: { type: "value", minInterval: 1, axisLabel: { fontSize: 10, color: "#8090a4" }, splitLine: { lineStyle: { color: "#edf1f7" } } },
    series: [{ type: "bar", barWidth: "46%", label: { show: true, position: "top", color: "#334a68", fontWeight: 700, fontSize: 11 }, data: data.map((item) => ({ value: item.count, itemStyle: { color: item.color, borderRadius: [5, 5, 0, 0] } })) }],
  }, onSelect);
  return <div className="pd-chart pd-age-chart" ref={host} role="img" aria-label="问题账龄分布柱状图" />;
}
