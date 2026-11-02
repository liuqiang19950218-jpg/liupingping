"use client";

import { formatCents, moneyToCents, useDashboardData } from "./dashboard-postgres-data";
import { isSettled, isUnsettled, settlementRate } from "../lib/reconciliation-settlement-status.mjs";

export function CurrentYearLinkedSummary() {
  const { quarter, rows, loading, error } = useDashboardData();
  const accountedRows = rows.filter((row) => isSettled(row) || isUnsettled(row));
  const clear = accountedRows.filter(isSettled).length;
  const unclear = accountedRows.filter(isUnsettled).length;
  const unresolved = accountedRows
    .filter(isUnsettled)
    .reduce((total, row) => {
      const amount = moneyToCents(row.reconciliationDifference);
      return total + (amount === null ? 0n : amount < 0n ? -amount : amount);
    }, 0n);
  const rate = settlementRate({ settled: clear, unsettled: unclear });
  if (loading) return <section className="current-year-linked-summary" aria-busy="true"><span>正在读取 PostgreSQL 季度数据…</span></section>;
  if (error) return <section className="current-year-linked-summary dashboard-data-error" role="alert">季度看板数据读取失败：{error}</section>;
  return (
    <section className="current-year-linked-summary">
      <div className="summary-intro">
        <p>{quarter?.label ?? "当前季度"} 数据</p>
        <h2>本季度数据概览</h2>
        <span>已对清 {clear} 家，未对清 {unclear} 家；数据按当前季度 API 实时汇总。</span>
      </div>
      <article className="summary-metric customer-metric">
        <i aria-hidden="true">♙</i><div><small>客户数（已排除未对账）</small><b>{accountedRows.length}</b><em>↑ 数据持续汇总</em></div><span className="mini-bars" aria-hidden="true"><u/><u/><u/><u/><u/></span>
      </article>
      <article className="summary-metric rate-metric">
        <i aria-hidden="true">✓</i><div><small>对账率（已排除未对账）</small><b>{rate.toFixed(1)}%</b><em>↑ 本季度对账进展</em></div><span className="mini-line" aria-hidden="true" />
      </article>
      <article className="summary-metric amount-metric">
        <i aria-hidden="true">¥</i><div><small>未对账金额（万元）</small><b>{formatCents(unresolved / 10000n, 1)}</b><em>需持续跟进</em></div><span className="mini-bars" aria-hidden="true"><u/><u/><u/><u/><u/></span>
      </article>
    </section>
  );
}
