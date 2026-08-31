"use client";

import { useState } from "react";
import { formatCents, moneyToCents, useDashboardData } from "./dashboard-postgres-data";
import type { Reconciliation } from "../lib/api/reconciliation-api";
import { isSettled, isUnsettled, settlementRate } from "../lib/reconciliation-settlement-status.mjs";
import "./dashboard-overview.css";
import "./dashboard-overview-overrides.css";

type RegionAnalysis = {
  region: string;
  total: number;
  clear: number;
  unclear: number;
  unreconciledReceivable: bigint;
  rate: number;
  pendingAmount: bigint;
};
type Analysis = {
  quarter: string;
  rate: number;
  clear: number;
  unclear: number;
  unreconciledReceivable: bigint;
  exception: string;
  regions: RegionAnalysis[];
};
type DetailTemplate = { headers: string[]; rows: unknown[][] };

const displayCell = (value: unknown) => {
  const text = String(value ?? "").trim();
  return text || "\u2014";
};

function unreconciledDetailTemplate(rows: Reconciliation[]): DetailTemplate {
  return {
    headers: [
      "\u8d26\u5957", "\u533a\u57df", "\u5ba2\u6237\u540d\u79f0", "\u5bf9\u8d26\u8d1f\u8d23\u4eba",
      "\u516c\u53f8\u5e94\u6536", "\u5ba2\u6237\u8d26\u9762\u91d1\u989d", "\u5bf9\u8d26\u5dee\u989d", "\u662f\u5426\u5bf9\u6e05",
    ],
    rows: rows.filter(isUnsettled).map((row) => [
      row.accountSet, row.region, row.customer, row.ownerName, row.companyReceivable,
      row.customerBookAmount, row.reconciliationDifference, row.reconciliationStatus ?? "未填写",
    ]),
  };
}

function analyze(rows: Reconciliation[], quarter: string): Analysis {
  const accounted = rows.filter((row) => isSettled(row) || isUnsettled(row));
  const clear = accounted.filter(isSettled).length;
  const unclear = accounted.filter(isUnsettled).length;
  const unreconciledReceivable = accounted
    .filter(isUnsettled)
    .reduce((sum, row) => { const value = moneyToCents(row.companyReceivable) ?? 0n; return sum + (value < 0n ? -value : value); }, 0n);
  const map = new Map<string, RegionAnalysis>();
  accounted.forEach((row) => {
    const region = row.region || "未填写区域";
    const current = map.get(region) ?? {
      region,
      total: 0,
      clear: 0,
      unclear: 0,
      unreconciledReceivable: 0n,
      rate: 0,
      pendingAmount: 0n,
    };
    current.total += 1;
    if (isSettled(row)) current.clear += 1;
    else if (isUnsettled(row)) current.unclear += 1;
    // 核心异常中的待解决差额，统一按未对清客户的公司应收金额统计。
    if (isUnsettled(row)) {
      const value = moneyToCents(row.companyReceivable) ?? 0n;
      const absolute = value < 0n ? -value : value;
      current.pendingAmount += absolute;
      current.unreconciledReceivable += absolute;
    }
    map.set(region, current);
  });
  const regions = [...map.values()]
    .map((region) => ({
      ...region,
      rate: region.total ? (region.clear / region.total) * 100 : 0,
    }))
    .sort((a, b) => b.unclear - a.unclear || (a.pendingAmount === b.pendingAmount ? 0 : a.pendingAmount > b.pendingAmount ? -1 : 1));
  const exception = unclear
    ? `当前未对清 ${unclear} 家，未对清客户我方应收总额 ${formatCents(unreconciledReceivable)}。`
    : "当前已填写账面金额的客户均已对清。";
  return {
    quarter,
    rate: settlementRate({ settled: clear, unsettled: unclear }),
    clear,
    unclear,
    unreconciledReceivable,
    exception,
    regions,
  };
}

export function DashboardOverview() {
  const { quarter, rows, loading, error } = useDashboardData();
  const [drawer, setDrawer] = useState<"exception" | null>(null);
  const summary = analyze(rows, quarter?.label ?? "当前季度");
  const unreconciledDetails = unreconciledDetailTemplate(rows);
  if (loading) return <section className="dashboard-overview" aria-busy="true">正在读取 PostgreSQL 季度数据…</section>;
  if (error) return <section className="dashboard-overview dashboard-data-error" role="alert">季度看板数据读取失败：{error}</section>;
  return (
    <>
      <section className="dashboard-overview" aria-label="季度核心结论">
        <article className="overview-metric">
          <p>{summary.quarter} 数据结论</p>
          <h2>{summary.quarter} 账实相符率</h2>
          <strong>{summary.rate.toFixed(1)}%</strong>
        </article>
        <InsightCard
          icon="!"
          title="核心异常"
          text={summary.exception}
          action="查看详情"
          onClick={() => setDrawer("exception")}
          warning
        />
      </section>
      {drawer && (
        <div
          className="insight-backdrop"
          role="presentation"
          onMouseDown={() => setDrawer(null)}
        >
          <aside
            className="insight-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="insight-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="drawer-close"
              type="button"
              aria-label="关闭"
              onClick={() => setDrawer(null)}
            >
              ×
            </button>
            <p>
              {summary.quarter}{" "}
              核心异常
            </p>
            <h2 id="insight-title">
              需优先处理的对账事项
            </h2>
            <div className="drawer-rate">{summary.rate.toFixed(1)}%</div>
            <p className="drawer-copy">
              {summary.exception}
            </p>
            {drawer === "exception" && (
              <>
                <div className="detail-drawer-summary">
                  <span>未对清客户</span>
                  <strong>{unreconciledDetails.rows.length} 家</strong>
                  <em>数据与本季度对账详细情况同步</em>
                </div>
                <div className="overview-detail-table-wrap">
                  <table className="overview-detail-table">
                    <thead>
                      <tr>
                        {unreconciledDetails.headers.map((header, index) => (
                          <th key={`${header}-${index}`} scope="col">{header || "—"}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {unreconciledDetails.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {unreconciledDetails.headers.map((_, columnIndex) => (
                            <td key={columnIndex}>{displayCell(row[columnIndex])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!unreconciledDetails.rows.length && (
                    <p className="overview-detail-empty">当前季度暂无未对清客户</p>
                  )}
                </div>
              </>
            )}
            <button
              type="button"
              className="drawer-action"
              onClick={() => setDrawer(null)}
            >
              我知道了
            </button>
          </aside>
        </div>
      )}
    </>
  );
}

function InsightCard({
  icon,
  title,
  text,
  action,
  onClick,
  warning = false,
}: {
  icon: string;
  title: string;
  text: string;
  action: string;
  onClick: () => void;
  warning?: boolean;
}) {
  return (
    <article className="overview-insight">
      <div className="insight-icon" data-warning={warning || undefined}>
        {icon}
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      <button type="button" onClick={onClick}>
        {action} <span>›</span>
      </button>
    </article>
  );
}
