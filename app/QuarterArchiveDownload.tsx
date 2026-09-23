"use client";

import { useEffect, useMemo, useState } from "react";

type Quarter = { code: string };
type ArchiveSummary = { quarter: string; reconciliations: number; differences: number; invoiceDifferences: number; followups: number; materials: number; spd: number; attachments: number; archivedAttachments: number; missingAttachments: number };

export function QuarterArchiveDownload() {
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [quarter, setQuarter] = useState("");
  const [summary, setSummary] = useState<ArchiveSummary | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const payload = await fetch("/api/quarters", { cache: "no-store" }).then((response) => response.json()).catch(() => ({ quarters: [] }));
      const available = Array.isArray(payload.quarters) ? payload.quarters : [];
      setQuarters(available);
      setQuarter(available[0]?.code ?? "");
    })();
  }, []);

  const ready = useMemo(() => Boolean(quarter), [quarter]);
  const preview = async () => {
    if (!ready) return;
    setBusy(true); setMessage(""); setSummary(null);
    try {
      const response = await fetch(`/api/quarter/${encodeURIComponent(quarter)}/archive`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "归档预检失败。");
      if (!payload.summary || typeof payload.summary !== "object") throw new Error("归档预检返回格式无效。");
      setSummary(payload.summary as ArchiveSummary);
    } catch (error) { setMessage(error instanceof Error ? error.message : "归档预检失败。"); }
    finally { setBusy(false); }
  };
  const download = () => {
    if (!summary || busy) return;
    const confirmed = window.confirm(`确认下载 ${quarter} 完整归档？\n对账 ${summary.reconciliations} 条，差额 ${summary.differences} 条，附件 ${summary.archivedAttachments} 个${summary.missingAttachments ? `（缺失 ${summary.missingAttachments} 个）` : ""}。`);
    if (!confirmed) return;
    setBusy(true); setMessage("归档正在服务端生成，浏览器将开始下载。");
    const link = document.createElement("a");
    link.href = `/api/quarter/${encodeURIComponent(quarter)}/archive?download=1`;
    link.download = "";
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => setBusy(false), 4000);
  };
  return <section className="quarter-archive-download" aria-label="季度归档下载">
    <div><h3>季度归档下载</h3><span>从当前季度数据库和已持久化图片附件生成完整只读 ZIP，不会写入业务数据。</span></div>
    <div className="archive-controls">
      <select aria-label="归档季度" value={quarter} disabled={!ready || busy} onChange={(event) => { setQuarter(event.target.value); setSummary(null); }}><option value="">选择季度</option>{quarters.map((item) => <option key={item.code} value={item.code}>{item.code}</option>)}</select>
      <button type="button" disabled={!ready || busy} onClick={() => void preview()}>{busy ? "正在读取归档内容…" : "预览归档内容"}</button>
      {summary && <button type="button" className="archive-download-button" disabled={busy} onClick={download}>下载完整归档 ZIP</button>}
    </div>
    {summary && <p className="archive-summary">{summary.quarter}：对账 {summary.reconciliations} 条 · 差额 {summary.differences} 条 · 发票明细 {summary.invoiceDifferences} 条 · 跟进 {summary.followups} 条 · 资料 {summary.materials} 条 · SPD {summary.spd} 条 · 图片附件 {summary.archivedAttachments}/{summary.attachments}{summary.missingAttachments ? `（缺失 ${summary.missingAttachments}）` : ""}</p>}
    {message && <p className="archive-message" role="status">{message}</p>}
  </section>;
}
