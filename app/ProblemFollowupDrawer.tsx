"use client";

import { useMemo, useState } from "react";
import { differenceReasonsByReconciliation } from "../lib/difference-reason-summary.mjs";
import { useDashboardData } from "./dashboard-postgres-data";
import { filterFollowupTrackerItems, followupManagementStage, toItems } from "./UnresolvedFollowupDashboard";
import "./problem-followup-drawer.css";

type Props = { filterContext: Record<string, string>; onClose: () => void; onEnterFollowup: () => void };
type SortKey = "customer" | "accountSet" | "region" | "owner" | "amount" | "reason" | "status" | "solution" | "solutionDate";
const PAGE_SIZE = 10;
const money = (amount: number) => amount.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const text = (value: unknown) => String(value ?? "").trim();
const LABELS: Record<string, string> = { region: "区域", owner: "责任人", stage: "处理阶段", customer: "客户", filter: "看板筛选", quarter: "季度" };
const FILTER_LABELS: Record<string, string> = { all: "未关闭问题", overdue: "超期未关闭", untouched: "7天未跟进", customer: "待销售处理", internal: "待内部处理", leader: "需领导介入", week: "本周待办" };

export function ProblemFollowupDrawer({ filterContext, onClose, onEnterFollowup }: Props) {
  const { quarter, reconciliationById, followups, differenceItems, loading, error } = useDashboardData();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "customer", direction: "asc" });
  const [page, setPage] = useState(1);
  const contextLabels = Object.entries(filterContext).filter(([, value]) => Boolean(value)).map(([key, value]) => `${LABELS[key] ?? key}：${key === "filter" ? FILTER_LABELS[value] ?? value : value}`);
  const items = useMemo(() => filterFollowupTrackerItems(toItems(quarter?.label ?? "", reconciliationById, followups), filterContext), [quarter, reconciliationById, followups, filterContext]);
  const reasons = useMemo(() => differenceReasonsByReconciliation(differenceItems, quarter?.code ?? ""), [differenceItems, quarter]);
  const rows = useMemo(() => items.map((item) => ({ item, reason: reasons.get(item.reconciliationId) || "—", status: followupManagementStage(item), solution: item.firstSolution || "—", solutionDate: item.firstTime || "—" })), [items, reasons]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const result = !query ? rows : rows.filter(({ item, reason, status, solution, solutionDate }) => [item.customer, item.accountSet, item.region, item.owner, item.amount, reason, status, solution, solutionDate].join(" ").toLocaleLowerCase().includes(query));
    return [...result].sort((left, right) => {
      const value = (row: typeof left) => sort.key === "amount" ? row.item.amount : sort.key === "reason" ? row.reason : sort.key === "status" ? row.status : sort.key === "solution" ? row.solution : sort.key === "solutionDate" ? row.solutionDate : row.item[sort.key];
      const first = value(left); const second = value(right);
      const compare = typeof first === "number" && typeof second === "number" ? first - second : text(first).localeCompare(text(second), "zh-CN");
      return sort.direction === "asc" ? compare : -compare;
    });
  }, [rows, search, sort]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const activePage = Math.min(page, pageCount);
  const displayed = filtered.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE);
  const amount = filtered.reduce((sum, { item }) => sum + Math.abs(item.amount), 0);
  const archive = filterContext.stage === "已关闭";
  const setSortKey = (key: SortKey) => { setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }); setPage(1); };
  const sortLabel = (label: string, key: SortKey) => <button type="button" onClick={() => setSortKey(key)}>{label}{sort.key === key ? (sort.direction === "asc" ? " ↑" : " ↓") : ""}</button>;

  return <div className="pfd-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="pfd-drawer" role="dialog" aria-modal="true" aria-label="问题明细" onMouseDown={(event) => event.stopPropagation()}>
      <header className="pfd-header"><div><p>问题解决看板 · 二级穿透</p><h2>问题明细</h2><span>{contextLabels.length ? contextLabels.join("　") : "当前季度问题客户"}</span></div><button type="button" className="pfd-icon-close" onClick={onClose} aria-label="关闭问题明细">×</button></header>
      <div className="pfd-summary"><span>当前筛选条件</span><b>{contextLabels.length ? contextLabels.join(" · ") : "全部"}</b><span>客户数量 <strong>{filtered.length}</strong></span><span>差额金额合计 <strong>¥ {money(amount)}</strong></span></div>
      <div className="pfd-body">
        {loading ? <p className="pfd-state">正在读取问题客户…</p> : error ? <p className="pfd-state error">无法读取问题客户：{error}</p> : <><div className="pfd-tools"><input aria-label="搜索问题客户" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索客户、账套、负责人、方案…" /></div>{!filtered.length ? <p className="pfd-state">暂无符合当前条件的客户</p> : <><div className="pfd-table-wrap"><table><thead><tr><th>{sortLabel("客户名称", "customer")}</th><th>{sortLabel("账套", "accountSet")}</th><th>{sortLabel("区域", "region")}</th><th>{sortLabel("对账负责人", "owner")}</th><th>{sortLabel("差额金额", "amount")}</th><th>{sortLabel("问题类型", "reason")}</th><th>{sortLabel("当前状态", "status")}</th><th>{sortLabel("解决方案", "solution")}</th><th>{sortLabel("解决时间", "solutionDate")}</th></tr></thead><tbody>{displayed.map(({ item, reason, status, solution, solutionDate }) => <tr key={item.id}><td>{item.customer}</td><td>{item.accountSet || "—"}</td><td>{item.region}</td><td>{item.owner || "未填写"}</td><td className="pfd-amount">¥ {money(item.amount)}</td><td><span className="pfd-clamp" title={reason}>{reason}</span></td><td>{status}</td><td><span className="pfd-clamp" title={solution}>{solution}</span></td><td>{solutionDate}</td></tr>)}</tbody></table></div><nav className="pfd-pagination" aria-label="问题明细分页"><span>第 {activePage} / {pageCount} 页</span><button type="button" disabled={activePage <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><button type="button" disabled={activePage >= pageCount} onClick={() => setPage((value) => value + 1)}>下一页</button></nav></>}</>}
      </div>
      <footer className="pfd-footer"><button type="button" onClick={onClose}>关闭</button><button type="button" className="pfd-primary" onClick={onEnterFollowup}>{archive ? "进入已解决档案" : "进入未解决客户跟进"}</button></footer>
    </section>
  </div>;
}
