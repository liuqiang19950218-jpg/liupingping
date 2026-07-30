"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { selectedQuarter, sheetForQuarter, writeArchivedSheet } from "./quarter-storage";
import "./unresolved-followup.css";

type FollowUp = { time: string; solution: string };
type Detail = { resolutionSolution?: string; resolutionTime?: string; resolved?: boolean; reopened?: boolean; followUps?: FollowUp[] };
type Sheet = { headers: string[]; rows: unknown[][]; fileName: string; details?: Record<string, Detail> };
type Risk = "高风险" | "中风险" | "一般关注";
type Finance = "需财务复核" | "财务关注" | "一般关注" | "无需关注";
type Item = { id: number; quarter: string; accountSet: string; region: string; customer: string; owner: string; amount: number; firstTime: string; firstSolution: string; followUps: FollowUp[]; resolved: boolean };

const ALL = "全部区域";
const OVERDUE_DAYS = 7;
const LONG_UNTOUCHED_DAYS = 30;
const HIGH_AMOUNT = 100000;

const value = (row: unknown[], headers: string[], names: string[]) => {
  const index = headers.findIndex((header) => names.some((name) => String(header).replace(/\s/g, "").includes(name)));
  return index < 0 ? "" : String(row[index] ?? "").trim();
};
const amountOf = (value: unknown) => { const number = Number(String(value ?? "").replace(/,/g, "")); return Number.isFinite(number) ? number : 0; };
const money = (value: number) => value === 0 ? "0" : value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const dayDistance = (value: string) => { const time = new Date(`${value}T00:00:00`).getTime(); return Number.isNaN(time) ? null : Math.max(0, Math.floor((Date.now() - time) / 86_400_000)); };
const latest = (item: Item) => [...item.followUps].reverse().find((entry) => entry.time.trim())?.time.trim() || item.firstTime;
const text = (item: Item) => [item.firstSolution, ...item.followUps.map((entry) => entry.solution)].join(" ");
const financeOf = (item: Item): Finance => { const note = text(item); if (item.amount >= HIGH_AMOUNT || /死账|调账|退票|发票|核销/.test(note)) return "需财务复核"; if (/财务|退款|入账/.test(note)) return "财务关注"; if (item.amount > 0) return "一般关注"; return "无需关注"; };
const riskOf = (item: Item): Risk => { const days = dayDistance(latest(item)) ?? 0; if (days > 90 || item.amount >= HIGH_AMOUNT || financeOf(item) === "需财务复核") return "高风险"; if (days > 30 || item.amount > 0) return "中风险"; return "一般关注"; };
const financeStatus = (item: Item) => item.resolved ? "已关闭" : financeOf(item) === "需财务复核" ? "待财务反馈" : item.followUps.length ? "处理中" : "待处理";
const nextAction = (item: Item) => { const days = dayDistance(latest(item)) ?? 0; if (financeOf(item) === "需财务复核") return "提交财务专项复核"; if (days > 90) return "升级管理层并安排当日跟进"; if (days > OVERDUE_DAYS) return "提醒负责人更新跟进记录"; return "按当前方案持续推进"; };

function toItems(source?: Sheet): Item[] {
  if (!source?.headers?.length) return [];
  const match = `${source.fileName} ${source.headers.join(" ")}`.match(/(\d{2,4})\s*年?\s*([1-4])\s*季度/);
  const quarter = match ? `${match[1].length === 2 ? `20${match[1]}` : match[1]} Q${match[2]}` : selectedQuarter() || "未识别季度";
  return source.rows.map((row, id) => {
    const detail = source.details?.[String(id)] ?? {};
    const firstSolution = detail.resolutionSolution || value(row, source.headers, ["解决方案"]);
    const firstTime = detail.resolutionTime || value(row, source.headers, ["解决时间"]);
    const followUps = Array.isArray(detail.followUps) ? detail.followUps.filter((entry): entry is FollowUp => Boolean(entry && typeof entry.solution === "string")).map((entry) => ({ time: String(entry.time ?? ""), solution: String(entry.solution ?? "") })) : [];
    return { id, quarter, accountSet: value(row, source.headers, ["账套"]), region: value(row, source.headers, ["区域"]) || "未填写区域", customer: value(row, source.headers, ["客户名称"]), owner: value(row, source.headers, ["对账负责人"]), amount: amountOf(value(row, source.headers, ["对账差额"])), firstTime, firstSolution, followUps, resolved: detail.resolved === true || (Boolean(firstSolution && !firstTime) && detail.reopened !== true) };
  }).filter((item) => item.customer && item.firstSolution.trim());
}

