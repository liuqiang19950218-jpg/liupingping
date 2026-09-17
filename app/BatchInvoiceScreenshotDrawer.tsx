"use client";

import { ChangeEvent, ClipboardEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { reconciliationApi } from "../lib/api/reconciliation-api";
import { mergeRecognizedInvoiceDrafts } from "../lib/invoice-draft-merge.mjs";

type Entry = { id?: string; date: string; invoice: string; amount: string; note: string };
type Status = "RECOGNIZED" | "NEEDS_REVIEW" | "AUTO_DEDUPED" | "CURRENT_DB_EXISTS" | "CURRENT_DRAFT_EXISTS" | "MANUALLY_SKIPPED" | "NOT_FOUND" | "AMBIGUOUS";
type Row = { rowIndex: number; preview: string; invoiceNumber: string; status: Status; invoiceDate: string; amount: string; candidateDates: string[] };
const MAX_BYTES = 10 * 1024 * 1024;
const numberOnly = (value: string) => value.trim().replace(/\s+/g, "");
const validInvoice = (value: string) => /^\d{7,}$/.test(value);

async function imageRows(file: File): Promise<{ preview: string; width: number; height: number; rows: { preview: string; rawText: string }[] }> {
  const preview = URL.createObjectURL(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => { const next = new Image(); next.onload = () => resolve(next); next.onerror = reject; next.src = preview; });
  if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error("图片像素过大");
  const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true }); if (!context) throw new Error("图片处理失败");
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const active: number[] = [];
  for (let y = 0; y < canvas.height; y++) {
    let ink = 0;
    for (let x = 0; x < canvas.width; x++) { const at = (y * canvas.width + x) * 4; if (data[at] < 170 && data[at + 1] < 170 && data[at + 2] < 170) ink++; }
    if (ink >= Math.max(3, Math.floor(canvas.width * 0.006))) active.push(y);
  }
  const bands: [number, number][] = [];
  for (const y of active) { const last = bands.at(-1); if (!last || y - last[1] > 3) bands.push([y, y]); else last[1] = y; }
  const filtered = bands.filter(([top, bottom]) => bottom - top >= 5).map(([top, bottom]) => [Math.max(0, top - 5), Math.min(canvas.height, bottom + 6)] as const);
  const ranges = filtered.length ? filtered : [[0, canvas.height] as const];
  return { preview, width: image.naturalWidth, height: image.naturalHeight, rows: ranges.map(([top, bottom]) => { const crop = document.createElement("canvas"); crop.width = canvas.width; crop.height = bottom - top; crop.getContext("2d")!.drawImage(canvas, 0, top, canvas.width, bottom - top, 0, 0, crop.width, crop.height); return { preview: crop.toDataURL("image/png"), rawText: "" }; }) };
}

async function recognizeRow(preview: string) {
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try { await worker.setParameters({ tessedit_char_whitelist: "0123456789OISB ", tessedit_pageseg_mode: PSM.SINGLE_LINE }); return (await worker.recognize(preview)).data.text; }
  finally { await worker.terminate(); }
}

