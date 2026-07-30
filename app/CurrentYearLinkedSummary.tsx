"use client";

import { useEffect, useState } from "react";
import { cockpitRows } from "./cockpit-data";
import { selectedQuarter } from "./quarter-storage";

export function CurrentYearLinkedSummary() {
  const [, setRevision] = useState(0);
  const [quarter, setQuarter] = useState("");
  useEffect(() => {
    const sync = () => { setQuarter(selectedQuarter()); setRevision((value) => value + 1); };
    sync();
    window.addEventListener("reconciliation-dashboard-updated", sync);
    window.addEventListener("reconciliation-quarter-selected", sync);
    window.addEventListener("reconciliation-quarter-updated", sync);
    return () => { window.removeEventListener("reconciliation-dashboard-updated", sync); window.removeEventListener("reconciliation-quarter-selected", sync); window.removeEventListener("reconciliation-quarter-updated", sync); };
  }, []);
  const rows = [...cockpitRows].filter((row) => !quarter || row.quarter === quarter),
    accountedRows = rows.filter((row) => row.filled),
    clear = accountedRows.filter((row) => row.cleared).length,
    unclear = accountedRows.length - clear,
    pendingRows = accountedRows.filter((row) => row.followStatus === "待跟进"),
    unresolved = pendingRows.reduce(
      (total, row) => total + Math.abs(row.difference),
      0,
    ),
    rate = accountedRows.length ? (clear / accountedRows.length) * 100 : 0;
  return (
    <section className="current-year-linked-summary">
      <div>
        <p>本年度对账详细情况 · 手动更新</p>
        <h2>本年度数据概览</h2>
        <span>
          本次同步共读取 {rows.length}{" "}
          条原始明细；客户数按每一行统计、不做客户去重，已排除客户账面金额为空的未对账记录。已对清{" "}
          {clear} 家，未对清 {unclear} 家；未解决差额仅汇总待解决清单的{" "}
          {pendingRows.length} 家客户。
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
          {unresolved.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}
        </b>
        <small>待解决差额</small>
      </div>
    </section>
  );
}
