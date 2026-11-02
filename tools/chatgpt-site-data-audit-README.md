# 正式 ChatGPT Site 浏览器业务数据只读保全与导出工具

本工具用于数据库迁移前，从正式 ChatGPT Site 的浏览器上下文中只读导出当前业务数据证据。

它不是迁移工具，不会修改正式网站，不会写入 localStorage / IndexedDB，不会访问服务器接口。

## 运行位置

必须在保存有正式 Q1 数据的同一个浏览器、同一个用户配置文件中打开：

```text
https://quarterly-recon-lenovo.poetic-macaw-6673.chatgpt.site/
```

不要在以下地址运行：

```text
http://192.168.51.182:8000
http://127.0.0.1:3000
http://localhost:3000
其他测试站点
```

脚本带有 origin 校验；如果不是正式站点，会立即停止。

## 使用步骤

1. 打开正式站点，并确认页面里能看到需要保全的 Q1 业务数据。
2. 按 `F12` 打开浏览器开发者工具。
3. 进入 `Console`。
4. 打开本文件旁边的脚本：

```text
tools/chatgpt-site-data-audit.js
```

5. 复制脚本全部内容，粘贴到 Console 后回车执行。
6. 浏览器会自动下载导出文件。
7. 将下载文件复制到安全目录，建议至少保留两份。

## 导出文件

正常会下载：

```text
quarterly-recon-browser-manifest-YYYYMMDD-HHMMSS.json
quarterly-recon-localstorage-YYYYMMDD-HHMMSS.json
quarterly-recon-indexeddb-YYYYMMDD-HHMMSS.json
```

如果 IndexedDB 数据量超过 100MB，脚本会自动分片，例如：

```text
quarterly-recon-indexeddb-YYYYMMDD-HHMMSS-manifest-only.json
quarterly-recon-indexeddb-YYYYMMDD-HHMMSS-part-001.json
quarterly-recon-indexeddb-YYYYMMDD-HHMMSS-part-002.json
```

## 只读边界

脚本只使用以下浏览器能力：

- `localStorage.length`
- `localStorage.key(index)`
- `localStorage.getItem(key)`
- `indexedDB.databases()`
- `indexedDB.open(name)`
- IndexedDB `readonly` transaction
- `objectStore.count()`
- `objectStore.openCursor()`
- `performance.getEntriesByType("resource")`

脚本不会执行：

- 写入 localStorage
- IndexedDB `readwrite`
- IndexedDB `put` / `add` / `delete` / `clear`
- `indexedDB.deleteDatabase`
- 数据库 schema upgrade
- 读取 cookie
- `fetch` / `XMLHttpRequest` / `WebSocket`
- 任何服务器写入或同步请求

## 敏感键排除

localStorage 中包含以下关键词的键名会被排除：

```text
token
auth
authorization
password
secret
credential
session
access
refresh
```

季度选择键不属于敏感键，允许导出：

```text
local-quarterly-reconciliation-selected-quarter
```

## 重点业务键

脚本会优先识别并导出以下业务键：

```text
local-quarterly-reconciliation
local-quarterly-reconciliation-archive
local-quarterly-reconciliation-selected-quarter
local-quarterly-reconciliation-spd-sheet-archive
local-quarterly-reconciliation-dashboard
local-quarterly-reconciliation-issue-tracker-view
quarterly-reconciliation-import-history-v1
```

## Manifest 内容

Manifest 会记录：

- 执行站点
- 执行时间
- localStorage 清单
- IndexedDB 数据库和 store 清单
- 导出文件大小
- SHA-256 哈希
- 当前季度主数据候选
- 公司应收、客户账面金额、差额、对账状态、跟进、发票字段可用性
- 六类差额关键词扫描结果
- 资料 / SPD / 回函关键词扫描结果
- performance resource 线索
- 与服务器基线的固定记录

服务器基线固定为：

```json
{
  "quarter": "2026 Q2",
  "rows": 851,
  "customers": 649,
  "companyReceivableTotal": 514473239.51
}
```

## 已知限制

- 如果浏览器不支持 `indexedDB.databases()`，脚本不会猜测并打开数据库名，避免误创建数据库。
- 二进制对象、附件、Blob、File、ArrayBuffer 只导出元信息，不直接导出二进制内容。
- 对未知字段不会伪造为 0，会显示 `{ "available": false }`。
- 本工具只负责保全导出，不负责把数据写入 182 服务器数据库。