function saveDetail(id: number, changes: Partial<Detail>) {
  const quarter = selectedQuarter();
  const sheet = sheetForQuarter(quarter) as Sheet | undefined;
  if (!sheet) return;
  const next: Sheet = { ...sheet, details: { ...(sheet.details ?? {}), [String(id)]: { ...(sheet.details?.[String(id)] ?? {}), ...changes } } };
  writeArchivedSheet(next);
  window.dispatchEvent(new Event("reconciliation-updated"));
}

function Badge({ type, children }: { type: string; children: string }) { return <span className={`uf-badge ${type}`}>{children}</span>; }

function AgingCylinderChart({ data }: { data: { label: string; value: number }[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const paint = () => {
      const rect = canvas.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      const width = Math.max(260, Math.floor(rect.width)); const height = 200;
      canvas.width = width * scale; canvas.height = height * scale;
      const context = canvas.getContext("2d"); if (!context) return;
      context.setTransform(scale, 0, 0, scale, 0, 0); context.clearRect(0, 0, width, height);
      const max = Math.max(1, ...data.map((item) => item.value)); const chartTop = 25; const chartBottom = 160; const columnWidth = Math.min(38, Math.max(24, (width - 70) / 8));
      context.font = "11px system-ui"; context.textAlign = "right"; context.fillStyle = "#7890a7";
      [0, .25, .5, .75, 1].forEach((tick) => { const y = chartBottom - (chartBottom - chartTop) * tick; context.strokeStyle = "#e9f0f7"; context.beginPath(); context.moveTo(28, y); context.lineTo(width - 8, y); context.stroke(); context.fillText(String(Math.round(max * tick)), 22, y + 4); });
      data.forEach((item, index) => { const step = (width - 45) / data.length; const x = 34 + step * index + (step - columnWidth) / 2; const valueHeight = Math.max(item.value ? 9 : 0, (item.value / max) * (chartBottom - chartTop)); const y = chartBottom - valueHeight; const gradient = context.createLinearGradient(0, y, 0, chartBottom); gradient.addColorStop(0, index === data.length - 1 ? "#f58a45" : "#86b9ff"); gradient.addColorStop(1, index === data.length - 1 ? "#ef4438" : "#1677ff"); context.fillStyle = gradient; context.beginPath(); context.roundRect(x, y, columnWidth, valueHeight, [columnWidth / 2, columnWidth / 2, 5, 5]); context.fill(); context.fillStyle = "#1d4f83"; context.textAlign = "center"; context.font = "700 11px system-ui"; context.fillText(String(item.value), x + columnWidth / 2, y - 7); context.fillStyle = "#617b95"; context.font = "10px system-ui"; context.fillText(item.label, x + columnWidth / 2, 181); });
    };
    paint(); const observer = new ResizeObserver(paint); observer.observe(canvas); return () => observer.disconnect();
  }, [data]);
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return <canvas ref={canvasRef} className="uf-aging-canvas" role="img" aria-label={`超期账龄分布：${data.map((item) => `${item.label}${item.value}个，占比${total ? (item.value / total * 100).toFixed(1) : 0}%`).join("；")}`} />;
}

