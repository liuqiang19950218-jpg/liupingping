"use client";

import { useMemo, useState } from "react";
import type { CockpitRow } from "./cockpit-data";

export type AgingLevel = "normal" | "attention" | "highAttention" | "highRisk";

export type DifferenceAgingDetail = {
  id: string;
  reconciliationId: string;
  quarter: string;
  accountSet: string;
  accountSetId: string;
  customer: string;
  customerId: string;
  region: string;
  invoiceNo: string;
  invoiceId: string;
  invoiceDate: string;
  agingDays: number;
  differenceAmount: number;
  differenceReason: string;
  reconciliationStatus: string;
  owner: string;
  ownerId: string;
  followStatus: string;
};

export type AgingBucket = {
  level: AgingLevel;
  label: string;
  status: string;
  amount: number;
  percentage: number;
  customerCount: number;
  invoiceCount: number;
  details: DifferenceAgingDetail[];
};

type CustomerDifferenceGroup = {
  key: string;
  customerId: string;
  customer: string;
  accountSet: string;
  accountSetId: string;
  region: string;
  owner: string;
  invoiceCount: number;
  totalDifferenceAmount: number;
  maxAgingDays: number;
  invoices: DifferenceAgingDetail[];
};

const DEFINITION: Array<Pick<AgingBucket, "level" | "label" | "status">> = [
  { level: "normal", label: "≤90天", status: "正常" },
  { level: "attention", label: "91–180天", status: "关注" },
  { level: "highAttention", label: "181–365天", status: "重点关注" },
  { level: "highRisk", label: ">365天", status: "高风险" },
];

const ALL = "全部";

export const getAgingLevel = (days: number): AgingLevel => {
  if (days <= 90) return "normal";
  if (days <= 180) return "attention";
  if (days <= 365) return "highAttention";
  return "highRisk";
};

const withinAgingLevel = (days: number, level: AgingLevel) =>
  getAgingLevel(days) === level;

const parseDate = (value: string) => {
  const matched = String(value).match(/(19|20)\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}/);
  if (!matched) return null;
  const parts = matched[0].match(/\d+/g);
  if (!parts || parts.length < 3) return null;
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeDate = (value: string) => {
  const parsed = parseDate(value);
  if (!parsed) return value || "—";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
};

export const quarterEndDate = (quarter: string) => {
  const match = String(quarter).match(/(20\d{2}).*?([1-4])/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) * 3, 0);
};

export const buildDifferenceAgingBuckets = (rows: CockpitRow[], quarter: string) => {
  const cutoff = quarterEndDate(quarter);
  const details: DifferenceAgingDetail[] = cutoff
    ? rows.flatMap((row) =>
        (row.differenceInvoices ?? []).flatMap((invoice, index) => {
          const invoiceDate = parseDate(invoice.date);
          if (!invoiceDate) return [];
          const agingDays = Math.max(0, Math.floor((cutoff.getTime() - invoiceDate.getTime()) / 86400000));
          const invoiceNo = String(invoice.invoice ?? "").trim();
          return [{
            id: `${row.id}-${invoice.category}-${invoiceNo}-${index}`,
            reconciliationId: row.id,
            quarter: row.quarter,
            accountSet: row.accountSet,
            accountSetId: row.accountSet,
            customer: row.customer,
            customerId: row.id,
            region: row.region,
            invoiceNo,
            invoiceId: `${row.id}-${invoiceNo}`,
            invoiceDate: normalizeDate(invoice.date),
            agingDays,
            differenceAmount: Math.abs(invoice.amount),
            // Prefer the invoice-level 差额说明 from quarterly details. If it has
            // not been filled in, retain the original invoice difference category
            // (在途、退票、丢票、仪器设备、其他等) as the business fallback.
            differenceReason: String(invoice.note ?? "").trim() || String(invoice.category ?? "").trim(),
            reconciliationStatus: !row.filled ? "未对账" : row.cleared ? "已对清" : "未对清",
            owner: row.owner,
            ownerId: row.owner,
            followStatus: row.followStatus,
          }];
        }),
      )
    : [];
  const total = details.reduce((sum, item) => sum + item.differenceAmount, 0);
  return DEFINITION.map((definition) => {
    const grouped = details.filter((detail) => withinAgingLevel(detail.agingDays, definition.level));
    const amount = grouped.reduce((sum, item) => sum + item.differenceAmount, 0);
    return {
      ...definition,
      amount,
      percentage: total ? Number(((amount / total) * 100).toFixed(1)) : 0,
      customerCount: new Set(grouped.map((item) => `${item.accountSetId}__${item.customerId}`)).size,
      invoiceCount: new Set(grouped.map((item) => item.invoiceId || `${item.accountSetId}__${item.customerId}__${item.invoiceNo}`)).size,
      details: grouped,
    } satisfies AgingBucket;
  });
};

