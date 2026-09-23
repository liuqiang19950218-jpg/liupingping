import archiver from "archiver";
import { Client } from "pg";
import * as XLSX from "xlsx";

const QUARTER_PATTERN = /^20\d{2}-Q[1-4]$/;
const ARCHIVE_TIMEOUT_MS = 2 * 60 * 1000;

const text = (value) => value == null ? "" : String(value);
const spreadsheetValue = (value) => {
  const valueText = text(value);
  return /^[=+\-@]/.test(valueText) ? `'${valueText}` : valueText;
};
const amount = (value) => value == null || value === "" ? "" : Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const safeName = (value) => text(value).replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 80) || "未命名客户";

function workbookBuffer(sheetName, headers, rows) {
  const workbook = XLSX.utils.book_new();
  const values = [headers, ...rows.map((row) => row.map(spreadsheetValue))];
  const sheet = XLSX.utils.aoa_to_sheet(values);
  sheet["!cols"] = headers.map((header, index) => ({ wch: Math.min(42, Math.max(12, String(header).length * 2 + (index === 0 ? 4 : 2))) }));
  sheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(Math.max(0, headers.length - 1))}${Math.max(1, values.length)}` };
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer", compression: true });
}

async function queryArchiveData(databaseUrl, quarter) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const [reconciliations, differences, followups, materials, spd] = await Promise.all([
      client.query(`SELECT r.id::text, r.source_row_key, reg.name AS region, a.name AS account_set, c.name AS customer,
        r.company_receivable::text, r.customer_book_amount::text, r.reconciliation_difference::text, r.reconciliation_status,
        r.bad_debt_amount::text, r.bad_debt_reason, r.adjustment_amount::text, r.adjustment_reason, r.solution,
        to_char(r.solution_date, 'YYYY-MM-DD') AS solution_date, r.owner_name, r.manual_resolution_status, r.financial_attention
        FROM recon.reconciliations r JOIN recon.quarters q ON q.id=r.quarter_id
        JOIN recon.account_sets a ON a.id=r.account_set_id JOIN recon.customers c ON c.id=r.customer_id
        LEFT JOIN recon.regions reg ON reg.id=c.region_id WHERE q.code=$1 ORDER BY r.source_row_key NULLS LAST, r.created_at ASC`, [quarter]),
      client.query(`SELECT d.id::text, r.id::text AS reconciliation_id, c.name AS customer, reg.name AS region, a.name AS account_set,
        d.category, d.invoice_no, to_char(d.invoice_date, 'YYYY-MM-DD') AS invoice_date, d.difference_amount::text,
        d.difference_description, d.verification_status, d.attachment_keys
        FROM recon.difference_items d JOIN recon.reconciliations r ON r.id=d.reconciliation_id JOIN recon.quarters q ON q.id=r.quarter_id
        JOIN recon.account_sets a ON a.id=r.account_set_id JOIN recon.customers c ON c.id=r.customer_id LEFT JOIN recon.regions reg ON reg.id=c.region_id
        WHERE q.code=$1 ORDER BY d.created_at ASC,d.id ASC`, [quarter]),
      client.query(`SELECT f.id::text, r.id::text AS reconciliation_id, c.name AS customer, reg.name AS region, r.owner_name,
        f.follow_status,f.process_stage,f.risk_level,f.expected_complete_at::text,f.next_follow_up_at::text,f.latest_follow_up_at::text,f.closed_at::text,
        e.event_type,e.content,e.occurred_at::text
        FROM recon.followup_items f JOIN recon.reconciliations r ON r.id=f.reconciliation_id JOIN recon.quarters q ON q.id=r.quarter_id
        JOIN recon.customers c ON c.id=r.customer_id LEFT JOIN recon.regions reg ON reg.id=c.region_id
        LEFT JOIN recon.followup_events e ON e.followup_item_id=f.id WHERE q.code=$1 ORDER BY f.created_at ASC,f.id ASC,e.occurred_at ASC,e.id ASC`, [quarter]),
      client.query(`SELECT c.name AS customer, reg.name AS region, m.material_type,m.provided,m.raw_value
        FROM recon.material_status m JOIN recon.reconciliations r ON r.id=m.reconciliation_id JOIN recon.quarters q ON q.id=m.quarter_id
        JOIN recon.customers c ON c.id=r.customer_id LEFT JOIN recon.regions reg ON reg.id=c.region_id
        WHERE q.code=$1 ORDER BY c.name,m.material_type,m.id`, [quarter]),
      client.query(`SELECT s.source_row_number,s.account_set_raw,s.region_raw,s.customer_name_raw,s.spd_confirmation_raw,s.spd_inventory_confirmation_raw
        FROM recon.spd_dashboard_rows s JOIN recon.quarters q ON q.id=s.quarter_id WHERE q.code=$1 ORDER BY s.source_row_number ASC,s.id ASC`, [quarter]),
    ]);
    return { reconciliations: reconciliations.rows, differences: differences.rows, followups: followups.rows, materials: materials.rows, spd: spd.rows };
  } finally { await client.end(); }
}

async function attachmentManifest(storage, differences) {
  const rows = [];
  for (const difference of differences) {
    const keys = Array.isArray(difference.attachment_keys) ? difference.attachment_keys.filter((key) => typeof key === "string") : [];
    for (const key of keys) {
      try {
        const details = await storage.inspect(key);
        rows.push({ key, status: "已归档", size: details.size, customer: difference.customer, differenceId: difference.id, contentType: details.contentType });
      } catch {
        rows.push({ key, status: "缺失", size: null, customer: difference.customer, differenceId: difference.id, contentType: null });
      }
    }
  }
  return rows;
}

function summaryOf(quarter, data, attachments) {
  const invoiceDifferences = data.differences.filter((row) => row.invoice_no || row.invoice_date);
  return {
    quarter, generatedAt: new Date().toISOString(), reconciliations: data.reconciliations.length, differences: data.differences.length,
    invoiceDifferences: invoiceDifferences.length, followups: new Set(data.followups.map((row) => row.id)).size,
    materials: data.materials.length, spd: data.spd.length, attachments: attachments.length,
    archivedAttachments: attachments.filter((row) => row.status === "已归档").length,
    missingAttachments: attachments.filter((row) => row.status === "缺失").length,
  };
}

function appendWorkbook(archive, filename, sheetName, headers, rows) { archive.append(workbookBuffer(sheetName, headers, rows), { name: filename }); }

function appendArchiveContent(archive, quarter, data, attachments, summary) {
  appendWorkbook(archive, "01_季度对账总表.xlsx", "季度对账总表", ["原始行号", "账套", "区域", "客户名称", "公司应收", "客户账面金额", "对账差额", "对账状态", "坏账金额", "坏账原因", "调账金额", "调账原因", "解决方案", "解决日期", "负责人", "人工解决状态", "财务关注"], data.reconciliations.map((r) => [r.source_row_key, r.account_set, r.region, r.customer, amount(r.company_receivable), amount(r.customer_book_amount), amount(r.reconciliation_difference), r.reconciliation_status, amount(r.bad_debt_amount), r.bad_debt_reason, amount(r.adjustment_amount), r.adjustment_reason, r.solution, r.solution_date, r.owner_name, r.manual_resolution_status, r.financial_attention]));
  const differenceHeaders = ["差额ID", "客户名称", "账套", "区域", "差额分类", "发票号", "发票日期", "差额金额", "差额原因", "核验状态", "附件数量"];
  const differenceRows = data.differences.map((r) => [r.id, r.customer, r.account_set, r.region, r.category, r.invoice_no, r.invoice_date, amount(r.difference_amount), r.difference_description, r.verification_status, Array.isArray(r.attachment_keys) ? r.attachment_keys.length : 0]);
  appendWorkbook(archive, "02_差额明细.xlsx", "差额明细", differenceHeaders, differenceRows);
  appendWorkbook(archive, "03_差额发票明细.xlsx", "差额发票明细", differenceHeaders, differenceRows.filter((row) => row[5] || row[6]));
  appendWorkbook(archive, "04_客户跟进记录.xlsx", "客户跟进记录", ["客户名称", "区域", "负责人", "当前状态", "处理阶段", "风险等级", "预计完成", "下次跟进", "最新跟进", "关闭时间", "事件类型", "跟进内容", "事件时间"], data.followups.map((r) => [r.customer, r.region, r.owner_name, r.follow_status, r.process_stage, r.risk_level, r.expected_complete_at, r.next_follow_up_at, r.latest_follow_up_at, r.closed_at, r.event_type, r.content, r.occurred_at]));
  appendWorkbook(archive, "05_资料收集情况.xlsx", "资料收集情况", ["客户名称", "区域", "资料类型", "已提供", "原始值"], data.materials.map((r) => [r.customer, r.region, r.material_type, r.provided ? "是" : "否", r.raw_value]));
  if (data.spd.length) appendWorkbook(archive, "06_SPD资料.xlsx", "SPD资料", ["原始行号", "账套", "区域", "客户名称", "SPD确认函", "SPD库存确认函"], data.spd.map((r) => [r.source_row_number, r.account_set_raw, r.region_raw, r.customer_name_raw, r.spd_confirmation_raw, r.spd_inventory_confirmation_raw]));
  appendWorkbook(archive, "07_附件清单.xlsx", "附件清单", ["客户名称", "差额ID", "附件键", "状态", "文件大小(字节)", "内容类型"], attachments.map((r) => [r.customer, r.differenceId, r.key, r.status, r.size, r.contentType]));
  const usedNames = new Set();
  for (const item of attachments.filter((row) => row.status === "已归档")) {
    const ext = item.key.split(".").pop();
    let basename = `${safeName(item.customer)}_${item.differenceId}.${ext}`;
    let attempt = 2;
    while (usedNames.has(basename)) basename = `${safeName(item.customer)}_${item.differenceId}_${attempt++}.${ext}`;
    usedNames.add(basename);
    archive.append(item.streamFactory(), { name: `图片附件/${basename}` });
  }
  const note = [`季度：${quarter}`, `生成时间：${summary.generatedAt}`, `对账记录：${summary.reconciliations} 条`, `差额明细：${summary.differences} 条`, `跟进记录：${summary.followups} 条`, `资料记录：${summary.materials} 条`, `SPD资料：${summary.spd} 条${summary.spd ? "" : "（当前季度无SPD资料，未生成06文件）"}`, `附件：${summary.archivedAttachments} 个已归档，${summary.missingAttachments} 个缺失`, "本归档仅包含所选季度的只读快照；附件缺失不影响其他文件生成。"].join("\n");
  archive.append(note, { name: "归档说明.txt" });
}

export function createQuarterArchiveHandler({ databaseUrl, storage, loadArchiveData = queryArchiveData, timeoutMs = ARCHIVE_TIMEOUT_MS }) {
  if (!databaseUrl) throw new Error("DATABASE_URL 未配置，季度归档不可用。");
  const running = new Set();
  const prepare = async (quarter) => {
    if (!QUARTER_PATTERN.test(quarter)) { const error = new Error("季度代码无效。"); error.status = 400; throw error; }
    const data = await loadArchiveData(databaseUrl, quarter);
    const baseAttachments = await attachmentManifest(storage, data.differences);
    const attachments = baseAttachments.map((item) => item.status === "已归档" ? { ...item, streamFactory: () => storage.createReadStream(item.key) } : item);
    return { data, attachments, summary: summaryOf(quarter, data, attachments) };
  };
  return async ({ quarter, download, request, response }) => {
    if (!download) return { status: 200, body: await prepare(quarter) };
    if (running.has(quarter)) return { status: 409, body: { error: "该季度归档正在生成，请勿重复提交。" } };
    if (running.size >= 2) return { status: 429, body: { error: "归档任务繁忙，请稍后重试。" } };
    running.add(quarter);
    try {
      const { data, attachments, summary } = await prepare(quarter);
      const archive = archiver("zip", { zlib: { level: 6 } });
      const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
      const filename = `${quarter}_季度对账完整归档_${date}.zip`;
      response.writeHead(200, { "content-type": "application/zip", "content-disposition": `attachment; filename="${quarter}-archive-${date}.zip"; filename*=UTF-8''${encodeURIComponent(filename)}`, "cache-control": "no-store", "x-content-type-options": "nosniff" });
      const finish = new Promise((resolve, reject) => { archive.once("error", reject); response.once("error", reject); response.once("finish", resolve); });
      const timer = setTimeout(() => archive.abort(), timeoutMs);
      const abort = () => { if (!response.writableEnded) archive.abort(); };
      request.once("aborted", abort); response.once("close", abort);
      archive.pipe(response);
      appendArchiveContent(archive, quarter, data, attachments, summary);
      try {
        await archive.finalize();
        await finish;
      } finally { clearTimeout(timer); }
      return null;
    } finally { running.delete(quarter); }
  };
}
