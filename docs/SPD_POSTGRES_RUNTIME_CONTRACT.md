# SPD PostgreSQL Runtime Contract

审计/实现基线：`1114b27fb85a8d8e8c05b9e00ede7cce124b80b3`。
实现分支：`feature/postgres-independent-spd-dashboard`。
SPD 专用测试库：`quarterly_recon_spd_dashboard_test_20260827`（隔离，Q1=752 / Q2=851 / Q3=0 / 001-005 存在）。

## 【系统存在两套 SPD 数据源】（业务最终确认）

| | SPD 数据源 A | SPD 数据源 B |
| --- | --- | --- |
| 用途 | 本季度对账详细情况表 | 对账看板 SPD资料已提供情况 |
| 数据 | 跟对账函/确认函/在途证明/催款函/精准核销一起上传的 SPD 资料状态 | 单独上传的 SPD 专项 Excel（如 26年1季度SPD库存明细表.xlsx） |
| 存储 | `recon.material_status` | `recon.spd_dashboard_rows`（独立季度数据集） |
| 读取 API | `GET /api/quarter/[code]/material-status` | `GET /api/quarter/[code]/spd-dashboard` |

- 两套 SPD **禁止合并 / 互相覆盖 / 互相同步状态**。
- 即使结果不同也不是 bug（业务口径不同）。
- `material_status` 现有 Q1 = 5527，**保持不变**；本阶段未对其做任何 INSERT/UPDATE/DELETE。

## 1. SPD 数据源 A（material_status）

- 用途：本季度对账详细情况表。
- 现有 Q1 material_status = 5527（其中 SPD确认表 886、SPD库存确认函 886）。
- 本阶段不改变其业务含义、不删除/移动/重解释其中 SPD material。
- 现有 `GET /api/quarter/[code]/material-status` 返回 `{ id, materialType, provided, rawValue, reconciliationId }`。

## 2. SPD 数据源 B（spd_dashboard_rows）

- 用途：对账看板 SPD资料已提供情况。
- 独立季度数据集，与 material_status 完全隔离。
- Schema（migration `005_spd_dashboard_dataset.sql`，仅应用隔离测试库）：

```
recon.spd_dashboard_rows
  id uuid PK default gen_random_uuid()
  quarter_id uuid NOT NULL -> recon.quarters(id) ON DELETE CASCADE
  source_row_key text NOT NULL
  source_row_number integer NULL
  source_file_name text NULL
  account_set_raw text NULL
  region_raw text NULL
  customer_name_raw text NULL
  spd_confirmation_raw text NULL
  spd_inventory_confirmation_raw text NULL
  remark text NULL
  source_payload jsonb NULL
  reconciliation_id uuid NULL -> recon.reconciliations(id) ON DELETE SET NULL
  created_at timestamptz NOT NULL default now()
  updated_at timestamptz NOT NULL default now()
```

- 索引：UNIQUE (quarter_id, source_row_key)；quarter_id；reconciliation_id。
- **raw 字段是 source truth**：账套/区域/客户名称 保留 Excel 原始值，不因匹配失败而丢失。
- 空状态行（SPD确认表/库存确认函为空）**必须保留并计入总数**。

## 3. 提交规则（业务最终确认）

- `SPD确认表`：`是` = 已提交；`否` = 已提交（对方已给业务结论）；空白/NULL = 未提交。
- `SPD库存确认函`：规则相同。
- 两种状态**分别计算**，不合并。
- `submitted + unsubmitted = total`；`total = 行数`。
- `submissionRate = submitted / total`；total=0 时返回 `null`（不得 NaN/Infinity）。
- 数据库：空白正规化为 NULL；raw 值在 source_payload 中保留。
- 前/后空格：判断时安全 trim；raw 值本身原样保留。

## 4. Q1 历史 Backfill

- 权威来源：`legacy_snapshots.localStorage` 中的 `local-quarterly-reconciliation-spd-sheet-archive`（142 行，sha 7743eab2…）。
- 禁止用 material_status 反向推断（它已丢 7 条空状态行）。
- Q1 `spd_dashboard_rows` = **142 行**；source_row_key 142 nonNULL / 142 distinct。
- 7 条空状态行（南通 7 家）已完整恢复。
- reconciliation 关联：仅 exact match（account_set.name==raw AND region AND customer）。Q1 SPD sheet 用简称
  账套（英科/国控/万和/生一），与 reconciliation 全名（江苏英科/国药控股/苏州万和/江苏生一）无精确匹配，
  且客户跨账套出现 —— 故全部 reconciliation_id = NULL（不模糊/别名猜测，符合规范；SPD row 仍保留）。

## 5. API Contract：GET /api/quarter/[code]/spd-dashboard

```json
{
  "quarter": "2026-Q1",
  "count": 142,
  "summary": {
    "spdConfirmation": { "total": 142, "submitted": 135, "unsubmitted": 7, "submissionRate": 95.1 },
    "spdInventoryConfirmation": { "total": 142, "submitted": 135, "unsubmitted": 7, "submissionRate": 95.1 }
  },
  "items": [
    {
      "id": "…",
      "sourceRowNumber": 1,
      "accountSet": "英科",
      "region": "常州",
      "customer": "常州市第一人民医院",
      "spdConfirmation": "是",
      "spdInventoryConfirmation": "是",
      "reconciliationId": null
    }
  ]
}
```

- quarter scoped（server-side SQL `JOIN quarters WHERE code=$1`）。
- `count` = rows.length；summary 严格按「非空=submitted」统计（是/否均计入 submitted）。
- **不返回** remark / source_payload（数据库保存，前端不暴露）。
- 不存在 quarter → `404 { error, code: NOT_FOUND }`；非法代码 → `400 INVALID_INPUT`。
- SQL 固定少量（route 内 1 条 rows 查询 + getQuarter 1 条；无 per-row loop）。`NO_SQL_N_PLUS_ONE = YES`。

## 6. 验证基线（spd_dashboard_rows）

| 指标 | Q1 | Q2 |
| --- | --- | --- |
| count | 142 | 0 |
| SPD确认表 submitted/unsubmitted | 135 / 7 | 0 / 0 |
| SPD库存确认函 submitted/unsubmitted | 135 / 7 | 0 / 0 |
| 是/否/空（两字段） | 105 / 30 / 7 | — |

Legacy = SQL = API 一致。Q2 无独立 SPD 表（count=0，不继承 Q1）。

## 7. 相关 Dashboard

- `PROBLEM_DASHBOARD_BACKEND_DATA_SUFFICIENT = YES`（followup quarter API + reconciliations）
- `UNRESOLVED_FOLLOWUP_BACKEND_DATA_SUFFICIENT = YES`
- 前端接线交新 Codex 任务：Q1SpecialPanels 的 Dashboard SPD 指标读 `/spd-dashboard`；本季度详细情况表的 SPD 状态仍读 `material_status`。

## 8. 未来事项（本阶段不做）

- `SPD_IMPORT_RUNTIME_REQUIRED_LATER = YES`：未来每季度单独上传 SPD 表 → 独立 Import API → spd_dashboard_rows → Dashboard。
- `SPD_REIMPORT_POLICY_REQUIRES_CONFIRMATION = YES`：同季度重传策略（整季替换/版本化/禁止覆盖）待用户确认。
- 穿透/明细 Drawer：以后开发，本阶段 schema 已留基础字段。

## 9. 安全

- DATABASE_URL server-only；错误脱敏；source_payload 不暴露前端；无密码入文档。
