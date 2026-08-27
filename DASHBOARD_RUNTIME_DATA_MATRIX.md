# DASHBOARD_RUNTIME_DATA_MATRIX

审计基线：`c369cf86bebc716c1fe64f93e9eee020f082376c`。

| Dashboard / 组件 | 当前指标与图表 | 原数据源 / localStorage | reconciliation 字段 | 需要明细 API | quarter 范围 | 本阶段结论 |
| --- | --- | --- | --- | --- | --- | --- |
| `CurrentYearLinkedSummary` | 客户数、对清率、未对清差额 | `cockpitRows` → `local-quarterly-reconciliation(-archive)` | 区域、客户账面金额、状态、差额 | 无 | 当前季度 | 已迁移为 `GET reconciliations` |
| `DashboardOverview` | 账实相符率、核心异常、未对清明细 Drawer | `cockpitRows` / `sheetForQuarter` | 账套、区域、客户、负责人、公司应收、客户账面、差额、状态 | 无 | 当前季度 | 已迁移为 `GET reconciliations` |
| `ReconciliationHistoryDashboard` | 趋势柱线图、区域对清表 | `latestQuarterlyCockpitRows`、历史硬编码趋势 | 区域、客户账面金额、状态 | 无 | 多季度 | 已迁移：`GET /api/quarters` + 每季度一次 `GET reconciliations` |
| `ManagementCockpit` | KPI、区域排名、差额结构、账龄、风险、趋势、钻取 | shared DashboardDataProvider | reconciliation + difference/followup Map join | difference_items、followup | 当前 + 多季度 | 当前季度已迁移为 4 个 quarter-level PG 请求；不使用逐 reconciliation 请求 |
| `DifferenceAgingAnalysis` / `DifferenceStructureChart` | 差额分类、发票账龄、明细 Drawer | ManagementCockpit PG ViewModel | reconciliation Map join + difference-items | difference_items | 当前季度 | 已由 ManagementCockpit 的 shared differenceItems 派生；无逐行 HTTP |
| `ProblemDashboard` | 问题阶段、责任人、风险、超期、关闭数 | `reconciliation-insights` + `resolved-followup-archive` | 负责人、差额、解决方案可用；阶段/最新跟进/关闭不足 | followup | 当前季度 | 阻断：需季度级 followup 聚合 |
| `UnresolvedFollowupDashboard` | 待解决清单、跟进编辑、账龄与区域图 | `sheetForQuarter` / `writeArchivedSheet` | 基础客户字段可用；完整跟进事件不足 | followup | 当前季度 | 阻断：需季度级 followup 聚合；现有写入不可改为逐条读取 |
| `Q1ActionPanel` / `Q1SpecialPanels` | Q1 专项、SPD、回款/资料 Drilldown | ActionPanel: shared PG rows；SpecialPanels: `sheetForQuarter`、`spdSheetForQuarter` | ActionPanel 已可用；SpecialPanels 不完整 | material + 独立 SPD 数据 | 当前季度 | Q1ActionPanel 已迁 PG；Q1SpecialPanels 仍需独立 SPD API，`ADDITIONAL_DASHBOARD_API_REQUIRED` |
| `ImportDashboard` | 本机导入历史 | `import-history` | 不适用 | import history | 跨季度 | 任务明确 deferred：`IMPORT_HISTORY_UI_REQUIRED_LATER = YES` |

## API 与请求评估

已迁移的当前季度组件共享 `DashboardDataProvider`：页面生命周期内为 `GET /api/quarters` + 当前季度一次 `GET /api/quarter/[code]/reconciliations`。历史趋势额外按已存在季度各请求一次 reconciliation，且不会按 reconciliation 行请求。

`difference_items` 和 `followup` 现仅提供 reconciliation-id 级 endpoint。对 Q2 851 条记录逐条获取会产生 852 次或更多请求，属于禁止的 N+1。因此需要新增只读、quarter-level 聚合 API 后才能完整迁移相关 Dashboard。
