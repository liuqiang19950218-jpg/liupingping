# FORMAL CUTOVER RUNBOOK — quarterly-recon → PostgreSQL (Phase 2I)

> 本 runbook 由 Phase 2I.1/2I.2 在 clone（quarterly_recon_cutover_dryrun_20260828）上
> 以真实数据 dry-run 验证后编写。所有命令均应在 freeze 时点重新执行；
> 本阶段（2I）只写文档，不执行正式 cutover。

- Release Candidate（唯一允许部署的 SHA）：`8c8af2e1709330e8af6c47cf7ea3029019966a57`
- Branch：`feature/postgres-remaining-imports-frontend`
- Formal PostgreSQL 容器：`quarterly-postgres`（postgres 16，端口 5432）
- Formal DB：`quarterly_recon`（schema `recon`，当前 migrations 001–003）
- 旧正式 runtime：k8s image `quarterly-recon:prod-20260825-090040`，release `releases/20260824-122717`，
  hostPort 8000→pod 3000，env 仅 NODE_ENV/PATH（旧 D1 runtime，无 DATABASE_URL）
- 正式 D1/SQLite：`/var/lib/quarterly-recon/database/wrangler/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite`
- 权威历史 ledger JSON：`<release>/public/ledger_keys.json`（sha256 `c976856e8aeb75df594e5ac3b04232012da2f50fce03c9d6e7ca34267c70d688`）
  与 `<release>/public/ledger_invoice_lookup.json`（sha256 `02684e895398c0c57a04b051285d9c584212097a8b981340f187e894028e638d`）
- Secret：`/opt/quarterly-recon-infra/.env`（root 600）；**任何命令不得把密码写进文件/Git/日志**。

---

## 0. 执行前置（CUTOVER_EXECUTION_HARD_GATE）

正式执行当天，**必须全部满足**，否则禁止开始 migration/deploy：

- [ ] `ACTUAL_BROWSER_INDEXEDDB_CURRENT_CHECK`：在实际承载“本年往来”上传的业务浏览器上
      检查 IndexedDB（库 `quarterly-reconciliation`，store/key 以真实代码确认为准，Phase 2G 审计为
      `ledger/current`）。见 §3。
- [ ] 用户对执行本次 cutover 的明确批准（`READY_FOR_FORMAL_CUTOVER=NO` 直到用户批准）。
- [ ] 目标 SHA 再次确认为 `8c8af2e1709330e8af6c47cf7ea3029019966a57`（`git ls-remote`）。
- [ ] `git diff --check`、build gate 在正式部署前重跑（npm ci/build/lint/test）。
- [ ] 旧正式 backup 目录可写：`/var/lib/quarterly-recon/postgres/backups/cutover/`。

---

## 1. FREEZE（正式 freeze 计划）

freeze 的目标是：**阻止旧 8000 继续产生任何新业务修改**，同时保留旧数据可读取能力。

1. **宣布 freeze**：用户确定 freeze 开始时间点（T0），并通知所有业务使用者停止操作。
2. **阻止写路径**：旧 runtime 的业务写入全部发生在浏览器 localStorage/IndexedDB（`saveSheet()` 只写
   localStorage；D1 仅在 `?syncServer=1`/bundle 上传时更新）。因此阻止手段为 **访问控制 + 停用上传入口**：
   - 首选：在 k8s Deployment `quarterly-recon` 上临时把 Service/Ingress 访问路径置于维护模式
     （如将 8000 hostPort 指向一个维护页 / 或对 `/api/local-state` POST 与 `/api/ledger-state` POST 返回 503）。
   - 备选（确认 freeze 后无正在进行的业务操作时）：`kubectl -n quarterly-recon scale deploy quarterly-recon --replicas=0`
     或 `kubectl -n quarterly-recon rollout pause deploy quarterly-recon`（保留读取需先导出）。
   - **口头通知不算完成 freeze**：必须确认旧写路径实际不可用后才进入下一步。
