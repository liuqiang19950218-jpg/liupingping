# Ledger PostgreSQL Runtime Contract

Phase 2G.1 往来明细 PostgreSQL 运行时契约。本阶段只做后端（schema/migration/backfill/API/服务器权威核验/tests/staging）；复杂 React 前端交接 Codex（FRONTEND_LEDGER_WIRING_REQUIRED = YES）。

## 数据模型

### recon.ledger_datasets（数据集/版本元数据）

| 列 | 说明 |
|----|------|
| dataset_type | `HISTORICAL_BASE`（全年份底库）或 `CURRENT_YEAR_QUARTER`（当季累计快照） |
| year | 年份（CURRENT_YEAR_QUARTER 时有效；HISTORICAL_BASE 为 0） |
| quarter_id | 当季 quarter uuid（HISTORICAL_BASE 为 NULL） |
| version | 版本号（HISTORICAL_BASE V1/V2/...；CURRENT_YEAR_QUARTER 恒 1） |
| is_active | 是否启用（历史底库同一时间至多一个 active；旧版本保留不删） |
| source_file_name / source_sha256 / source_payload | 来源审计（哪个文件/字节产生这些行） |
| row_count / imported_at / created_at | 计数与时间 |

约束：UNIQUE(dataset_type, quarter_id, version)；部分唯一索引保证「至多一个 active HISTORICAL_BASE」「每季度至多一个 active CURRENT_YEAR_QUARTER」。

### recon.ledger_verification_entries（核验条目）

| 列 | 说明 |
|----|------|
| dataset_id | FK → ledger_datasets |
| source_row_key | canonical key `invoice|YYYYMMDD|amount2dp`，UNIQUE(dataset_id, source_row_key) |
| invoice_no_raw / invoice_no_normalized | 发票号（text；normalized=trim） |
| invoice_date_raw / invoice_date | 日期（date） |
| invoice_amount | numeric(18,2) |
| source_payload | 原始记录（审计） |

索引：(invoice_no_normalized, invoice_date, invoice_amount) —— 核验热路径。

## Historical Base Versioning

- V1 = 现有权威核验源（UNION canonical 355,915）→ 已 backfill 为 HISTORICAL_BASE V1 active。
- 未来用户因历史发票调整「替换历史底库」：新增 HISTORICAL_BASE V2/V3...，切换 is_active，旧版本不物理删除。
- 本阶段不做替换前端（HISTORICAL_LEDGER_REPLACE UI 未开发，schema 已支持）。

## CURRENT_YEAR_QUARTER 快照

- 每个季度独立 dataset（Q1=1-3月、Q2=1-6月、Q3=1-9月、Q4=1-12月 累计）。
- Q2 上传不覆盖 Q1；Q3 不覆盖 Q1/Q2。
- 同一季度重复上传：当前策略 BLOCK_EXISTING_QUARTER_LEDGER → 409 `LEDGER_QUARTER_DATA_ALREADY_EXISTS`（CURRENT_YEAR_LEDGER_REIMPORT_POLICY_REQUIRES_CONFIRMATION = YES，待用户决定）。

## Import API

```
POST /api/quarter/[code]/ledger/import
Body: { "sourceFiles": [ { "sourceFileName": "...", "headers": [...], "rows": [[...]] } ] }
```
- 支持多账套多文件一次上传。
- 表头探测（前 5 行）：发票号/发票代码/单据编号/摘要 + 开票日期/业务日期/财务日期/交易日期/日期 + 本期应收/应收金额/开票金额/含税金额/借方/金额。
- 原子事务：任一文件非法 → 整批 ROLLBACK（含已解析合法文件）。
- 季度作用域：quarter 不存在 → 404；已有当季 dataset → 409。
- 返回：`{ quarter, status:"IMPORTED", datasetId, datasetType:"CURRENT_YEAR_QUARTER", version, sourceFiles, sourceSha256, insertedRows, distinctInvoices }`。
- 审计：dataset 自带 source_file_name/source_sha256/source_payload/imported_at/row_count。本阶段不强行写 recon.import_batches；统一 Import History 后续需把 ledger 纳入（IMPORT_HISTORY_LEDGER_INTEGRATION_REQUIRED_LATER = YES）。

