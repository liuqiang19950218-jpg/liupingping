"use client";

import { useEffect, useState } from "react";
import "./q1-action-panel.css";

const SHEET_KEY = "local-quarterly-reconciliation";
type ActionItem = { region: string; customer: string; companyReceivable: string; cause: string; action: string };
type SavedSheet = { headers?: string[]; rows?: unknown[][] };
const regionClass: Record<string, string> = { "南京": "nanjing", "南通": "nantong", "扬州": "yangzhou", "无锡": "wuxi", "泰州": "taizhou" };

function valueAt(row: unknown[], headers: string[], name: string) {
  const index = headers.findIndex(header => String(header).replace(/\s/g, "") === name.replace(/\s/g, ""));
  return index < 0 ? "" : String(row[index] ?? "").trim();
}

function valueFromMarkedColumn(row: unknown[], headers: string[], names: string[]) {
  return names.map(name => valueAt(row, headers, name)).find(Boolean) ?? "";
}

function actionRows(): ActionItem[] {
  try {
    const sheet = JSON.parse(localStorage.getItem(SHEET_KEY) || "null") as SavedSheet | null;
    if (!sheet?.headers?.length || !sheet.rows?.length) return [];
    const statusHeader = "26年1季度是否对清";
    if (!sheet.headers.some(header => String(header).replace(/\s/g, "") === statusHeader)) return [];
    return sheet.rows
      .filter(row => valueAt(row, sheet.headers!, statusHeader) === "未对清")
      .map(row => ({
        region: valueAt(row, sheet.headers!, "区域") || "未填写",
        customer: valueAt(row, sheet.headers!, "客户名称") || "—",
        companyReceivable: valueAt(row, sheet.headers!, "公司应收") || "—",
        cause: valueFromMarkedColumn(row, sheet.headers!, ["原因", "核心原因", "差额原因备注"]) || "—",
        action: valueFromMarkedColumn(row, sheet.headers!, ["措施", "解决措施", "处理措施", "下一步动作", "解决方案"]) || "待填写",
      }));
  } catch { return []; }
}

function exportList(items: ActionItem[]) {
  const content = [["区域", "客户", "公司应收金额", "核心原因", "下一步动作"], ...items.map(item => [item.region, item.customer, item.companyReceivable, item.cause, item.action])]
    .map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([`\ufeff${content}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = "2026Q1-未对清客户重点行动清单.csv"; link.click(); URL.revokeObjectURL(url);
}

export function Q1ActionPanel() {
  const [selected, setSelected] = useState(6); const [items, setItems] = useState<ActionItem[]>([]);
  useEffect(() => { const sync = () => setItems(actionRows()); sync(); const quarter = (event: Event) => setSelected((event as CustomEvent<number>).detail); window.addEventListener("quarter-selected", quarter); window.addEventListener("reconciliation-updated", sync); return () => { window.removeEventListener("quarter-selected", quarter); window.removeEventListener("reconciliation-updated", sync); }; }, []);
  if (selected !== 6) return null;
  return <section className="q1-actions"><div className="action-heading"><div><p>2026 Q1 专项跟进</p><h2>未对清客户重点行动清单</h2><span>仅统计“26年1季度是否对清”明确为“未对清”的客户，共 {items.length} 家；金额口径为公司应收金额。</span></div><button type="button" className="export-button" onClick={() => exportList(items)} disabled={!items.length}>↓ 导出清单</button></div><div className="action-table"><table><thead><tr><th>区域</th><th>客户</th><th>公司应收金额</th><th>核心原因</th><th>下一步动作</th></tr></thead><tbody>{items.length ? items.map(item => <tr key={`${item.region}-${item.customer}`}><td><span className={`region-tag ${regionClass[item.region] ?? ""}`}>{item.region}</span></td><td>{item.customer}</td><td>{item.companyReceivable}</td><td>{item.cause}</td><td>{item.action}</td></tr>) : <tr><td colSpan={5}>暂无“26年1季度是否对清”为“未对清”的客户数据。</td></tr>}</tbody></table></div></section>;
}
