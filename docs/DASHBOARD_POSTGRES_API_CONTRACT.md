# Dashboard PostgreSQL Aggregate API Contract (Phase 2F.1)

审计/代码基线：`a0d19d1206a0882382456039a1000e5057062795`（`feature/dashboard-postgres-integration`）。
本阶段新增两个 **quarter-scoped 批量读取 API**，供 Dashboard 差额类 / Followup 类图表使用，
避免对 851+ 条 reconciliation 逐条请求（N+1）。

- 实现 commit：`feature/postgres-dashboard-aggregate-api`（见 `lib/server/recon/recon.ts`、
  `app/api/quarter/[code]/difference-items/route.ts`、`app/api/quarter/[code]/followups/route.ts`）。
- Dashboard 前端本轮 **未修改**；Codex 下轮据本契约完成剩余 Dashboard 接线。

## 1. GET /api/quarter/[code]/difference-items

Quarter-scoped 读取当前季度的全部 `difference_items`。

```json
{
  "quarter": "2026-Q1",
  "count": 856,
  "items": [
    {
      "id": "004fa212-…",
      "reconciliationId": "b22d6088-…",
      "quarterCode": "2026-Q1",
      "category": "transit",
      "invoiceNo": "26322000002346063121",
      "invoiceDate": "2026-03-26",
      "differenceAmount": "-111.01",
      "differenceDescription": null,
      "verificationStatus": "pending",
      "attachmentKeys": []
    }
  ]
}
```

### 字段说明 / 规则

- `category`：返回数据库真实值，**不做重命名/映射**。写入 API 的分类词汇为
  `transit / returned / lost / instrument / otherInvoice / other`，但历史季度可能存有迁移值
  （如 `returned_invoice`、`lost_invoice`、`equipment`、`other_with_invoice`、`other_without_invoice`）。
  前端应按字符串处理，并自行归类展示（不要因未知值抛错）。
- 金额：所有 NUMERIC 以 **字符串** 返回（`"-111.01"`），禁止转 JS number 后再回传。
- `invoiceDate`：真实发票日期（`YYYY-MM-DD`），无日期为 `null` —— **不要** 虚构 0 天 / 当前日期。
- `differenceAmount`：可为 `null`（保持 null，不转 0）。
- `attachmentKeys`：字符串数组（JSONB），可为 `[]`。
- NULL 语义：`invoiceDate` / `differenceAmount` / `differenceDescription` 等缺失时保持 `null`。

### 关联 reconciliation

每个 item 带有 `reconciliationId`。Dashboard 已有共享的当前季度
`GET /api/quarter/[code]/reconciliations` dataset（`DashboardDataProvider.rows`，按 `id` 索引），
前端用 `reconciliationId` Map-join 即可获得：
`customer`、`region`、`accountSet`、`ownerName`、`companyReceivable`、
`customerBookAmount`、`reconciliationDifference`、`reconciliationStatus` —— **无需额外 HTTP**。

### 服务端范围

SQL 严格按 URL quarter 限制：

```sql
FROM recon.difference_items d
JOIN recon.reconciliations r ON r.id = d.reconciliation_id
JOIN recon.quarters q ON q.id = r.quarter_id
WHERE q.code = $1
```

- 一次查询返回整季数据，无 per-row 循环，无 N+1。
- 季度不存在 → `404 { "error": "季度 2026-QX 不存在", "code": "NOT_FOUND" }`。
- 非法季度代码（非 `YYYY-Q[1-4]`）→ `400 INVALID_INPUT`。

## 2. GET /api/quarter/[code]/followups

Quarter-scoped 读取当前季度的全部 `followup_items` 及其 `followup_events`。

```json
{
  "quarter": "2026-Q1",
  "count": 109,
  "eventCount": 37,
  "items": [
    {
      "id": "014c645e-…",
      "reconciliationId": "7863da46-…",
      "quarterCode": "2026-Q1",
      "followStatus": "pending",
      "processStage": null,
      "riskLevel": "low",
      "expectedCompleteAt": "2026-06-15 00:00:00+00",
      "nextFollowUpAt": null,
      "latestFollowUpAt": null,
      "closedAt": null,
      "createdAt": "2026-08-26 09:16:54.612554+00",
      "updatedAt": "2026-08-26 09:16:54.612554+00",
      "events": [
        { "id": "…", "eventType": "follow_up", "content": "…", "occurredAt": "…" }
      ],
      "latestEvent": { "id": "…", "eventType": "follow_up", "content": "…", "occurredAt": "…" } | null
    }
  ]
}
```

### 字段说明 / 规则

- 时间戳以 PG `timestamptz::text` 返回（ISO 风格，含时区偏移）。为空则 `null`。
- `latestEvent`：服务端从 **同一次批量结果** 中取 `events[]` 最后一条，**不做额外查询**；
  无事件则为 `null`。若前端只需最近跟进，可直接用 `latestEvent` 或 `latestFollowUpAt`；
  也可自行从 `events[]` 计算。
- `eventCount`：整季事件总数（便于一次性断言）。
- `processStage` / `riskLevel` / `followStatus`：返回数据库真实值，不翻译不映射
  （历史值如 `待核查`、`待销售去医院处理`、`low` 等原样返回）。
- NULL 语义：`processStage` / `nextFollowUpAt` / `latestFollowUpAt` / `closedAt` 等缺失为 `null`。

### 关联 reconciliation

同 difference API：用 `reconciliationId` 与共享 reconciliation dataset Map-join，得到客户 /
区域 / 账套 / 负责人 / 解决方案等字段，无额外 HTTP。

### 服务端范围

```sql
FROM recon.followup_items f
JOIN recon.reconciliations r ON r.id = f.reconciliation_id
JOIN recon.quarters q ON q.id = r.quarter_id
WHERE q.code = $1
```

事件批量加载（一条 SQL，`WHERE e.followup_item_id = ANY($1::uuid[])`）—— **不是** 逐 item 查询。
季度不存在 → `404`；非法代码 → `400`。

## 3. 通用约定

- 错误形状：`{ "error": "<中文信息>", "code": "INVALID_INPUT" | "NOT_FOUND" | "INTERNAL" }`。
  内部 SQL 错误一律脱敏为 `服务器内部错误`，不泄漏 SQL / schema / DATABASE_URL / 密码。
- 金额一律 NUMERIC-as-string；NULL 保持 NULL（绝不转 0）。
- 不修改现有 reconciliation 级 detail CRUD；本阶段仅新增 quarter-level GET。
- `material-status` 已有季度级 API，本阶段不新增第二套 material 聚合。

## 4. 已知验证基线（staging 隔离库 quarterly_recon_runtime_import_ui_test_20260827）

| 项 | Q1 | Q2 |
| --- | --- | --- |
| reconciliations | 752 | 851 |
| difference_items | 856 | 0 |
| followup_items | 109 | 0 |
| followup_events | 37 | 0 |
| material_status（经 reconciliation join） | 5465 | 0 |

- API count == SQL count（856 / 109 / 37 / 0）。
- amount sum（API 逐项 decimal 汇总）== SQL `sum(difference_amount)`（45620003.37）。
- 实现无 N+1：difference = 1 条 SQL；followup = 2 条 SQL（items + 批量 events）。
