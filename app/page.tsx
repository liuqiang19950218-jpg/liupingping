"use client";

import { useState } from "react";
import { QuarterlyReconciliation } from "./QuarterlyReconciliation";
import { ReconciliationHistoryDashboard } from "./ReconciliationHistoryDashboard";
import { DashboardOverview } from "./DashboardOverview";
import { Q1ActionPanel } from "./Q1ActionPanel";
import { Q1SpecialPanels } from "./Q1SpecialPanels";
import { LiveIssueTracker } from "./LiveIssueTracker";
import { ManagementCockpit } from "./ManagementCockpit";
import "./app-shell.css";
import "./shell-overrides.css";

const T = { brand:"对账管理", sub:"季度对账与复核工具", history:"往年对账看板", current:"本年度对账详细情况", import:"数据导入", tracker:"未解决客户跟进", cockpit:"管理层驾驶舱", review:"财务复核看板", issue:"问题解决看板", local:"本机数据自动保存" };
type View = "history" | "current" | "import" | "tracker" | "cockpit";

export default function Home() {
  const [view, setView] = useState<View>("history");
  const [tab, setTab] = useState<"cockpit" | "review" | "issue">("cockpit");
  const title = view === "history" ? T.history : view === "current" ? T.current : view === "import" ? T.import : view === "tracker" ? T.tracker : T.cockpit;
  const hint = view === "history" ? "查看历史季度对清情况与专项信息" : view === "current" ? "查看、筛选、填写与导出对账明细" : view === "import" ? "上传季度表、替换往来明细与管理本机数据" : view === "tracker" ? "与本年度对账明细自动同步" : "聚合风险、差额、进度与跟进优先级";
  const [updatedAt] = useState(() => new Intl.DateTimeFormat("zh-CN", { dateStyle:"medium", timeStyle:"short", hour12:false }).format(new Date()));
  const cockpit = (next:"cockpit" | "review" | "issue") => { setTab(next); setView("cockpit"); };

  return <main className={`app-shell ${view === "current" ? "reconciliation-page" : ""}`}>
    <aside className="side-nav">
      <div className="side-brand"><i>账</i><div><strong>{T.brand}</strong><span>{T.sub}</span></div></div>
      <nav>
        <button className={view === "history" ? "selected" : ""} onClick={() => setView("history")}><i>◈</i>{T.history}</button>
        <button className={view === "current" ? "selected" : ""} onClick={() => setView("current")}><i>≡</i>{T.current}</button>
        <button className={view === "tracker" ? "selected" : ""} onClick={() => setView("tracker")}><i>●</i>{T.tracker}</button>
        <button className={view === "cockpit" && tab === "cockpit" ? "selected" : ""} onClick={() => cockpit("cockpit")}><i>◴</i>{T.cockpit}</button>
        <button className={view === "cockpit" && tab === "review" ? "selected" : ""} onClick={() => cockpit("review")}><i>✓</i>{T.review}</button>
        <button className={view === "cockpit" && tab === "issue" ? "selected" : ""} onClick={() => cockpit("issue")}><i>!</i>{T.issue}</button>
        <button className={view === "import" ? "selected" : ""} onClick={() => setView("import")}><i>↑</i>{T.import}</button>
        <button onClick={() => setView("current")}><i>⚙</i>系统设置</button>
      </nav>
      <div className="side-note"><b>使用说明</b><span>已解决客户会从待解决清单移出，并保留解决时间和方案供后续查看。</span></div>
    </aside>
    <section className="work-area">
      <header className="work-header"><div><h1>{title}</h1><p>{hint}</p></div><div className="header-status"><span>◷ {T.local}</span><small>{`更新时间：${updatedAt}`}</small></div></header>
      <div className="work-content">
        {view === "history" ? <><DashboardOverview selected={6}/><Q1ActionPanel/><Q1SpecialPanels/><ReconciliationHistoryDashboard/></> : view === "current" ? <QuarterlyReconciliation/> : view === "import" ? <QuarterlyReconciliation mode="import"/> : view === "tracker" ? <LiveIssueTracker/> : <ManagementCockpit activeTab={tab} onTabChange={setTab}/>} 
      </div>
    </section>
  </main>;
}
