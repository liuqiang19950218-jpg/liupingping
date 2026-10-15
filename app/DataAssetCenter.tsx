"use client";

import { useEffect, useState } from "react";

type AssetSummary = {
  customers: number;
  reconciliations: number;
  differenceItems: number;
  materialStatus: number;
  spdDashboardRows: number;
  followupItems: number;
  ledgerDatasets: number;
  ledgerInvoices: number;
  quarters: number;
};

type QuarterCoverage = {
  quarter: string;
  reconciliations: number;
  differenceItems: number;
  materialStatus: number;
  spdDashboardRows: number;
  followupItems: number;
};

type DataAssetPayload = {
  summary?: AssetSummary;
  quarterCoverage?: QuarterCoverage[];
  error?: string;
};

const formatCount = (value: number) => value.toLocaleString();

export function DataAssetCenter() {
  const [assets, setAssets] = useState<DataAssetPayload | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/data-assets", { cache: "no-store" });
        const payload = await response.json() as DataAssetPayload;
        if (!response.ok || !payload.summary || !Array.isArray(payload.quarterCoverage)) {
          throw new Error(payload.error || "资产统计读取失败");
        }
        if (!active) return;
        setAssets(payload);
        setLoadError("");
      } catch (error) {
        if (active) {
          setAssets(null);
          setLoadError(error instanceof Error ? error.message : "资产统计读取失败");
        }
      }
    })();
    return () => { active = false; };
  }, []);

  const summary = assets?.summary;
  const cards = summary ? [
    ["客户档案", summary.customers, "recon.customers"],
    ["季度对账", summary.reconciliations, "recon.reconciliations"],
    ["差额数据", summary.differenceItems, "recon.difference_items"],
    ["资料状态", summary.materialStatus, "recon.material_status"],
    ["SPD 数据", summary.spdDashboardRows, "recon.spd_dashboard_rows"],
    ["跟进数据", summary.followupItems, "recon.followup_items"],
  ] as const : [];

  return (
    <section className="data-asset-center" aria-label="数据资产中心">
      <div className="data-asset-heading">
        <div>
          <p>POSTGRESQL DATA ASSETS</p>
          <h3>数据资产中心</h3>
          <span>实时读取 PostgreSQL 资产统计，不写入、不缓存业务数据。</span>
        </div>
        {summary && <small>已登记季度 {formatCount(summary.quarters)} · 历史底库 {formatCount(summary.ledgerDatasets)} · 旧台账发票 {formatCount(summary.ledgerInvoices)}</small>}
      </div>

      {loadError ? <p className="data-asset-empty" role="status">暂无资产统计</p> : !summary ? <p className="data-asset-empty">正在读取资产统计…</p> : <>
        <div className="data-asset-grid">
          {cards.map(([title, count, source]) => (
            <article className="data-asset-card" key={title}>
              <span>{title}</span>
              <strong>{formatCount(count)}</strong>
              <small>{source}</small>
            </article>
          ))}
        </div>
        <div className="data-asset-coverage">
          <div><strong>历史覆盖情况</strong><span>按季度汇总的真实 PostgreSQL 记录</span></div>
          {assets?.quarterCoverage?.length ? (
            <div className="data-asset-coverage-grid">
              {assets?.quarterCoverage?.map((coverage) => (
                <article className="data-asset-quarter-card" key={coverage.quarter}>
                  <strong>{coverage.quarter}</strong>
                  <span>对账 {formatCount(coverage.reconciliations)}</span>
                  <span>差额 {formatCount(coverage.differenceItems)}</span>
                  <span>资料 {formatCount(coverage.materialStatus)}</span>
                  <span>SPD {formatCount(coverage.spdDashboardRows)}</span>
                  <span>跟进 {formatCount(coverage.followupItems)}</span>
                </article>
              ))}
            </div>
          ) : <p>暂无季度覆盖记录</p>}
        </div>
      </>}
    </section>
  );
}
