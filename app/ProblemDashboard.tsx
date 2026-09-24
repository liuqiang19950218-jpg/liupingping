"use client";

import { useMemo, useState } from "react";
import { useDashboardData } from "./dashboard-postgres-data";
import {
  buildProblemDashboard,
  filterProblemItemList,
  issueFollowState,
  issueLatestAt,
  issueTitle,
  type ProblemFilters,
} from "./problem-dashboard-data";
import { ProblemStageDistribution } from "./ProblemStageDistribution";
import { ProblemFollowupDrawer } from "./ProblemFollowupDrawer";
import { isResolvedArchiveReconciliation } from "../lib/closed-reconciliation-qualification.mjs";
import "./problem-dashboard.css";
import "./problem-dashboard-layout.css";

const getOverdueDays = (date: string) => {
  const timestamp = new Date(date).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000)) : 0;
};
type DashboardIssue = Parameters<typeof buildProblemDashboard>[0][number];

type Props = { onOpenFollowup: (filters?: Record<string, string>) => void };

const emptyFilters = (quarter: string): ProblemFilters => ({
  quarter, region: "全部", owner: "全部", risk: "全部", cause: "全部", stage: "全部", aging: "全部", follow: "全部",
});

const riskClass = (risk: string) => risk === "高风险" ? "high" : risk === "中风险" ? "medium" : "low";
const overdueClass = (days: number) => days > 45 ? "danger" : days > 30 ? "warning" : "";
const avatar = (name: string) => name.trim().slice(0, 1) || "未";

