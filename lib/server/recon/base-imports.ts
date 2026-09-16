import { createHash, randomUUID } from "node:crypto";
import { withPostgresClient, withPostgresTransaction } from "../../../db/postgres";
import { conflict, invalidInput, notFound } from "./errors";
import { cellToString, isValidQuarterCode, SqlClient } from "./remaining-imports-common";

export const BASE_HEADERS = ["序号", "对账时间点", "账套", "区域", "对账负责人", "客户名称", "公司应收"] as const;
export const RECEIVABLE_UPDATE_HEADERS = ["序号", "对账时间点", "账套", "区域", "客户名称", "新公司应收"] as const;
type BaseMode = "NEW_QUARTER_BASE";
type Preview = { kind: BaseMode | "UPDATE_COMPANY_RECEIVABLE"; quarter: string; sourceSha256: string; digest: string; targetDigest?: string; expiresAt: number };
const previews = new Map<string, Preview>();
const AMOUNT = /^-?\d+(\.\d{1,2})?$/;

type BaseRow = { sequence: string; timepoint: string | null; accountSet: string; region: string; ownerRaw: string | null; customer: string; companyReceivable: string | null; row: unknown[] };
type UpdateRow = { sequence: string; timepoint: string; accountSet: string; region: string; customer: string; companyReceivable: string; row: unknown[] };

function sha(payload: unknown) { return createHash("sha256").update(JSON.stringify(payload)).digest("hex"); }
type SourcePayload = { sourceFileName: string; sourceSha256: string; headers: string[]; rows: unknown[][] };
function sourceSha(payload: SourcePayload) {
  if (!/^[a-f0-9]{64}$/.test(payload.sourceSha256)) throw invalidInput("源文件 SHA256 无效");
  return payload.sourceSha256;
}
function quarterParts(code: string) { const m = /^(\d{4})-Q([1-4])$/.exec(code); if (!m) throw invalidInput("季度必须为 YYYY-QN"); return { year: Number(m[1]), quarter: Number(m[2]) }; }
function amount(value: unknown, row: number, allowNull: boolean) {
  if (value === null || value === undefined || value === "") { if (allowNull) return null; throw invalidInput(`第 ${row} 行新公司应收不能为空（可明确填写 NULL）`); }
  const text = typeof value === "number" ? value.toFixed(2) : String(value).trim().replace(/,/g, "");
  if (text === "NULL") return allowNull ? null : (() => { throw invalidInput(`第 ${row} 行金额不能为空`); })();
  if (!AMOUNT.test(text)) throw invalidInput(`第 ${row} 行金额格式错误`);
  return text.includes(".") ? text : `${text}.00`;
}
function cents(value: string | null) {
  if (!value) return 0;
  const [whole, decimal = ""] = value.split(".");
  return Number(whole) * 100 + Number((decimal + "00").slice(0, 2));
}
function exactIndexes(headers: string[], expected: readonly string[]) {
  return expected.map((name) => { const index = headers.indexOf(name); if (index < 0) throw invalidInput(`缺少必需列：${name}（MISSING_REQUIRED_HEADER）`); return index; });
}
function parseBase(payload: SourcePayload) {
  const at = exactIndexes(payload.headers, BASE_HEADERS); const rows: BaseRow[] = [];
  payload.rows.forEach((row, index) => { const n = index + 2; const sequence = cellToString(row[at[0]]); const accountSet = cellToString(row[at[2]]); const region = cellToString(row[at[3]]); const customer = cellToString(row[at[5]]);
    if (!sequence || !accountSet || !region || !customer) throw invalidInput(`第 ${n} 行序号/账套/区域/客户名称不能为空`);
    const rawOwner = cellToString(row[at[4]]); rows.push({ sequence, timepoint: cellToString(row[at[1]]) || null, accountSet, region, ownerRaw: rawOwner || null, customer, companyReceivable: amount(row[at[6]], n, true), row: BASE_HEADERS.map((_, i) => row[at[i]] ?? null) });
  }); if (!rows.length) throw invalidInput("没有可导入的数据行"); return rows;
}
function parseUpdates(payload: SourcePayload) {
  const at = exactIndexes(payload.headers, RECEIVABLE_UPDATE_HEADERS); const seen = new Set<string>(); const rows: UpdateRow[] = [];
  payload.rows.forEach((row, index) => { const n=index+2; const sequence=cellToString(row[at[0]]); const timepoint=cellToString(row[at[1]]); const accountSet=cellToString(row[at[2]]); const region=cellToString(row[at[3]]); const customer=cellToString(row[at[4]]);
    if (!sequence || !timepoint || !accountSet || !region || !customer) throw invalidInput(`第 ${n} 行序号/时间点/账套/区域/客户名称不能为空`); if (seen.has(sequence)) throw invalidInput(`序号 ${sequence} 在更新表中重复`); seen.add(sequence);
    rows.push({sequence,timepoint,accountSet,region,customer,companyReceivable:amount(row[at[5]],n,false)!,row:RECEIVABLE_UPDATE_HEADERS.map((_,i)=>row[at[i]]??null)});
  }); if (!rows.length) throw invalidInput("没有可更新的数据行"); return rows;
}
async function quarter(client: SqlClient, code: string) { const r=await client.query("SELECT id FROM recon.quarters WHERE code=$1",[code]); return r.rows[0]?.id as string | undefined; }
async function dictionaries(client: SqlClient, rows: BaseRow[]) { const [regions, accounts] = await Promise.all([client.query("SELECT name FROM recon.regions"),client.query("SELECT name FROM recon.account_sets")]); const knownR=new Set(regions.rows.map(r=>String(r.name))), knownA=new Set(accounts.rows.map(r=>String(r.name))); return { newRegions:[...new Set(rows.map(r=>r.region).filter(x=>!knownR.has(x)))], newAccountSets:[...new Set(rows.map(r=>r.accountSet).filter(x=>!knownA.has(x)))] }; }
function issue(kind: Preview["kind"], quarterCode: string, sourceSha256: string, digest: string, targetDigest?: string) { const token=randomUUID(); previews.set(token,{kind,quarter:quarterCode,sourceSha256,digest,targetDigest,expiresAt:Date.now()+15*60_000}); return token; }
function verify(token: string, kind: Preview["kind"], quarterCode: string, sourceSha256: string, digest: string) { const p=previews.get(token); previews.delete(token); if (!p || p.expiresAt<Date.now() || p.kind!==kind || p.quarter!==quarterCode || p.sourceSha256!==sourceSha256 || p.digest!==digest) throw conflict("预检令牌无效、已过期或源文件已变化（PREVIEW_REQUIRED）"); return p; }

