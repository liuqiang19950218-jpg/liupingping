"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IMPORT_HISTORY_UPDATED,
  backfillImportHistory,
  formatImportTime,
  importStatusLabel,
  importTypeLabel,
  readImportHistory,
  type ImportHistoryRecord,
  type LedgerImportSnapshot,
} from "./import-history";

type Props = { ledger?: LedgerImportSnapshot | null };
type Order = "desc" | "asc";

const isCompleted = (status: ImportHistoryRecord["status"]) =>
  status === "success" || status === "partial";

const asTime = (value?: string) => {
  if (!value) return -1;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? -1 : time;
};

const localDay = (value?: string) => {
  const time = asTime(value);
  if (time < 0) return "";
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const todayKey = () => localDay(new Date().toISOString());
const previousDayKey = () => {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return localDay(date.toISOString());
};

export function ImportDashboard({ ledger }: Props) {
  const [records, setRecords] = useState<ImportHistoryRecord[]>([]);
  const [order, setOrder] = useState<Order>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<ImportHistoryRecord | null>(null);

  useEffect(() => {
    const refresh = () => {
      backfillImportHistory(ledger);
      setRecords(readImportHistory());
    };
    refresh();
    window.addEventListener(IMPORT_HISTORY_UPDATED, refresh);
    window.addEventListener("reconciliation-quarter-updated", refresh);
    window.addEventListener("reconciliation-spd-sheet-updated", refresh);
    return () => {
      window.removeEventListener(IMPORT_HISTORY_UPDATED, refresh);
      window.removeEventListener("reconciliation-quarter-updated", refresh);
      window.removeEventListener("reconciliation-spd-sheet-updated", refresh);
    };
  }, [ledger]);

  const sorted = useMemo(
    () =>
      [...records].sort((left, right) => {
        const difference = asTime(right.importedAt) - asTime(left.importedAt);
        return order === "desc" ? difference : -difference;
      }),
    [records, order],
  );
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const activePage = Math.min(page, pageCount);
  const displayed = sorted.slice((activePage - 1) * pageSize, activePage * pageSize);

  const latest = sorted.find((record) => record.importedAt) ?? sorted[0];
  const totalRecords = records.reduce(
    (sum, record) => sum + (typeof record.recordCount === "number" ? record.recordCount : 0),
    0,
  );
  const today = todayKey();
  const yesterday = previousDayKey();
  const todayRecords = records.filter((record) => localDay(record.importedAt) === today && isCompleted(record.status));
  const yesterdayRecords = records.filter((record) => localDay(record.importedAt) === yesterday && isCompleted(record.status));
  const attempts = records.filter((record) => !record.isHistorical && ["success", "partial", "failed"].includes(record.status));
  const successful = attempts.filter((record) => isCompleted(record.status));
  const successRate = attempts.length ? (successful.length / attempts.length) * 100 : null;
  const yesterdayAttempts = records.filter((record) => localDay(record.importedAt) === yesterday && ["success", "partial", "failed"].includes(record.status));
  const yesterdayRate = yesterdayAttempts.length
    ? (yesterdayAttempts.filter((record) => isCompleted(record.status)).length / yesterdayAttempts.length) * 100
    : null;

  return (
    <section className="import-dashboard" aria-label="数据导入看板">
      <div className="import-dashboard-heading">
        <div>
          <h3>数据导入看板</h3>
          <p>按文件命名展示每次导入记录、数据库更新情况。</p>
        </div>
      </div>
      <div className="import-kpi-grid">
        <article className="import-kpi-card">
          <i className="import-kpi-icon upload" aria-hidden="true">↑</i>
          <div><span>今日导入次数</span><strong>{todayRecords.length} 次</strong><small>{todayRecords.length - yesterdayRecords.length >= 0 ? "较昨日 ↑ " : "较昨日 ↓ "}{Math.abs(todayRecords.length - yesterdayRecords.length)}</small></div>
        </article>
        <article className="import-kpi-card">
          <i className="import-kpi-icon success" aria-hidden="true">✓</i>
          <div><span>导入成功率</span><strong>{successRate === null ? "暂无数据" : `${successRate.toFixed(1)}%`}</strong><small>{yesterdayRate === null || successRate === null ? "暂无昨日数据" : `较昨日 ${successRate >= yesterdayRate ? "↑" : "↓"} ${Math.abs(successRate - yesterdayRate).toFixed(1)}%`}</small></div>
        </article>
        <article className="import-kpi-card latest-card">
          <i className="import-kpi-icon latest" aria-hidden="true">▣</i>
          <div><span>最近导入文件</span><strong title={latest?.fileName}>{latest?.fileName || "暂无导入文件"}</strong><small>{formatImportTime(latest?.importedAt)}</small></div>
        </article>
        <article className="import-kpi-card">
          <i className="import-kpi-icon database" aria-hidden="true">●</i>
          <div><span>累计导入记录数</span><strong>{totalRecords.toLocaleString()} 条</strong><small>基于已记录的有效导入数据</small></div>
        </article>
      </div>

      <article className="import-history-card">
        <div className="import-history-head">
          <h3>导入记录 / 数据库更新记录</h3>
        </div>
        <div className="import-history-table-wrap">
          <table className="import-history-table">
            <thead><tr>
              <th>文件名称</th>
              <th><button type="button" onClick={() => { setOrder((value) => value === "desc" ? "asc" : "desc"); setPage(1); }}>导入时间 {order === "desc" ? "↓" : "↑"}</button></th>
              <th>数据类型</th><th>导入内容说明</th><th>记录数</th><th>更新表 / 数据库</th><th>导入人</th><th>状态</th><th>操作</th>
            </tr></thead>
            <tbody>
              {displayed.length ? displayed.map((record) => <tr key={record.id}>
                <td title={record.fileName}>{record.fileName}</td><td>{formatImportTime(record.importedAt)}</td><td>{importTypeLabel(record.dataType)}</td><td title={record.description}>{record.description}</td><td className="number-cell">{typeof record.recordCount === "number" ? record.recordCount.toLocaleString() : "未记录"}</td><td>{record.targetStore}</td><td>{record.operator}</td><td><span className={`import-status-badge ${record.status}`}>{importStatusLabel(record.status)}</span></td><td><button type="button" className="import-detail-button" onClick={() => setSelected(record)}>详情</button></td>
              </tr>) : <tr><td colSpan={9} className="import-history-empty">暂无导入记录</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="import-pagination">
          <span>共 {sorted.length} 条</span><div><button type="button" disabled={activePage <= 1} onClick={() => setPage(activePage - 1)}>‹</button><b>{activePage}</b><button type="button" disabled={activePage >= pageCount} onClick={() => setPage(activePage + 1)}>›</button></div><label>每页 <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={10}>10 条/页</option><option value={20}>20 条/页</option><option value={50}>50 条/页</option></select></label><label>前往 <input value={activePage} type="number" min={1} max={pageCount} onChange={(event) => setPage(Math.max(1, Math.min(pageCount, Number(event.target.value) || 1)))} /> 页</label>
        </div>
      </article>

      {selected && <div className="import-drawer-backdrop" onMouseDown={() => setSelected(null)}><aside className="import-detail-drawer" role="dialog" aria-modal="true" aria-label="导入记录详情" onMouseDown={(event) => event.stopPropagation()}><header><div><p>导入记录详情</p><h2>{selected.fileName}</h2></div><button type="button" onClick={() => setSelected(null)} aria-label="关闭">×</button></header><section><h3>基本信息</h3><dl><dt>文件名称</dt><dd>{selected.fileName}</dd><dt>导入时间</dt><dd>{formatImportTime(selected.importedAt)}</dd><dt>所属季度</dt><dd>{selected.quarter || "历史版本未记录"}</dd><dt>数据类型</dt><dd>{importTypeLabel(selected.dataType)}</dd><dt>记录数</dt><dd>{typeof selected.recordCount === "number" ? selected.recordCount.toLocaleString() : "历史版本未记录"}</dd><dt>导入人</dt><dd>{selected.operator}</dd><dt>状态</dt><dd><span className={`import-status-badge ${selected.status}`}>{importStatusLabel(selected.status)}</span></dd></dl></section><section><h3>数据更新信息</h3><dl><dt>更新目标表 / 数据库</dt><dd>{selected.targetStore}</dd><dt>新增记录数</dt><dd>{selected.stats?.inserted?.toLocaleString() ?? "历史版本未记录"}</dd><dt>更新记录数</dt><dd>{selected.stats?.updated?.toLocaleString() ?? "历史版本未记录"}</dd><dt>跳过记录数</dt><dd>{selected.stats?.skipped?.toLocaleString() ?? "历史版本未记录"}</dd><dt>异常记录数</dt><dd>{selected.stats?.errors?.toLocaleString() ?? "历史版本未记录"}</dd>{selected.stats?.note && <><dt>说明</dt><dd>{selected.stats.note}</dd></>}</dl></section></aside></div>}
    </section>
  );
}
