# Full Import Runtime Matrix

Phase 2G.0 全系统上传 / 导入 / 替换 / 文件写入入口总审计。只读审计，无写入。
基于真实代码 / 数据库 / 文件证据，非提示词复述。

## TOTAL_UPLOAD_IMPORT_ACTIONS_FOUND = 9

业务数据上传动作 = 7；另 2 个为图片附件/OCR 辅助入口。

| # | 动作 | UI | 组件 | handler | 接受类型 | 旧存储 | 当前 PG 目标 | 写 API | 读消费方 | 多机共享 | PG 状态 | cutover blocker |
|---|------|-----|--------|---------|----------|--------|--------------|--------|-----------|---------|---------|----------------|
| 1 | 上传季度对账表 | 上传对账季度表 | QuarterlyReconciliation.tsx | importFile | .xlsx/.xls | localStorage `local-quarterly-reconciliation-archive` | recon.reconciliations / import_batches / migration_manifests | POST /api/quarter/[code]/import | 本季度对账详细情况表 (851 行 PG) | YES | COMPLETE | 无 |
| 2 | 上传/替换本年往来明细 | 上传本年往来明细 | QuarterlyReconciliation.tsx | importCurrentLedger | .xlsx/.xls multiple | IndexedDB `quarterly-reconciliation/ledger/current` | (本阶段新增) recon.ledger_datasets + ledger_verification_entries CURRENT_YEAR_QUARTER | (本阶段新增) POST /api/quarter/[code]/ledger/import | 发票核验 | NO（旧 IndexedDB）→ YES（PG 后） | 2G.1 已后端化，前端未接线 | 前端接线 |
| 3 | 导入资料提供情况表 | 导入资料提供情况表 | QuarterlyReconciliation.tsx | importMaterials | .xlsx/.xls | localStorage `local-quarterly-reconciliation-archive`（按客户合并） | recon.material_status（仅逐行手改走 PG） | PUT/PATCH /material-status（逐行） | 对账看板 资料状态 | 批量 NO / 逐行 YES | 批量未 PG | BLOCKER |
| 4 | 导入 SPD 表 | 导入 SPD 表 | QuarterlyReconciliation.tsx | importSpdSheet | .xlsx/.xls | localStorage `local-quarterly-reconciliation-spd-sheet-archive` | recon.spd_dashboard_rows（仅迁移回填 142 行） | 无 POST（路由仅 GET） | 对账看板 SPD 统计 | NO | 上传未 PG | BLOCKER |
| 5 | 上传公司应收更新表 | 上传公司应收更新表 | QuarterlyReconciliation.tsx | importCompanyReceivables | .xlsx/.xls | localStorage archive（仅 company 列） | 无 | 无（PATCH 白名单无 companyReceivable） | 本季度对账表 | NO | 未 PG | BLOCKER |
| 6 | 导入 Q1 浏览器迁移包 | 季度数据安全迁移 | ServerStateBridge.tsx | handleImport / ?syncServer=1 | .json | D1 /api/local-state + /api/ledger-state | 无（legacy D1 only） | POST /api/local-state /api/ledger-state | 生产浏览器恢复 | YES_SERVER_D1_LEGACY | legacy only | DEFERRED |
| 7 | OCR 发票识别 | 差额抽屉 OCR 识别 | QuarterlyReconciliation.tsx | recognizeInvoices | image/* | 浏览器本地（无持久化） | — | — | 差额明细自动填充 | — | 本地 | DEFERRED |
| 8 | 导入识别照片 | 差额明细照片导入 | QuarterlyReconciliation.tsx | recognizePhotos / importPhotos | image/* | 浏览器本地 | — | — | 差额明细 | — | 本地 | DEFERRED |
| 9 | 图片附件 | 其他（无发票）图片附件 | QuarterlyReconciliation.tsx | addImage | image/* | 本地 dataURL / attachmentKeys 骨架 | recon.difference_items.attachment_keys | POST/PATCH difference-item | 差额明细 | 部分 | 骨架 | DEFERRED |

## 用户人工确认的 6 个业务入口基准（真实状态）

1. QUARTER_RECON_IMPORT — PG 完成（QUARTER_RECON_IMPORT_PG_COMPLETE = YES）
2. CURRENT_YEAR_LEDGER_UPLOAD — 旧 IndexedDB；2G.1 后端 PG 完成、前端未接线
3. HISTORICAL_LEDGER_REPLACE — 无网页入口；底库=打包静态 JSON；schema 已支持版本化（V1..Vn，active 切换）
4. MATERIAL_STATUS_IMPORT — 批量只写 localStorage；逐行手改已接 PG
5. INDEPENDENT_SPD_IMPORT — 网页上传只写 localStorage；spd_dashboard_rows 无写 API
6. COMPANY_RECEIVABLE_UPDATE — 只写 localStorage；无 PG API（BLOCKER）

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
| 资料批量 | NO_LOCAL_ONLY |
| SPD 上传 | NO_LOCAL_ONLY |
| 公司应收更新 | NO_LOCAL_ONLY |
| 迁移包 | YES_SERVER_D1_LEGACY |

## 业务本地存储清单

- localStorage：local-quarterly-reconciliation(-archive/-spd-sheet-archive/-selected-quarter/-dashboard/-table-view/-issue-tracker-view)、quarterly-reconciliation-import-history-v1、postgres-quarterly-reconciliation-selected-quarter、reconciliation-server-{snapshot,ledger}-updated-at
- IndexedDB：quarterly-reconciliation / ledger / key="current"（本年往来，2G.1 后端已 PG）
- D1：/api/local-state、/api/ledger-state、/api/server-sync、/api/reconciliation、/api/admin/quarter（app_state_snapshots 等；业务表 ledger_lines/quarter_rows 0 行）

## Cutover Blocker 汇总

- BLOCKER：本年往来前端接线（后端已就绪）
- BLOCKER：资料批量导入→PG
- BLOCKER：独立 SPD 上传→PG POST
- BLOCKER：公司应收更新 PG API
- BLOCKER：formal 应用 004/005/006
- PRE_CUTOVER：import_batches 覆盖扩展到全类型（ledger 使用自有 ledger_datasets 审计元数据，文档见 LEDGER_POSTGRES_RUNTIME_CONTRACT.md）
- DEFERRED：OCR/图片、迁移包、D1 演示端点、RBAC