export async function previewBase(kind: BaseMode, quarterCode: string, payload: SourcePayload) {
  if (!isValidQuarterCode(quarterCode)) throw invalidInput("季度必须为 YYYY-QN"); const rows=parseBase(payload); const fileSha=sourceSha(payload); const digest=sha(rows); const accounts:Record<string,number>={}, regions:Record<string,number>={}; rows.forEach(r=>{accounts[r.accountSet]=(accounts[r.accountSet]||0)+1;regions[r.region]=(regions[r.region]||0)+1;});
  return withPostgresClient(async client=>{ const q=await quarter(client,quarterCode); const existing=q ? await client.query("SELECT count(*)::int count, coalesce(sum(company_receivable),0)::text total FROM recon.reconciliations WHERE quarter_id=$1",[q]) : {rows:[{count:0,total:"0.00"}]}; if (kind==="NEW_QUARTER_BASE" && Number(existing.rows[0].count)>0) throw conflict("该季度已经存在基础对账数据，不能再次执行首次导入；如确需整体重建，请联系管理员/Codex进行专项处理。"); const children=q ? await client.query("SELECT (SELECT count(*) FROM recon.difference_items d JOIN recon.reconciliations r ON r.id=d.reconciliation_id WHERE r.quarter_id=$1)::int differences,(SELECT count(*) FROM recon.followup_items f JOIN recon.reconciliations r ON r.id=f.reconciliation_id WHERE r.quarter_id=$1)::int followups,(SELECT count(*) FROM recon.followup_events e JOIN recon.followup_items f ON f.id=e.followup_item_id JOIN recon.reconciliations r ON r.id=f.reconciliation_id WHERE r.quarter_id=$1)::int events,(SELECT count(*) FROM recon.material_status WHERE quarter_id=$1)::int materials",[q]) : {rows:[{differences:0,followups:0,events:0,materials:0}]}; const dict=await dictionaries(client,rows); return {previewToken:issue(kind,quarterCode,fileSha,digest),kind,quarter:quarterCode,sourceSha256:fileSha,sourceRows:rows.length,companyReceivableTotal:(rows.reduce((sum,row)=>sum+cents(row.companyReceivable),0)/100).toFixed(2),companyReceivableNull:rows.filter(r=>r.companyReceivable===null).length,ownerNull:rows.filter(r=>!r.ownerRaw||r.ownerRaw==="0").length,accountSets:accounts,regions,duplicateRecords:rows.length-new Set(rows.map(r=>`${r.accountSet}\u001f${r.region}\u001f${r.customer}`)).size,sequenceGaps:[],newDictionaryValues:dict,current:{records:Number(existing.rows[0].count),companyReceivableTotal:existing.rows[0].total,children:children.rows[0]}}; });
}