type CardProps = { buckets: AgingBucket[]; onOpen: (bucket: AgingBucket) => void; formatAmount: (amount: number) => string };

export function DifferenceAgingAnalysisCard({ buckets, onOpen, formatAmount }: CardProps) {
  const maxAmount = Math.max(...buckets.map((bucket) => bucket.amount), 0);
  return <article className="panel difference-aging-panel">
    <h3>A. 差额账龄分析 <span className="aging-info" title="按照差额对应发票日期计算账龄，用于识别正常差额、超期差额及历史遗留风险。">i</span></h3>
    <div className="aging-list" aria-label="差额账龄分析">
      {buckets.map((bucket) => {
        const width = maxAmount ? Math.max((bucket.amount / maxAmount) * 100, bucket.amount ? 3 : 0) : 0;
        return <button className={`aging-row ${bucket.level}`} key={bucket.level} type="button" onClick={() => bucket.details.length && onOpen(bucket)} disabled={!bucket.details.length} title={bucket.details.length ? `${bucket.label}：点击查看总表明细` : "当前账龄区间暂无差额明细"}>
          <span className="aging-name"><strong>{bucket.label}</strong><i>{bucket.status}</i></span>
          <span className="aging-track"><span style={{ width: `${width}%` }} /></span>
          <span className="aging-amount">{formatAmount(bucket.amount)}</span>
          <span className="aging-percent">{bucket.percentage.toFixed(1)}%</span>
        </button>;
      })}
    </div>
    <p className="aging-footnote">91天以上需重点跟进，&gt;365天属于历史遗留高风险差额。</p>
  </article>;
}

const riskNotice: Record<AgingLevel, string> = {
  normal: "当前差额处于正常处理周期，建议持续跟进。",
  attention: "已超过正常三个月处理周期，建议加强跟进。",
  highAttention: "长期未解决，建议纳入重点关注。",
  highRisk: "历史遗留高风险差额，请优先核查往年发票及长期未解决原因。",
};

const statusClass = (value: string) => value === "已对清" ? "cleared" : value === "未对清" ? "uncleared" : "unaccounted";

function groupByCustomer(details: DifferenceAgingDetail[]): CustomerDifferenceGroup[] {
  const groups = details.reduce((map, item) => {
    const key = `${item.accountSetId}__${item.customerId}`;
    const current = map.get(key) ?? { key, customerId: item.customerId, customer: item.customer, accountSet: item.accountSet, accountSetId: item.accountSetId, region: item.region, owner: item.owner, invoiceCount: 0, totalDifferenceAmount: 0, maxAgingDays: 0, invoices: [] };
    current.invoices.push(item);
    current.totalDifferenceAmount += item.differenceAmount;
    current.maxAgingDays = Math.max(current.maxAgingDays, item.agingDays);
    map.set(key, current);
    return map;
  }, new Map<string, CustomerDifferenceGroup>());
  return [...groups.values()].map((group) => ({ ...group, invoiceCount: new Set(group.invoices.map((invoice) => invoice.invoiceId || invoice.invoiceNo)).size, invoices: [...group.invoices].sort((a, b) => b.agingDays - a.agingDays || b.differenceAmount - a.differenceAmount) })).sort((a, b) => b.maxAgingDays - a.maxAgingDays || b.totalDifferenceAmount - a.totalDifferenceAmount);
}

type DrawerProps = { bucket: AgingBucket; onClose: () => void; onOpenReconciliation: (detail: DifferenceAgingDetail) => void; formatAmount: (amount: number) => string };