3. **保持可读**：freeze 期间旧 release 目录、D1 文件、image 均不删除，供导出与回滚。
4. **freeze 后顺序固定**：先 freeze → 再导出 → 再 final delta → 再 backup → 再 migration/deploy。
   严禁“先导出再让用户继续使用半小时”。

---

## 2. 业务浏览器导出（freeze 后立即执行）

### 2.1 localStorage（每季度对账表 + SPD 表）

在承载实际业务的浏览器（用户指定权威浏览器）上导出：

- `local-quarterly-reconciliation`（active sheet）
- `local-quarterly-reconciliation-archive`（各季度 archive）
- `local-quarterly-reconciliation-spd-sheet-archive`（独立 SPD 表，Q1=142）
- `local-quarterly-reconciliation-selected-quarter`
- `quarterly-reconciliation-import-history-v1`

导出为 JSON 文件，保存到：
`/var/lib/quarterly-recon/postgres/backups/cutover/<timestamp>/browser/<browser-label>-localStorage.json`
记录 sha256sum。比对方式见 §4。

### 2.2 IndexedDB ledger "current"（本年往来）—— CUTOVER_EXECUTION_HARD_GATE

服务器看不到业务浏览器 IndexedDB。freeze 后必须在**实际使用旧 8000 上传过本年往来的浏览器**上检查
IndexedDB（database `quarterly-reconciliation`，store/key 由真实代码确认——Phase 2G 审计为
`ledger/current`，整体 REPLACE 无季度快照）。

结果只允许两种：

- **A. 不存在或为空** → 记录 `CURRENT_YEAR_LEDGER_BROWSER_EXPORT = EMPTY`（+ 浏览器标识 + 时间戳），
  无需创建 CURRENT_YEAR_QUARTER dataset。
- **B. 存在数据** → 必须导出到
  `/var/lib/quarterly-recon/postgres/backups/cutover/<timestamp>/browser/ledger-current.json`
  并记录 sha256sum。然后**识别其实际归属季度**（文件语义：Q1=1-3月、Q2=1-6月 累计）：
  - 确认属 Q1 → 导入 Q1 的 `CURRENT_YEAR_QUARTER`（version 1，active，quarter_id=2026-Q1）
  - 确认属 Q2 → 导入 Q2 的 `CURRENT_YEAR_QUARTER`
  - **无法确认季度 → 停止 cutover**。
- 禁止：把一份 current 同时导入 Q1/Q2；按日期猜季度（必须人工确认文件语义）；塞入 Historical Base。

若有多个潜在业务浏览器，由**用户指定唯一权威浏览器**，其余仅作交叉参考；
不能默认 Hermes 服务器浏览器 == 业务用户浏览器。

> 说明：Historical Base V1 已含 2026-01~06（30,197 keys，max date 2026-06-30），与 Q1/Q2 本年
> 快照重叠时按 canonical key 去重（命中一次，非报错）。Historical V1 不能替代 current-year snapshot。

---

## 3. FINAL DELTA（final delta 计划，freeze 后）

逐模块：旧 source → PG target → 比对 key → 有 delta 时如何处理。

| 模块 | 旧 source | PG target | 比对 key | delta 处理 |
|---|---|---|---|---|
| reconciliation | 权威 localStorage archive（Q1=752）| reconciliations | (account_set, region, customer) 去空白 | 按 Q1/Q2 已迁规则补差（独立季度，不跨季度推导） |
| customerBook | localStorage archive 客户账面金额 | customer_book_amount | reconciliation id | 非空源值更新 |
| difference | LocalSheet 对账差额 | reconciliation_difference | 由公司应收-账面推导 | 服务器重算（company NULL → NULL） |
| differenceItems | LocalSheet 差异明细 | difference_items | source_row_key | 仅补 freeze 后新增 |
| followups | LocalSheet 跟进 | followup_items/events | reconciliation id | 仅补 freeze 后新增 |
| material | LocalSheet 资料列 | material_status | (recon, material_type) | 匹配合并 upsert；未匹配 → PARTIAL，不模糊 |
| owner | localStorage 对账负责人 / formal source_payload→owner_raw_name | owner_name | 004 规则（哨兵→NULL） | 004 内建 backfill，不 fuzzy |
| SPD（独立）| localStorage spd-sheet-archive（Q1=142：105/30/7）| spd_dashboard_rows | 权威 142 行直接导入 | 用 2I.1 验证过的 backfill 逻辑，**不得**用 material_status SPD-A 推导 |
| company receivable | LocalSheet 公司应收 | reconciliations.company_receivable | (账套,区域,客户) 精确 | 非空更新；ambiguous → AMBIGUOUS 跳过并报告 |
| current-year ledger | 浏览器 IndexedDB current（§2.2）| ledger_datasets CURRENT_YEAR_QUARTER | 见 §2.2 | 见 §2.2（EMPTY 或按季度导入） |

