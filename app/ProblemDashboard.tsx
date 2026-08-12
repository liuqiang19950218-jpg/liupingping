"use client";

import { useEffect, useMemo, useState } from "react";
import { selectedQuarter } from "./quarter-storage";
import { issuesForQuarter } from "./reconciliation-insights";
import {
  buildProblemDashboard,
  filterProblemItems,
  formatMoney,
  issueFollowState,
  issueLatestAt,
  issueTitle,
  type ProblemFilters,
} from "./problem-dashboard-data";
import { ProblemStageDistribution } from "./ProblemStageDistribution";
import { resolvedFollowupArchiveItemsForQuarter } from "./resolved-followup-archive";
import "./problem-dashboard.css";
import "./problem-dashboard-layout.css";

type Props = { onOpenFollowup: (filters?: Record<string, string>) => void };

const emptyFilters = (quarter: string): ProblemFilters => ({
  quarter, region: "全部", owner: "全部", risk: "全部", cause: "全部", stage: "全部", aging: "全部", follow: "全部",
});

const riskClass = (risk: string) => risk === "高风险" ? "high" : risk === "中风险" ? "medium" : "low";
const overdueClass = (days: number) => days > 45 ? "danger" : days > 30 ? "warning" : "";
const avatar = (name: string) => name.trim().slice(0, 1) || "未";