export function UnresolvedFollowupDashboard() {
  const [items, setItems] = useState<Item[]>([]);
  const [region, setRegion] = useState(ALL);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [risk, setRisk] = useState("全部");
  const [finance, setFinance] = useState("全部");
  const [tab, setTab] = useState<"pending" | "resolved">("pending");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [editing, setEditing] = useState<Item | null>(null);
  const [followTime, setFollowTime] = useState("");
  const [followSolution, setFollowSolution] = useState("");
  const [detail, setDetail] = useState<Item | null>(null);
  const [message, setMessage] = useState("");
  const sync = () => setItems(toItems(sheetForQuarter(selectedQuarter()) as Sheet | undefined));
  useEffect(() => { sync(); window.addEventListener("reconciliation-updated", sync); window.addEventListener("reconciliation-quarter-selected", sync); window.addEventListener("reconciliation-quarter-updated", sync); return () => { window.removeEventListener("reconciliation-updated", sync); window.removeEventListener("reconciliation-quarter-selected", sync); window.removeEventListener("reconciliation-quarter-updated", sync); }; }, []);
  useEffect(() => { const timer = window.setTimeout(() => setSearch(query.trim().toLocaleLowerCase()), 250); return () => window.clearTimeout(timer); }, [query]);
  useEffect(() => { setPage(1); }, [region, search, risk, finance, tab, pageSize]);
  const pending = useMemo(() => items.filter((item) => !item.resolved), [items]);
  const resolved = useMemo(() => items.filter((item) => item.resolved), [items]);
  const base = tab === "pending" ? pending : resolved;
  const visible = useMemo(() => base.filter((item) => (region === ALL || item.region === region) && (!search || [item.customer, item.owner, item.region, item.accountSet].join(" ").toLocaleLowerCase().includes(search)) && (risk === "全部" || riskOf(item) === risk) && (finance === "全部" || financeOf(item) === finance)), [base, region, search, risk, finance]);
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const rows = visible.slice((page - 1) * pageSize, page * pageSize);
  const regions = useMemo(() => [...new Set(pending.map((item) => item.region))], [pending]);
  const overdue = useMemo(() => pending.filter((item) => (dayDistance(latest(item)) ?? 0) > OVERDUE_DAYS), [pending]);
  const overdueAmount = overdue.reduce((total, item) => total + Math.abs(item.amount), 0);
  const financeItems = pending.filter((item) => financeOf(item) !== "无需关注");
  const weekNew = pending.filter((item) => { const days = dayDistance(item.firstTime); return days !== null && days <= 7; }).length;
  const regionStats = useMemo(() => [ALL, ...regions].map((name) => { const list = name === ALL ? overdue : overdue.filter((item) => item.region === name); const amount = list.reduce((total, item) => total + Math.abs(item.amount), 0); return { name, list, amount, average: list.length ? Math.round(list.reduce((total, item) => total + (dayDistance(latest(item)) ?? 0), 0) / list.length) : 0 }; }), [regions, overdue]);
  const selectedOverdue = (region === ALL ? overdue : overdue.filter((item) => item.region === region)).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || (dayDistance(latest(b)) ?? 0) - (dayDistance(latest(a)) ?? 0));
  const aging = ["30天内", "31-60天", "61-90天", "90天以上"].map((label, index) => ({ label, value: overdue.filter((item) => { const days = dayDistance(latest(item)) ?? 0; return index === 0 ? days <= 30 : index === 1 ? days <= 60 : index === 2 ? days <= 90 : true; }).length }));
  const priority = useMemo(() => ({ top: [...overdue].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 5), untouched: pending.filter((item) => (dayDistance(latest(item)) ?? 0) > LONG_UNTOUCHED_DAYS), finance: pending.filter((item) => financeOf(item) === "需财务复核"), stalled: pending.filter((item) => item.followUps.length >= 2 && (dayDistance(latest(item)) ?? 0) > OVERDUE_DAYS) }), [overdue, pending]);
  const reset = () => { setRegion(ALL); setQuery(""); setRisk("全部"); setFinance("全部"); };
  const submitFollowUp = () => { if (!editing || !followSolution.trim()) { setMessage("请填写本次跟进解决方案。"); return; } saveDetail(editing.id, { followUps: [...editing.followUps, { time: followTime, solution: followSolution.trim() }], resolved: false, reopened: true }); setEditing(null); setFollowTime(""); setFollowSolution(""); setMessage("已保存跟进记录，首次解决方案与首次时间保持不变。"); };
  const resolve = (item: Item) => { saveDetail(item.id, { resolved: true, reopened: false }); setMessage("已转入已解决档案。"); };
  const restore = (item: Item) => { saveDetail(item.id, { resolved: false, reopened: true }); setMessage("已撤销解决状态，客户已回到待解决清单。"); };
  const exportRows = () => { const header = ["季度", "账套", "区域", "客户名称", "负责人", "对账差额", "超期天数", "财务关注", "财务处理状态", "首次解决时间", "首次解决方案", "最近跟进时间", "跟进解决方案"]; const content = [header, ...visible.map((item) => [item.quarter, item.accountSet, item.region, item.customer, item.owner, money(item.amount), String(dayDistance(latest(item)) ?? "—"), financeOf(item), financeStatus(item), item.firstTime, item.firstSolution, latest(item), item.followUps.map((entry) => entry.solution).join("；")])].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n"); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([`\ufeff${content}`], { type: "text/csv;charset=utf-8" })); link.download = `${selectedQuarter() || "季度"}-未解决客户跟进.csv`; link.click(); URL.revokeObjectURL(link.href); };
  const maxCustomers = Math.max(1, ...regionStats.map((item) => item.list.length));
  const maxAmount = Math.max(1, ...regionStats.map((item) => item.amount));
  const recommendations = [{ level: "high", text: `优先处理 ${priority.finance.length} 个需财务复核客户`, action: "提交财务专项处理" }, { level: "high", text: `催办 ${aging[3].value} 个超过 90 天未更新事项`, action: "升级管理层关注" }, { level: "medium", text: `跟进 ${priority.untouched.length} 个长期未更新客户`, action: "提醒负责人更新" }, { level: "medium", text: `复核 ${priority.stalled.length} 个多次跟进无进展事项`, action: "核对当前解决方案" }, { level: "normal", text: `持续推进 ${pending.length} 个待解决客户的处理闭环`, action: "查看待解决清单" }].filter((item) => !item.text.startsWith("优先处理 0") && !item.text.startsWith("催办 0") && !item.text.startsWith("跟进 0") && !item.text.startsWith("复核 0"));
  return <section className="uf-page" aria-busy={false}>
    <section className="uf-kpis" aria-label="未解决客户核心指标">
      {[{ label: "未解决客户总数", value: pending.length, tone: "blue", icon: "◉" }, { label: "超期客户数", value: overdue.length, tone: "orange", icon: "◷" }, { label: "超期金额总额", value: overdueAmount ? money(overdueAmount) : "—", tone: "red", icon: "¥" }, { label: "财务关注事项数", value: financeItems.length, tone: "purple", icon: "◆" }, { label: "本周新增问题数", value: weekNew, tone: "green", icon: "↗" }].map((card) => <article className={`uf-kpi ${card.tone}`} key={card.label}><i aria-hidden="true">{card.icon}</i><span>{card.label}</span><strong>{card.value}</strong><small>当前季度真实数据</small></article>)}
    </section>
    <section className="uf-card uf-table-card">
      <header className="uf-card-head"><div><p>与财务联动清单</p><h2>未解决客户跟进</h2><span>跟踪高风险客户、超期客户与财务重点关注客户，支持销售与财务协同处理。</span></div><div className="uf-tools"><select value={region} aria-label="按区域筛选" onChange={(event) => setRegion(event.target.value)}><option>{ALL}</option>{regions.map((name) => <option key={name}>{name}</option>)}</select><input value={query} aria-label="搜索客户或负责人" placeholder="搜索客户 / 负责人" onChange={(event) => setQuery(event.target.value)} /><select value={risk} aria-label="筛选风险等级" onChange={(event) => setRisk(event.target.value)}><option>全部</option><option>高风险</option><option>中风险</option><option>一般关注</option></select><select value={finance} aria-label="筛选财务关注状态" onChange={(event) => setFinance(event.target.value)}><option>全部</option><option>需财务复核</option><option>财务关注</option><option>一般关注</option></select><button type="button" className="uf-secondary" onClick={reset}>清空筛选</button><button type="button" className="uf-primary" onClick={exportRows}>导出</button></div></header>
      <div className="uf-tabs" role="tablist"><button role="tab" aria-selected={tab === "pending"} className={tab === "pending" ? "active" : ""} onClick={() => setTab("pending")}>待解决清单（{pending.length}）</button><button role="tab" aria-selected={tab === "resolved"} className={tab === "resolved" ? "active" : ""} onClick={() => setTab("resolved")}>已解决档案（{resolved.length}）</button></div>
      {message && <p className="uf-message" role="status">{message}</p>}
      <div className="uf-table-wrap"><table><thead><tr>{["季度", "区域", "客户名称", "负责人", "对账差额", "超期天数", "首次解决方案", "最近跟进时间", "跟进解决方案", "财务关注", "财务处理状态", "操作"].map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead><tbody>{rows.length ? rows.map((item) => { const days = dayDistance(latest(item)); return <tr key={item.id}><td>{item.quarter}</td><td>{item.region}</td><td className="uf-sticky-customer" title={item.customer}><strong>{item.customer}</strong><small>{item.accountSet || "—"}</small></td><td>{item.owner || "—"}</td><td className={item.amount ? "uf-money danger" : "uf-money muted"}>{money(item.amount)}</td><td>{days === null ? "—" : <span className={days > OVERDUE_DAYS ? "uf-overdue" : ""}>{days} 天</span>}</td><td><span className="uf-clamp" title={item.firstSolution}>{item.firstSolution}</span></td><td>{latest(item) || "—"}</td><td><span className="uf-clamp" title={item.followUps.map((entry) => entry.solution).join("；")}>{item.followUps.map((entry) => entry.solution).join("；") || "—"}</span></td><td><Badge type={financeOf(item)}>{financeOf(item)}</Badge></td><td><Badge type={financeStatus(item)}>{financeStatus(item)}</Badge></td><td className="uf-actions"><button type="button" className="uf-primary" onClick={() => { setEditing(item); setFollowTime(""); setFollowSolution(""); }}>跟进填写</button><button type="button" className="uf-secondary" onClick={() => setDetail(item)}>查看详情</button>{tab === "pending" ? <button type="button" className="uf-resolve" onClick={() => resolve(item)}>已解决</button> : <button type="button" className="uf-secondary" onClick={() => restore(item)}>撤销</button>}</td></tr>; }) : <tr><td className="uf-empty" colSpan={12}>没有符合当前条件的数据。<button type="button" onClick={reset}>清空筛选</button></td></tr>}</tbody></table></div>
      <footer className="uf-pagination"><span>共 {visible.length} 条记录</span><div><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><b>{page} / {pageCount}</b><button disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>下一页</button><select value={pageSize} aria-label="每页条数" onChange={(event) => setPageSize(Number(event.target.value))}><option value={10}>每页 10 条</option><option value={20}>每页 20 条</option><option value={50}>每页 50 条</option></select></div></footer>
    </section>
    <section className="uf-grid"><article className="uf-card uf-region"><header><div><p>超期客户区域跟踪</p><h2>超期客户按区域跟踪</h2></div><button type="button" onClick={() => setRegion(ALL)}>查看全部</button></header><div className="uf-region-body"><aside>{regionStats.map((stat) => <button key={stat.name} className={region === stat.name ? "selected" : ""} onClick={() => setRegion(stat.name)}><b>{stat.name}</b><span>{stat.list.length} 客户</span><em>¥ {money(stat.amount)}</em></button>)}</aside><div className="uf-region-customers"><div className="uf-region-metrics"><b><small>超期客户数</small>{selectedOverdue.length}</b><b><small>超期金额</small>¥ {money(selectedOverdue.reduce((sum, item) => sum + Math.abs(item.amount), 0))}</b><b><small>平均超期天数</small>{regionStats.find((stat) => stat.name === region)?.average ?? 0} 天</b><b><small>高风险客户数</small>{selectedOverdue.filter((item) => riskOf(item) === "高风险").length}</b><b><small>最近跟进时间</small>{selectedOverdue.map((item) => latest(item)).filter(Boolean).sort().at(-1) || "—"}</b></div>{selectedOverdue.length ? <div className="uf-overdue-cards">{selectedOverdue.slice(0, 5).map((item) => <button className="uf-customer-card" key={item.id} onClick={() => setDetail(item)}><div><strong title={item.customer}>{item.customer}</strong><Badge type={riskOf(item)}>{riskOf(item)}</Badge></div><span>区域：{item.region}　负责人：{item.owner || "未填写"}</span><span>对账差额：<b>{money(item.amount)}</b></span><span>超期金额：<b>{money(Math.abs(item.amount))}</b></span><span>超期天数：<b className="uf-overdue">{dayDistance(latest(item)) ?? 0} 天</b></span><span>财务处理：<b>{financeStatus(item)}</b></span><span>最近跟进：{latest(item) || "—"}</span><small>下一步建议：{nextAction(item)}</small></button>)}</div> : <p className="uf-no-data">当前区域暂无超期客户。</p>}</div></div></article><article className="uf-card uf-priority"><header><div><p>财务重点关注事项</p><h2>风险优先级</h2></div></header><div className="uf-priority-tabs"><b>大额超期 TOP5</b><span>长期未更新 {priority.untouched.length}</span><span>需财务介入 {priority.finance.length}</span><span>多次无进展 {priority.stalled.length}</span></div>{priority.top.length ? priority.top.map((item, index) => <button key={item.id} onClick={() => setDetail(item)}><i>{index + 1}</i><span><strong>{item.customer}</strong><small>{item.region} · {item.owner || "未填写负责人"}</small></span><b>{money(item.amount)}</b><em>{dayDistance(latest(item)) ?? 0} 天</em></button>) : <p className="uf-no-data">暂无可识别的财务重点事项。</p>}</article></section>
    <section className="uf-grid uf-charts"><article className="uf-card uf-distribution uf-count-distribution"><header><h2>超期客户区域分布</h2><span>单位：客户数</span></header>{regionStats.filter((stat) => stat.name !== ALL).map((stat) => <button className="uf-bar" key={stat.name} onClick={() => setRegion(stat.name)}><span>{stat.name}</span><i><b style={{ width: `${stat.list.length / maxCustomers * 100}%` }} /></i><strong>{stat.list.length}</strong><em>{(overdue.length ? stat.list.length / overdue.length * 100 : 0).toFixed(1)}%</em></button>)}</article><article className="uf-card uf-distribution uf-amount-distribution"><header><h2>超期金额区域分布</h2><span>单位：元</span></header>{regionStats.filter((stat) => stat.name !== ALL).map((stat) => <button className="uf-bar" key={stat.name} onClick={() => setRegion(stat.name)}><span>{stat.name}</span><i><b style={{ width: `${stat.amount / maxAmount * 100}%` }} /></i><strong>¥ {money(stat.amount)}</strong><em>{(overdueAmount ? stat.amount / overdueAmount * 100 : 0).toFixed(1)}%</em></button>)}</article><article className="uf-card"><h2>超期账龄分布</h2><AgingCylinderChart data={aging} /><p className="uf-chart-caption">按最近跟进时间统计，悬停或聚焦可查看账龄数量。</p></article><article className="uf-card uf-advice"><h2>下一步处理建议</h2>{recommendations.length ? recommendations.map((item) => <div key={item.text}><Badge type={item.level === "high" ? "高风险" : item.level === "medium" ? "中风险" : "一般关注"}>{item.level === "high" ? "高优先级" : item.level === "medium" ? "中优先级" : "一般优先级"}</Badge><span>{item.text}</span><small>{item.action}</small></div>) : <p className="uf-no-data">当前没有需要升级处理的事项。</p>}</article></section>
    {editing && <div className="uf-modal-backdrop" role="presentation" onMouseDown={() => setEditing(null)}><section className="uf-modal" role="dialog" aria-modal="true" aria-label="跟进填写" onMouseDown={(event) => event.stopPropagation()}><button className="uf-close" aria-label="关闭" onClick={() => setEditing(null)}>×</button><p>销售与财务协同跟进</p><h2>{editing.customer}</h2><span>对账差额：<b>{money(editing.amount)}</b>　首次方案：{editing.firstSolution}</span><label>跟进解决时间<input type="date" value={followTime} onChange={(event) => setFollowTime(event.target.value)} /></label><label>跟进解决方案<textarea value={followSolution} placeholder="填写本次跟进处理过程与下一步动作" onChange={(event) => setFollowSolution(event.target.value)} /></label><button className="uf-primary" onClick={submitFollowUp}>保存本次跟进</button></section></div>}
    {detail && <div className="uf-modal-backdrop" role="presentation" onMouseDown={() => setDetail(null)}><section className="uf-modal uf-detail" role="dialog" aria-modal="true" aria-label="客户详情" onMouseDown={(event) => event.stopPropagation()}><button className="uf-close" aria-label="关闭" onClick={() => setDetail(null)}>×</button><p>{detail.quarter} · {detail.region}</p><h2>{detail.customer}</h2><dl><div><dt>对账差额</dt><dd>{money(detail.amount)}</dd></div><div><dt>风险等级</dt><dd><Badge type={riskOf(detail)}>{riskOf(detail)}</Badge></dd></div><div><dt>财务关注</dt><dd><Badge type={financeOf(detail)}>{financeOf(detail)}</Badge></dd></div><div><dt>下一步建议</dt><dd>{nextAction(detail)}</dd></div></dl><h3>首次解决方案</h3><p>{detail.firstSolution}</p><h3>跟进记录</h3>{detail.followUps.length ? <ol>{detail.followUps.map((entry, index) => <li key={`${entry.time}-${index}`}><b>{entry.time || "未填写日期"}</b>{entry.solution}</li>)}</ol> : <p>暂无继续跟进记录。</p>}</section></div>}
  </section>;
}
