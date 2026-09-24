"use client";

import type { StageItem } from "./problem-dashboard-data";

type Props = { data: StageItem[]; onSelect: (stage: string) => void };
const presentation = (name: string) => ({
  "待确认": { icon: "?", tone: "checking", status: "待确认" },
  "处理中": { icon: "◷", tone: "finance", status: "处理中" },
  "等待客户反馈": { icon: "◌", tone: "sales", status: "待反馈" },
  "超期跟进": { icon: "!", tone: "overdue", status: "需跟进" },
  "已关闭": { icon: "✓", tone: "closed", status: "已完成" },
}[name] ?? { icon: "•", tone: "checking", status: "待确认" });

export function ProblemStageDistribution({ data, onSelect }: Props) {
  const total = data.reduce((sum, row) => sum + row.count, 0);

  return <article className="pd-card pd-stage-card">
    <h2><span className="pd-stage-title-marker" aria-hidden="true" />问题处理阶段分布</h2>
    <div className="pd-stage-header" aria-hidden="true"><span>阶段</span><span>数量</span><span>处理进度</span><span>占比</span><span>状态</span></div>
    <div className="pd-stage-rows">{data.map((row) => {
      const detail = presentation(row.name);
      const ratio = total ? row.count / total : 0;
      return <button className={`pd-stage-row pd-stage-${detail.tone}`} key={row.name} type="button" onClick={() => onSelect(row.name)} aria-label={`${row.name}：${row.count} 个，占比 ${(ratio * 100).toFixed(1)}%`}>
        <span className="pd-stage-name"><i aria-hidden="true">{detail.icon}</i><strong>{row.name}</strong></span>
        <b>{row.count}</b><span className="pd-stage-progress" aria-hidden="true"><i style={{ width: `${ratio * 100}%` }} /></span>
        <em>{(ratio * 100).toFixed(1)}%</em><small><i aria-hidden="true" />{detail.status}</small>
      </button>;
    })}</div>
    <footer className="pd-stage-total"><span>阶段问题总计</span><b>{total}</b><em>个</em></footer>
  </article>;
}
