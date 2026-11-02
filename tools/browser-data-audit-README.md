# 季度对账系统浏览器本地数据只读审计与导出工具

这个工具用于在正式网页的浏览器上下文里读取本地数据，并导出一份 JSON 审计文件，方便判断当前浏览器里到底保存了哪些季度对账数据、差额明细、跟进信息和往来发票核验数据。

它不是数据库迁移工具，不会把数据写回服务器。

## 使用方式

1. 打开实际业务网址，例如：

   `http://192.168.51.182:8000`

   不要在空白页、历史记录页、ChatGPT 页面或错误页运行。

2. 按 `F12` 打开开发者工具。

3. 进入 `Console`，或进入 `Sources` → `Snippets` 新建一个片段。

4. 打开本文件旁边的脚本：

   `tools/browser-data-audit.js`

5. 复制脚本全部内容，粘贴到 Console 或 Snippets 中运行。

6. 浏览器会自动下载：

   `quarterly-recon-browser-audit-YYYYMMDD-HHMMSS.json`

7. 下载后建议保存两份：

   - 一份原始备份
   - 一份发给开发人员分析

## 只读安全边界

本脚本只做读取和导出：

- 只读取 `localStorage`
- 只读取 `sessionStorage` 的概要
- 只以 `readonly` 事务读取 `IndexedDB`
- 自动下载 JSON 文件到本机

本脚本不会执行：

- `localStorage.setItem`
- `localStorage.removeItem`
- `localStorage.clear`
- `sessionStorage.setItem`
- `sessionStorage.removeItem`
- `sessionStorage.clear`
- `indexedDB.deleteDatabase`
- IndexedDB `put / add / delete / clear`

## 当前重点审计的数据

脚本会重点读取以下本系统已知存储键：

- `local-quarterly-reconciliation`
- `local-quarterly-reconciliation-archive`
- `local-quarterly-reconciliation-selected-quarter`
- `local-quarterly-reconciliation-spd-sheet-archive`
- `quarterly-reconciliation-import-history-v1`
- `local-quarterly-reconciliation-dashboard`
- `reconciliation-detail-target`
- `reconciliation-server-snapshot-updated-at`
- `reconciliation-server-ledger-updated-at`
- `local-quarterly-reconciliation-table-view`
- `local-quarterly-reconciliation-issue-tracker-view`

同时会只读扫描名称包含季度、对账、往来、发票、reconciliation、ledger、spd 等特征的 IndexedDB。

## 导出的内容

JSON 中包含：

- 浏览器页面地址和生成时间
- localStorage 关键业务数据
- 当前季度表概要
- 归档季度概要
- 当前季度与归档数据对比
- 差额六分类路径、笔数、金额、发票号、日期、差额说明存在情况
- 跟进信息字段路径
- IndexedDB 数据库、Store、记录数、索引概要
- 往来发票 ledger 概要
- 关键原始数据 SHA-256 指纹
- 与服务器参考基线的只读对比提示

## 敏感信息处理

如果发现键名包含以下内容，脚本不会导出对应值，只记录键名和排除原因：

- token
- access_token
- refresh_token
- session
- password
- secret
- credential
- authorization

## 注意事项

- 运行前不要清除网站数据。
- 如果网页正在报错，先关闭错误弹窗或刷新到系统正常页面后再运行。
- 如果要审计服务器 `182:8000` 的浏览器本地数据，必须在 `http://192.168.51.182:8000` 这个页面里运行。
- 如果要审计旧 ChatGPT Site 链接的数据，必须在旧链接页面里运行；不同域名的浏览器本地数据互不相通。