所有 delta 处理必须可审计：记录每条变更的来源 key、目标 id、前后值；禁止“发现差异后导入”这种模糊描述。

---

## 4. BACKUP（freeze 后、migration 前执行）

正式 backup 必须在 freeze 时点执行（不是现在）。输出目录：
`/var/lib/quarterly-recon/postgres/backups/cutover/<timestamp>/`

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ); OUT=/var/lib/quarterly-recon/postgres/backups/cutover/$TS
sudo mkdir -p "$OUT" && sudo chown -R liupp:liupp "$OUT"

# 4.1 Formal PostgreSQL（dump 到 HOST stdout，勿用 -f 写容器内）
docker exec quarterly-postgres pg_dump -U postgres -d quarterly_recon -Fc > "$OUT/quarterly_recon-$TS.dump"
sha256sum "$OUT/quarterly_recon-$TS.dump" > "$OUT/quarterly_recon-$TS.dump.sha256"

# 4.2 D1/SQLite（只读 copy + hash）
cp -a /var/lib/quarterly-recon/database/wrangler/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite "$OUT/quarterly-recon-d1-$TS.sqlite"
sha256sum "$OUT/quarterly-recon-d1-$TS.sqlite" > "$OUT/quarterly-recon-d1-$TS.sqlite.sha256"

# 4.3 Kubernetes snapshot
kubectl -n quarterly-recon get deploy quarterly-recon -o yaml > "$OUT/k8s-deploy-$TS.yaml"
kubectl -n quarterly-recon get svc quarterly-recon -o yaml > "$OUT/k8s-svc-$TS.yaml"
kubectl -n quarterly-recon get deploy quarterly-recon -o jsonpath='{.spec.template.spec.containers[0].image}' > "$OUT/k8s-image-$TS.txt"
# 记录 image = quarterly-recon:prod-20260825-090040；replicas；env names（NODE_ENV/PATH）

