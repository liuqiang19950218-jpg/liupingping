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

function workbookBuffer(sheets) {
  const workbook = XLSX.utils.book_new();
  for (const { sheetName, headers, rows, longTextColumns = new Set() } of sheets) {
    const values = [headers, ...rows.map((row) => row.map(spreadsheetValue))];
    const sheet = XLSX.utils.aoa_to_sheet(values);
    sheet["!cols"] = headers.map((header, index) => ({ wch: longTextColumns.has(index) ? 42 : Math.min(24, Math.max(12, String(header).length * 2 + (index === 0 ? 4 : 2))) }));
    sheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(Math.max(0, headers.length - 1))}${Math.max(1, values.length)}` };
    sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
    sheet["!rows"] = values.map((row, rowIndex) => ({ hpt: rowIndex === 0 ? 22 : Math.min(90, Math.max(20, ...row.map((value) => String(value ?? "").split("\n").length * 16))) }));
    for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
      if (!cell) continue;
      cell.s = rowIndex === 0 ? { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1F4E78" } }, alignment: { horizontal: "center", vertical: "center", wrapText: true } } : { alignment: { vertical: "top", wrapText: longTextColumns.has(columnIndex) } };
    }
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  }
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer", compression: true, cellStyles: true });
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
      client.query(`SELECT m.reconciliation_id::text AS reconciliation_id, c.name AS customer, reg.name AS region, m.material_type,m.provided,m.raw_value
        FROM recon.material_status m JOIN recon.reconciliations r ON r.id=m.reconciliation_id JOIN recon.quarters q ON q.id=m.quarter_id
        JOIN recon.customers c ON c.id=r.customer_id LEFT JOIN recon.regions reg ON reg.id=c.region_id
        WHERE q.code=$1 ORDER BY c.name,m.material_type,m.id`, [quarter]),
      client.query(`SELECT s.source_row_number,s.source_file_name,s.account_set_raw,s.region_raw,s.customer_name_raw,s.spd_confirmation_raw,s.spd_inventory_confirmation_raw,s.remark
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

function appendWorkbook(archive, filename, sheets) { archive.append(workbookBuffer(sheets), { name: filename }); }

function appendArchiveContent(archive, quarter, data, attachments, summary) {
  const by = (rows, key) => rows.reduce((map, row) => { const list = map.get(row[key]) ?? []; list.push(row); map.set(row[key], list); return map; }, new Map());
  const diffs = by(data.differences, "reconciliation_id"), follows = by(data.followups, "reconciliation_id"), materials = by(data.materials, "reconciliation_id"), attachmentByDiff = by(attachments, "differenceId");
  const labels = { transit: "在途", returned_invoice: "退票", returned: "退票", lost_invoice: "丢票", lost: "丢票", equipment: "仪器设备", instrument: "仪器设备", other_with_invoice: "其他（有发票）", otherInvoice: "其他（有发票）", other_without_invoice: "其他（无发票及无法验证）", other: "其他（无发票及无法验证）" };
  const headers = ["序号", "账套", "区域", "客户名称", "负责人", "公司应收金额", "客户账面金额", "差额金额", "对账状态", "差额明细", "当前处理阶段", "当前状态", "最新跟进时间", "最新跟进内容", "跟进历史", "解决方案", "解决时间", "人工解决状态", "财务关注", "资料收集状态", "图片附件", "附件文件夹"];
  const folderByReconciliation = new Map(data.reconciliations.map((reconciliation, index) => [
    reconciliation.id,
    `${String(reconciliation.source_row_key || index + 1).padStart(4, "0")}_${safeName(reconciliation.customer)}`,
  ]));
  const rows = data.reconciliations.map((r, index) => {
    const rd = diffs.get(r.id) ?? [], rf = follows.get(r.id) ?? [], rm = materials.get(r.id) ?? [];
    const detail = rd.map((d) => [labels[d.category] ?? d.category, d.invoice_date, d.invoice_no ? `发票号：${d.invoice_no}` : "", `金额：${amount(d.difference_amount)}`, d.difference_description ? `原因：${d.difference_description}` : ""].filter(Boolean).join("｜")).join("\n");
    const history = rf.filter((f) => f.occurred_at || f.content).map((f) => [f.occurred_at, f.owner_name, f.content].filter(Boolean).join("｜")).join("\n");
    const latest = rf.filter((f) => f.occurred_at || f.content).at(-1) ?? null;
    const current = latest ?? rf.at(-1) ?? null;
    const materialText = rm.map((m) => `${m.material_type}：${m.provided ? "是" : "否"}${m.raw_value ? `（${m.raw_value}）` : ""}`).join("\n");
    const imageRows = rd.flatMap((d) => attachmentByDiff.get(d.id) ?? []); const available = imageRows.filter((a) => a.status === "已归档").length, missing = imageRows.filter((a) => a.status === "缺失").length;
    const folder = folderByReconciliation.get(r.id);
    return [r.source_row_key ?? index + 1, r.account_set, r.region, r.customer, r.owner_name, amount(r.company_receivable), amount(r.customer_book_amount), amount(r.reconciliation_difference), r.reconciliation_status, detail, current?.process_stage, current?.follow_status, latest?.occurred_at, latest?.content, history, r.solution, r.solution_date, r.manual_resolution_status, r.financial_attention, materialText, missing ? `附件缺失（${missing}张）` : available ? `有（${available}张）` : "—", available ? folder : ""];
  });
  const spdHeaders = ["季度", "源行号", "来源文件", "账套", "区域", "客户名称", "SPD确认状态", "SPD库存确认状态", "备注"];
  const spdRows = data.spd.map((row) => [quarter, row.source_row_number, row.source_file_name, row.account_set_raw, row.region_raw, row.customer_name_raw, row.spd_confirmation_raw, row.spd_inventory_confirmation_raw, row.remark]);
  appendWorkbook(archive, `${quarter}_季度对账完整表.xlsx`, [{ sheetName: "季度对账完整表", headers, rows, longTextColumns: new Set([9, 13, 14, 19]) }, { sheetName: "SPD明细", headers: spdHeaders, rows: spdRows, longTextColumns: new Set([8]) }]);
  const usedNames = new Set();
  for (const item of attachments.filter((row) => row.status === "已归档")) {
    const ext = item.key.split(".").pop();
    const reconciliation = data.differences.find((difference) => difference.id === item.differenceId);
    const folder = folderByReconciliation.get(reconciliation?.reconciliation_id) ?? `未关联_${safeName(item.customer)}`;
    let basename = `${item.key.replaceAll("/", "_")}`;
    let attempt = 2;
    while (usedNames.has(basename)) basename = `${safeName(item.customer)}_${item.differenceId}_${attempt++}.${ext}`;
    usedNames.add(basename);
    archive.append(item.streamFactory(), { name: `图片附件/${folder}/${basename}` });
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