export function AgingDetailDrawer({ bucket, onClose, onOpenReconciliation, formatAmount }: DrawerProps) {
  const [accountSet, setAccountSet] = useState(ALL);
  const [region, setRegion] = useState(ALL);
  const [owner, setOwner] = useState(ALL);
  const [reason, setReason] = useState(ALL);
  const [customer, setCustomer] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [showAllInvoices, setShowAllInvoices] = useState<Set<string>>(() => new Set());
  const options = (key: keyof Pick<DifferenceAgingDetail, "accountSet" | "region" | "owner" | "differenceReason">) => [...new Set(bucket.details.map((item) => item[key]).filter(Boolean))];
  const details = useMemo(() => bucket.details.filter((item) => withinAgingLevel(item.agingDays, bucket.level)).filter((item) => accountSet === ALL || item.accountSet === accountSet).filter((item) => region === ALL || item.region === region).filter((item) => owner === ALL || item.owner === owner).filter((item) => reason === ALL || item.differenceReason === reason).filter((item) => !customer.trim() || item.customer.includes(customer.trim())).sort((a, b) => b.agingDays - a.agingDays || b.differenceAmount - a.differenceAmount), [bucket, accountSet, region, owner, reason, customer]);
  const groups = useMemo(() => groupByCustomer(details), [details]);
  const total = details.reduce((sum, item) => sum + item.differenceAmount, 0);
  const average = details.length ? Math.round(details.reduce((sum, item) => sum + item.agingDays, 0) / details.length) : 0;
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(groups.length / pageSize));
  const pageGroups = groups.slice((page - 1) * pageSize, page * pageSize);
  const reset = () => { setAccountSet(ALL); setRegion(ALL); setOwner(ALL); setReason(ALL); setCustomer(""); setPage(1); };
  const query = () => setPage(1);
  const toggle = (key: string) => setExpanded((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const toggleAllInvoices = (key: string) => setShowAllInvoices((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; });
  if (details.some((item) => !withinAgingLevel(item.agingDays, bucket.level)) && process.env.NODE_ENV !== "production") console.warn("[DifferenceAging] Invalid aging detail", details.filter((item) => !withinAgingLevel(item.agingDays, bucket.level)));
  if (Math.abs(total - bucket.amount) > 100 && accountSet === ALL && region === ALL && owner === ALL && reason === ALL && !customer.trim() && process.env.NODE_ENV !== "production") console.warn("[DifferenceAging] Amount mismatch", { bucket: bucket.amount, drawer: total });
  const earliest = bucket.level === "highRisk" && details.length ? [...details].sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate))[0] : null;
  return <div className="cockpit-modal aging-drawer-overlay" role="presentation" onMouseDown={onClose}>
    <section className="cockpit-detail-dialog aging-detail-dialog" role="dialog" aria-modal="true" aria-label={`${bucket.label}差额总表`} onMouseDown={(event) => event.stopPropagation()}>
      <header className="cockpit-detail-head">
        <div><span>来源：<b>A. 差额账龄分析</b></span><h2>{bucket.label}差额总表 <em>{bucket.status}</em></h2></div>
        <button className="modal-close" aria-label="关闭差额总表" onClick={onClose}>×</button>
      </header>
      <div className="aging-drawer-body">
        <div className="aging-summary-strip"><div><small>客户数</small><strong>{new Set(details.map((item) => `${item.accountSetId}__${item.customerId}`)).size}</strong></div><div><small>发票数</small><strong>{new Set(details.map((item) => item.invoiceId || `${item.accountSetId}__${item.customerId}__${item.invoiceNo}`)).size}</strong></div><div><small>差额总金额</small><strong className="aging-summary-money">{formatAmount(total)}</strong></div><div><small>平均账龄</small><strong>{average}天</strong></div>{earliest && <div className="aging-extra-summary"><small>最早发票</small><strong>{earliest.invoiceDate}</strong></div>}</div>
        <p className={`aging-risk-notice ${bucket.level}`}>{riskNotice[bucket.level]}</p>
        <div className="aging-drawer-filters"><select value={accountSet} onChange={(event) => setAccountSet(event.target.value)} aria-label="账套"><option>{ALL}</option>{options("accountSet").map((value) => <option key={value}>{value}</option>)}</select><select value={region} onChange={(event) => setRegion(event.target.value)} aria-label="区域"><option>{ALL}</option>{options("region").map((value) => <option key={value}>{value}</option>)}</select><select value={owner} onChange={(event) => setOwner(event.target.value)} aria-label="负责人"><option>{ALL}</option>{options("owner").map((value) => <option key={value}>{value}</option>)}</select><input value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="搜索客户名称" aria-label="搜索客户名称" /><select value={reason} onChange={(event) => setReason(event.target.value)} aria-label="差额说明"><option>{ALL}</option>{options("differenceReason").map((value) => <option key={value}>{value}</option>)}</select><button type="button" className="aging-filter-reset" onClick={reset}>重置</button><button type="button" className="aging-filter-query" onClick={query}>查询</button></div>
        <div className="aging-drawer-summary">当前筛选：{groups.length}户客户 ｜ {new Set(details.map((item) => item.invoiceId || item.invoiceNo)).size}张发票 ｜ 差额{formatAmount(total)}</div>
        <div className="aging-customer-list">{pageGroups.length ? pageGroups.map((group) => { const isExpanded = expanded.has(group.key); const visibleInvoices = showAllInvoices.has(group.key) ? group.invoices : group.invoices.slice(0, 6); return <article className={`aging-customer-group ${bucket.level}`} key={group.key}><header className="aging-customer-head" onClick={() => toggle(group.key)}><div className="aging-customer-main"><b>{group.customer}</b><span>账套：{group.accountSet || "—"}</span><span>区域：{group.region || "—"}</span><span>负责人：{group.owner || "—"}</span></div><div className="aging-customer-metrics"><span>差额合计<strong>{formatAmount(group.totalDifferenceAmount)}</strong></span><span>发票数<strong>{group.invoiceCount}</strong></span><span>最长账龄<strong>{group.maxAgingDays}天</strong></span><button type="button" className="aging-open-reconciliation" onClick={(event) => { event.stopPropagation(); onOpenReconciliation(group.invoices[0]); }}>查看对账</button><button type="button" className="aging-expand" aria-label={isExpanded ? "收起发票明细" : "展开发票明细"} onClick={(event) => { event.stopPropagation(); toggle(group.key); }}>{isExpanded ? "⌃" : "⌄"}</button></div></header>{isExpanded && <div className="aging-invoice-table-wrap"><table className="aging-invoice-table"><thead><tr><th>发票日期</th><th>发票号</th><th>差额金额（元）</th><th>差额说明</th><th>账龄</th><th>对账状态</th></tr></thead><tbody>{visibleInvoices.map((invoice) => <tr key={invoice.id}><td>{invoice.invoiceDate}</td><td><button type="button" className="aging-invoice-link" onClick={() => onOpenReconciliation(invoice)}>{invoice.invoiceNo || "—"}</button></td><td className="aging-invoice-money">{invoice.differenceAmount.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</td><td><span className="aging-reason" title={invoice.differenceReason}>{invoice.differenceReason}</span></td><td className="aging-invoice-days">{invoice.agingDays}天</td><td><span className={`aging-status ${statusClass(invoice.reconciliationStatus)}`}>{invoice.reconciliationStatus}</span></td></tr>)}</tbody></table>{group.invoices.length > 6 && <button type="button" className="aging-show-all" onClick={() => toggleAllInvoices(group.key)}>{showAllInvoices.has(group.key) ? "收起发票明细" : `查看全部 ${group.invoices.length} 张发票`} {showAllInvoices.has(group.key) ? "⌃" : "⌄"}</button>}</div>}</article>; }) : <div className="aging-empty">当前筛选条件下暂无差额客户</div>}</div>
        {groups.length > pageSize && <nav className="aging-pagination" aria-label="客户分页"><span>共 {groups.length} 个客户</span><button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>上一页</button><b>{page} / {totalPages}</b><button type="button" disabled={page === totalPages} onClick={() => setPage((value) => value + 1)}>下一页</button></nav>}
      </div>
    </section>
  </div>;
}
