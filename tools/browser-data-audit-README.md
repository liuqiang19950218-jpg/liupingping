# 季度对账系统浏览器本地数据只读审计工具

## 适用范围

本工具用于在季度对账系统的业务页面中，只读检查浏览器本地存储（localStorage / sessionStorage / IndexedDB）里保存了哪些对账数据、差额明细、跟进信息和往来发票核验数据，并导出一份 JSON 审计文件。

- 仅适用于本系统业务页面（生产或验收环境）。
- 只读：不写入、不删除任何浏览器数据，不写回服务器，不访问数据库。
- 不是数据迁移工具，也不是数据库备份工具。

不要在空白页、历史记录页、其他站点或错误页运行；不同域名的浏览器本地数据互不相通。

## 使用方式

1. 在浏览器打开实际业务页面（例如生产或验收入口地址，由运维记录提供，勿使用文档中的示例 IP）。
2. 按 `F12` 打开开发者工具。
3. 进入 `Console`，或 `Sources` → `Snippets` 新建片段。
4. 打开本目录下的 `tools/browser-data-audit.js`，复制全部内容粘贴并运行。
5. 浏览器会自动下载 `quarterly-recon-browser-audit-YYYYMMDD-HHMMSS.json`。
6. 将导出文件保存到受控的内部位置（见下方"导出文件保管"）。

## 只读安全边界（代码保证）

脚本不执行任何写操作：

- 不调用 `localStorage.setItem / removeItem / clear`
- 不调用 `sessionStorage.setItem / removeItem / clear`
- 不调用 `indexedDB.deleteDatabase`
- IndexedDB 事务只使用 `readonly`
- 不做 `put / add / delete / clear`
- 不发起任何网络请求（无 fetch / XHR / WebSocket）

## 敏感信息处理

以下键名（不区分大小写）只记录键名与"已排除"原因，**不导出其值**：

`token`、`access_token`、`refresh_token`、`session`、`password`、`passwd`、`secret`、`credential`、`authorization`、`auth`

键名过滤是尽力而为的第一道防线：脚本会导出业务数据原文（用于核对），因此**导出文件本身必须按业务数据管理**。

## 导出文件保管（强制）

- 导出 JSON 包含页面地址、业务数据概要、差额/发票/跟进字段、数据指纹等，属于**内部业务敏感材料**。
- 仅保存于受控内部位置；**不得提交 Git、不得上传公共网盘/聊天工具、不得作为工单附件外发**。
- 使用完毕后按内部数据留存规则删除或归档。

## 可选：服务器参考基线

仓库不内置任何业务基线数字。如需只读对比，在运行脚本**之前**注入：

```js
window.__QUARTERLY_RECON_AUDIT_BASELINE = {
  quarter: "2026 Q2",          // 示例字段，按实际审计目标填写
  rows: 851,
  uniqueCustomers: 649,
  companyReceivable: 514473239.51
};
```

未注入时，导出报告的 `serverBaselineComparison.baseline` 为 `null`，`currentActive` 仍会给出浏览器端的当前季度概要。

## 限制说明

- 审计结果只反映**当前浏览器**中保存的数据，不代表服务器数据库内容；两者需另行只读核对。
- 与服务器数据的对比仅作提示，不构成一致性证明。
- 本工具为独立运维/审计工具，不耦合业务页面代码，不影响系统运行。