async function resolveBaseRows(client: SqlClient, quarterId: string, rows: BaseRow[]) {
  for (const name of new Set(rows.map(r=>r.accountSet))) await client.query("INSERT INTO recon.account_sets(code,name) VALUES($1,$1) ON CONFLICT (code) DO NOTHING",[name]);
  for (const name of new Set(rows.map(r=>r.region))) await client.query("INSERT INTO recon.regions(code,name) VALUES($1,$1) ON CONFLICT (code) DO NOTHING",[name]);
  const ids=await client.query("SELECT a.id::text aid,a.name account,g.id::text gid,g.name region FROM recon.account_sets a FULL JOIN recon.regions g ON false"); const account=new Map(ids.rows.filter(r=>r.account).map(r=>[String(r.account),String(r.aid)])); const region=new Map(ids.rows.filter(r=>r.region).map(r=>[String(r.region),String(r.gid)]));
  const customers=new Map<string,string>(); for (const r of rows) { const key=`${r.accountSet}\u001f${r.region}\u001f${r.customer}`; if (!customers.has(key)) { const c=await client.query("INSERT INTO recon.customers(external_code,name,region_id) VALUES(NULL,$1,$2) RETURNING id::text",[r.customer,region.get(r.region)]); customers.set(key,String(c.rows[0].id)); } }
  for (const r of rows) { const key=`${r.accountSet}\u001f${r.region}\u001f${r.customer}`; const owner=(!r.ownerRaw||r.ownerRaw==="0")?null:r.ownerRaw; const payload=JSON.stringify({allowed_source_columns:BASE_HEADERS,row:r.row,source_sequence:r.sequence,timepoint:r.timepoint,owner_raw_name:r.ownerRaw}); const rowKey=`base:${createHash("sha256").update(JSON.stringify(r.row)).digest("hex").slice(0,24)}`; await client.query("INSERT INTO recon.reconciliations(legacy_id,quarter_id,account_set_id,customer_id,owner_id,company_receivable,customer_book_amount,reconciliation_difference,reconciliation_status,source_row_key,source_payload,owner_name) VALUES($1,$2,$3,$4,NULL,$5::numeric,NULL,NULL,NULL,$6,$7::jsonb,$8)",[r.sequence,quarterId,account.get(r.accountSet),customers.get(key),r.companyReceivable,rowKey,payload,owner]); }
}

export async function executeBase(kind: BaseMode, quarterCode: string, input: SourcePayload & { previewToken:string }) { const rows=parseBase(input); const fileSha=sourceSha(input); verify(input.previewToken,kind,quarterCode,fileSha,sha(rows));
  return withPostgresTransaction(async client=>{ await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",["quarter-base:" + quarterCode]); let q=await quarter(client,quarterCode); if(!q){ if(kind!=="NEW_QUARTER_BASE") throw notFound("目标季度不存在"); const p=quarterParts(quarterCode); const day=p.quarter===1?"31":p.quarter===2?"30":p.quarter===3?"30":"31"; const cutoff=String(p.year)+"-"+String(p.quarter*3).padStart(2,"0")+"-"+day; const created=await client.query("INSERT INTO recon.quarters(code,year,quarter,cutoff_date,status) VALUES($1,$2,$3,$4,'open') RETURNING id::text",[quarterCode,p.year,p.quarter,cutoff]); q=String(created.rows[0].id); }
    const existing=await client.query("SELECT count(*)::int count FROM recon.reconciliations WHERE quarter_id=$1",[q]); if(Number(existing.rows[0].count)>0) throw conflict("该季度已经存在基础对账数据，不能再次执行首次导入；如确需整体重建，请联系管理员/Codex进行专项处理。");
    await resolveBaseRows(client,q,rows); const check=await client.query("SELECT count(*)::int count FROM recon.reconciliations WHERE quarter_id=$1",[q]); if(Number(check.rows[0].count)!==rows.length) throw new Error("POST_IMPORT_VALIDATION_FAILED"); const batch=await client.query("INSERT INTO recon.import_batches(quarter_id,data_type,original_file_name,source_sha256,imported_at,valid_record_count,inserted_count,target_module,status,details) VALUES($1,$2,$3,$4,now(),$5,$5,'quarter-base-import','success',$6::jsonb) RETURNING id::text",[q,kind,input.sourceFileName,fileSha,rows.length,JSON.stringify({only_allowed_fields:BASE_HEADERS})]); return {status:"SUCCESS",quarter:quarterCode,importedRows:rows.length,sourceSha256:fileSha,importBatchId:batch.rows[0].id}; }); }

