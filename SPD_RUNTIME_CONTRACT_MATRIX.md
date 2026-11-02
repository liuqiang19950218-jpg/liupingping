# SPD_RUNTIME_CONTRACT_MATRIX

审计基线：`b4301d009affe60cc35fef6ec1e790ace4ba648e`（`feature/dashboard-postgres-completion`）。
审计分支：`feature/postgres-spd-dashboard-api`（本阶段只读审计，未改前端/未建 API）。

## 1. Q1SpecialPanels 真实 UI 模块清单

Q1SpecialPanels 只依赖 `quarter-storage.ts` 的两个 localStorage 读取器：
`sheetForQuarter`（主对账表 archive）与 `spdSheetForQuarter`（独立 SPD sheet archive）。

### 1a. 「资料收集」Tab — CollectionOverviewCard（资料收集总览）
- 数据来源：`specialData(sheet, spdSheet)` → `collection`
- 渲染 7 类资料（MATERIALS）：确认函 / 对账函 / SPD确认表 / SPD库存确认函 / 催款函送达证明 / 在途证明 / 精准核销
- 其中 SPD 两类（kind=spd / stock）**只**读取 `spdSheet`（独立 SPD 表），其余读主 `sheet`
- 每行字段：`name`、`completed/total`、`rate`、`followRegions[{name, rate}]`
- 计算：`spdCollectionForMaterial` → population=去重后的 SPD sheet 行；completed=SPD确认表/SPD库存确认函 单元格非空；rate=percent
- 过滤/分组：按 `区域` 分组计算各区域收集率，rate<100% 进 followRegions
- 点击钻取：传 `material`（含 kind）→ 打开 CollectionDrilldownDialog

### 1b. 「资料收集」Tab — ReplyRateCard（有效回函率（按区域））
- 数据来源：主 `sheet`（**非** SPD sheet），reconciled 客户按区域
- 字段：`name`、`replied/total`、`rate`；仅认定「已盖章」为有效回函
- 点击钻取：传 `region` → 有效回函明细

### 1c. 「资料收集」Tab — FollowAdviceCard（重点跟进建议）
- 派生自 `collection` + `replyRates`：低回函率区域(<60%) + 低收集率资料(rate<95 或 对账函有未满区域) top3

### 1d. 「未对账客户」Tab — 未对账客户清单
- 数据来源：主 `sheet`，`!isReconciled` 的行
- 字段：`region`、`customer`、`note`（差额原因备注）

### 1e. 钻取 CollectionDrilldownDialog（关键）
- 打开条件：点击 CollectionOverviewCard 某资料行 或 ReplyRateCard 某区域行
- **SPD 资料钻取**（kind=spd/stock）使用 `spdSheet` 作为唯一数据源
- 每行字段（CollectionDrillRow）：`id`、`accountSet`、`region`、`customer`、`materialStatus`（已收集/未收集）、`reconciliationStatus`（已对清/未对账）、`companyReceivable`、`customerBookAmount`、`differenceAmount`
- 分类：positive=已收集 / negative=未收集
- 说明文字明确：「数据来源：独立导入的SPD表。」

## 2. 旧 SPD 数据结构（spdSheetForQuarter / localStorage）

- 存储键：`local-quarterly-reconciliation-spd-sheet-archive`
- quarter 键：`2026 Q1`
- fileName：`26年1季度SPD库存明细表.xlsx`
- headers：`[序号, 账套, 区域, 客户名称, SPD确认表, SPD库存确认函, 备注]`
- rows：**142 行**（去重后仍 142）
- 每行值：序号(int) / 账套（英科、国控…） / 区域 / 客户名称 / SPD确认表（是/否/空） / SPD库存确认函（是/否/空） / 备注
- 收集语义：`isSpdCollected = value.trim() !== ""` —— 是/否都算已收集，只有空白算未收集
- 备注：36 行有备注（如「无库存」「以后这家客户不给拉SPD库存了…」）

## 3. PostgreSQL 当前 SPD 数据（quarterly_recon_runtime_import_ui_test_20260827）

### material_status
- 总行数：Q1 = 5527（5465 reconciliation-level + 62 quarter-level）
- SPD确认表：886 = 855 reconciliation-level + 31 quarter-level
- SPD库存确认函：886 = 855 + 31
- **关键**：material_status **没有 source_payload 列**，迁移时的 SPD_SOURCE / PRIMARY 来源标记在 PG 中**已丢失**（仅存在于迁移 bundle 的 material_status.json 里）
- **62 条 quarter-level 行**（reconciliation_id NULL）：customer_id / account_set_id 全部 NULL —— **无法关联到任何客户/区域/账套**

### legacy_snapshots
- source=localStorage 快照（sha 7743eab2…）**完整保留**了 `local-quarterly-reconciliation-spd-sheet-archive`（含 142 行 SPD sheet）→ 这是唯一可靠、完整的旧 SPD 数据恢复源

### 对比结论
- 旧 SPD sheet 142 行；PG material_status 中带 SPD_SOURCE 来源的业务键仅 135 个
- **7 行（全部为南通、SPD确认表/库存确认函均为空）不在任何 SPD_SOURCE 中**，即 PG 无法还原这 7 行的「未收集」状态
- 且 62 条 quarter-level 行无客户关联 → 无法还原钻取所需的客户/区域/账套

## 4. 结论

| 项 | 值 |
| --- | --- |
| legacy SPD sheet 行数 | 142 |
| PG 可识别 SPD 业务键（SPD_SOURCE） | 135 |
| 缺失行 | 7（均为空/未收集，南通） |
| quarter-level 行客户关联 | 62 行全部 NULL |
| SPD_POSTGRES_DATA_COMPLETE | **NO** |
| SPD_POSTGRES_DATA_GAP | **YES** |
| EXISTING_MATERIAL_API_SUFFICIENT（对 SPD 面板） | **NO** |
| 缺什么 | 独立 SPD sheet 作为可查询 quarter 数据集：客户/区域/账套关联 + SPD确认表/SPD库存确认函 是/否/空 + 备注 |
| 旧数据在哪 | legacy_snapshots.localStorage（完整）+ 迁移 bundle material_status.json |
| 需要 | data migration/backfill（把 SPD sheet 落成带关联的业务结构）或 schema extension 评审 |

## 5. 相关 Dashboard 后端数据充分性（只读评估）

- **ProblemDashboard**：现读 reconciliation-insights（cockpit-data 派生）+ resolved-followup-archive。所需字段 owner/riskLevel/processStage/overdueDays(由 expectedCompleteAt 算)/latestFollowUpAt/followStatus 均可由 `GET /api/quarter/[code]/followups` + `GET reconciliations` 提供 → `PROBLEM_DASHBOARD_BACKEND_DATA_SUFFICIENT = YES`（后端字段足，前端接线属 Codex）
- **UnresolvedFollowupDashboard**：所需 followStatus/processStage/riskLevel/expectedCompleteAt/nextFollowUpAt/latestFollowUpAt/ownerName/customer/region 亦可由 followup quarter API + reconciliations 提供 → `UNRESOLVED_FOLLOWUP_BACKEND_DATA_SUFFICIENT = YES`
