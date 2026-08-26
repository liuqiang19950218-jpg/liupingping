"use client";

import { useEffect, useState } from "react";
import { cockpitRows, latestQuarterlyCockpitRows, type CockpitRow } from "./cockpit-data";
import { selectedQuarter, sheetForQuarter } from "./quarter-storage";
import "./dashboard-overview.css";
import "./dashboard-overview-overrides.css";

type RegionAnalysis = {
  region: string;
  total: number;
  clear: number;
  unclear: number;
  unreconciledReceivable: number;
  rate: number;
  pendingAmount: number;
};
type Analysis = {
  quarter: string;
  rate: number;
  clear: number;
  unclear: number;
  unreconciledReceivable: number;
  exception: string;
  regions: RegionAnalysis[];
};
type DetailTemplate = { headers: string[]; rows: unknown[][] };

const normalizeHeader = (value: unknown) => String(value ?? "").replace(/\s/g, "");
const displayCell = (value: unknown) => {
  const text = String(value ?? "").trim();
  return text || "\u2014";
};

function unreconciledDetailTemplate(
  quarter: string,
  fallbackRows: CockpitRow[],
): DetailTemplate {
  const sheet = sheetForQuarter(quarter);
  if (sheet?.headers?.length) {
    const headers = sheet.headers.map((header) => String(header ?? ""));
    const statusIndex = headers.findIndex((header) =>
      normalizeHeader(header).includes("\u662f\u5426\u5bf9\u6e05"),
    );
    if (statusIndex >= 0)
      return {
        headers,
        rows: sheet.rows.filter(
          (row) => String(row[statusIndex] ?? "").trim() === "\u672a\u5bf9\u6e05",
        ),
      };
  }
  return {
    headers: [
      "\u8d26\u5957", "\u533a\u57df", "\u5ba2\u6237\u540d\u79f0", "\u5bf9\u8d26\u8d1f\u8d23\u4eba",
      "\u516c\u53f8\u5e94\u6536", "\u5ba2\u6237\u8d26\u9762\u91d1\u989d", "\u5bf9\u8d26\u5dee\u989d", "\u662f\u5426\u5bf9\u6e05",
    ],
    rows: fallbackRows.filter((row) => row.filled && !row.cleared).map((row) => [
      row.accountSet, row.region, row.customer, row.owner, row.companyReceivable,
      row.customerBook, row.difference, "\u672a\u5bf9\u6e05",
    ]),
  };
}

function analyze(rows: CockpitRow[]): Analysis {
  const accounted = rows.filter((row) => row.filled);
  const clear = accounted.filter((row) => row.cleared).length;
  const unclear = accounted.length - clear;
  const unreconciledReceivable = accounted
    .filter((row) => !row.cleared)
    .reduce((sum, row) => sum + Math.abs(row.companyReceivable), 0);
  const map = new Map<string, RegionAnalysis>();
  accounted.forEach((row) => {
    const region = row.region || "未填写区域";
    const current = map.get(region) ?? {
      region,
      total: 0,
      clear: 0,
      unclear: 0,
      unreconciledReceivable: 0,
      rate: 0,
      pendingAmount: 0,
    };
    current.total += 1;
    if (row.cleared) current.clear += 1;
    else current.unclear += 1;
    // 核心异常中的待解决差额，统一按未对清客户的公司应收金额统计。
    if (!row.cleared) {
      current.pendingAmount += Math.abs(row.companyReceivable);
      current.unreconciledReceivable += Math.abs(row.companyReceivable);
    }
    map.set(region, current);
  });
  const regions = [...map.values()]
    .map((region) => ({
      ...region,
      rate: region.total ? (region.clear / region.total) * 100 : 0,
    }))
    .sort((a, b) => b.unclear - a.unclear || b.pendingAmount - a.pendingAmount);
  const exception = unclear
    ? `当前未对清 ${unclear} 家，未对清客户我方应收总额 ${unreconciledReceivable.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}。`
    : "当前已填写账面金额的客户均已对清。";
  return {
    quarter: rows[0]?.quarter || "当前季度",
    rate: accounted.length ? (clear / accounted.length) * 100 : 0,
    clear,
    unclear,
    unreconciledReceivable,
    exception,
    regions,
  };
}

export function DashboardOverview({
  selected: _selected,
}: {
  selected: number;
}) {
  const [, setRevision] = useState(0);
  const [quarter, setQuarter] = useState("");
  const [drawer, setDrawer] = useState<"exception" | null>(null);
  useEffect(() => {
    const sync = () => setRevision((value) => value + 1);
    const refresh = () => { setQuarter(selectedQuarter()); sync(); };
    refresh();
    window.addEventListener("reconciliation-dashboard-updated", refresh);
    window.addEventListener("reconciliation-quarter-selected", refresh);
    window.addEventListener("reconciliation-quarter-updated", refresh);
    return () => { window.removeEventListener("reconciliation-dashboard-updated", refresh); window.removeEventListener("reconciliation-quarter-selected", refresh); window.removeEventListener("reconciliation-quarter-updated", refresh); };
  }, []);
  const liveRows = latestQuarterlyCockpitRows();
  const scopedRows = (liveRows.length ? liveRows : cockpitRows).filter(
    (row) => !quarter || row.quarter === quarter,
  );
  const summary = analyze(scopedRows);
  const unreconciledDetails = unreconciledDetailTemplate(
    quarter || summary.quarter,
    scopedRows,
  );
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
