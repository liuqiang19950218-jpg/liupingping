"use client";

import { useMemo } from "react";
import { differenceReasonsByReconciliation } from "../lib/difference-reason-summary.mjs";
import { useDashboardData } from "./dashboard-postgres-data";
import { filterFollowupTrackerItems, followupStage, latestFollowupAt, latestFollowupContent, toItems } from "./UnresolvedFollowupDashboard";
import "./problem-followup-drawer.css";

type Props = {
  filterContext: Record<string, string>;
  onClose: () => void;
  onEnterFollowup: () => void;
};

const money = (amount: number) => amount.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const LABELS: Record<string, string> = { region: "区域", owner: "责任人", stage: "处理阶段", customer: "客户", filter: "看板筛选", quarter: "季度" };
const FILTER_LABELS: Record<string, string> = { all: "未关闭问题", overdue: "超期未关闭", untouched: "7天未跟进", customer: "待销售处理", internal: "待内部处理", leader: "需领导介入", week: "本周待办" };

export function ProblemFollowupDrawer({ filterContext, onClose, onEnterFollowup }: Props) {
  const { quarter, reconciliationById, followups, differenceItems, loading, error } = useDashboardData();
  const contextLabels = Object.entries(filterContext)
    .filter(([key, value]) => key !== "quarter" ? Boolean(value) : Boolean(value))
    .map(([key, value]) => `${LABELS[key] ?? key}：${key === "filter" ? FILTER_LABELS[value] ?? value : value}`);
  const items = useMemo(() => filterFollowupTrackerItems(
    toItems(quarter?.label ?? "", reconciliationById, followups),
    filterContext,
  ), [quarter, reconciliationById, followups, filterContext]);
  const reasons = useMemo(() => differenceReasonsByReconciliation(differenceItems, quarter?.code ?? ""), [differenceItems, quarter]);
  const amount = items.reduce((sum, item) => sum + Math.abs(item.amount), 0);

  return <div className="pfd-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="pfd-drawer" role="dialog" aria-modal="true" aria-label="问题明细" onMouseDown={(event) => event.stopPropagation()}>
      <header className="pfd-header"><div><p>问题解决看板 · 二级穿透</p><h2>问题明细</h2><span>{contextLabels.length ? contextLabels.join("　") : "当前季度全部未解决客户"}</span></div><button type="button" className="pfd-icon-close" onClick={onClose} aria-label="关闭问题明细">×</button></header>
      <div className="pfd-summary"><span>当前筛选条件</span><b>{contextLabels.length ? contextLabels.join(" · ") : "全部"}</b><span>客户数量 <strong>{items.length}</strong></span><span>未解决金额合计 <strong>¥ {money(amount)}</strong></span></div>
      <div className="pfd-body">
        {loading ? <p className="pfd-state">正在读取未解决客户跟进…</p> : error ? <p className="pfd-state error">无法读取未解决客户跟进：{error}</p> : !items.length ? <p className="pfd-state">暂无符合当前条件的客户</p> : <div className="pfd-table-wrap"><table><thead><tr><th>客户名称</th><th>区域</th><th>未解决金额</th><th>当前处理阶段</th><th>差额原因</th><th>最新跟进时间</th><th>最新跟进内容</th><th>负责人</th><th>当前状态</th></tr></thead><tbody>{items.map((item) => {
          const reason = reasons.get(item.reconciliationId) || "—";
          const content = latestFollowupContent(item) || "—";
          return <tr key={item.id}><td>{item.customer}</td><td>{item.region}</td><td className="pfd-amount">¥ {money(item.amount)}</td><td>{followupStage(item)}</td><td><span className="pfd-clamp" title={reason}>{reason}</span></td><td>{latestFollowupAt(item) || "—"}</td><td><span className="pfd-clamp" title={content}>{content}</span></td><td>{item.owner || "未填写"}</td><td>{item.resolved ? "已解决" : "待解决"}</td></tr>;
        })}</tbody></table></div>}
      </div>
      <footer className="pfd-footer"><button type="button" onClick={onClose}>关闭</button><button type="button" className="pfd-primary" onClick={onEnterFollowup}>进入未解决客户跟进</button></footer>
    </section>
  </div>;
}
