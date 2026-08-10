"use client";

import { useMemo, useState } from "react";
import type { CockpitRow } from "./cockpit-data";

export type AgingLevel = "normal" | "attention" | "highAttention" | "highRisk";

export type DifferenceAgingDetail = {
  id: string;
  quarter: string;
  accountSet: string;
  customer: string;
  region: string;
  invoiceNo: string;
  invoiceDate: string;
  agingDays: number;
  differenceAmount: number;
  differenceReason: string;
  reconciliationStatus: string;
  owner: string;
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

const DEFINITION: Array<Pick<AgingBucket, "level" | "label" | "status">> = [
  { level: "normal", label: "≤90天", status: "正常" },
  { level: "attention", label: "91–180天", status: "关注" },
  { level: "highAttention", label: "181–365天", status: "重点关注" },
  { level: "highRisk", label: ">365天", status: "高风险" },
];

export const getAgingLevel = (days: number): AgingLevel => {
  if (days <= 90) return "normal";
  if (days <= 180) return "attention";
  if (days <= 365) return "highAttention";
  return "highRisk";
};

const parseDate = (value: string) => {
  const matched = String(value).match(/(19|20)\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}/);
  if (!matched) return null;
  const parts = matched[0].match(/\d+/g);
  if (!parts || parts.length < 3) return null;
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return Number.isNaN(date.getTime()) ? null : date;
};

export const quarterEndDate = (quarter: string) => {
  const match = String(quarter).match(/(20\d{2}).*?([1-4])/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) * 3, 0);
};

export const buildDifferenceAgingBuckets = (rows: CockpitRow[], quarter: string) => {
  const cutOff = quarterEndDate(quarter);
  const details = cutOff
    ? rows.flatMap((row) =>
        (row.differenceInvoices ?? []).flatMap((invoice, index) => {
          const invoiceDate = parseDate(invoice.date);
          if (!invoiceDate) return [];
          const agingDays = Math.max(0, Math.floor((cutOff.getTime() - invoiceDate.getTime()) / 86400000));
          return [{
            id: `${row.id}-${invoice.category}-${invoice.invoice}-${index}`,
            quarter: row.quarter,
            accountSet: row.accountSet,
            customer: row.customer,
            region: row.region,
            invoiceNo: invoice.invoice,
            invoiceDate: invoice.date,
            agingDays,
            differenceAmount: Math.abs(invoice.amount),
            differenceReason: row.cause || invoice.category,
            reconciliationStatus: !row.filled ? "未对账" : row.cleared ? "已对清" : "未对清",
            owner: row.owner,
            followStatus: row.followStatus,
          }];
        }),
      )
    : [];
  const total = details.reduce((sum, item) => sum + item.differenceAmount, 0);
  return DEFINITION.map((definition) => {
    const grouped = details.filter((detail) => getAgingLevel(detail.agingDays) === definition.level);
    const amount = grouped.reduce((sum, item) => sum + item.differenceAmount, 0);
    return {
      ...definition,
      amount,
      percentage: total ? Number(((amount / total) * 100).toFixed(1)) : 0,
      customerCount: new Set(grouped.map((item) => `${item.accountSet}-${item.customer}`)).size,
      invoiceCount: grouped.length,
      details: grouped,
    };
  }) satisfies AgingBucket[];
};

type CardProps = {
  buckets: AgingBucket[];
  onOpen: (bucket: AgingBucket) => void;
  formatAmount: (amount: number) => string;
};

export function DifferenceAgingAnalysisCard({ buckets, onOpen, formatAmount }: CardProps) {
  const maxAmount = Math.max(...buckets.map((bucket) => bucket.amount), 0);
  return (
    <article className="panel difference-aging-panel">
      <h3>
        A. 差额账龄分析
        <span className="aging-info" title="按照差额对应发票日期计算账龄，用于识别正常差额、超期差额及历史遗留风险。">i</span>
      </h3>
      <div className="aging-list" aria-label="差额账龄分析">
        {buckets.map((bucket) => {
          const width = maxAmount ? Math.max((bucket.amount / maxAmount) * 100, bucket.amount ? 3 : 0) : 0;
          return (
            <button
              className={`aging-row ${bucket.level}`}
              key={bucket.level}
              type="button"
              onClick={() => bucket.details.length && onOpen(bucket)}
              disabled={!bucket.details.length}
              title={bucket.details.length ? `${bucket.label}：点击查看明细` : "当前账龄区间暂无差额明细"}
            >
              <span className="aging-name"><strong>{bucket.label}</strong><i>{bucket.status}</i></span>
              <span className="aging-track"><span style={{ width: `${width}%` }} /></span>
              <span className="aging-amount">{formatAmount(bucket.amount)}</span>
              <span className="aging-percent">{bucket.percentage.toFixed(1)}%</span>
            </button>
          );
        })}
      </div>
      <p className="aging-footnote">91天以上需重点跟进，&gt;365天属于历史遗留高风险差额。</p>
    </article>
  );
}

