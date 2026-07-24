"use client";

import { useState } from "react";
import "./dashboard-overview.css";

type Summary = { quarter: string; rate: string; exception: string; trend: string };

export const dashboardSummaries: Summary[] = [
  { quarter: "2024 Q3", rate: "97.4%", exception: "重点关注：南京、南通、苏州共 5 户未对清；泰州对清率 94%。", trend: "较上季度对清率提升 1 个百分点。" },
  { quarter: "2024 Q4", rate: "97.7%", exception: "重点关注：南京未对清 6 户，对清率 93%。", trend: "未对清客户较上季收窄至 15 户。" },
  { quarter: "2025 Q1", rate: "97.8%", exception: "重点关注：苏州未对清 6 户；南通对清率 94%。", trend: "对清率基本持平，未对清客户减少 1 户。" },
  { quarter: "2025 Q2", rate: "98.0%", exception: "重点关注：南京未对清 4 户；扬州对清率 90%。", trend: "对清率持平，未对清客户数量持平。" },
  { quarter: "2025 Q3", rate: "98.4%", exception: "重点关注：南通未对清 4 户；扬州对清率 91%。", trend: "未对清客户较上季收窄至 11 户。" },
  { quarter: "2025 Q4", rate: "99.2%", exception: "重点关注：南通未对清 2 户；泰州对清率 94%。", trend: "未对清客户较上季收窄至 5 户。" },
  { quarter: "2026 Q1", rate: "99.2%", exception: "重点关注：南京未对清 2 户；泰州对清率 94%。", trend: "对清率与上季度基本持平，未对清客户由 5 户增至 6 户，需专项跟进。" },
];

export function DashboardOverview({ selected }: { selected: number }) {
  const [drawer, setDrawer] = useState<"exception" | "trend" | null>(null);
  const summary = dashboardSummaries[selected] ?? dashboardSummaries[6];
  const trendBars = [35, 43, 34, 76, 88, 62, 74];
  return <>
    <section className="dashboard-overview" aria-label="季度核心结论">
      <article className="overview-metric">
        <p>{summary.quarter} 一句话结论</p>
        <h2>{summary.quarter} 账实相符率</h2>
        <strong>{summary.rate}</strong>
      </article>
      <InsightCard icon="!" title="核心异常" text={summary.exception} action="查看详情" onClick={() => setDrawer("exception")} warning />
      <InsightCard icon="▥" title="环比趋势" text={summary.trend} action="查看趋势" onClick={() => setDrawer("trend")} chart={<div className="mini-chart" aria-label="近七季度趋势图">{trendBars.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>} />
    </section>
    {drawer && <div className="insight-backdrop" role="presentation" onMouseDown={() => setDrawer(null)}>
      <aside className="insight-drawer" role="dialog" aria-modal="true" aria-labelledby="insight-title" onMouseDown={event => event.stopPropagation()}>
        <button className="drawer-close" type="button" aria-label="关闭" onClick={() => setDrawer(null)}>×</button>
        <p>{summary.quarter} {drawer === "exception" ? "核心异常" : "趋势说明"}</p>
        <h2 id="insight-title">{drawer === "exception" ? "需优先处理的对账事项" : "账实相符率变化"}</h2>
        <div className="drawer-rate">{summary.rate}</div>
        <p className="drawer-copy">{drawer === "exception" ? summary.exception : summary.trend}</p>
        <button type="button" className="drawer-action" onClick={() => setDrawer(null)}>我知道了</button>
      </aside>
    </div>}
  </>;
}

function InsightCard({ icon, title, text, action, onClick, warning = false, chart }: { icon: string; title: string; text: string; action: string; onClick: () => void; warning?: boolean; chart?: React.ReactNode }) {
  return <article className="overview-insight">
    <div className="insight-icon" data-warning={warning || undefined}>{icon}</div><h3>{title}</h3>
    <p>{text}</p>
    <button type="button" onClick={onClick}>{action} <span>›</span></button>{chart}
  </article>;
}