export function BatchInvoiceScreenshotDrawer({ quarter, entries, onAppend, onClose }: { quarter: string; entries: Entry[]; onAppend: (items: Entry[]) => void; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null); const [image, setImage] = useState<{ preview: string; width: number; height: number } | null>(null);
  const [rows, setRows] = useState<Row[]>([]); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (image?.preview.startsWith("blob:")) URL.revokeObjectURL(image.preview); }, [image]);
  const stats = useMemo(() => ({ detected: rows.length, recognized: rows.filter((row) => row.status === "RECOGNIZED").length, review: rows.filter((row) => row.status === "NEEDS_REVIEW" || row.status === "AMBIGUOUS" || row.status === "NOT_FOUND").length, duplicate: rows.filter((row) => row.status === "AUTO_DEDUPED").length, db: rows.filter((row) => row.status === "CURRENT_DB_EXISTS").length, draft: rows.filter((row) => row.status === "CURRENT_DRAFT_EXISTS").length, skipped: rows.filter((row) => row.status === "MANUALLY_SKIPPED").length }), [rows]);
  const addableRows = useMemo(() => rows.filter((row) => row.status === "RECOGNIZED"), [rows]);
  const blockingRows = useMemo(() => rows.filter((row) => row.status === "NEEDS_REVIEW" || row.status === "AMBIGUOUS" || row.status === "NOT_FOUND"), [rows]);
  const load = async (next?: File) => { if (!next) return; if (!/image\/(png|jpeg|webp)/.test(next.type) || next.size > MAX_BYTES) { setMessage("请选择 PNG、JPG、JPEG 或 WEBP 图片，且不超过 10MB。"); return; } try { setRows([]); setFile(next); setImage(await imageRows(next)); setMessage("图片已载入。请确认检测行数与截图中的实际发票号数量一致。"); } catch { setMessage("图片处理失败，请重新上传。"); } };
  const classify = async (draft: Row[]) => {
    const normalized = draft.map((row) => ({ ...row, invoiceNumber: numberOnly(row.invoiceNumber) }));
    const seen = new Set<string>();
    const resolverCandidates = normalized.filter((row) => row.status !== "MANUALLY_SKIPPED" && validInvoice(row.invoiceNumber) && !seen.has(row.invoiceNumber) && !!seen.add(row.invoiceNumber)).map((row) => row.invoiceNumber);
    const resolved = resolverCandidates.length ? (await reconciliationApi.resolveLedgerInvoices(quarter, resolverCandidates)).results : [];
    const lookup = new Map(resolved.map((row) => [row.invoiceNumber, row]));
    const persisted = new Set(entries.filter((entry) => entry.id).map((entry) => numberOnly(entry.invoice)));
    const drafts = new Set(entries.filter((entry) => !entry.id).map((entry) => numberOnly(entry.invoice)));
    seen.clear();
    return normalized.map((row) => {
      if (row.status === "MANUALLY_SKIPPED") return row;
      if (!validInvoice(row.invoiceNumber)) return { ...row, invoiceDate: "", amount: "", candidateDates: [], status: "NEEDS_REVIEW" as const };
      if (seen.has(row.invoiceNumber)) return { ...row, invoiceDate: "", amount: "", candidateDates: [], status: "AUTO_DEDUPED" as const };
      seen.add(row.invoiceNumber);
      if (persisted.has(row.invoiceNumber)) return { ...row, status: "CURRENT_DB_EXISTS" as const };
      if (drafts.has(row.invoiceNumber)) return { ...row, status: "CURRENT_DRAFT_EXISTS" as const };
      const result = lookup.get(row.invoiceNumber);
      return { ...row, invoiceDate: result?.invoiceDate ?? "", amount: result?.invoiceAmount ?? "", candidateDates: result?.candidateDates ?? [], status: result?.status === "resolved" ? "RECOGNIZED" as const : result?.status === "ambiguous" ? "AMBIGUOUS" as const : "NOT_FOUND" as const };
    });
  };
  const recognize = async () => { if (!image) return; setBusy(true); setMessage("正在按行识别发票号…"); try { const source = await imageRows(file!); const detected = await Promise.all(source.rows.map(async (row, index) => ({ rowIndex: index + 1, preview: row.preview, invoiceNumber: numberOnly(await recognizeRow(row.preview)), status: "NEEDS_REVIEW" as Status, invoiceDate: "", amount: "", candidateDates: [] }))); const classified = await classify(detected); setRows(classified); setMessage(`检测到 ${classified.length} 行，自动去重 ${classified.filter((row) => row.status === "AUTO_DEDUPED").length} 行，最终 ${classified.filter((row) => row.status === "RECOGNIZED").length} 个可填入发票号。`); } catch { setMessage("识别服务暂时不可用，请稍后重试。"); } finally { setBusy(false); } };
  const edit = async (index: number, value: string) => { const next = rows.map((row, at) => at === index ? { ...row, invoiceNumber: value, invoiceDate: "", amount: "", candidateDates: [], status: "NEEDS_REVIEW" as Status } : row); setRows(await classify(next)); };
  const toggleSkipped = async (index: number) => { const next = rows.map((row, at) => at === index ? { ...row, status: row.status === "MANUALLY_SKIPPED" ? "NEEDS_REVIEW" as Status : "MANUALLY_SKIPPED" as Status } : row); setRows(await classify(next)); };
  const append = () => { if (!addableRows.length) { setMessage("当前没有可填入的发票明细。"); return; } onAppend(mergeRecognizedInvoiceDrafts(entries, addableRows.map((row) => ({ date: row.invoiceDate, invoice: row.invoiceNumber, amount: row.amount, note: "" })))); onClose(); };
  const statusLabel = (status: Status) => ({ RECOGNIZED: "已匹配", NEEDS_REVIEW: "待确认", AUTO_DEDUPED: "截图内重复已自动去重", CURRENT_DB_EXISTS: "本季度已存在", CURRENT_DRAFT_EXISTS: "当前编辑中已存在", MANUALLY_SKIPPED: "已忽略", AMBIGUOUS: "日期待确认", NOT_FOUND: "未找到发票信息" }[status]);
  return <div className="invoice-screenshot-backdrop" onMouseDown={() => !busy && onClose()}><aside className="invoice-screenshot-drawer" role="dialog" aria-modal="true" aria-label="批量识别发票号" onMouseDown={(event) => event.stopPropagation()}><header><div><p>批量识别发票号</p><h2>批量识别发票号</h2><span>上传或粘贴一列、一行一个发票号的截图，系统将按行识别并自动补全日期和金额，确认后填入当前差额明细。</span></div><button type="button" aria-label="关闭批量识别发票号" onClick={onClose}>×</button></header><section className="invoice-screenshot-body" onDragOver={(event) => event.preventDefault()} onDrop={(event: DragEvent) => { event.preventDefault(); void load(event.dataTransfer.files[0]); }} onPaste={(event: ClipboardEvent) => { const imageFile = [...event.clipboardData.files].find((candidate) => candidate.type.startsWith("image/")); if (imageFile) { event.preventDefault(); void load(imageFile); } }}><div className="invoice-screenshot-actions"><button type="button" onClick={() => input.current?.click()}>重新选择</button><button type="button" disabled={!image || busy} onClick={() => void recognize()}>{busy ? "识别中…" : "开始识别"}</button><input ref={input} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event: ChangeEvent<HTMLInputElement>) => { void load(event.target.files?.[0]); event.target.value = ""; }} /></div>{image && <div className="invoice-screenshot-preview"><img src={image.preview} alt="待识别的发票号截图"/><span>{file?.name || "剪贴板截图"}　{image.width} × {image.height}　{Math.ceil((file?.size ?? 0) / 1024)} KB</span></div>}{message && <p className="invoice-screenshot-message" role="status">{message}</p>}{rows.length > 0 && <><div className="invoice-screenshot-stats">检测：{stats.detected}　有效：{stats.recognized}　待确认：{stats.review}　自动去重：{stats.duplicate}　已保存：{stats.db}　草稿重复：{stats.draft}　已忽略：{stats.skipped}</div><p className="invoice-screenshot-hint">检测行数保留原图全部行；重复、已保存和草稿重复项不会进入本次填入。</p><div className="invoice-screenshot-rows">{rows.map((row, index) => <div className="invoice-screenshot-row" key={row.rowIndex}><img src={row.preview} alt={`第 ${row.rowIndex} 行原图`}/><span>第 {row.rowIndex} 行</span><input value={row.invoiceNumber} onChange={(event) => void edit(index, event.target.value)} placeholder="请输入发票号"/><b>{statusLabel(row.status)}</b><span>{row.invoiceDate || "—"}</span><span>{row.amount || "—"}</span><button type="button" disabled={row.status === "AUTO_DEDUPED"} onClick={() => void toggleSkipped(index)}>{row.status === "AUTO_DEDUPED" ? "已自动去重" : row.status === "MANUALLY_SKIPPED" ? "恢复" : "忽略"}</button></div>)}</div><button type="button" className="invoice-screenshot-add" onClick={() => setRows((current) => [...current, { rowIndex: current.length + 1, preview: "", invoiceNumber: "", status: "NEEDS_REVIEW", invoiceDate: "", amount: "", candidateDates: [] }])}>＋ 手动新增一行</button></>}</section><footer><button type="button" onClick={onClose}>取消</button><button type="button" className="invoice-screenshot-confirm" disabled={busy || blockingRows.length > 0 || addableRows.length === 0} onClick={append}>批量填入差额明细（{addableRows.length}条）</button></footer></aside></div>;
}
