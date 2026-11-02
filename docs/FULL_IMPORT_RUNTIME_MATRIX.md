# Full Import Runtime Matrix

Phase 2G.0 全系统上传 / 导入 / 替换 / 文件写入入口总审计。只读审计，无写入。
基于真实代码 / 数据库 / 文件证据，非提示词复述。

## TOTAL_UPLOAD_IMPORT_ACTIONS_FOUND = 9

业务数据上传动作 = 7；另 2 个为图片附件/OCR 辅助入口。

| # | 动作 | UI | 组件 | handler | 接受类型 | 旧存储 | 当前 PG 目标 | 写 API | 读消费方 | 多机共享 | PG 状态 | cutover blocker |
|---|------|-----|--------|---------|----------|--------|--------------|--------|-----------|---------|---------|----------------|
| 1 | 上传季度对账表 | 上传对账季度表 | QuarterlyReconciliation.tsx | importFile | .xlsx/.xls | localStorage `local-quarterly-reconciliation-archive` | recon.reconciliations / import_batches / migration_manifests | POST /api/quarter/[code]/import | 本季度对账详细情况表 (851 行 PG) | YES | COMPLETE | 无 |
| 2 | 上传/替换本年往来明细 | 上传本年往来明细 | QuarterlyReconciliation.tsx | importCurrentLedger | .xlsx/.xls multiple | IndexedDB `quarterly-reconciliation/ledger/current`（仅保留旧版本遗留） | recon.ledger_datasets + ledger_verification_entries CURRENT_YEAR_QUARTER | POST /api/quarter/[code]/ledger/import | 发票核验 | YES | 前后端 PG 已接线 | 同季度重传策略待确认（409 明确提示） |
| 3 | 导入资料提供情况表 | 导入资料提供情况表 | QuarterlyReconciliation.tsx | importMaterials | .xlsx/.xls | 无业务回退（导入历史仅兼容记录） | recon.material_status（含 SPD-A） | POST /api/quarter/[code]/materials/import | 对账看板 资料状态 / 本季度对账详细情况表 | YES | FRONTEND_PG_COMPLETE | 无 |
| 4 | 导入 SPD 表 | 导入 SPD 表 | QuarterlyReconciliation.tsx | importSpdSheet | .xlsx/.xls | 无业务回退（导入历史仅兼容记录） | recon.spd_dashboard_rows（SPD-B） | POST /api/quarter/[code]/spd-dashboard/import | 对账看板 SPD 统计 | YES | FRONTEND_PG_COMPLETE | 无 |
| 5 | 上传公司应收更新表 | 上传公司应收更新表 | QuarterlyReconciliation.tsx | importCompanyReceivables | .xlsx/.xls | 无业务回退（导入历史仅兼容记录） | recon.reconciliations.company_receivable（+ 服务器派生 difference） | POST /api/quarter/[code]/company-receivables/import | 本季度对账表 | YES | FRONTEND_PG_COMPLETE | 无 |
| 6 | 导入 Q1 浏览器迁移包 | 季度数据安全迁移 | ServerStateBridge.tsx | handleImport / ?syncServer=1 | .json | D1 /api/local-state + /api/ledger-state | 无（legacy D1 only） | POST /api/local-state /api/ledger-state | 生产浏览器恢复 | YES_SERVER_D1_LEGACY | legacy only | DEFERRED |
| 7 | OCR 发票识别 | 差额抽屉 OCR 识别 | QuarterlyReconciliation.tsx | recognizeInvoices | image/* | 浏览器本地（无持久化） | — | — | 差额明细自动填充 | — | 本地 | DEFERRED |
| 8 | 导入识别照片 | 差额明细照片导入 | QuarterlyReconciliation.tsx | recognizePhotos / importPhotos | image/* | 浏览器本地 | — | — | 差额明细 | — | 本地 | DEFERRED |
| 9 | 图片附件 | 其他（无发票）图片附件 | QuarterlyReconciliation.tsx | addImage | image/* | 本地 dataURL / attachmentKeys 骨架 | recon.difference_items.attachment_keys | POST/PATCH difference-item | 差额明细 | 部分 | 骨架 | DEFERRED |

## 用户人工确认的 6 个业务入口基准（真实状态）

1. QUARTER_RECON_IMPORT — PG 完成（QUARTER_RECON_IMPORT_PG_COMPLETE = YES）
2. CURRENT_YEAR_LEDGER_UPLOAD — PostgreSQL 已接线；浏览器继续解析 Excel，最终写入按当前 quarter 的 ledger/import，禁止 IndexedDB 回退
3. HISTORICAL_LEDGER_REPLACE — PG 网页入口完成：复用 Excel 解析、多文件、显式确认，POST /api/ledger/historical/import；版本化原子替换，旧版本保留。
4. MATERIAL_STATUS_IMPORT — PG 网页入口完成：POST /api/quarter/[code]/materials/import；SPD-A 仅进 material_status，PARTIAL 显示匹配/未匹配数。
5. INDEPENDENT_SPD_IMPORT — PG 网页入口完成：POST /api/quarter/[code]/spd-dashboard/import；整表原子替换，导入后重新读取 SPD 看板。
6. COMPANY_RECEIVABLE_UPDATE — PG 网页入口完成：POST /api/quarter/[code]/company-receivables/import；仅服务端更新 company_receivable 与派生差额，歧义提示人工核验。

## Historical Ledger（2G.0 已确认，2G.1 已落 PG）

- 运行时权威核验源：public/ledger_keys.json + public/ledger_invoice_lookup.json
- SHA：ledger_keys c976856e8aeb75df594e5ac3b04232012da2f50fce03c9d6e7ca34267c70d688；lookup 02684e895398c0c57a04b051285d9c584212097a8b981340f187e894028e638d
- 规模：347,012 keys / 322,035 invoices / 325,756 date records
- UNION canonical = 355,915（A∩B=308,757；A-only=8,903；B-only=38,255）
- 日期 2008-11-06 ~ 2026-06-30
- 2G.1 已 backfill 为 recon.ledger_datasets (HISTORICAL_BASE V1, active) + 355,915 ledger_verification_entries

## 多用户可见性

| 入口 | 分类 |
|------|------|
| 季度对账表 | YES_PG |
| 本年往来明细 | NO_LOCAL_ONLY（旧）→ 2G.1 PG 化 |
| 资料批量 | YES_PG（2H.2 前端已接线） |
| SPD 上传 | YES_PG（2H.2 前端已接线） |
| 公司应收更新 | YES_PG（2H.2 前端已接线） |
| 历史往来底库替换 | YES_PG（2H.2 前端已接线） |
| 迁移包 | YES_SERVER_D1_LEGACY |

## 业务本地存储清单

- localStorage：local-quarterly-reconciliation(-archive/-spd-sheet-archive/-selected-quarter/-dashboard/-table-view/-issue-tracker-view)、quarterly-reconciliation-import-history-v1、postgres-quarterly-reconciliation-selected-quarter、reconciliation-server-{snapshot,ledger}-updated-at
- IndexedDB：quarterly-reconciliation / ledger / key="current"（本年往来，2G.1 后端已 PG）
- D1：/api/local-state、/api/ledger-state、/api/server-sync、/api/reconciliation、/api/admin/quarter（app_state_snapshots 等；业务表 ledger_lines/quarter_rows 0 行）

## Cutover Blocker 汇总

- CURRENT_YEAR_LEDGER_FRONTEND_PG_COMPLETE：YES；同季度重传策略仍待用户确认
- 2H.2 四类前端接线完成：资料批量、独立 SPD、公司应收、历史底库均由浏览器解析后仅提交 PostgreSQL API；导入历史不作为业务回退。
- BLOCKER：formal 应用 004/005/006/007
- PRE_CUTOVER：import_batches 覆盖扩展到全类型（ledger 使用自有 ledger_datasets 审计元数据，文档见 LEDGER_POSTGRES_RUNTIME_CONTRACT.md）
- DEFERRED：OCR/图片、迁移包、D1 演示端点、RBAC
