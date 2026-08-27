# FRONTEND_POSTGRES_API_CONTRACT

面向 Codex 下一阶段（QuarterlyReconciliation.tsx 从 localStorage 切换到 PG API）的前端 API 契约。
后端 staging: `8001`。所有金额为 **decimal string**（非 JS number），所有写入均为 **服务端** 校验/计算。

## 通用约定

- 所有资源使用 camelCase JSON 字段。
- 金额（金额列）一律是字符串：`"20000.00"`；`null` = 未填写。
- NULL 语义：`customer_book_amount = null` ⇒ `difference = null`（绝不变成 0 或 company_receivable）。
  `reconciliation_status` 仅在显式填写时保存；显式传 `null` 可回到 NULL，绝不自动 backfill 为“未对账”。
- 季度归属：所有 `/api/quarter/{code}/...` 都强制校验资源属于 URL 中的季度；跨季度 → `409 CONFLICT`。
- 错误响应统一：`{ "error": "<中文消息>", "code": "INVALID_INPUT|NOT_FOUND|CONFLICT|INTERNAL|SCHEMA_004_REQUIRED" }`。

## 1. Reconciliation 资源

`GET /api/quarter/{code}/reconciliations` → `{ quarter, reconciliations: [...] }`
`PATCH /api/quarter/{code}/reconciliations/{id}` → `{ quarter, reconciliation: {...} }`

Reconciliation 资源字段（GET 与 PATCH response 尽量一致）：

```
id                      string (uuid)
sourceRowKey            string|null        （只读，GET）
quarterCode             string
region / accountSet / customer   string|null （只读，GET）
companyReceivable       string|null        （导入字段，只读，显示用）
customerBookAmount      string|null        （PATCH 可写）
reconciliationDifference string|null       （只读，服务端计算 = company - customerBook）
reconciliationStatus    string|null        （PATCH 可写；null=未填）
badDebtAmount / badDebtReason        string|null （PATCH 可写）
adjustmentAmount / adjustmentReason  string|null （PATCH 可写）
solution / solutionDate              string|null （PATCH 可写；日期 YYYY-MM-DD）
ownerId                 string|null        （保留：未来系统账号，当前恒为 null，勿用于展示）
ownerName               string|null        （当前业务负责人姓名，可编辑）
```

### ownerName 语义（负责人）

- Excel 导入负责人 = 初始值（由 004 迁移从 `source_payload.owner_raw_name` 回填到 `owner_name`）。
- 销售修改负责人 → 只写 `owner_name`；原始 `source_payload`（provenance）永不覆盖。
- 读取：`ownerName = 可编辑 owner_name ?? provenance owner_raw_name(非哨兵)`，
  因此 Q1/Q2 历史负责人不会因 PG 切换变空。
- PATCH：`ownerName` 接受 string（trim 后保存，空串→null）或 null。
- 缺少 004 迁移时，GET/PATCH 返回 `code: "SCHEMA_004_REQUIRED"`（500），可识别，不会静默失败。

## 2. Difference Item 资源

`GET    /api/quarter/{code}/reconciliations/{id}/difference-items`
`POST   /api/quarter/{code}/reconciliations/{id}/difference-items`
`PATCH  /api/quarter/{code}/reconciliations/{id}/difference-items/{itemId}`
`DELETE /api/quarter/{code}/reconciliations/{id}/difference-items/{itemId}`

GET → `{ quarter, reconciliationId, items: [...] }`；POST(201)/PATCH → `{ quarter, reconciliationId, item: {...} }`
（item 与 items[] 元素为同一 resource shape）。

```
id                    string (uuid)
category              string   ∈ {transit, returned, lost, instrument, otherInvoice, other}
invoiceNo             string|null
invoiceDate           string|null   (YYYY-MM-DD；提供日期必须同时提供发票号)
differenceAmount      string|null
differenceDescription string|null
verificationStatus    string   ∈ {not_applicable, pending, matched, mismatched}
attachmentKeys        string[]      (业务附件 key 列表；仅作为列表往返，不做文件读写)
```

### attachmentKeys（“其他-无发票”图片附件）

- `other` 类别的图片附件在 PG 中存 `difference_items.attachment_keys`（jsonb string[]）。
- POST/PATCH 提交 `attachmentKeys: string[]`；GET / POST / PATCH 响应都返回 `attachmentKeys`（round-trip 一致）。
- 仅当业务附件 key 列表使用；禁止通过它读取任意服务器文件路径。本阶段无文件上传接口。

## 3. Followup 资源（1 条 followup_item / reconciliation + events 历史）

`GET    /api/quarter/{code}/reconciliations/{id}/followups`
`POST   /api/quarter/{code}/reconciliations/{id}/followups`   （创建，已存在 → 409）
`PATCH  /api/quarter/{code}/reconciliations/{id}/followups`   （更新 + 可选追加 event）
`DELETE /api/quarter/{code}/reconciliations/{id}/followups`   （删除，events 级联）
`POST   /api/quarter/{code}/reconciliations/{id}/followups/events` （追加历史）

followup item 字段：`id, followStatus, processStage, riskLevel, expectedCompleteAt,
nextFollowUpAt, latestFollowUpAt, closedAt, events[]`。
event：`{ eventType, content, occurredAt, id }`（跟进方案→content，跟进时间→occurredAt，跟进历史→events）。
item 更新 + event 追加在**单事务**内（BEGIN→item→event→COMMIT，任一步失败 ROLLBACK）。

## 4. Material 资源

`GET    /api/quarter/{code}/reconciliations/{id}/material-status`
`POST   /api/quarter/{code}/reconciliations/{id}/material-status`   （upsert by materialType）
`PATCH  /api/quarter/{code}/reconciliations/{id}/material-status/{materialId}`
`DELETE /api/quarter/{code}/reconciliations/{id}/material-status/{materialId}`
`GET / PUT / DELETE /api/quarter/{code}/material-status[/{materialId}]` （季度级，reconciliation_id IS NULL）

字段：`{ id, materialType, provided(boolean|null), rawValue(string|null), reconciliationId }`。
materialType 使用现有语义（如：对账函 / 对账确认函 / SPD确认表 / SPD库存确认函 / 在途证明 / 精准核销 / 催款函送达证明）。

## 5. 版本 / 健康

`GET /api/version` → `{ buildSha, buildTime, environment }`（buildSha 必须等于部署 commit）。

---
本契约不包含任何数据库密码 / DATABASE_URL / 服务器敏感信息。PostgreSQL 为唯一业务真相；
前端不得回退 localStorage 作为正式方案。
