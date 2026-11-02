"use client";

import { useMemo, useState } from "react";
import { reconciliationApi, type PreviousQuarterTransferPreview } from "../lib/api/reconciliation-api";

const categoryLabel: Record<string, string> = { transit: "在途", returned_invoice: "退票", lost_invoice: "丢票", equipment: "仪器设备", other_with_invoice: "其他（有发票）", other_without_invoice: "其他（无发票）" };
const money = (value: string | null) => value === null ? "—" : Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PreviousQuarterDifferenceTransferDrawer({ quarter, reconciliationId, accountSet, customer, onTransferred }: { quarter: string; reconciliationId: string; accountSet: string; customer: string; onTransferred: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PreviousQuarterTransferPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const available = useMemo(() => preview?.items.filter((item) => item.transferStatus === "AVAILABLE") ?? [], [preview]);
  const selectedAmount = useMemo(() => (preview?.items.filter((item) => selected.includes(item.id)).reduce((sum, item) => sum + Number(item.differenceAmount ?? 0), 0) ?? 0), [preview, selected]);
  const readPreview = async (sourceReconciliationId?: string) => {
    try {
      setBusy(true); setMessage("");
      const next = await reconciliationApi.previewPreviousQuarterDifferenceItems(quarter, reconciliationId, sourceReconciliationId);
      setPreview(next); setSelected(next.items.filter((item) => item.transferStatus === "AVAILABLE").map((item) => item.id));
    } catch (error) { setMessage(error instanceof Error ? error.message : "预览读取失败"); }
    finally { setBusy(false); }
  };
  const show = () => { setOpen(true); setPreview(null); setSelected([]); void readPreview(); };
  const execute = async () => {
    if (!preview?.previewToken || !selected.length) return;
    try {
      setBusy(true); setMessage("");
      const result = await reconciliationApi.executePreviousQuarterDifferenceItems(quarter, reconciliationId, preview.previewToken, selected);
      await onTransferred();
      setMessage(`已转入 ${result.insertedCount} 条差额明细。`);
      setPreview(null); setSelected([]);
    } catch (error) { setMessage(error instanceof Error ? error.message : "转入失败"); }
    finally { setBusy(false); }
  };
  return <>
    <button type="button" className="previous-transfer-trigger" onClick={show}>转入上季度差额明细</button>
    {open && <div className="previous-transfer-backdrop" onMouseDown={() => !busy && setOpen(false)}><aside className="previous-transfer-drawer" role="dialog" aria-modal="true" aria-label="转入上季度差额明细" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><p>转入上季度差额明细</p><h2>按需选择后追加到本季度</h2><span>当前季度：<b>{quarter}</b>　来源季度：<b>{preview?.target.previousQuarter ?? "读取中…"}</b></span></div><button type="button" aria-label="关闭转入上季度差额明细" onClick={() => setOpen(false)}>×</button></header>
      <section className="previous-transfer-context"><span>当前账套：<b>{accountSet}</b></span><span>客户：<b>{customer}</b></span>{preview?.source && <><span>来源账套：<b>{preview.source.accountSet}</b></span><span>匹配方式：<b>{preview.source.matchMode === "EXACT_ACCOUNT_SET" ? "账套 + 客户名称精确匹配" : "账套等价组 + 客户名称精确匹配"}</b></span></>}</section>
      {busy && <p className="previous-transfer-message">正在读取或执行…</p>}
      {message && <p className="previous-transfer-message" role="status">{message}</p>}
      {preview?.matchStatus === "ZERO_MATCH" && <p className="previous-transfer-empty">上一季度未找到相同账套/等价账套 + 客户名称的客户记录。</p>}
      {preview?.matchStatus === "MULTI_MATCH" && <section className="previous-transfer-candidates"><h3>上一季度存在多条同账套等价组 + 同客户名称记录，请选择来源记录</h3>{preview.candidates.map((candidate) => <button type="button" key={candidate.id} onClick={() => void readPreview(candidate.id)}>来源账套：{candidate.accountSet}　区域：{candidate.region ?? "—"}　序号：{candidate.sequence ?? "—"}　时间点：{candidate.timepoint ?? "—"}　公司应收：{money(candidate.companyReceivable)}　客户账面：{money(candidate.customerBookAmount)}</button>)}</section>}
      {preview?.matchStatus === "READY" && <section className="previous-transfer-content">
        {!preview.items.length ? <p className="previous-transfer-empty">上一季度该客户没有差额明细。</p> : <>
          <div className="previous-transfer-stats"><span>上一季度明细：{preview.items.length} 条</span><span>可转入：{available.length} 条</span><span>已转入：{preview.items.filter((item) => item.transferStatus === "ALREADY_TRANSFERRED").length} 条</span><span>本季度已存在：{preview.items.filter((item) => item.transferStatus === "CURRENT_INVOICE_EXISTS").length} 条</span><span>当前选择：{selected.length} 条</span><span>选择金额合计：{selectedAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元</span></div>
          <div className="previous-transfer-actions"><button type="button" onClick={() => setSelected(available.map((item) => item.id))}>全选可转入</button><button type="button" onClick={() => setSelected([])}>取消全选</button></div>
          <div className="previous-transfer-table-wrap"><table><thead><tr><th>选择</th><th>发票号</th><th>发票日期</th><th>金额</th><th>差额类型</th><th>差额说明</th><th>转入状态</th></tr></thead><tbody>{preview.items.map((item) => <tr key={item.id}><td><input type="checkbox" checked={selected.includes(item.id)} disabled={item.transferStatus !== "AVAILABLE"} onChange={() => setSelected((value) => value.includes(item.id) ? value.filter((id) => id !== item.id) : [...value, item.id])} /></td><td>{item.invoiceNo ?? "—"}</td><td>{item.invoiceDate ?? "—"}</td><td>{money(item.differenceAmount)}</td><td>{categoryLabel[item.category] ?? item.category}</td><td>{item.differenceDescription ?? "—"}</td><td>{item.transferStatus === "AVAILABLE" ? "可转入" : item.transferStatus === "ALREADY_TRANSFERRED" ? "已转入" : "本季度已存在"}</td></tr>)}</tbody></table></div>
        </>}
      </section>}
      <footer><button type="button" onClick={() => setOpen(false)}>取消</button><button type="button" className="previous-transfer-confirm" disabled={busy || !preview?.previewToken || !selected.length} onClick={() => void execute()}>确认转入 {selected.length} 条</button></footer>
    </aside></div>}
  </>;
}
