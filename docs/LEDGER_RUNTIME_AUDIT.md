# Ledger Runtime Audit（往来明细专项审计）

Phase 2G.0/2G.1 往来明细全链路只读审计 + 落 PG。目标：回答"用户最初提供的所有年份/所有账套往来数据现在在哪里、是否完整进入 PostgreSQL"。

## 结论速览

1. 服务器上找到的权威历史核验数据 = 加工产物（打包静态 JSON），非原始会计台账。
2. 原始按账套 xlsx 不在本服务器（RAW_SOURCE_XLSX_AVAILABLE = NO）。
3. 运行时核验源可用（RUNTIME_VERIFICATION_SOURCE_AVAILABLE = YES）→ 2G.1 已定义为 Historical Base V1 迁入 PG。
4. 2G.0 时 PG ledger_invoices = 0（formal/test 全部）；2G.1 已新增独立 ledger 运行时表并 backfill 355,915 条。

## Historical Ledger 权威源

| 项 | 值 |
|----|-----|
| 文件 | public/ledger_keys.json、public/ledger_invoice_lookup.json（全部 release 一致，2026-07-24 起未变） |
| SHA256 | keys c976856e8aeb75df594e5ac3b04232012da2f50fce03c9d6e7ca34267c70d688；lookup 02684e895398c0c57a04b051285d9c584212097a8b981340f187e894028e638d |
| git blob | 10bc5a4 / 709b443 / 1bad450 三处 ledger_keys blob 一致 (3b25665e…) |
| 生成工具 | scripts/normalize_ledger.py（BASE=E:\交接资料\工作交接-历年往来-8.30\更新至25.12月往来数据，<账套>-往来明细.xlsx） |
| 规模 | keys 347,012；lookup 322,035 invoices / 325,756 dates |
| 年份 | 2008–2026（2023:50,846、2024:58,888、2025:58,992、2026:30,197） |
| 日期范围 | 2008-11-06 ~ 2026-06-30 |
| 维度 | 仅 invoice|date|amount 三元组；无账套/客户维度（旧业务核验本就不匹配账套/客户） |

## 旧系统真实发票核验链路（从销售填写页反向追踪）

1. 页面加载：fetch("/ledger_keys.json") + fetch("/ledger_invoice_lookup.json") 进内存（QuarterlyReconciliation.tsx 901-924）。
2. 叠加 IndexedDB quarterly-reconciliation/ledger/current（本年往来，浏览器上传）。
3. 核验函数：validLedgerEntry（526-540）/ findLedgerMatch（541-561）/ ledgerKey（524-525）/ normalizeDate（562-570）/ num（263-266）。
4. 双路径：
   - Path A：lookup[invoice] 存在且 dates 含 entry.date（YYYY-MM-DD）且 |lookup.amount - num(amount)| < 0.01
   - Path B：keys 含 "invoice|YYYYMMDD|amount.toFixed(2)"
5. 保存门禁：commit() 内 needsCheck = transit/returned/lost/instrument/otherInvoice 中 hasInvoiceNumber 的条目必须全部 validLedgerEntry 通过，否则 alert 阻断（1790-1820）。
6. 服务器差异写：前端差异保存把 verificationStatus 固定为 "matched"（1836 行）→ 2G.1 改为服务器权威核验（禁止客户端决定）。

## Current-Year Ledger（本年往来）

- 旧存储：IndexedDB key="current"（整体 REPLACE，无季度快照）。
- 语义：Q1=1-3月、Q2=1-6月、Q3=1-9月、Q4=1-12月 累计文件。
- 2G.1 用户确认策略：按季度独立快照（CURRENT_YEAR_LEDGER_QUARTER_SNAPSHOT_POLICY = CONFIRMED）；Q2 不覆盖 Q1；同一季度重复上传当前 409（BLOCK_EXISTING_QUARTER_LEDGER，CURRENT_YEAR_LEDGER_REIMPORT_POLICY_REQUIRES_CONFIRMATION = YES）。
- 静态 JSON 已含 2026-01~06（30,197 keys），与本年季度快照在前半年重叠 → 核验逻辑去重（同 canonical key 命中一次，非报错）。

## PostgreSQL ledger 状态

| DB | ledger_invoices (旧表) | ledger_datasets (2G.1) | ledger_verification_entries (2G.1) |
|----|------------------------|------------------------|-------------------------------------|
| formal quarterly_recon | 0 | 不存在 | 不存在 |
| 全部 test DB | 0 | — | — |
| ledger_runtime_test_20260828 | 0 | HISTORICAL_BASE V1 (active) | 355,915 |

- 旧表 recon.ledger_invoices 因要求 account_set_id/customer_id 且 UNIQUE(account_set_id, invoice_no)，与"无账套/客户维度的三元组"不匹配；2G.1 未伪造账套/客户塞入该表，而是新增独立数据集模型（见 LEGACY_LEDGER_JSON_TO_PG_MAPPING.md）。
- LEDGER_SCHEMA_EXTENSION_REQUIRED = YES（已由 006 解决）。

## 服务器权威核验（2G.1）

- 范围：active HISTORICAL_BASE UNION 当季 CURRENT_YEAR_QUARTER（季度隔离，不含更早季度）。
- 服务端查询 PG 决定 matched/not_found；客户端 verificationStatus 不可信。
- 发票类 category（transit/returned/lost/instrument/otherInvoice + 迁移 legacy returned_invoice/lost_invoice/equipment/other_with_invoice）required；other/other_without_invoice 无发票 = not_applicable。
- not_found → 409 LEDGER_INVOICE_NOT_FOUND，拒绝保存。
- 索引 (invoice_no_normalized, invoice_date, invoice_amount) 命中，无 32 万行全扫。

## 存量 pending 差异记录

- formal/迁移数据存在约 690 条发票类 difference item verification_status=pending（2G.0 迁移期无完整底库时诚实保留）。
- LEGACY_PENDING_DIFFERENCE_REVALIDATED = NO（本阶段禁止批量改写；只约束今后 CREATE/UPDATE）。后续如需重验另开专项。

## 数据文件记录（只读，未移动/删除）

服务器上未发现原始 xlsx（搜索 往来/明细/发票/账套/ledger 等关键词无果；原始文件位于 Windows 交接资料目录）。migration bundle（/home/liupp/111/*.zip）不含 ledger_invoices 数据（Q1/Q2 bundle 均 ledger_invoices_expected=0）。
