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
      <div>
        <p>{quarter?.label ?? "当前季度"} PostgreSQL 数据</p>
        <h2>本季度数据概览</h2>
        <span>
          共读取 {rows.length}{" "}
          条原始明细；客户数按每一行统计、不做客户去重，已排除客户账面金额为空的未对账记录。已对清{" "}
          {clear} 家，未对清 {unclear} 家。
        </span>
      </div>
      <div>
        <b>{accountedRows.length}</b>
        <small>客户数（已排除未对账）</small>
      </div>
      <div>
        <b>{rate.toFixed(1)}%</b>
        <small>对清率（已排除未对账）</small>
      </div>
      <div>
        <b>
          {formatCents(unresolved / 10000n, 1)}
        </b>
        <small>未对清差额（万元）</small>
      </div>
    </section>
  );
}