# 4.4 旧 release / 浏览器导出（§2）同目录
```

校验：`sha256sum -c *.sha256` 全部 OK；目录可写（已实测 `/var/lib/quarterly-recon/postgres/backups/` 可写）。

---

## 5. MIGRATION + BACKFILL 执行顺序（clone 已验证）

顺序固定（clone 实测耗时：004≈0.55s，005≈0.19s，006≈0.21s，007≈0.20s，Historical≈23.6s；
正式可能因数据/机器不同而有差异）：

1. freeze（§1）→ 2. backup（§4）→ 3. final delta（§3）→ 4. verify baseline（§6 前）
5. `004_reconciliation_owner_name.sql`（ADD owner_name + 从 source_payload.owner_raw_name backfill，哨兵→NULL）
6. owner backfill 校验（Q1 697 / Q2 788 非空，clone 实测；正式以实际为准）
7. `005_spd_dashboard_dataset.sql`（建 spd_dashboard_rows + 索引 + GRANT）
8. Independent SPD backfill（权威 localStorage spd-sheet-archive → 142 行；105 是 / 30 否 / 7 空）
9. `006_ledger_verification_runtime.sql`（建 ledger_datasets + ledger_verification_entries + 索引 + GRANT）
10. Historical Base V1 backfill（`backfill-historical-ledger.py --commit-dataset`，355915 行，约 24s）
11. Current-Year snapshot（**仅当 §2.2 判定存在**：Q1 或 Q2 的 CURRENT_YEAR_QUARTER）
12. `007_remaining_business_imports.sql`（spd source_batch_id + 两个 partial unique index）
13. 完整 validation（§6）→ 14. deploy exact RC（§7）→ 15. smoke（§8）→ 16. unfreeze（§9）

migration 均以 `postgres` 角色应用（`docker exec -i quarterly-postgres psql -U postgres -d quarterly_recon -v ON_ERROR_STOP=1 < 文件`），
piped via stdin（容器内无该文件路径）。007 的 `material_status_batch_unique` 为 partial index
（仅约束 source_batch_id IS NOT NULL 的行）；正式已存在 208 组 legacy duplicate（batch NULL）不受影响（clone 预检 0 冲突）。

---

## 6. VALIDATION（migration/backfill 后、deploy 前）

独立 SQL 复算（不信任 self-report）：

```
quarters: 2026-Q1(archived) / 2026-Q2(open)，无 Q3/Q4
reconciliations: Q1=752, Q2=851, total=1603
difference_items: Q1=856, Q2=0
followup_items/events: Q1=109/37, Q2=0
material_status: 5527 (Q1), Q2=0
spd_dashboard_rows: Q1=142 (是105/否30/空7), Q2=0
ledger_datasets: HISTORICAL_BASE V1 active, sha aedb62474d9c285a7485cf62100f80facdbffd37fc47a8fe5fdd9092ea7c594d, 355915
ledger_verification_entries: V1=355915，distinct invoices=323215，日期 2008-11-06~2026-06-30
owner_name: Q1/Q2 非空数（以 004 backfill 实际为准，clone=697/788）
CURRENT_YEAR_QUARTER: 按 §2.2（EMPTY→0）
schema_migrations: 001–007
007 对象: material_status_batch_unique + import_batches_global_dedup + spd_dashboard_rows.source_batch_id
```

---

## 7. DEPLOY（exact RC，唯一）

正式 8000 只允许部署 `8c8af2e1709330e8af6c47cf7ea3029019966a57`。
若 cutover 前产生新业务 commit → 重新走 RC validation，禁止 “latest”。

Formal runtime 所需 env（部署到 8000 的 k8s Deployment 容器 env）：

| env | 值 |
|---|---|
| DATABASE_URL | `postgresql://<quarterly_app>:***@127.0.0.1:5432/quarterly_recon`（正式库，密码运行期从 .env 注入） |
| BUILD_SHA | `8c8af2e1709330e8af6c47cf7ea3029019966a57` |
| BUILD_TIME | build 时点 UTC |
| ENVIRONMENT | `formal` |
| NODE_ENV | `production` |
| 端口 | containerPort 3000，hostPort 8000（沿用现有 k8s manifest） |

**必须确认不存在任何残留**：DATABASE_URL 不得指向 `quarterly_recon_cutover_dryrun_20260828` /
`quarterly_recon_remaining_imports_test_20260828`；不得沿用 staging-8002/8003 env。
secret 来源 = `/opt/quarterly-recon-infra/.env`（或最终安全来源），只引用 env 变量名，不在文档/Git 写密码。

---

## 8. SMOKE（deploy 后）

- `/` 首页 HTTP 200
- `/api/version` → buildSha = `8c8af2e1709330e8af6c47cf7ea3029019966a57`
- `/api/quarters` → Q1=752 / Q2=851
- `/api/quarter/2026-Q1|Q2/reconciliations`（含 ownerName）
- difference=856、followups=109、material=5527、SPD=142
- Historical ledger verify：真实票 `25322000000148462908 / 20250402 / 1960.00` → matched=true HISTORICAL_BASE
- Current-Year verify（若 snapshot 存在）
- Dashboard 聚合（无独立 /dashboard 路由，前端由聚合 API 派生）
- 两个真实/独立浏览器读取结果一致（本机内存受限时可用 2I.2 的独立进程 browser probe 方法）
- 不立即做大量破坏性写测试。

