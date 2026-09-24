"use client";

import type { StageItem } from "./problem-dashboard-data";

type Props = { data: StageItem[]; onSelect: (stage: string) => void };
type StageRow = { id: string; name: string; status: string; icon: string; tone: string; count: number; target: string };

const countByColor = (data: StageItem[], colors: string[]) =>
  data.reduce((total, item) => total + (colors.includes(item.color.toLowerCase()) ? item.count : 0), 0);

const targetByColor = (data: StageItem[], color: string) =>
  data.find((item) => item.color.toLowerCase() === color)?.name ?? "";

export function ProblemStageDistribution({ data, onSelect }: Props) {
  const rows: StageRow[] = [
    { id: "closed", name: "已关闭", status: "已完成", icon: "✓", tone: "closed", count: countByColor(data, ["#b8bfd8"]), target: targetByColor(data, "#b8bfd8") },
    { id: "sales", name: "等待销售处理", status: "处理中", icon: "◷", tone: "sales", count: countByColor(data, ["#1677ff", "#25bda5"]), target: targetByColor(data, "#25bda5") || targetByColor(data, "#1677ff") },
    { id: "finance", name: "待财务调账", status: "待处理", icon: "▤", tone: "finance", count: countByColor(data, ["#f6bd16"]), target: targetByColor(data, "#f6bd16") },
    { id: "checking", name: "核查中", status: "待处理", icon: "⌕", tone: "checking", count: countByColor(data, ["#20a8d8"]), target: targetByColor(data, "#20a8d8") },
  ];
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return <article className="pd-card pd-stage-card">
    <h2><span className="pd-stage-title-marker" aria-hidden="true" />问题处理阶段分布</h2>
    <div className="pd-stage-header" aria-hidden="true"><span>阶段</span><span>数量</span><span>处理进度</span><span>占比</span><span>状态</span></div>
    <div className="pd-stage-rows">{rows.map((row) => {
      const ratio = total ? row.count / total : 0;
      return <button className={`pd-stage-row pd-stage-${row.tone}`} key={row.id} type="button" onClick={() => row.target && onSelect(row.target)} aria-label={`${row.name}：${row.count} 个，占比 ${(ratio * 100).toFixed(1)}%`}>
        <span className="pd-stage-name"><i aria-hidden="true">{row.icon}</i><strong>{row.name}</strong></span>
        <b>{row.count}</b><span className="pd-stage-progress" aria-hidden="true"><i style={{ width: `${ratio * 100}%` }} /></span>
        <em>{(ratio * 100).toFixed(1)}%</em><small><i aria-hidden="true" />{row.status}</small>
      </button>;
    })}</div>
    <footer className="pd-stage-total"><span>阶段问题总计</span><b>{total}</b><em>个</em></footer>
  </article>;
}