## Verify API

```
POST /api/quarter/[code]/ledger/verify
Body: { "invoiceNo": "...", "invoiceDate": "YYYY-MM-DD", "amount": "1234.56" }
```
- 范围：active HISTORICAL_BASE UNION 当季 CURRENT_YEAR_QUARTER（不含更早季度）。
- canonical 匹配：invoice_no_normalized + invoice_date + invoice_amount 精确；金额 100/100.0/100.00 等值。
- 返回：`{ matched, status:"matched"|"not_found", matchedDatasetType, matchedDatasetId, invoiceNo, invoiceDate, invoiceAmount, matchCount }`。
- 不暴露整个 dataset；索引查找，单次 ~0.1ms。

## 服务器权威核验（Difference Enforcement）

- 发票类 category（transit/returned/lost/instrument/otherInvoice + 迁移 legacy returned_invoice/lost_invoice/equipment/other_with_invoice）创建/更新时，服务端查询 PG ledger，决定 matched / 409 not_found。
- 客户端 verificationStatus 不可信（伪造 matched 但发票不存在 → 仍 409）。
- 无发票类别（other / other_without_invoice）= not_applicable，不要求 ledger match。
- 空白发票行（发票类但无发票号）= not_applicable（旧行为跳过）。

## Category Matrix

| category | 需核验 | 说明 |
|----------|--------|------|
| transit | required | 在途 |
| returned | required | 退票（新 taxonomy） |
| returned_invoice | required | 迁移 legacy 分类值（DB 存量） |
| lost | required | 丢票（新） |
| lost_invoice | required | 迁移 legacy |
| equipment | required | 迁移 legacy（仪器设备） |
| instrument | required | 仪器设备（新） |
| otherInvoice | required | 其他有发票（新） |
| other_with_invoice | required | 迁移 legacy |
| other | not_applicable | 其他无发票 |
| other_without_invoice | not_applicable | 迁移 legacy 无发票 |

注：write API 的 normalizeCategory 只接受新 taxonomy；迁移 legacy 值存在于 DB 存量行，UPDATE 时经 item.category 参与 enforcement。

## Error Contract

| 错误 | HTTP | code | 场景 |
|------|------|------|------|
| INVALID_INPUT | 400 | — | 缺少/无法规范化发票号/日期/金额；非法 category |
| NOT_FOUND | 404 | — | 季度不存在 |
| CONFLICT | 409 | LEDGER_QUARTER_DATA_ALREADY_EXISTS | 同季度重复上传 |
| CONFLICT | 409 | LEDGER_INVOICE_NOT_FOUND | 发票类差额发票不在底账（含伪造 matched） |

## 性能

- 核验查询：索引查找 (invoice_no_normalized, invoice_date, invoice_amount)，EXPLAIN 确认 Index Scan，无 355k 行 Seq Scan。
- backfill：COPY(FORMAT csv) 批量，25.9s / 355,915 行，无每行事务、无 N+1。
- 季度导入：chunk 批量 insert（2000/批）。

## Legacy Pending 不回写

- formal/迁移数据约 690 条发票类 difference item verification_status=pending（迁移期无完整底库时诚实保留）。
- 本阶段禁止批量改成 matched；不 UPDATE 存量。新 enforcement 只约束今后 CREATE/UPDATE。
- LEGACY_PENDING_DIFFERENCE_REVALIDATED = NO；如需重验另开专项。

## 前端接线（下一阶段 Codex）

- 当前 upload UI 仍 IndexedDB（importCurrentLedger）；verify UI 仍静态 JSON。
- Codex 范围：importCurrentLedger 切到 POST /api/quarter/[code]/ledger/import；保存前调用 verify 或依赖服务器 enforcement；移除前端 fetch ledger JSON 作为业务真相（可保留 fallback 资产）。
- 后端全部就绪后 READY_FOR_CODEX_LEDGER_FRONTEND = YES。
