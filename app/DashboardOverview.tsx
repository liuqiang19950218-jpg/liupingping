"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cockpitRows, type CockpitRow } from "./cockpit-data";
import { selectedQuarter } from "./quarter-storage";
import "./dashboard-overview.css";

type RegionAnalysis = {
  region: string;
  total: number;
  clear: number;
  unclear: number;
  rate: number;
  pendingAmount: number;
};
type Analysis = {
  quarter: string;
  rate: number;
  clear: number;
  unclear: number;
  pending: number;
  exception: string;
  trend: string;
  regions: RegionAnalysis[];
};

function analyze(rows: CockpitRow[]): Analysis {
  const accounted = rows.filter((row) => row.filled);
  const clear = accounted.filter((row) => row.cleared).length;
  const unclear = accounted.length - clear;
  const pending = accounted.filter((row) => row.followStatus === "待跟进");
  const map = new Map<string, RegionAnalysis>();
  accounted.forEach((row) => {
    const region = row.region || "未填写区域";
    const current = map.get(region) ?? {
      region,
      total: 0,
      clear: 0,
      unclear: 0,
      rate: 0,
      pendingAmount: 0,
    };
    current.total += 1;
    if (row.cleared) current.clear += 1;
    else current.unclear += 1;
    if (row.followStatus === "待跟进")
      current.pendingAmount += Math.abs(row.difference);
    map.set(region, current);
  });
  const regions = [...map.values()]
    .map((region) => ({
      ...region,
      rate: region.total ? (region.clear / region.total) * 100 : 0,
    }))
    .sort((a, b) => b.unclear - a.unclear || b.pendingAmount - a.pendingAmount);
  const focus = regions[0];
  const pendingAmount = pending.reduce(
    (sum, row) => sum + Math.abs(row.difference),
    0,
  );
  const exception = unclear
    ? `当前未对清 ${unclear} 家，${focus?.region ?? "当前范围"}未对清 ${focus?.unclear ?? 0} 家、待解决差额 ${focus?.pendingAmount.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) ?? "0"}。`
    : "当前已填写账面金额的客户均已对清。";
  const trend = `当前已对清 ${clear} 家，未对清 ${unclear} 家；待解决清单 ${pending.length} 家，待解决差额 ${pendingAmount.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}。未导入上一季度明细时，不展示虚拟环比数据。`;
  return {
    quarter: rows[0]?.quarter || "当前季度",
    rate: accounted.length ? (clear / accounted.length) * 100 : 0,
    clear,
    unclear,
    pending: pending.length,
    exception,
    trend,
    regions,
  };
}

export function DashboardOverview({
  selected: _selected,
}: {
  selected: number;
}) {
  const [, setRevision] = useState(0);
  const [quarter, setQuarter] = useState("");
  const [drawer, setDrawer] = useState<"exception" | "trend" | null>(null);
  useEffect(() => {
    const sync = () => setRevision((value) => value + 1);
    const refresh = () => { setQuarter(selectedQuarter()); sync(); };
    refresh();
    window.addEventListener("reconciliation-dashboard-updated", refresh);
    window.addEventListener("reconciliation-quarter-selected", refresh);
    window.addEventListener("reconciliation-quarter-updated", refresh);
    return () => { window.removeEventListener("reconciliation-dashboard-updated", refresh); window.removeEventListener("reconciliation-quarter-selected", refresh); window.removeEventListener("reconciliation-quarter-updated", refresh); };
  }, []);
  const summary = analyze([...cockpitRows].filter((row) => !quarter || row.quarter === quarter));
  const bars = summary.regions
    .slice(0, 7)
    .map((region) => Math.max(8, region.rate));
  return (
    <>
      <section className="dashboard-overview" aria-label="季度核心结论">
        <article className="overview-metric">
          <p>{summary.quarter} 数据结论</p>
          <h2>{summary.quarter} 账实相符率</h2>
          <strong>{summary.rate.toFixed(1)}%</strong>
        </article>
        <InsightCard
          icon="!"
          title="核心异常"
          text={summary.exception}
          action="查看详情"
          onClick={() => setDrawer("exception")}
          warning
        />
        <InsightCard
          icon="▥"
          title="当前数据趋势"
          text={summary.trend}
          action="查看趋势"
          onClick={() => setDrawer("trend")}
          chart={
            <div className="mini-chart" aria-label="区域对清率图">
              {bars.map((height, index) => (
                <i key={index} style={{ height: `${height}%` }} />
              ))}
            </div>
          }
        />
      </section>
      {drawer && (
        <div
          className="insight-backdrop"
          role="presentation"
          onMouseDown={() => setDrawer(null)}
        >
          <aside
            className="insight-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="insight-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="drawer-close"
              type="button"
              aria-label="关闭"
              onClick={() => setDrawer(null)}
            >
              ×
            </button>
            <p>
              {summary.quarter}{" "}
              {drawer === "exception" ? "核心异常" : "当前数据趋势"}
            </p>
            <h2 id="insight-title">
              {drawer === "exception"
                ? "需优先处理的对账事项"
                : "当前对账数据分析"}
            </h2>
            <div className="drawer-rate">{summary.rate.toFixed(1)}%</div>
            <p className="drawer-copy">
              {drawer === "exception" ? summary.exception : summary.trend}
            </p>
            {drawer === "exception" && (
              <div className="overview-region-list">
                {summary.regions.map((region) => (
                  <p key={region.region}>
                    {region.region}：已对清 {region.clear} 家，未对清{" "}
                    {region.unclear} 家，待解决差额{" "}
                    {region.pendingAmount.toLocaleString("zh-CN", {
                      maximumFractionDigits: 2,
                    })}
                  </p>
                ))}
              </div>
            )}
            <button
              type="button"
              className="drawer-action"
              onClick={() => setDrawer(null)}
            >
              我知道了
            </button>
          </aside>
        </div>
      )}
    </>
  );
}

function InsightCard({
  icon,
  title,
  text,
  action,
  onClick,
  warning = false,
  chart,
}: {
  icon: string;
  title: string;
  text: string;
  action: string;
  onClick: () => void;
  warning?: boolean;
  chart?: ReactNode;
}) {
  return (
    <article className="overview-insight">
      <div className="insight-icon" data-warning={warning || undefined}>
        {icon}
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      <button type="button" onClick={onClick}>
        {action} <span>›</span>
      </button>
      {chart}
    </article>
  );
}