export function ProblemDashboard({ onOpenFollowup }: Props) {
  const { quarter, reconciliationById, followups, loading, error } = useDashboardData();
  const [filters, setFilters] = useState<ProblemFilters>(() => emptyFilters(""));
  const [exporting, setExporting] = useState(false);
  const [drawerFilterContext, setDrawerFilterContext] = useState<Record<string, string> | null>(null);

  const allQuarterItems = useMemo(() => followups.map((followup) => {
    const row = reconciliationById.get(followup.reconciliationId);
    const stage = followup.closedAt || followup.followStatus === "closed" || followup.followStatus === "已解决" ? "已关闭" : followup.processStage === "待销售走申请" || followup.processStage === "待销售去医院处理" || followup.processStage === "待财务调账" || followup.processStage === "待核查" ? followup.processStage : "待核查";
    const riskLevel = followup.riskLevel === "high" ? "高风险" : followup.riskLevel === "medium" ? "中风险" : followup.riskLevel === "low" ? "低风险" : followup.riskLevel as "高风险" | "中风险" | "低风险";
    return { id: followup.id, quarter: quarter?.label ?? "", accountSet: row?.accountSet ?? "", region: row?.region ?? "未填写区域", customer: row?.customer ?? "", owner: row?.ownerName ?? "", difference: Number(row?.reconciliationDifference ?? 0), solution: row?.solution ?? "", cause: row?.solution ?? "", expectedDate: followup.expectedCompleteAt ?? "", latestFollowUpAt: followup.latestFollowUpAt ?? followup.latestEvent?.occurredAt ?? "", updatedAt: followup.updatedAt ?? "", followStatus: followup.followStatus, processStage: followup.processStage ?? "", financeAttention: "无需关注", riskLevel, stage, overdueDays: getOverdueDays(followup.expectedCompleteAt ?? "") } as unknown as DashboardIssue;
  }), [followups, reconciliationById, quarter]);
  const activeItems = useMemo(() => allQuarterItems.filter((item) => item.stage !== "已关闭"), [allQuarterItems]);
  const closedReconciliations = useMemo(
    () => [...reconciliationById.values()].filter((item) => Boolean(item.customer?.trim()) && isResolvedArchiveReconciliation(item)),
    [reconciliationById],
  );
  const currentFilters = { ...filters, quarter: quarter?.label ?? "" };
  const items = useMemo(() => filterProblemItemList(activeItems, currentFilters), [activeItems, currentFilters]);
  const closedCount = useMemo(() => {
    if (filters.stage !== "全部" && filters.stage !== "已关闭") return 0;
    return closedReconciliations.filter((item) =>
      (filters.region === "全部" || (item.region ?? "未填写区域") === filters.region) &&
      (filters.owner === "全部" || item.ownerName === filters.owner),
    ).length;
  }, [closedReconciliations, filters]);
  const dashboard = useMemo(() => buildProblemDashboard(items, closedCount), [items, closedCount]);
  const regions = useMemo(() => [...new Set(allQuarterItems.map((item) => item.region))], [allQuarterItems]);
  const owners = useMemo(() => [...new Set(allQuarterItems.map((item) => item.owner).filter(Boolean))], [allQuarterItems]);
  const causes = useMemo(() => [...new Set(allQuarterItems.map((item) => item.cause).filter(Boolean))], [allQuarterItems]);
  const change = (key: keyof ProblemFilters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  // Preserve the exact legacy navigation context; navigation now happens only
  // after the user explicitly chooses it in the secondary drawer.
  const drill = (filter: Record<string, string> = {}) => setDrawerFilterContext({ quarter: quarter?.code ?? "", ...filter });
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
    link.download = `问题解决看板_${quarter?.label ?? ""}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    window.setTimeout(() => setExporting(false), 260);
  };
  const metrics = [
    ["未关闭问题", dashboard.metrics.all.length, "▤", "blue", "all"],
    ["超期未关闭", dashboard.metrics.overdue.length, "◷", "orange", "overdue"],
    ["7天未跟进", dashboard.metrics.untouched.length, "▦", "purple", "untouched"],
    ["待销售处理", dashboard.metrics.customer.length, "◌", "cyan", "customer"],
    ["待内部处理", dashboard.metrics.internal.length, "◎", "blue", "internal"],
    ["需领导介入", dashboard.metrics.leader.length, "♟", "purple", "leader"],
    ["已关闭", closedCount, "✓", "green", "closed"],
  ] as const;
  const handleMetric = (key: string) => key === "closed" ? selectStage("已关闭") : drill({ filter: key });
  const selectStage = (stage: string) => drill({
    stage,
    ...(filters.region === "全部" ? {} : { region: filters.region }),
    ...(filters.owner === "全部" ? {} : { owner: filters.owner }),
  });

  if (error) return <section className="pd-page"><p className="pd-empty">无法读取问题看板：{error}</p></section>;
  if (loading) return <section className="pd-page" aria-busy><p className="pd-empty">正在读取问题看板…</p></section>;
  return <section className="pd-page" aria-busy={false}>
    <section className="pd-filter">
      <label>责任人<select value={filters.owner} onChange={(event) => change("owner", event.target.value)}><option>全部</option>{owners.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>问题类型<select value={filters.cause} onChange={(event) => change("cause", event.target.value)}><option>全部</option>{causes.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>风险等级<select value={filters.risk} onChange={(event) => change("risk", event.target.value)}><option>全部</option><option>高风险</option><option>中风险</option><option>低风险</option></select></label>
      <label>处理阶段<select value={filters.stage} onChange={(event) => change("stage", event.target.value)}><option>全部</option>{dashboard.stages.map((item) => <option key={item.name}>{item.name}</option>)}</select></label>
      <label>超期天数<select value={filters.aging} onChange={(event) => change("aging", event.target.value)}><option>全部</option>{dashboard.ages.map((item) => <option key={item.name}>{item.name}</option>)}</select></label>
      <label>最近跟进时间<select value={filters.follow} onChange={(event) => change("follow", event.target.value)}><option>全部</option><option>跟进中</option><option>待跟进</option><option>已超期</option></select></label>
      <label>区域<select value={filters.region} onChange={(event) => change("region", event.target.value)}><option>全部</option>{regions.map((item) => <option key={item}>{item}</option>)}</select></label>
      <div className="pd-filter-actions"><button onClick={() => setFilters(emptyFilters(quarter?.label ?? ""))}>↻ 重置</button><button className="primary" disabled={exporting} onClick={exportCurrent}>{exporting ? "导出中" : "↓ 导出"}</button></div>
    </section>
    <p className="pd-alert">⚠ 当前未关闭问题 <b>{dashboard.total}</b> 个，其中超期 <strong>{dashboard.metrics.overdue.length}</strong> 个，7 天未跟进 <em>{dashboard.metrics.untouched.length}</em> 个，待销售处理 <b>{dashboard.metrics.customer.length}</b> 个，请及时推进问题闭环。</p>
    <section className="pd-kpis">
      {metrics.map(([name, count, icon, tone, key]) => <button className={`pd-kpi ${tone}`} key={name} onClick={() => handleMetric(key)}><i>{icon}</i><span>{name}</span><strong>{count}</strong><small>{key === "closed" ? "已解决档案" : "当前筛选范围"}</small></button>)}
    </section>
    <section className="pd-analysis-grid">
      <ProblemStageDistribution data={dashboard.stages} onSelect={selectStage} />
      <article className="pd-card pd-owner-card"><h2>责任人处理情况 Top5</h2><table><thead><tr><th>责任人</th><th>未关闭</th><th>超期</th><th>高风险</th><th>7天无更新</th><th>平均处理天数</th></tr></thead><tbody>{dashboard.owners.map((item) => <tr key={item.name} onClick={() => drill({ owner: item.name })}><td><i className="pd-avatar">{avatar(item.name)}</i>{item.name}</td><td>{item.count}</td><td className="danger">{item.overdue}</td><td className="danger">{item.high}</td><td className="warning">{item.untouched}</td><td>{item.averageDays.toFixed(1)}</td></tr>)}</tbody></table><button className="pd-more" onClick={() => drill()}>查看全部责任人 ›</button></article>
    </section>
    <article className="pd-card pd-preview"><h2>重点问题预览 <button onClick={() => drill()}>查看更多 ›</button></h2><div className="pd-preview-wrap"><table><thead><tr><th>客户名称</th><th>问题标题</th><th>责任人</th><th>当前阶段</th><th>超期天数</th><th>风险等级</th><th>最近跟进时间</th><th>跟进状态</th></tr></thead><tbody>{dashboard.preview.map((item) => <tr key={item.id} onClick={() => drill({ customer: item.customer })}><td>{item.customer}</td><td title={issueTitle(item)}>{issueTitle(item)}</td><td><i className="pd-avatar">{avatar(item.owner)}</i>{item.owner || "未分配"}</td><td>{item.stage}</td><td className={overdueClass(item.overdueDays)}>{item.overdueDays} 天</td><td><span className={`pd-risk-tag ${riskClass(item.riskLevel)}`}>{item.riskLevel}</span></td><td>{issueLatestAt(item)}</td><td><span className="pd-follow-tag">{issueFollowState(item)}</span></td></tr>)}{!dashboard.preview.length && <tr><td colSpan={8} className="pd-empty">当前筛选范围暂无待解决问题</td></tr>}</tbody></table></div></article>
    {drawerFilterContext && <ProblemFollowupDrawer filterContext={drawerFilterContext} onClose={() => setDrawerFilterContext(null)} onEnterFollowup={() => onOpenFollowup(drawerFilterContext)} />}
  </section>;
}
