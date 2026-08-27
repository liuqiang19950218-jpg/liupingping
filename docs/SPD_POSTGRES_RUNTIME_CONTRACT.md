# SPD PostgreSQL Runtime Contract (Phase 2F.3)

审计结论：**SPD_POSTGRES_DATA_GAP = YES** —— 本阶段未实现 SPD API、未改前端、未改数据库。

审计基线：`b4301d009affe60cc35fef6ec1e790ace4ba648e`。
审计分支：`feature/postgres-spd-dashboard-api`（commit 见 git log）。
测试/审计库：`quarterly_recon_runtime_import_ui_test_20260827`（隔离，Q1=752 / Q2=851 / Q3=0 / 004 存在）。

## 1. SPD 数据来源

- 旧前端（Q1SpecialPanels）读取 localStorage：
  - `local-quarterly-reconciliation-spd-sheet-archive`（`spdSheetForQuarter`）
  - 每个 quarter 一份独立 SPD sheet：headers `[序号, 账套, 区域, 客户名称, SPD确认表, SPD库存确认函, 备注]`，Q1 共 **142 行**，fileName `26年1季度SPD库存明细表.xlsx`
- 当前 PostgreSQL 中：
  - `recon.material_status`：SPD确认表 886 = 855 reconciliation-level + 31 quarter-level；SPD库存确认函 886 = 855 + 31
  - `recon.legacy_snapshots`（source=localStorage, sha 7743eab2…）：**完整保留** 142 行 SPD sheet（authoritative recovery source）
  - 迁移 bundle `/home/liupp/111/q1-postgres-test-bundle-20260826.zip` 的 `material_status.json`：含 SPD_SOURCE 来源标记（PG 表内**未存储**该标记）

## 2. 旧字段 → PostgreSQL 映射（SPD_POSTGRES_FIELD_MAPPING）

| Legacy SPD 字段 | PG 表 | PG 列 / JSON 路径 | Completeness | 可空 | 示例 |
| --- | --- | --- | --- | --- | --- |
| 序号 | —（仅 sheet 内序号） | material_status 无 | PARTIAL（仅 source_payload 有，PG 表无此列） | — | 1 |
| 账套 | account_sets | material_status.account_set_id（仅 reconciliation-level 行有） | PARTIAL | 是（quarter-level 行 NULL） | 英科 |
| 区域 | regions | customers.region_id → regions.name（需经 customer_id） | PARTIAL | 是（quarter-level 行无 customer_id） | 南通 |
| 客户名称 | customers | material_status.customer_id → customers.name | PARTIAL | 是（62 条 quarter-level 行 customer_id NULL） | 常州市第一人民医院 |
| SPD确认表 | material_status | material_type='SPD确认表', raw_value | PARTIAL（855 rec + 31 quarter；缺 7 行空值） | 是 | 是 / 否 / 已提供 |
| SPD库存确认函 | material_status | material_type='SPD库存确认函', raw_value | PARTIAL | 是 | 是 / 否 / 已提供 |
| 备注 | — | material_status 无备注列；仅 legacy_snapshots / bundle | **MISSING（PG 无存储）** | — | 无库存 |

### 完整性汇总
- **COMPLETE**：material_type 两个取值、raw_value 的是/否/已提供/未提供 状态值（855×2 reconciliation-level）
- **PARTIAL**：账套/区域/客户名称 —— 仅 reconciliation-level 855×2 行可关联；62 条 quarter-level 行（31 客户 ×2 类）customer_id/account_set_id 全 NULL，无法还原客户/区域/账套
- **MISSING**：备注（36 行有值，PG 无列）；7 行空收集状态（南通 7 家，PG material_status 无 SPD_SOURCE 表示）

## 3. 数量核对

| 指标 | 旧数据 | PG 可识别 | 说明 |
| --- | --- | --- | --- |
| Q1 SPD sheet 行数 | 142（去重后 142） | SPD_SOURCE 业务键 135 | 7 行缺失（均空/未收集） |
| 唯一客户数 | ~135（SPD_SOURCE 键） | 135 | 一致（去重后） |
| 区域分布 | 常州/南通/南京/无锡/苏州/镇江/徐州/盐城/淮安/扬州/泰州/连云港 | 135 键可还原 | reconciliation-level 可行 |
| 账套分布 | 英科/国控/万和/生一/… | 经 account_set_id 可还原 | 仅 rec-level |
| 负责人 | SPD sheet 无独立负责人列 | —（owner 属 reconciliation） | SPD 面板不显示负责人 |
| material type | SPD确认表 / SPD库存确认函 | 两类均 886 | 一致 |
| 状态分布 | 是/否/空 | 是/否/已提供/未提供/未对账（855 rec + 31 ql） | 缺 7 空行 |

## 4. Quarter 语义 / 季度独立性

- Q1 SPD 仅属于 2026-Q1；Q2 material_status SPD = **0**（无继承）；Q3 不存在。
- 跨季度复制：无（impoter 严格 quarter-scoped）。

## 5. Material 关系

- SPD 数据存放在 `recon.material_status`，与对账函/确认函/催款函/在途证明/精准核销同表，靠 `material_type` 区分。
- 现有 `GET /api/quarter/[code]/material-status` 返回 `{ id, materialType, provided, rawValue, reconciliationId }`，**不包含**客户/区域/账套，且 quarter-level 行 reconciliationId=null —— 无法支撑 SPD 面板钻取。

## 6. API Contract（本阶段：未实现）

未新增 `GET /api/quarter/[code]/spd`。原因：数据不完整（见 SPD_POSTGRES_FIELD_MAPPING），
若现在实现会返回不完整/误导性的「SPD 面板」。需先完成 data backfill 或 schema 扩展评审。

## 7. Current Owner 语义

- SPD 面板不展示独立负责人；若未来需要，负责人以 `reconciliations.owner_name`（GET ownerName）为准，
  不使用 owner_raw_name 覆盖销售后续修改。

## 8. NULL 语义

- 保持 NULL；SPD 空值（未收集）不得转为 0/默认业务状态/默认负责人。
- quarter-level 行的 customer/account/region 关联缺失即 NULL —— 这正是当前数据缺口。

## 9. Drilldown 字段完整性

SPD 钻取（CollectionDrilldownDialog）需要：`accountSet / region / customer / materialStatus / reconciliationStatus / companyReceivable / customerBookAmount / differenceAmount`。
- reconciliation-level 855×2 行可经 reconciliation join 拿到全部金额/状态 + 客户/区域/账套 → **可支撑**
- quarter-level 62 行无 customer_id → **无法支撑**钻取客户/区域/账套
- 7 行空收集 → 完全缺失

⇒ **SPD_DATA_COMPLETE_FOR_DASHBOARD = NO**

## 10. 相关 Dashboard 后端数据充分性

- `PROBLEM_DASHBOARD_BACKEND_DATA_SUFFICIENT = YES`（followup quarter API + reconciliations 提供 owner/risk/stage/overdue/latestFollowUp/followStatus）
- `UNRESOLVED_FOLLOWUP_BACKEND_DATA_SUFFICIENT = YES`

## 11. 建议下一步（交用户/Codex 确认，不在本轮执行）

- 方案 A：把 legacy_snapshots.localStorage 中的 142 行 SPD sheet 以数据迁移方式 backfill 成带
  customer/region/account_set 关联的季度级数据集（需要 schema 决策：material_status 加列 或 独立表）。
- 方案 B：仅当「SPD 在业务上确为独立 quarter-level dataset」且「复用 material_status 会语义混乱」时，
  才新建 `GET /api/quarter/[code]/spd`。当前判断：数据不足，暂不建。