type ReceivableTarget = { id: string; legacy_id: string; timepoint: string; account: string; region: string; customer: string; current: string; book: string | null; difference?: string | null };
type ReceivablePreviewRow = { sequence: string; customer: string; oldCompanyReceivable: string; newCompanyReceivable: string; oldDifference: string | null; newDifference: string | null; requiresDifferenceReview: boolean };
function receivableSnapshot(rows: ReceivableTarget[]) { return sha(rows.map((row) => [row.id, row.legacy_id, row.timepoint, row.account, row.region, row.customer, row.current, row.book]).sort((a, b) => String(a[1]).localeCompare(String(b[1])))); }
export async function previewReceivable(quarterCode:string,payload:SourcePayload) { if(!isValidQuarterCode(quarterCode)) throw invalidInput("季度必须为 YYYY-QN"); const rows=parseUpdates(payload), fileSha=sourceSha(payload), digest=sha(rows); return withPostgresClient(async client=>{const q=await quarter(client,quarterCode);if(!q)throw notFound("目标季度不存在");const db=(await client.query("SELECT r.id::text,r.legacy_id,r.source_payload->>'timepoint' timepoint,a.name account,g.name region,c.name customer,r.company_receivable::text current,r.customer_book_amount::text book FROM recon.reconciliations r JOIN recon.account_sets a ON a.id=r.account_set_id JOIN recon.customers c ON c.id=r.customer_id LEFT JOIN recon.regions g ON g.id=c.region_id WHERE r.quarter_id=$1",[q])) as {rows:ReceivableTarget[]};const bySeq=new Map(db.rows.map((r: ReceivableTarget)=>[String(r.legacy_id),r]));let matched=0,unmatched=0,conflictCount=0,unchanged=0;const changes:ReceivablePreviewRow[]=[];for(const r of rows){const x=bySeq.get(r.sequence);if(!x){unmatched++;continue;}if(x.timepoint!==r.timepoint||x.account!==r.accountSet||x.region!==r.region||x.customer!==r.customer){conflictCount++;continue;}if(x.current===r.companyReceivable){unchanged++;continue;}matched++;const newDifference=x.book===null?null:(Number(r.companyReceivable)-Number(x.book)).toFixed(2);changes.push({sequence:r.sequence,customer:r.customer,oldCompanyReceivable:x.current,newCompanyReceivable:r.companyReceivable,oldDifference:x.book===null?null:(Number(x.current)-Number(x.book)).toFixed(2),newDifference,requiresDifferenceReview:newDifference!==null});}const blockingIssues=unmatched+conflictCount;return {previewToken:blockingIssues===0?issue("UPDATE_COMPANY_RECEIVABLE",quarterCode,fileSha,digest,receivableSnapshot(db.rows)):null,quarter:quarterCode,sourceSha256:fileSha,sourceRows:rows.length,matched,unmatched,conflict:conflictCount,unchanged,blockingIssues,changes};}); }

