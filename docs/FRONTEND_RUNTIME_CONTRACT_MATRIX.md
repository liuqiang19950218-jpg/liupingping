# FRONTEND_RUNTIME_CONTRACT_MATRIX

只读审计（本季度对账详细情况 / "对账负责人" / 差额 / 跟进 / 资料）
前端真实来源：`app/QuarterlyReconciliation.tsx`（`DetailForm`、`LocalSheet`、`DIFFERENCE_SUMMARIES`、
`MATERIAL_HEADERS`、`saveSheet`），`app/quarter-storage.ts`，Q1 `source_payload.detail` 真实结构。

字段映射 —— 前端当前必须持久化的业务字段：

| # | UI 字段 (DetailForm) | LocalSheet/详情 | PG 表/列 | GET 返回 | WRITE 支持 | 分类 | 丢失风险 |
|---|---|---|---|---|---|---|---|
| 1 | companyAmount | detail.companyAmount | reconciliations.company_receivable | companyReceivable | 只读（导入字段） | CONTRACT_OK | 无（显示用） |
| 2 | customerAmount | detail.customerAmount | reconciliations.customer_book_amount | customerBookAmount | PATCH customerBookAmount | CONTRACT_OK | 无 |
| 3 | responsible（对账负责人） | detail.responsible / source_payload.owner_raw_name | reconciliations.owner_name（004新增，可编辑）+ owner_id(NULL,未来账号) | ownerName（COALESCE owner_name ← provenance owner_raw_name） | PATCH ownerName | **SCHEMA_EXTENSION_REQUIRED → 已建004 + API 补齐** | 曾丢失 → 本轮修复 |
| 4 | transit/returned/lost/instrument/otherInvoice | detail.{cat}[] InvoiceEntry {date,invoice,amount,note} | difference_items(category,invoice_no,invoice_date,difference_amount,difference_description) | items[] | POST/PATCH/DELETE | CONTRACT_OK | 无 |
| 5 | other（无发票/图片） | detail.other[] OtherEntry {amount,note,image} | difference_items(category='other') + attachment_keys(jsonb) | **本轮新增 attachmentKeys** | POST/PATCH attachmentKeys | **API_RESPONSE_FIX_REQUIRED → 已修复** | 曾丢失（刷新后图片附件丢失）→ 本轮修复 |
| 6 | badDebt | detail.badDebt | reconciliations.bad_debt_amount | badDebtAmount | PATCH badDebtAmount | CONTRACT_OK | 无 |
| 7 | badDebtReason | detail.badDebtReason | reconciliations.bad_debt_reason | badDebtReason | PATCH badDebtReason | CONTRACT_OK | 无 |
| 8 | adjustment | detail.adjustment | reconciliations.adjustment_amount | adjustmentAmount | PATCH adjustmentAmount | CONTRACT_OK | 无 |
| 9 | adjustmentReason | detail.adjustmentReason | reconciliations.adjustment_reason | adjustmentReason | PATCH adjustmentReason | CONTRACT_OK | 无 |
| 10 | resolutionSolution | detail.resolutionSolution | reconciliations.solution | solution | PATCH solution | CONTRACT_OK | 无 |
| 11 | resolutionTime | detail.resolutionTime | reconciliations.solution_date | solutionDate | PATCH solutionDate | CONTRACT_OK | 无 |
| 12 | resolved (boolean) | detail.resolved | reconciliation_status / followup follow_status（语义映射） | reconciliationStatus / followup.followStatus | PATCH reconciliationStatus / followup | DEFERRED_NON_CORE（状态语义已在Phase 2B定义，resolved布尔不单独落库） | 无 |
| 13 | followUps {time,solution}[] | detail.followUps[] | followup_items + followup_events（事件=跟进历史，content=方案，occurred_at=时间） | followups[].events[] | POST/PATCH/DELETE followups(+events) | CONTRACT_OK | 无 |
| 14 | 资料状态（MATERIAL_HEADERS: 对账函/对账确认函/SPD确认表/SPD库存确认函/在途证明/精准核销/催款函送达证明） | 表列（资料提供情况表） | material_status(material_type,provided,raw_value) | material[] | POST/PATCH/DELETE（reconciliation级 + quarter级PUT） | CONTRACT_OK | 无 |

结论：
- 前端核心字段总数（本季度对账详细 + 负责人 + 差额 + 跟进 + 资料）：14 类。
- CONTRACT_OK：12
- API_RESPONSE_FIX_REQUIRED：1（#5 attachmentKeys GET 未返回）→ 本轮已修复
- SCHEMA_EXTENSION_REQUIRED：1（#3 负责人 editable owner_name）→ 本轮已建 004 + 回填 + API 补齐
- API_WRITE_FIX_REQUIRED：0（Phase 2B 已具备写路径）
- 其他 blocking 字段：无。
- 当前核心页面可完全不依赖 localStorage 完成数据还原（PG 为唯一业务真相；本轮修复两个缺口后无 blocking gap）。

来源佐证（真实代码/数据）：
- `app/QuarterlyReconciliation.tsx` L28-101（InvoiceEntry/OtherEntry/DetailForm/LocalSheet）、L2685-2700（DIFFERENCE_SUMMARIES：transit/returned/lost/instrument/otherInvoice=invoice:true，other=invoice:false 可附图片）、L55（OtherEntry.image）、L165-176（MATERIAL_HEADERS）、L990-1028（saveSheet 持久化）。
- `app/quarter-storage.ts`（localStorage 存档结构：headers/rows/fileName/details）。
- 数据库实测：Q1/Q2 `reconciliations.source_payload` 均含 `owner_raw_name`；Q1 `source_payload.detail` 结构与 DetailForm 完全一致（含 `other[].image`）。
- 004 回填实测：Q1=697、Q2=788 行 owner_name 由 provenance 初始化；缺失/哨兵(0/—/-/未填写/未对账/null/undefined) → NULL。