type DrawerProps = {
  bucket: AgingBucket;
  onClose: () => void;
  onOpenReconciliation: (detail: DifferenceAgingDetail) => void;
  formatAmount: (amount: number) => string;
};

const riskNotice: Record<AgingLevel, string> = {
  normal: "当前差额处于正常处理周期，建议持续跟进。",
  attention: "该部分差额已超过正常三个月处理周期，建议加强跟进。",
  highAttention: "该部分差额已长期未解决，建议纳入重点事项管理。",
  highRisk: "历史遗留高风险差额，请优先核查往年发票及长期未解决原因。",
};

export function AgingDetailDrawer({ bucket, onClose, onOpenReconciliation, formatAmount }: DrawerProps) {
  const [accountSet, setAccountSet] = useState("全部");
  const [region, setRegion] = useState("全部");
  const [owner, setOwner] = useState("全部");
  const [reason, setReason] = useState("全部");
  const [customer, setCustomer] = useState("");
  const options = (key: keyof Pick<DifferenceAgingDetail, "accountSet" | "region" | "owner" | "differenceReason">) =>
    Array.from(new Set(bucket.details.map((item) => item[key]).filter(Boolean)));
  const details = useMemo(() => bucket.details
    .filter((item) => accountSet === "全部" || item.accountSet === accountSet)
    .filter((item) => region === "全部" || item.region === region)
    .filter((item) => owner === "全部" || item.owner === owner)
    .filter((item) => reason === "全部" || item.differenceReason === reason)
    .filter((item) => !customer.trim() || item.customer.includes(customer.trim()))
    .sort((a, b) => b.agingDays - a.agingDays || b.differenceAmount - a.differenceAmount),
  [bucket.details, accountSet, region, owner, reason, customer]);
  const total = details.reduce((sum, item) => sum + item.differenceAmount, 0);
  const average = details.length ? Math.round(details.reduce((sum, item) => sum + item.agingDays, 0) / details.length) : 0;
  return (
    <div className="cockpit-modal" role="presentation" onMouseDown={onClose}>
      <section className="cockpit-detail-dialog aging-detail-dialog" role="dialog" aria-modal="true" aria-label={`${bucket.label}差额明细`} onMouseDown={(event) => event.stopPropagation()}>
        <header className="cockpit-detail-head">
          <div>
            <span>差额账龄明细</span>
            <h2>{bucket.label}差额明细 <em>{bucket.status}{bucket.level === "highRisk" ? " · 历史遗留" : ""}</em></h2>
            <p>{bucket.invoiceCount}笔 ｜ {bucket.customerCount}户 ｜ {formatAmount(bucket.amount)} ｜ 平均{average}天</p>
          </div>
          <button className="modal-close" aria-label="关闭明细" onClick={onClose}>×</button>
        </header>
        <p className={`aging-risk-notice ${bucket.level}`}>{riskNotice[bucket.level]}</p>
        <div className="aging-drawer-filters">
          <select value={accountSet} onChange={(event) => setAccountSet(event.target.value)}><option>全部</option>{options("accountSet").map((value) => <option key={value}>{value}</option>)}</select>
          <input value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="筛选客户名称" aria-label="筛选客户名称" />
          <select value={region} onChange={(event) => setRegion(event.target.value)}><option>全部</option>{options("region").map((value) => <option key={value}>{value}</option>)}</select>
          <select value={reason} onChange={(event) => setReason(event.target.value)}><option>全部</option>{options("differenceReason").map((value) => <option key={value}>{value}</option>)}</select>
          <select value={owner} onChange={(event) => setOwner(event.target.value)}><option>全部</option>{options("owner").map((value) => <option key={value}>{value}</option>)}</select>
        </div>
        <div className="aging-drawer-summary">当前筛选：{details.length}笔 ｜ {new Set(details.map((item) => `${item.accountSet}-${item.customer}`)).size}户 ｜ {formatAmount(total)}</div>
        <div className="cockpit-detail-table-wrap">
          <table className="cockpit-detail-table cockpit-aging-detail-table">
            <thead><tr><th>账套</th><th>客户名称</th><th>区域</th><th>发票号</th><th>发票日期</th><th>账龄</th><th>差额金额</th><th>差额原因</th><th>对账状态</th><th>负责人</th><th>操作</th></tr></thead>
            <tbody>{details.map((detail) => <tr key={detail.id}><td>{detail.accountSet || "—"}</td><td className="detail-customer">{detail.customer}</td><td>{detail.region || "—"}</td><td>{detail.invoiceNo || "—"}</td><td>{detail.invoiceDate || "—"}</td><td>{detail.agingDays}天</td><td className="detail-money difference-money">{formatAmount(detail.differenceAmount)}</td><td><span className="detail-clamp" title={detail.differenceReason}>{detail.differenceReason || "—"}</span></td><td>{detail.reconciliationStatus}</td><td>{detail.owner || "—"}</td><td><button className="aging-open-reconciliation" onClick={() => onOpenReconciliation(detail)}>查看对账</button></td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
