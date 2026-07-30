"use client";

import { useEffect, useState } from "react";
import { cockpitRows } from "./cockpit-data";

export function CurrentYearLinkedSummary(){const [,setRevision]=useState(0);useEffect(()=>{const sync=()=>setRevision(value=>value+1);window.addEventListener("reconciliation-dashboard-updated",sync);return()=>window.removeEventListener("reconciliation-dashboard-updated",sync)},[]);const rows=[...cockpitRows],clear=rows.filter(row=>row.cleared).length,filled=rows.filter(row=>row.filled).length,unresolved=rows.filter(row=>!row.cleared).reduce((total,row)=>total+Math.abs(row.difference),0),rate=rows.length?clear/rows.length*100:0;return <section className="current-year-linked-summary"><div><p>本年度对账详细情况 · 手动更新</p><h2>本年度数据概览</h2><span>下方往年看板保留历史数据；点击“数据导入”中的“一键更新其他看板”后，此区域及其他看板才会更新。</span></div><div><b>{rows.length}</b><small>客户数</small></div><div><b>{filled}</b><small>已填写</small></div><div><b>{rate.toFixed(1)}%</b><small>对清率</small></div><div><b>{unresolved.toLocaleString("zh-CN",{maximumFractionDigits:2})}</b><small>未解决差额</small></div></section>}
