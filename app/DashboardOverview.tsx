"use client";

import { useDashboardData } from "./dashboard-postgres-data";
import { isSettled, isUnsettled, settlementRate } from "../lib/reconciliation-settlement-status.mjs";
import "./dashboard-overview.css";
import "./dashboard-overview-overrides.css";

export function DashboardOverview() {
  const { quarter, rows, loading, error } = useDashboardData();
  if (loading) return <section className="dashboard-overview" aria-busy="true">正在读取 PostgreSQL 季度数据…</section>;
  if (error) return <section className="dashboard-overview dashboard-data-error" role="alert">季度看板数据读取失败：{error}</section>;
  const accounted = rows.filter((row) => isSettled(row) || isUnsettled(row));
  const settled = accounted.filter(isSettled).length;
  return <section className="dashboard-overview dashboard-overview-single" aria-label="季度核心结论"><article className="overview-metric"><p>{quarter?.label ?? "当前季度"} 数据结论</p><h2>{quarter?.label ?? "当前季度"} 账实相符率</h2><strong>{settlementRate({ settled, unsettled: accounted.length - settled }).toFixed(1)}%</strong></article></section>;
}
