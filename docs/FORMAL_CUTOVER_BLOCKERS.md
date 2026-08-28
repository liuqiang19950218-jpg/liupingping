# FORMAL CUTOVER BLOCKERS MATRIX — quarterly-recon → PostgreSQL

Phase 2I 最终判定矩阵。每项 = PASS / BLOCKED / DEFERRED_NOT_BLOCKING / 特殊状态。
RC = `8c8af2e1709330e8af6c47cf7ea3029019966a57`（唯一）。

## 硬 Gate 矩阵

| # | 项目 | 状态 | 证据 |
|---|---|---|---|
| 1 | RC build | **PASS** | 2I.1 实测：npm ci 通过；build "Build complete"；lint 0 errors（56 warnings）；tests 45/45 |
| 2 | server-side delta | **PASS** | D1 快照 2026-08-21T03:05:20Z（早于 Q1/Q2 迁移基线 08-25/26）；formal PG 各业务计数与权威源一致；Q1 权威 localStorage 快照（752/SPD 142）服务端可恢复 |
| 3 | browser IndexedDB authority | **PRE_EXECUTION_GATE** | 服务器无 current-year 副本（D1 ledger 表=0，无文件）；旧 runtime 本年往来仅存浏览器 IndexedDB key="current"。**正式执行当天必须完成 ACTUAL_BROWSER_INDEXEDDB_CURRENT_CHECK，否则禁止 migration/deploy** |
| 4 | owner source | **PASS** | formal source_payload→owner_raw_name（Q1=713/Q2=826 非空）；浏览器快照 Q1 713 一致；004 内建 backfill（哨兵→NULL）clone 实测 Q1=697/Q2=788 |
| 5 | SPD source | **PASS** | 权威 localStorage spd-sheet-archive "2026 Q1"=142 行（是105/否30/空7）；与 staging test DB 一致；不得用 material_status SPD-A 推导 |
| 6 | Historical source | **PASS** | 8000 release public ledger JSON sha 一致（keys c976856e…/lookup 02684e89…）；canonical 355915 行、sha aedb6247…、日期 2008-11-06~2026-06-30、distinct 323215 |
| 7 | clone migrations | **PASS** | clone 应用 004–007 全过（0.55s/0.19s/0.21s/0.20s）；schema_migrations 001–007 |
| 8 | clone backfill | **PASS** | owner 697/788；SPD 142；Historical 355915（23.6s）；CURRENT_YEAR=0 |
| 9 | clone runtime | **PASS** | 8003 = exact RC，/api/version buildSha 一致；quarters 752/851、diff 856、fup 109、material 5527、SPD 142；ledger parity 120/120 matched + 25/25 not_found |
| 10 | clone multi-browser | **PASS** | 2I.2：2 个独立 fresh browser context（独立 chromium 进程）读取一致（752/851、owner 佐毅、SPD 142、diff 856、fup 109、ledger matched=true HISTORICAL_BASE） |
| 11 | freeze plan | **PASS（文档）** | RUNBOOK §1：维护模式/停写入口 + 明确顺序（freeze→export→delta→backup→migration） |
| 12 | backup plan | **PASS（文档）** | RUNBOOK §4：pg_dump -Fc、D1 copy、k8s snapshot、sha256、目录 `/var/lib/quarterly-recon/postgres/backups/cutover/<ts>/`；命令已实测可写 |
| 13 | final delta plan | **PASS（文档）** | RUNBOOK §3：逐模块 source/target/match key/delta 处理；§2.2 IndexedDB current 强制流程 |
| 14 | pg_hba | **PASS（方案）** | 只读确认当前规则 + 实测源 IP=172.18.0.1/32；加固方案（去 catch-all，仅 quarterly_app+quarterly_recon+172.18.0.1/32 scram）见 RUNBOOK §11；**本阶段不改，正式 cutover 时应用** |
| 15 | runtime config | **PASS（清单）** | DATABASE_URL=quarterly_recon；BUILD_SHA=exact RC；ENVIRONMENT=formal；NODE_ENV=production；无 test/clone/8002/8003 残留 |
| 16 | rollback | **PASS（方案）** | RUNBOOK §10：旧 image quarterly-recon:prod-20260825-090040 + release 20260824-122717 保留；不做破坏性 down migration；新 PG 数据保留排查；10 分钟内恢复 |

## Deferred（DEFERRED_NOT_BLOCKING）

| 项 | 状态 |
|---|---|
| Import History 统一页面 | DEFERRED_NOT_BLOCKING |
| raw XLSX binary storage | DEFERRED_NOT_BLOCKING |
| same-quarter current-year ledger reimport 策略（当前 409） | DEFERRED_NOT_BLOCKING |
| 690 条 pending verification_status 自动重验 | DEFERRED_NOT_BLOCKING（保持 pending，不自动改） |
| permissions / auth / ~50 账号 | DEFERRED_NOT_BLOCKING |
| 附件 / OCR | DEFERRED_NOT_BLOCKING |

除非审计证明会导致正式数据丢失，否则不把这些带进 cutover 开发。

## 状态汇总

- **本阶段允许**：`FORMAL_CUTOVER_PREPARATION_COMPLETE = YES`（文档/流程全部就绪）
- **本阶段允许**：`READY_FOR_FORMAL_CUTOVER_EXECUTION = YES`（技术/流程准备完成）
- **强制执行门**：`ACTUAL_BROWSER_INDEXEDDB_CURRENT_CHECK = REQUIRED_AT_CUTOVER`（执行当天未完成 → 禁止继续）
- **本阶段写**：`READY_FOR_FORMAL_CUTOVER = NO`（正式执行需用户明确批准）