export function ProblemDashboard({ onOpenFollowup }: Props) {
  const [filters, setFilters] = useState<ProblemFilters>(() => emptyFilters(""));
  const [revision, setRevision] = useState(0);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const sync = () => setFilters((current) => ({ ...current, quarter: selectedQuarter() || current.quarter }));
    const refresh = () => setRevision((value) => value + 1);
    sync();
    window.addEventListener("reconciliation-updated", refresh);
    window.addEventListener("reconciliation-quarter-updated", sync);
    window.addEventListener("reconciliation-dashboard-updated", refresh);
    window.addEventListener("problem-dashboard-refresh", refresh);
    return () => {
      window.removeEventListener("reconciliation-updated", refresh);
      window.removeEventListener("reconciliation-quarter-updated", sync);
      window.removeEventListener("reconciliation-dashboard-updated", refresh);
      window.removeEventListener("problem-dashboard-refresh", refresh);
    };
  }, []);

  const allQuarterItems = useMemo(() => issuesForQuarter(filters.quarter), [filters.quarter, revision]);
  const items = useMemo(() => filterProblemItems(filters), [filters, revision]);
  const closedCount = useMemo(() => {
    if (filters.stage !== "全部" && filters.stage !== "已关闭") return 0;
    return resolvedFollowupArchiveItemsForQuarter(filters.quarter).filter(
      (item) =>
        (filters.region === "全部" || item.region === filters.region) &&
        (filters.owner === "全部" || item.owner === filters.owner),
    ).length;
  }, [filters.quarter, filters.region, filters.owner, filters.stage, revision]);
  const dashboard = useMemo(() => buildProblemDashboard(items, closedCount), [items, closedCount]);
  const regions = useMemo(() => [...new Set(allQuarterItems.map((item) => item.region))], [allQuarterItems]);
  const owners = useMemo(() => [...new Set(allQuarterItems.map((item) => item.owner).filter(Boolean))], [allQuarterItems]);
  const causes = useMemo(() => [...new Set(allQuarterItems.map((item) => item.cause).filter(Boolean))], [allQuarterItems]);
  const change = (key: keyof ProblemFilters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const drill = (filter: Record<string, string> = {}) => onOpenFollowup({ quarter: filters.quarter, ...filter });
  const exportCurrent = () => {
    setExporting(true);
  const lines = [
    "客户名称,区域,责任人,对账差额,当前阶段,超期天数,风险等级,最近跟进时间,跟进状态",
    ...dashboard.preview.map((item) =>
      [
        item.customer,
        item.region,
        item.owner,
        item.difference,
        item.stage,
        item.overdueDays,
        item.riskLevel,
        issueLatestAt(item),
        issueFollowState(item),
      ].join(","),
    ),
  ];
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([`\ufeff${lines.join("\n")}`], { type: "text/csv" }));
    link.download = `问题解决看板_${filters.quarter}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    window.setTimeout(() => setExporting(false), 260);
  };
  const metrics = [
    ["未关闭问题", dashboard.metrics.all, "▤", "blue", "all"],
    ["超期未关闭", dashboard.metrics.overdue, "◷", "orange", "overdue"],
    ["7天未跟进", dashboard.metrics.untouched, "▦", "purple", "untouched"],
    ["待销售处理", dashboard.metrics.customer, "◌", "cyan", "customer"],
    ["待内部处理", dashboard.metrics.internal, "◎", "blue", "internal"],
    ["需领导介入", dashboard.metrics.leader, "♟", "purple", "leader"],
    ["本周待办", dashboard.metrics.week, "✓", "blue", "week"],
  ] as const;
  const handleMetric = (key: string) => drill({ filter: key });
  const selectStage = (stage: string) => drill({ stage });

  return <section className="pd-page" aria-busy={false}>
    <section className="pd-filter">
      <label>责任人<select value={filters.owner} onChange={(event) => change("owner", event.target.value)}><option>全部</option>{owners.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>问题类型<select value={filters.cause} onChange={(event) => change("cause", event.target.value)}><option>全部</option>{causes.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>风险等级<select value={filters.risk} onChange={(event) => change("risk", event.target.value)}><option>全部</option><option>高风险</option><option>中风险</option><option>低风险</option></select></label>
      <label>处理阶段<select value={filters.stage} onChange={(event) => change("stage", event.target.value)}><option>全部</option>{dashboard.stages.map((item) => <option key={item.name}>{item.name}</option>)}</select></label>
      <label>超期天数<select value={filters.aging} onChange={(event) => change("aging", event.target.value)}><option>全部</option>{dashboard.ages.map((item) => <option key={item.name}>{item.name}</option>)}</select></label>
      <label>最近跟进时间<select value={filters.follow} onChange={(event) => change("follow", event.target.value)}><option>全部</option><option>跟进中</option><option>待跟进</option><option>已超期</option></select></label>
      <label>区域<select value={filters.region} onChange={(event) => change("region", event.target.value)}><option>全部</option>{regions.map((item) => <option key={item}>{item}</option>)}</select></label>
      <div className="pd-filter-actions"><button onClick={() => setFilters(emptyFilters(selectedQuarter()))}>↻ 重置</button><button className="primary" disabled={exporting} onClick={exportCurrent}>{exporting ? "导出中" : "↓ 导出"}</button></div>
    </section>
    <p className="pd-alert">⚠ 当前未关闭问题 <b>{dashboard.total}</b> 个，其中超期 <strong>{dashboard.metrics.overdue.length}</strong> 个，7 天未跟进 <em>{dashboard.metrics.untouched.length}</em> 个，待销售处理 <b>{dashboard.metrics.customer.length}</b> 个，请及时推进问题闭环。</p>
    <section className="pd-kpis">
      {metrics.map(([name, list, icon, tone, key]) => <button className={`pd-kpi ${tone}`} key={name} onClick={() => handleMetric(key)}><i>{icon}</i><span>{name}</span><strong>{list.length}</strong><small>较上周 <b className={key === "week" ? "down" : "up"}>{key === "week" ? "↓" : "↑"} {list.length ? "关注" : "0"}</b></small></button>)}
    </section>
    <section className="pd-analysis-grid">
      <ProblemStageDistribution data={dashboard.stages} onSelect={selectStage} />
      <article className="pd-card pd-owner-card"><h2>责任人处理情况 Top5</h2><table><thead><tr><th>责任人</th><th>未关闭</th><th>超期</th><th>高风险</th><th>7天无更新</th><th>平均处理天数</th></tr></thead><tbody>{dashboard.owners.map((item) => <tr key={item.name} onClick={() => drill({ owner: item.name })}><td><i className="pd-avatar">{avatar(item.name)}</i>{item.name}</td><td>{item.count}</td><td className="danger">{item.overdue}</td><td className="danger">{item.high}</td><td className="warning">{item.untouched}</td><td>{item.averageDays.toFixed(1)}</td></tr>)}</tbody></table><button className="pd-more" onClick={() => drill()}>查看全部责任人 ›</button></article>
      <article className="pd-card pd-priority-card">
        <h2>风险优先级 Top5</h2>
        <div className="pd-priority-table-wrap">
          <table className="pd-priority-table">
            <colgroup><col /><col /><col /><col /><col /></colgroup>
            <thead><tr><th>序号</th><th>客户名称</th><th>涉及金额</th><th>超期天数</th><th>风险等级</th></tr></thead>
            <tbody>{dashboard.priority.map((item, index) => (
              <tr key={item.id} onClick={() => drill({ customer: item.customer })}>
                <td><i className={`pd-priority-rank rank-${index + 1}`}>{index + 1}</i></td>
                <td title={item.customer}>{item.customer}</td>
                <td className="pd-priority-amount">{formatMoney(item.difference)}</td>
                <td className={overdueClass(item.overdueDays)}>{item.overdueDays}天</td>
                <td><span className={`pd-risk-tag ${riskClass(item.riskLevel)}`}>{item.riskLevel}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </article>
    </section>
    <article className="pd-card pd-preview"><h2>重点问题预览 <button onClick={() => drill()}>查看更多 ›</button></h2><div className="pd-preview-wrap"><table><thead><tr><th>客户名称</th><th>问题标题</th><th>责任人</th><th>当前阶段</th><th>超期天数</th><th>风险等级</th><th>最近跟进时间</th><th>跟进状态</th></tr></thead><tbody>{dashboard.preview.map((item) => <tr key={item.id} onClick={() => drill({ customer: item.customer })}><td>{item.customer}</td><td title={issueTitle(item)}>{issueTitle(item)}</td><td><i className="pd-avatar">{avatar(item.owner)}</i>{item.owner || "未分配"}</td><td>{item.stage}</td><td className={overdueClass(item.overdueDays)}>{item.overdueDays} 天</td><td><span className={`pd-risk-tag ${riskClass(item.riskLevel)}`}>{item.riskLevel}</span></td><td>{issueLatestAt(item)}</td><td><span className="pd-follow-tag">{issueFollowState(item)}</span></td></tr>)}{!dashboard.preview.length && <tr><td colSpan={8} className="pd-empty">当前筛选范围暂无待解决问题</td></tr>}</tbody></table></div></article>
  </section>;
}
