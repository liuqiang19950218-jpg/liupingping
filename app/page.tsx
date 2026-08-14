"use client";

import { useEffect, useState } from "react";
import { QuarterlyReconciliation } from "./QuarterlyReconciliation";
import { ReconciliationHistoryDashboard } from "./ReconciliationHistoryDashboard";
import { DashboardOverview } from "./DashboardOverview";
import { Q1ActionPanel } from "./Q1ActionPanel";
import { Q1SpecialPanels } from "./Q1SpecialPanels";
import { UnresolvedFollowupDashboard } from "./UnresolvedFollowupDashboard";
import { ManagementCockpit } from "./ManagementCockpit";
import { ProblemDashboard } from "./ProblemDashboard";
import { CurrentYearLinkedSummary } from "./CurrentYearLinkedSummary";
import { ServerStateBridge } from "./ServerStateBridge";
import { quarterOptions, selectQuarter, selectedQuarter } from "./quarter-storage";
import "./app-shell.css";
import "./shell-overrides.css";
import "./problem-dashboard-header.css";

const T = { brand:"对账管理", sub:"季度对账与复核工具", history:"对账看板", current:"本季度对账详细情况", import:"数据导入", tracker:"未解决客户跟进", cockpit:"管理层驾驶舱", issue:"问题解决看板", local:"本机数据自动保存" };
type View = "history" | "current" | "import" | "tracker" | "cockpit" | "problem";

function GlobalQuarterFilter() {
  const [quarters, setQuarters] = useState<string[]>([]);
  const [quarter, setQuarter] = useState("");
  useEffect(() => {
    const refresh = () => { setQuarters(quarterOptions()); setQuarter(selectedQuarter()); };
    refresh();
    window.addEventListener("reconciliation-quarter-updated", refresh);
    window.addEventListener("reconciliation-quarter-selected", refresh);
    return () => { window.removeEventListener("reconciliation-quarter-updated", refresh); window.removeEventListener("reconciliation-quarter-selected", refresh); };
  }, []);
  if (!quarters.length) return null;
  return <div className="global-quarter-filter"><label>对账季度<select value={quarter} aria-label="筛选看板季度" onChange={(event) => selectQuarter(event.target.value)}>{quarters.map((item) => <option value={item} key={item}>{item}</option>)}</select></label><span>切换后自动显示该季度数据</span></div>;
}

export default function Home() {
  const [view, setView] = useState<View>("history");
  const [tab, setTab] = useState<"cockpit" | "issue">("cockpit");
  const title = view === "history" ? T.history : view === "current" ? T.current : view === "import" ? T.import : view === "tracker" ? T.tracker : view === "problem" ? T.issue : T.cockpit;
  const hint = view === "history" ? "查看历史季度对清情况与专项信息" : view === "current" ? "查看、筛选、填写与导出对账明细" : view === "import" ? "上传季度表、替换往来明细与管理本机数据" : view === "tracker" ? "全量台账、持续跟进、动态处理" : view === "problem" ? "看问题、看责任、看进度、促闭环" : "看全局、看风险、看趋势、做决策";
  const [updatedAt] = useState(() => new Intl.DateTimeFormat("zh-CN", { dateStyle:"medium", timeStyle:"short", hour12:false }).format(new Date()));
  const cockpit = (next:"cockpit" | "issue") => { setTab(next); setView("cockpit"); };
  const openTracker = (filters: Record<string, string> = {}) => {
    const query = new URLSearchParams(filters).toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    window.dispatchEvent(new CustomEvent("reconciliation-followup-filter", { detail: filters }));
    setView("tracker");
  };
  useEffect(() => {
    const openCurrentDetail = () => setView("current");
    window.addEventListener("reconciliation-open-current-detail", openCurrentDetail);
    return () => window.removeEventListener("reconciliation-open-current-detail", openCurrentDetail);
  }, []);

  return <><ServerStateBridge /><main className={`app-shell ${view === "current" ? "reconciliation-page" : ""}`}>
    <aside className="side-nav">
      <div className="side-brand"><i>账</i><div><strong>{T.brand}</strong><span>{T.sub}</span></div></div>
      <nav>
        <button className={view === "history" ? "selected" : ""} onClick={() => setView("history")}><i>◈</i>{T.history}</button>
        <button className={view === "current" ? "selected" : ""} onClick={() => setView("current")}><i>≡</i>{T.current}</button>
        <button className={view === "tracker" ? "selected" : ""} aria-current={view === "tracker" ? "page" : undefined} onClick={() => openTracker()}><i>●</i>{T.tracker}</button>
        <button className={view === "cockpit" && tab === "cockpit" ? "selected" : ""} onClick={() => cockpit("cockpit")}><i>◴</i>{T.cockpit}</button>
        <button className={view === "problem" ? "selected" : ""} aria-current={view === "problem" ? "page" : undefined} onClick={() => setView("problem")}><i>!</i>{T.issue}</button>
        <button className={view === "import" ? "selected" : ""} onClick={() => setView("import")}><i>↑</i>{T.import}</button>
        <button onClick={() => setView("current")}><i>⚙</i>系统设置</button>
      </nav>
      <div className="side-note"><b>使用说明</b><span>已解决客户会从待解决清单移出，并保留解决时间和方案供后续查看。</span></div>
    </aside>
    <section className="work-area">
      <header className="work-header"><div><h1>{title}</h1><p>{hint}</p></div>{view === "problem" ? <div className="problem-header-actions"><small>{`◷ 数据更新时间：${updatedAt}`}</small><button onClick={() => window.dispatchEvent(new Event("problem-dashboard-refresh"))}>↻ 刷新数据</button><button className="primary" onClick={() => openTracker()}>进入未解决客户跟进 ›</button></div> : <div className="header-status"><span>◷ {T.local}</span><small>{`更新时间：${updatedAt}`}</small></div>}</header>
      <div className="work-content">
        {view !== "current" && view !== "import" && view !== "problem" && <GlobalQuarterFilter />}
        {view === "history" ? <><CurrentYearLinkedSummary/><DashboardOverview selected={6}/><Q1ActionPanel/><Q1SpecialPanels/><ReconciliationHistoryDashboard/></> : view === "current" ? <QuarterlyReconciliation/> : view === "import" ? <QuarterlyReconciliation mode="import"/> : view === "tracker" ? <UnresolvedFollowupDashboard/> : view === "problem" ? <ProblemDashboard onOpenFollowup={openTracker}/> : <ManagementCockpit activeTab={tab} onTabChange={setTab}/>} 
      </div>
    </section>
  </main></>;
}
