import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createAttachmentStorage } from "../services/attachment-service/storage.mjs";
import { createAttachmentService } from "../services/attachment-service/server.mjs";
import { createQuarterArchiveHandler } from "../services/attachment-service/quarter-archive.mjs";

const token = "archive-test-token";
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function entries(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "zip end record");
  const result = new Map(); let offset = buffer.readUInt32LE(end + 16);
  while (offset + 46 <= buffer.length && buffer.readUInt32LE(offset) === 0x02014b50) {
    const compression = buffer.readUInt16LE(offset + 10); const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28); const extraLength = buffer.readUInt16LE(offset + 30); const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42); const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const localNameLength = buffer.readUInt16LE(localOffset + 26); const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength; const bytes = buffer.subarray(start, start + compressedSize);
    result.set(name, compression === 8 ? inflateRawSync(bytes) : bytes);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

test("quarter archive streams a complete zip, preserves the selected quarter, and includes real images", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "quarterly-archive-"));
  const storage = createAttachmentStorage(root);
  const key = await storage.save(png, "png");
  const loadArchiveData = async (_databaseUrl, quarter) => ({
    reconciliations: [{ source_row_key: "1", account_set: "华东", region: "南京", customer: "客户/A", company_receivable: "100", customer_book_amount: "90", reconciliation_difference: "10", reconciliation_status: "未解决", bad_debt_amount: null, bad_debt_reason: null, adjustment_amount: null, adjustment_reason: null, solution: "不作为差额原因", solution_date: null, owner_name: "销售甲", manual_resolution_status: null, financial_attention: null }],
    differences: [{ id: "diff-1", customer: "客户/A", account_set: "华东", region: "南京", category: "other", invoice_no: null, invoice_date: null, difference_amount: "10", difference_description: "数据库差额原因", verification_status: "pending", attachment_keys: [key, "../never-read.png"] }],
    followups: [{ id: "follow-1", customer: "客户/A", region: "南京", owner_name: "销售甲", follow_status: "处理中", process_stage: "待销售处理", risk_level: "中", expected_complete_at: null, next_follow_up_at: null, latest_follow_up_at: null, closed_at: null, event_type: "跟进", content: "已电话沟通", occurred_at: "2026-09-23" }],
    materials: [{ customer: "客户/A", region: "南京", material_type: "对账函", provided: true, raw_value: "是" }], spd: [],
  });
  const archiveHandler = createQuarterArchiveHandler({ databaseUrl: "postgres://test", storage, loadArchiveData });
  const server = createAttachmentService({ root, token, storage, archiveHandler });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { authorization: `Bearer ${token}` };
  const preview = await fetch(`${base}/internal/quarter-archives?quarter=2026-Q2`, { headers });
  assert.equal(preview.status, 200);
  const summary = await preview.json();
  assert.equal(summary.summary.quarter, "2026-Q2"); assert.equal(summary.summary.archivedAttachments, 1); assert.equal(summary.summary.missingAttachments, 1);
  const response = await fetch(`${base}/internal/quarter-archives?quarter=2026-Q2&download=1`, { headers });
  assert.equal(response.status, 200); assert.match(response.headers.get("content-disposition"), /filename\*=UTF-8''/);
  const zipEntries = entries(Buffer.from(await response.arrayBuffer()));
  for (const filename of ["01_季度对账总表.xlsx", "02_差额明细.xlsx", "03_差额发票明细.xlsx", "04_客户跟进记录.xlsx", "05_资料收集情况.xlsx", "07_附件清单.xlsx", "归档说明.txt"]) assert.ok(zipEntries.has(filename), filename);
  assert.equal(zipEntries.has("06_SPD资料.xlsx"), false);
  assert.deepEqual(zipEntries.get("图片附件/客户_A_diff-1.png"), png);
  assert.match(zipEntries.get("归档说明.txt").toString("utf8"), /2026-Q2/);
  assert.match(zipEntries.get("归档说明.txt").toString("utf8"), /缺失/);
  assert.deepEqual(zipEntries.get("02_差额明细.xlsx").subarray(0, 2), Buffer.from("PK"));
  assert.equal((await fetch(`${base}/internal/quarter-archives?quarter=../2026-Q2`, { headers })).status, 400);
});
