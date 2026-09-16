"use client";
import * as XLSX from "xlsx";
import { ChangeEvent, useEffect, useState } from "react";

type Flow = "NEW_QUARTER_BASE" | "UPDATE_COMPANY_RECEIVABLE";
type Source = { sourceFileName:string; sourceSha256:string; headers:string[]; rows:unknown[][] };
type Preview = {
  previewToken: string;
  quarter: string;
  sourceSha256: string;
  sourceRows: number;
  companyReceivableNull?: number;
  ownerNull?: number;
  current?: { records?: number };
  newDictionaryValues?: { newRegions?: string[]; newAccountSets?: string[] };
  matched?: number;
  unmatched?: number;
  conflict?: number;
  unchanged?: number;
  blockingIssues?: number;
  changes?: Array<{ sequence:string; customer:string; oldCompanyReceivable:string; newCompanyReceivable:string; oldDifference:string|null; newDifference:string|null; requiresDifferenceReview:boolean }>;
};
type Batch = { id: string; label: string; quarter: string; original_file_name: string; source_sha256: string; imported_at: string; status: string; inserted_count: number; updated_count: number };
const updateHeaders=["序号","对账时间点","账套","区域","客户名称","新公司应收"];
const endpoints:Record<Flow,{preview:string;execute:string}>= {
  NEW_QUARTER_BASE:{preview:"/api/imports/quarter-base/preview",execute:"/api/imports/quarter-base/execute"},
  UPDATE_COMPANY_RECEIVABLE:{preview:"/api/imports/company-receivable/preview",execute:"/api/imports/company-receivable/execute"},
};
const labels:Record<Flow,string>={NEW_QUARTER_BASE:"导入新季度基础对账表",UPDATE_COMPANY_RECEIVABLE:"公司应收增量更新"};
async function sha256(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}
async function read(file:File):Promise<Source>{const buffer=await file.arrayBuffer();const wb=XLSX.read(buffer,{type:"array"});const all=XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]],{header:1,defval:""});return {sourceFileName:file.name,sourceSha256:await sha256(buffer),headers:(all[0]??[]).map(String),rows:all.slice(1).filter(r=>r.some(v=>String(v??"").trim()!==""))};}
async function api(path:string,body:unknown){const r=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const json=await r.json().catch(()=>({}));if(!r.ok)throw new Error(json.error??"请求失败");return json;}

export function DataImportCenter(){const [flow,setFlow]=useState<Flow>("NEW_QUARTER_BASE"),[quarter,setQuarter]=useState("2026-Q3"),[source,setSource]=useState<Source|null>(null),[preview,setPreview]=useState<Preview|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[batches,setBatches]=useState<Batch[]>([]);
  const refreshHistory=()=>fetch("/api/imports/history").then(r=>r.ok?r.json():Promise.reject()).then(value=>setBatches(value.batches)).catch(()=>setBatches([]));
  useEffect(()=>{void refreshHistory();},[]);
  const choose=async(event:ChangeEvent<HTMLInputElement>)=>{const file=event.target.files?.[0];event.target.value="";if(!file)return;try{setBusy(true);setMessage("正在解析并执行只读预检…");const next=await read(file);setSource(next);const p=await api(endpoints[flow].preview,{quarter,...next});setPreview(p);setMessage("预检完成。请核对后确认执行。");}catch(e){setPreview(null);setMessage(e instanceof Error?e.message:"预检失败");}finally{setBusy(false);}};
  const execute=async()=>{if(!source||!preview)return;try{setBusy(true);const result=await api(endpoints[flow].execute,{quarter,...source,previewToken:preview.previewToken});setMessage(`${labels[flow]}成功：${result.importedRows??result.updated??0} 条。`);setPreview(null);void refreshHistory();}catch(e){setMessage(e instanceof Error?e.message:"执行失败");}finally{setBusy(false);}};
  const template=()=>{const wb=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet([updateHeaders]);XLSX.utils.book_append_sheet(wb,ws,"公司应收更新");XLSX.writeFile(wb,"公司应收增量更新模板.xlsx");};
  return <section className="base-import-center" aria-label="季度基础数据维护">
    <div><h2>季度基础数据维护</h2><p>全部流程先预检，再由 PostgreSQL 原子事务执行；不会使用浏览器本地业务数据。</p></div>
    <div className="base-import-cards">{(Object.keys(labels) as Flow[]).map(kind=><button key={kind} type="button" className={`base-import-card ${kind===flow?"selected":""}`} onClick={()=>{setFlow(kind);setPreview(null);setMessage("");}}><strong>{labels[kind]}</strong><span>{kind==="NEW_QUARTER_BASE"?"新季度首次建立，只导入 7 个基础字段。":"仅更新精确匹配记录的公司应收，不覆盖已填写的业务内容。"}</span></button>)}</div>
    <div className="base-import-form"><label>目标季度 <select value={quarter} onChange={e=>{setQuarter(e.target.value);setPreview(null);}}>{[2026,2027,2028,2029,2030].flatMap(y=>[1,2,3,4].map(q=><option key={`${y}-${q}`} value={`${y}-Q${q}`}>{y} Q{q}</option>))}</select></label>{flow==="UPDATE_COMPANY_RECEIVABLE"&&<button type="button" onClick={template}>下载公司应收更新模板</button>}<label className="upload-action">上传并预检<input type="file" accept=".xlsx,.xls" onChange={choose} disabled={busy}/></label></div>
    {preview&&<article className="base-import-preview"><h3>{labels[flow]}预检</h3><p>季度：{preview.quarter}；SHA256：{String(preview.sourceSha256).slice(0,16)}…；有效记录：{preview.sourceRows}</p>{flow==="UPDATE_COMPANY_RECEIVABLE"?<><p>精确匹配：{preview.matched??0}；金额未变化：{preview.unchanged??0}；未匹配：{preview.unmatched??0}；匹配冲突：{preview.conflict??0}</p>{preview.changes?.map(change=><p key={change.sequence}>序号 {change.sequence} · {change.customer}：公司应收 {change.oldCompanyReceivable} → {change.newCompanyReceivable}；差额 {change.oldDifference??"NULL"} → {change.newDifference??"NULL"}{change.requiresDifferenceReview?"（差额需复核）":""}</p>)}{(preview.blockingIssues??0)>0&&<p className="base-import-message">存在未匹配或冲突记录，不能执行更新。</p>}</>:<><p>当前记录：{preview.current?.records??"—"}；新文件公司应收 NULL：{preview.companyReceivableNull??"—"}；负责人 NULL：{preview.ownerNull??"—"}</p><p>新增区域：{preview.newDictionaryValues?.newRegions?.join("、")||"无"}；新增账套：{preview.newDictionaryValues?.newAccountSets?.join("、")||"无"}</p></>}<button type="button" className="execute-import" disabled={busy||!preview.previewToken} onClick={execute}>确认正式执行</button></article>}
    <p className="base-import-message" role="status">{message}</p>
    {batches.length>0&&<section className="base-import-history"><h3>季度基础数据维护历史</h3><ul>{batches.map(batch=><li key={batch.id}>{batch.label} · {batch.quarter} · {batch.original_file_name} · {batch.status} · {new Date(batch.imported_at).toLocaleString("zh-CN")}</li>)}</ul></section>}
  </section>;
}
