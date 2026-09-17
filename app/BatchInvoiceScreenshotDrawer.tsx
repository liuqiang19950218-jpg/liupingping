"use client";

import { ChangeEvent, DragEvent, ClipboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { reconciliationApi } from "../lib/api/reconciliation-api";

type Entry = { id?: string; date: string; invoice: string; amount: string; note: string };
type Status = "RECOGNIZED" | "NEEDS_REVIEW" | "IMAGE_DUPLICATE" | "CURRENT_DB_EXISTS" | "CURRENT_DRAFT_EXISTS" | "MANUALLY_SKIPPED" | "NOT_FOUND" | "AMBIGUOUS";
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
  const stats = useMemo(() => ({ detected: rows.length, recognized: rows.filter((row) => row.status === "RECOGNIZED").length, review: rows.filter((row) => row.status === "NEEDS_REVIEW" || row.status === "AMBIGUOUS" || row.status === "NOT_FOUND").length, duplicate: rows.filter((row) => row.status === "IMAGE_DUPLICATE").length, db: rows.filter((row) => row.status === "CURRENT_DB_EXISTS").length, draft: rows.filter((row) => row.status === "CURRENT_DRAFT_EXISTS").length, skipped: rows.filter((row) => row.status === "MANUALLY_SKIPPED").length }), [rows]);
  const load = async (next?: File) => { if (!next) return; if (!/image\/(png|jpeg|webp)/.test(next.type) || next.size > MAX_BYTES) { setMessage("请选择 PNG、JPG、JPEG 或 WEBP 图片，且不超过 10MB。"); return; } try { setRows([]); setFile(next); setImage(await imageRows(next)); setMessage("图片已载入。请确认检测行数与截图中的实际发票号数量一致。"); } catch { setMessage("图片处理失败，请重新上传。"); } };
  const classify = async (draft: Row[]) => {
    const usable = [...new Set(draft.filter((row) => validInvoice(row.invoiceNumber)).map((row) => row.invoiceNumber))];
    const resolved = usable.length ? (await reconciliationApi.resolveLedgerInvoices(quarter, usable)).results : [];
    const lookup = new Map(resolved.map((row) => [row.invoiceNumber, row])); const all = new Map<string, number>(); for (const row of draft) if (validInvoice(row.invoiceNumber)) all.set(row.invoiceNumber, (all.get(row.invoiceNumber) ?? 0) + 1);
    const persisted = new Set(entries.filter((entry) => entry.id).map((entry) => entry.invoice.trim())); const drafts = new Set(entries.filter((entry) => !entry.id).map((entry) => entry.invoice.trim()));
    return draft.map((row) => { if (row.status === "MANUALLY_SKIPPED") return row; const invoiceNumber = numberOnly(row.invoiceNumber); if (!validInvoice(invoiceNumber)) return { ...row, invoiceNumber, invoiceDate: "", amount: "", candidateDates: [], status: "NEEDS_REVIEW" as const }; if ((all.get(invoiceNumber) ?? 0) > 1) return { ...row, invoiceNumber, status: "IMAGE_DUPLICATE" as const }; if (persisted.has(invoiceNumber)) return { ...row, invoiceNumber, status: "CURRENT_DB_EXISTS" as const }; if (drafts.has(invoiceNumber)) return { ...row, invoiceNumber, status: "CURRENT_DRAFT_EXISTS" as const }; const result = lookup.get(invoiceNumber); return { ...row, invoiceNumber, invoiceDate: result?.invoiceDate ?? "", amount: result?.invoiceAmount ?? "", candidateDates: result?.candidateDates ?? [], status: result?.status === "resolved" ? "RECOGNIZED" as const : result?.status === "ambiguous" ? "AMBIGUOUS" as const : "NOT_FOUND" as const }; });
  };
  const recognize = async () => { if (!image) return; setBusy(true); setMessage("正在按行识别发票号…"); try { const source = await imageRows(file!); const detected = await Promise.all(source.rows.map(async (row, index) => ({ rowIndex: index + 1, preview: row.preview, invoiceNumber: numberOnly(await recognizeRow(row.preview)), status: "NEEDS_REVIEW" as Status, invoiceDate: "", amount: "", candidateDates: [] }))); setRows(await classify(detected)); setMessage("请逐行确认结果；系统不会静默删除已检测行。"); } catch { setMessage("识别服务暂时不可用，请稍后重试。"); } finally { setBusy(false); } };
  const edit = async (index: number, value: string) => { const next = rows.map((row, at) => at === index ? { ...row, invoiceNumber: value, invoiceDate: "", amount: "", candidateDates: [], status: "NEEDS_REVIEW" as Status } : row); setRows(await classify(next)); };
  const append = () => { const selected = rows.filter((row) => row.status === "RECOGNIZED" || row.status === "NOT_FOUND" || row.status === "AMBIGUOUS"); if (!selected.length) { setMessage("没有可填入的有效发票号。"); return; } onAppend([...entries, ...selected.map((row) => ({ date: row.invoiceDate, invoice: row.invoiceNumber, amount: row.amount, note: "" }))]); onClose(); };
  return <div className="invoice-screenshot-backdrop" onMouseDown={() => !busy && onClose()}><aside className="invoice-screenshot-drawer" role="dialog" aria-modal="true" aria-label="批量识别发票号" onMouseDown={(event) => event.stopPropagation()}><header><div><p>批量识别发票号</p><h2>批量识别发票号</h2><span>上传或粘贴一列、一行一个发票号的截图，系统将按行识别并自动补全日期和金额，确认后填入当前差额明细。</span></div><button type="button" aria-label="关闭批量识别发票号" onClick={onClose}>×</button></header><section className="invoice-screenshot-body" onDragOver={(event) => event.preventDefault()} onDrop={(event: DragEvent) => { event.preventDefault(); void load(event.dataTransfer.files[0]); }} onPaste={(event: ClipboardEvent) => { const imageFile = [...event.clipboardData.files].find((candidate) => candidate.type.startsWith("image/")); if (imageFile) { event.preventDefault(); void load(imageFile); } }}><div className="invoice-screenshot-actions"><button type="button" onClick={() => input.current?.click()}>重新选择</button><button type="button" disabled={!image || busy} onClick={() => void recognize()}>{busy ? "识别中…" : "开始识别"}</button><input ref={input} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event: ChangeEvent<HTMLInputElement>) => { void load(event.target.files?.[0]); event.target.value = ""; }} /></div>{image && <div className="invoice-screenshot-preview"><img src={image.preview} alt="待识别的发票号截图"/><span>{file?.name || "剪贴板截图"}　{image.width} × {image.height}　{Math.ceil((file?.size ?? 0) / 1024)} KB</span></div>}{message && <p className="invoice-screenshot-message" role="status">{message}</p>}{rows.length > 0 && <><div className="invoice-screenshot-stats">检测：{stats.detected}　已识别：{stats.recognized}　待确认：{stats.review}　截图内重复：{stats.duplicate}　已保存：{stats.db}　草稿重复：{stats.draft}　已忽略：{stats.skipped}</div><p className="invoice-screenshot-hint">请确认检测行数与截图中的实际发票号数量一致。</p><div className="invoice-screenshot-rows">{rows.map((row, index) => <div className="invoice-screenshot-row" key={row.rowIndex}><img src={row.preview} alt={`第 ${row.rowIndex} 行原图`}/><span>第 {row.rowIndex} 行</span><input value={row.invoiceNumber} onChange={(event) => void edit(index, event.target.value)} placeholder="请输入发票号"/><b>{row.status === "RECOGNIZED" ? "已匹配" : row.status === "NEEDS_REVIEW" ? "待确认" : row.status === "IMAGE_DUPLICATE" ? "截图内重复" : row.status === "CURRENT_DB_EXISTS" ? "本季度已存在" : row.status === "CURRENT_DRAFT_EXISTS" ? "当前编辑中已存在" : row.status === "MANUALLY_SKIPPED" ? "已忽略" : row.status === "AMBIGUOUS" ? "日期待确认" : "未找到发票信息"}</b><span>{row.invoiceDate || "—"}</span><span>{row.amount || "—"}</span><button type="button" onClick={() => setRows((current) => current.map((item, at) => at === index ? { ...item, status: item.status === "MANUALLY_SKIPPED" ? "NEEDS_REVIEW" : "MANUALLY_SKIPPED" } : item))}>{row.status === "MANUALLY_SKIPPED" ? "恢复" : "忽略"}</button></div>)}</div><button type="button" className="invoice-screenshot-add" onClick={() => setRows((current) => [...current, { rowIndex: current.length + 1, preview: "", invoiceNumber: "", status: "NEEDS_REVIEW", invoiceDate: "", amount: "", candidateDates: [] }])}>＋ 手动新增一行</button></>} </section><footer><button type="button" onClick={onClose}>取消</button><button type="button" className="invoice-screenshot-confirm" disabled={!rows.length || busy} onClick={append}>批量填入差额明细</button></footer></aside></div>;
}
