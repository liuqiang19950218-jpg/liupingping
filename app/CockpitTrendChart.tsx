"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";

export type TrendPoint = {
  quarter: string;
  rate: number;
  unresolved: number;
  overdue: number;
  highRisk: number;
};

export function CockpitTrendChart({ data, onQuarterClick }: { data: TrendPoint[]; onQuarterClick: (quarter: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const chart = echarts.init(element);
    chart.setOption({
      color: ["#1677ff", "#5b8ff9", "#f6bd16", "#ef6a6a"],
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (value: number | string) => typeof value === "number" ? value.toLocaleString("zh-CN", { maximumFractionDigits: 1 }) : value },
      legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 8, textStyle: { fontSize: 11, color: "#64748b" } },
      grid: { left: 44, right: 46, top: 42, bottom: 30 },
      xAxis: { type: "category", data: data.map((item) => item.quarter), axisTick: { show: false }, axisLine: { lineStyle: { color: "#dfe7f1" } }, axisLabel: { color: "#64748b", fontSize: 11 } },
      yAxis: [
        { type: "value", min: 90, max: 100, interval: 2, axisLabel: { formatter: "{value}%", color: "#64748b", fontSize: 10 }, splitLine: { lineStyle: { color: "#edf1f7" } } },
        { type: "value", axisLabel: { formatter: (value: number) => `${(value / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}万`, color: "#64748b", fontSize: 10 }, splitLine: { show: false } },
      ],
      series: [
        { name: "金额对账完成率", type: "line", yAxisIndex: 0, data: data.map((item) => Number(item.rate.toFixed(1))), symbol: "circle", symbolSize: 6, lineStyle: { width: 2 }, label: { show: true, position: "top", formatter: "{c}%", fontSize: 10, color: "#1677ff" }, z: 10 },
        { name: "未解决差额", type: "bar", yAxisIndex: 1, data: data.map((item) => item.unresolved), barMaxWidth: 16, itemStyle: { borderRadius: [3, 3, 0, 0] } },
        { name: "逾期金额", type: "bar", yAxisIndex: 1, data: data.map((item) => item.overdue), barMaxWidth: 16, itemStyle: { borderRadius: [3, 3, 0, 0] } },
        { name: "高风险金额", type: "bar", yAxisIndex: 1, data: data.map((item) => item.highRisk), barMaxWidth: 16, itemStyle: { borderRadius: [3, 3, 0, 0] } },
      ],
    });
    const resize = () => chart.resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    chart.on("click", (params) => { if (typeof params.name === "string") onQuarterClick(params.name); });
    return () => { observer.disconnect(); chart.dispose(); };
  }, [data, onQuarterClick]);
  return <div className="cockpit-trend-chart" ref={host} aria-label="对账趋势组合图：金额完成率折线、未解决差额、逾期金额和高风险金额柱状图" />;
}