---

## 9. UNFREEZE + 运行

smoke 全过后恢复用户访问（维护页撤除 / replicas 恢复）。用户 A 写 → PG，用户 B 刷新 → 最新 PG
（无需 WebSocket；staging 已验证）。同一季度 ledger 重复上传当前 409 为已知业务策略，不影响本次一次性导入。

---

## 10. ROLLBACK（新 RC 上线后关键 smoke 失败，10 分钟内恢复旧 runtime）

1. 重新 freeze（再次阻止业务写）。
2. 记录新 PG 中的写入（保留调查证据，不删除）。
3. **不做破坏性 down migration**：004–007 不含 DROP table/column、不删数据；新 schema/data 原样保留。
4. 恢复旧 k8s image/release：`kubectl -n quarterly-recon set image deploy/quarterly-recon <ctr>=quarterly-recon:prod-20260825-090040`
   （旧 image 与 release 目录 `releases/20260824-122717` 必须保留、已在 backup 记录）。
5. 恢复旧 D1/SQLite 读写路径（D1 文件 backup 已保留，原路径未动）。
6. 验证旧首页 `/` 与关键流程（旧 runtime 仍可用 8000 读取 D1）。
7. 恢复用户访问。
- 原则：优先代码/image 回滚，而非破坏性 down migration；新 PG 状态保留供后续排查。

---

## 11. PG_HBA 加固（PRE_CUTOVER_REQUIRED）

当前（只读确认）：`local all all trust`；`host all all 127.0.0.1/32 trust`；`host all all ::1/128 trust`；
`local/host replication trust`；**`host all all all scram-sha-256`（过宽 catch-all）**；listen_addresses=`*`。

实测：host→published 127.0.0.1:5432 的连接，postgres 看到的源 IP 为 **172.18.0.1/32**（容器网络
`quarterly-recon-infra_default` 网关），当前命中 catch-all → scram。

加固方案（正式 cutover 时应用，本阶段不执行）：

```conf
# 1) 保留容器内管理入口（docker exec / 127.0.0.1 内联 helper）——不改
local   all             all                                     trust
host    all             all             127.0.0.1/32            trust
host    all             all             ::1/128                 trust
local   replication     all                                     trust
host    replication     all             127.0.0.1/32            trust
host    replication     all             ::1/128                 trust

# 2) 正式 app 访问：仅 quarterly_app，仅正式库，仅 docker bridge 网关源，SCRAM
host    quarterly_recon quarterly_app   172.18.0.1/32           scram-sha-256

# 3) 演练期如需 staging 连接 test 库（8001/8003 尚未停时），临时加（cutover 后移除）：
# host  all             quarterly_app   172.18.0.1/32           scram-sha-256

# 4) 删除过宽的 catch-all：host all all all scram-sha-256
```

安全变更步骤（正式执行时）：
1. `docker exec quarterly-postgres sh -c 'cp /var/lib/postgresql/data/pg_hba.conf /var/lib/postgresql/data/pg_hba.conf.bak-<ts>'`
2. 写入新规则
3. `SELECT * FROM pg_hba_file_rules;` 预检（如可用）
4. `docker exec quarterly-postgres psql -U postgres -c "SELECT pg_reload_conf();"`（先 reload，不 restart）
5. 以 quarterly_app 从正式应用来源（127.0.0.1:5432 发布端口）测试连接（能连）
6. admin 连接测试（docker exec 可连）
7. 任一失败 → 立即恢复备份文件 + `pg_reload_conf()`。

不得让正式连接断掉；本阶段（2I）不改 pg_hba。

---

## 12. 本阶段（2I）禁止项

- 不执行正式 cutover；不写 formal DB；不应用 004–007 到 formal；不部署 8000；不改业务代码。
- 不执行正式 backup（仅验证命令/目录可写）。
- 不改 pg_hba；不改 D1/SQLite。
