"use client";

import { useEffect, useMemo, useState } from "react";
import { quarterOptions, selectQuarter, selectedQuarter } from "./quarter-storage";
import { formatMoney, formatRate, issueSummary, issuesForQuarter, topPendingIssuesByDifference, type ReconciliationIssue } from "./reconciliation-insights";
import "./problem-dashboard.css";

type Props = { onOpenFollowup: (filters?: Record<string, string>) => void };

const labels = [
  { key: "all", label: "未关闭问题" }, { key: "overdue", label: "超期未关闭" },
  { key: "untouched", label: "7 天未跟进" }, { key: "customer", label: "待客户回复" },
  { key: "finance", label: "需财务介入" }, { key: "high", label: "需领导介入" },
] as const;

export function ProblemDashboard({ onOpenFollowup }: Props) {
  const [quarter, setQuarter] = useState("");
  const [region, setRegion] = useState("全部区域");
  const [owner, setOwner] = useState("全部负责人");
  const [active, setActive] = useState("all");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const sync = () => { setQuarter(selectedQuarter()); setRevision((value) => value + 1); };
    sync(); window.addEventListener("reconciliation-updated", sync); window.addEventListener("reconciliation-quarter-updated", sync);
    return () => { window.removeEventListener("reconciliation-updated", sync); window.removeEventListener("reconciliation-quarter-updated", sync); };
  }, []);
  const items = useMemo(() => issuesForQuarter(quarter).filter((item) => (region === "全部区域" || item.region === region) && (owner === "全部负责人" || item.owner === owner)), [quarter, region, owner, revision]);
  const summary = useMemo(() => issueSummary(items), [items]);
  const regions = useMemo(() => [...new Set(issuesForQuarter(quarter).map((item) => item.region))], [quarter, revision]);
  const owners = useMemo(() => [...new Set(issuesForQuarter(quarter).map((item) => item.owner))], [quarter, revision]);
  const metrics: Record<string, ReconciliationIssue[]> = { all: items, overdue: summary.overdue, untouched: summary.untouched, customer: items.filter((item) => item.stage === "等待客户回复"), finance: summary.finance, high: summary.high };
  const drill = (key: string) => onOpenFollowup({ quarter, ...(region === "全部区域" ? {} : { region }), ...(owner === "全部负责人" ? {} : { owner }), filter: key });
  return <section className="pd-page">
    <section className="pd-filter"><label>对账季度<select value={quarter} onChange={(event) => { setQuarter(event.target.value); selectQuarter(event.target.value); }}>{quarterOptions().map((item) => <option key={item}>{item}</option>)}</select></label><label>区域<select value={region} onChange={(event) => setRegion(event.target.value)}><option>全部区域</option>{regions.map((item) => <option key={item}>{item}</option>)}</select></label><label>责任人<select value={owner} onChange={(event) => setOwner(event.target.value)}><option>全部负责人</option>{owners.map((item) => <option key={item}>{item}</option>)}</select></label><button onClick={() => { setRegion("全部区域"); setOwner("全部负责人"); setActive("all"); }}>重置筛选</button><button className="primary" onClick={() => setRevision((value) => value + 1)}>刷新数据</button></section>
    <p className="pd-alert">当前未关闭问题 <b>{items.length}</b> 个，其中超期 <b>{summary.overdue.length}</b> 个，7 天未跟进 <b>{summary.untouched.length}</b> 个，待客户回复 <b>{metrics.customer.length}</b> 个，请及时推进闭环。</p>
    <section className="pd-kpis">{labels.map(({ key, label }) => <button className={active === key ? "active" : ""} key={key} onClick={() => { setActive(key); drill(key); }}><span>{label}</span><strong>{metrics[key].length}</strong><small>{key === "finance" ? "需财务协同处理" : "点击进入执行台账"}</small></button>)}</section>
    <section className="pd-grid">
      <article className="pd-card pd-stage"><h2>问题处理阶段分布</h2>{summary.stages.map((item) => <button key={item.name} onClick={() => onOpenFollowup({ quarter, stage: item.name })}><span>{item.name}</span><i><b style={{ width: `${item.ratio * 100}%` }} /></i><strong>{item.count}</strong><em>{formatRate(item.ratio * 100)}</em></button>)}</article>
      <article className="pd-card"><h2>阻塞原因分析 Top5</h2>{summary.blockers.map((item) => <button className="pd-rank" key={item.name} onClick={() => onOpenFollowup({ quarter, cause: item.name })}><span title={item.name}>{item.name}</span><b>{item.count}</b><small>{formatRate(item.ratio * 100)}</small></button>)}</article>
      <article className="pd-card"><h2>责任人处理情况 Top5</h2><table><thead><tr><th>责任人</th><th>未关闭</th><th>超期</th><th>高风险</th></tr></thead><tbody>{summary.owners.map((item) => <tr key={item.name} onClick={() => onOpenFollowup({ quarter, owner: item.name })}><td>{item.name}</td><td>{item.count}</td><td className="danger">{item.overdue}</td><td className="danger">{item.high}</td></tr>)}</tbody></table></article>
      <article className="pd-card"><h2>风险优先级 Top5 <small>待解决客户 · 按对账差额</small></h2>{topPendingIssuesByDifference(items).map((item, index) => <button className="pd-risk" key={item.id} onClick={() => onOpenFollowup({ quarter, customer: item.customer })}><i>{index + 1}</i><span>{item.customer}<small>{item.region} · {item.owner || "未分配"}</small></span><b>{formatMoney(item.difference)}</b><em>{item.overdueDays} 天</em></button>)}</article>
    </section>
    <section className="pd-bottom"><article className="pd-card"><h2>问题账龄分布</h2><div className="pd-donut"><b>{items.length}<small>未关闭问题</small></b></div><div className="pd-age">{[["0-7天", 0, 7], ["8-30天", 8, 30], ["31-60天", 31, 60], ["61-90天", 61, 90], ["90天以上", 91, Infinity]].map(([label, min, max]) => { const count = items.filter((item) => item.overdueDays >= Number(min) && item.overdueDays <= Number(max)).length; return <button key={String(label)} onClick={() => onOpenFollowup({ quarter, aging: String(label) })}>{String(label)}<b>{count}</b></button>; })}</div></article><article className="pd-card pd-advice"><h2>下一步处理建议</h2><p>优先推进 <b>{summary.overdue.length}</b> 个超期问题，尤其是高风险和大额差异客户。</p><p>安排财务专人处理 <b>{summary.finance.length}</b> 个需财务介入事项。</p><p>督促责任人跟进 <b>{summary.untouched.length}</b> 个 7 天未更新问题。</p><button className="primary" onClick={() => drill("all")}>进入未解决客户跟进</button></article></section>
  </section>;
}