export async function executeReceivable(
  quarterCode: string,
  input: SourcePayload & { previewToken: string },
) {
  const rows = parseUpdates(input);
  const fileSha = sourceSha(input);
  const preview = verify(input.previewToken, "UPDATE_COMPANY_RECEIVABLE", quarterCode, fileSha, sha(rows));
  return withPostgresTransaction(async (client) => {
    const quarterId = await quarter(client, quarterCode);
    if (!quarterId) throw notFound("目标季度不存在");
    const snapshot = await client.query("SELECT r.id::text,r.legacy_id,r.source_payload->>'timepoint' timepoint,a.name account,g.name region,c.name customer,r.company_receivable::text current,r.customer_book_amount::text book FROM recon.reconciliations r JOIN recon.account_sets a ON a.id=r.account_set_id JOIN recon.customers c ON c.id=r.customer_id LEFT JOIN recon.regions g ON g.id=c.region_id WHERE r.quarter_id=$1", [quarterId]);
    if (preview.targetDigest !== receivableSnapshot(snapshot.rows as ReceivableTarget[])) throw conflict("预检之后目标季度已发生并发变更（CONCURRENT_CHANGE）");
    let updated = 0;
    let unchanged = 0;
    const auditEntries: Array<Record<string, string | null>> = [];
    for (const row of rows) {
      const found = await client.query(
        "SELECT r.id::text, r.company_receivable::text current, r.customer_book_amount::text book, r.reconciliation_difference::text difference, r.source_payload->>'timepoint' timepoint, a.name account, g.name region, c.name customer FROM recon.reconciliations r JOIN recon.account_sets a ON a.id=r.account_set_id JOIN recon.customers c ON c.id=r.customer_id LEFT JOIN recon.regions g ON g.id=c.region_id WHERE r.quarter_id=$1 AND r.legacy_id=$2 FOR UPDATE OF r",
        [quarterId, row.sequence],
      );
      if (found.rowCount !== 1) throw conflict("序号 " + row.sequence + " 未匹配或存在冲突");
      const current = found.rows[0];
      if (current.timepoint !== row.timepoint || current.account !== row.accountSet || current.region !== row.region || current.customer !== row.customer) throw conflict("序号 " + row.sequence + " 关键字段不一致");
      if (current.current === row.companyReceivable) { unchanged++; continue; }
      await client.query(
        "UPDATE recon.reconciliations SET company_receivable=$2::numeric, reconciliation_difference=CASE WHEN customer_book_amount IS NULL THEN NULL ELSE $2::numeric-customer_book_amount END, updated_at=now(), version=version+1 WHERE id=$1",
        [current.id, row.companyReceivable],
      );
      auditEntries.push({ source_sequence: row.sequence, reconciliation_id: String(current.id), account_set: String(current.account), region: current.region === null ? null : String(current.region), customer_name: String(current.customer), old_company_receivable: String(current.current), new_company_receivable: row.companyReceivable, delta: (Number(row.companyReceivable) - Number(current.current)).toFixed(2), customer_book_amount: current.book === null ? null : String(current.book), old_difference: current.difference === null ? null : String(current.difference), new_difference: current.book === null ? null : (Number(row.companyReceivable) - Number(current.book)).toFixed(2) });
      updated++;
    }
    const batch = await client.query(
      "INSERT INTO recon.import_batches(quarter_id,data_type,original_file_name,source_sha256,imported_at,valid_record_count,updated_count,skipped_count,target_module,status,details) VALUES($1,'UPDATE_COMPANY_RECEIVABLE',$2,$3,now(),$4,$5,$6,'quarter-base-import','success',$7::jsonb) RETURNING id::text",
      [quarterId, input.sourceFileName, fileSha, rows.length, updated, unchanged, JSON.stringify({ only_updated_field: "company_receivable", row_audit: auditEntries })],
    );
    for (const entry of auditEntries) await client.query("INSERT INTO recon.audit_logs(action,entity_type,entity_id,before_data,after_data) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)", ["UPDATE_COMPANY_RECEIVABLE", "reconciliation", entry.reconciliation_id, JSON.stringify({ batch_id: batch.rows[0].id, quarter: quarterCode, source_filename: input.sourceFileName, source_sha256: fileSha, ...entry, company_receivable: entry.old_company_receivable, difference: entry.old_difference }), JSON.stringify({ batch_id: batch.rows[0].id, quarter: quarterCode, source_filename: input.sourceFileName, source_sha256: fileSha, ...entry, company_receivable: entry.new_company_receivable, difference: entry.new_difference })]);
    return { status: "SUCCESS", quarter: quarterCode, updated, unchanged, importBatchId: batch.rows[0].id };
  });
}
