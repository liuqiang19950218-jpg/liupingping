"use client";

import { useEffect, useState } from "react";
import { cockpitRows } from "./cockpit-data";

export function CurrentYearLinkedSummary(){const [,setRevision]=useState(0);useEffect(()=>{const sync=()=>setRevision(value=>value+1);window.addEventListener("reconciliation-dashboard-updated",sync);return()=>window.removeEventListener("reconciliation-dashboard-updated",sync)},[]);const rows=[...cockpitRows],accountedRows=rows.filter(row=>row.filled),clear=accountedRows.filter(row=>row.cleared).length,unresolved=accountedRows.filter(row=>!row.cleared).reduce((total,row)=>total+Math.abs(row.difference),0),rate=accountedRows.length?clear/accountedRows.length*100:0;return <section className="current-year-linked-summary"><div><p>本年度对账详细情况 · 手动更新</p><h2>本年度数据概览</h2><span>本次同步共读取 {rows.length} 条原始明细；客户数和对清率均已排除“未对账”记录，不做客户去重。</span></div><div><b>{accountedRows.length}</b><small>客户数（已排除未对账）</small></div><div><b>{rate.toFixed(1)}%</b><small>对清率（已排除未对账）</small></div><div><b>{unresolved.toLocaleString("zh-CN",{maximumFractionDigits:2})}</b><small>未解决差额</small></div></section>}
