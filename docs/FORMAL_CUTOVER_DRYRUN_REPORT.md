# FORMAL CUTOVER DRY-RUN REPORT — Phase 2I.1 / 2I.2（2026-08-28）

Clone：`quarterly_recon_cutover_dryrun_20260828`（来源 = formal `quarterly_recon` pg_dump -Fc，非 staging test DB）
RC：`8c8af2e1709330e8af6c47cf7ea3029019966a57`；worktree：`/home/liupp/formal-cutover-prep-2i1`

## A. Build Gate
- npm ci：OK；build：PASS（"Build complete"）；lint：0 errors（56 pre-existing warnings）
- node --test（rendered-html + spd-dashboard + ledger-runtime + remaining-imports-runtime）：**45/45 PASS**
- FORMAL_RC_BUILD_GATE = PASS

## B. Formal 只读审计（2I.1）
- quarters：2026-Q1(archived)/2026-Q2(open)；reconciliations Q1=752/Q2=851/total=1603；customers=1601（Q1 752/Q2 849）
- difference_items Q1=856（Q2=0）；followup_items=109；followup_events=37；material_status=5527（Q1）
- import_batches=3（Q1对账 752 / Q1SPD 142 / Q2对账 851 sha4dfb0380…）；migration_manifests=2；legacy_snapshots=5
- schema_migrations=001/002/003；004(owner_name)/005(spd)/006(ledger)/007(indexes) 均未应用
- 8000：旧 runtime（image quarterly-recon:prod-20260825-090040；/api/version 404 预期）；全程未动

## C. 源解析（全部实证）
- owner：formal source_payload→owner_raw_name（Q1=713/Q2=826 非空）与权威浏览器快照 Q1=713 一致
- SPD：localStorage spd-sheet-archive "2026 Q1"=142（是105/否30/空7）；原始 xlsx 不在服务器
- Historical：release public ledger_keys.json(347,012) + ledger_invoice_lookup.json(322,035) →
  canonical union 355915 行、0 malformed、sha aedb6247…、日期 2008-11-06~2026-06-30、distinct invoices 323215
- Current-Year：服务器无快照（D1 ledger 表=0）；旧 runtime 仅浏览器 IndexedDB key="current" → 执行前强制 Gate

## D. Clone dry-run（全部真实执行）
- 创建：1603 recons / 2 quarters / 856 diff / 5527 material，migrations 001-003，quarterly_app 重授
- 004=0.55s（owner_name + backfill → Q1=697/Q2=788）；005=0.19s（spd_dashboard_rows）
- SPD backfill：142 行（105/30/7），source_row_key 用生产推导 `spd:<sha24>`，0 冲突，与 staging 一致
- 006=0.21s（ledger 两表 + 索引）；Historical V1：355915 行 23.6s，active，BACKFILL_VALIDATED
- 007=0.20s（spd source_batch_id + material_status_batch_unique + import_batches_global_dedup；预检 0 重复组）
- 回归：Q1=752/Q2=851/diff 856/fup 109+37/material 5527/SPD 142/Historical 355915/CURRENT_YEAR=0 → FORMAL_CLONE_DATA_PARITY=PASS

## E. 8003 Runtime + Smoke
- 8003（systemd transient quarterly-staging-8003）连接 clone，/api/version buildSha=8c8af2e…
- quarters 752/851；Q1 reconciliations（含 ownerName）；difference=856；followups=109；material=5527；
  spd-dashboard=142；ledger verify（25322000000148462908/20250402/1960.00）=matched=true HISTORICAL_BASE @a4110d4f…
- ledger parity：120/120 matched + 25/25 not_found
- **Multi-browser（2I.2）**：2 个独立 fresh chromium context（因内存限制用独立进程隔离）读取一致
  （752/851、owner 佐毅、SPD 142、diff 856、fup 109、ledger matched=true）→ SERVER_SOURCE_OF_TRUTH_CONSISTENT=YES

## F. 环境事实（供 runbook）
- host→published 5432 的 postgres 源 IP = 172.18.0.1/32（容器网络 quarterly-recon-infra_default 网关，实测）
- pg_hba 当前含过宽 `host all all all scram-sha-256`（加固方案见 RUNBOOK §11）
- 8002 已停（quarterly-staging-8002 inactive）；8001 未动；8000 未动

## G. 遗留 / 保留
- Clone DB 保留：`quarterly_recon_cutover_dryrun_20260828`（正式执行前 rehearsal/reference）
- 8003：完成 multi-browser smoke 后已允许停止（本轮报告前仍在运行，最终状态见主报告）
- Formal：全程零写；D1/SQLite：零写；pg_hba：只读
