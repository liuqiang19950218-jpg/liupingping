# DASHBOARD_RUNTIME_DATA_MATRIX

审计基线：`c369cf86bebc716c1fe64f93e9eee020f082376c`。

| Dashboard / 组件 | 当前指标与图表 | 原数据源 / localStorage | reconciliation 字段 | 需要明细 API | quarter 范围 | 本阶段结论 |
| --- | --- | --- | --- | --- | --- | --- |
| `CurrentYearLinkedSummary` | 客户数、对清率、未对清差额 | `cockpitRows` → `local-quarterly-reconciliation(-archive)` | 区域、客户账面金额、状态、差额 | 无 | 当前季度 | 已迁移为 `GET reconciliations` |
| `DashboardOverview` | 账实相符率、核心异常、未对清明细 Drawer | `cockpitRows` / `sheetForQuarter` | 账套、区域、客户、负责人、公司应收、客户账面、差额、状态 | 无 | 当前季度 | 已迁移为 `GET reconciliations` |
| `ReconciliationHistoryDashboard` | 趋势柱线图、区域对清表 | `latestQuarterlyCockpitRows`、历史硬编码趋势 | 区域、客户账面金额、状态 | 无 | 多季度 | 已迁移：`GET /api/quarters` + 每季度一次 `GET reconciliations` |
| `ManagementCockpit` | KPI、区域排名、差额结构、账龄、风险、趋势、钻取 | shared DashboardDataProvider | reconciliation + difference/followup Map join | difference_items、followup | 当前 + 多季度 | 当前季度已迁移为 4 个 quarter-level PG 请求；不使用逐 reconciliation 请求 |
| `DifferenceAgingAnalysis` / `DifferenceStructureChart` | 差额分类、发票账龄、明细 Drawer | ManagementCockpit PG ViewModel | reconciliation Map join + difference-items | difference_items | 当前季度 | 已由 ManagementCockpit 的 shared differenceItems 派生；无逐行 HTTP |
| `ProblemDashboard` | 问题阶段、责任人、风险、超期、关闭数 | `reconciliation-insights` + `resolved-followup-archive` | shared reconciliations 的当前 `ownerName`、金额/方案；followup 的状态、阶段、风险、时间 | `GET followups` + shared reconciliations | 当前季度 | 已迁移；关闭项直接由 `followStatus=closed` / `closedAt` 派生，无 archive 业务依赖 |
| `UnresolvedFollowupDashboard` | 待解决清单、跟进编辑、账龄与区域图 | `sheetForQuarter` / `writeArchivedSheet` | shared reconciliations + followup items/events | `GET followups` + shared reconciliations | 当前季度 | 已迁移；列表 Map join，跟进事件和关闭状态走现有 followup CRUD，拒绝 localStorage 业务回退 |
| `Q1ActionPanel` / `Q1SpecialPanels` | Q1 专项、SPD、回款/资料 Drilldown | ActionPanel: shared PG rows；SpecialPanels: `sheetForQuarter`、`spdSheetForQuarter` | ActionPanel 已可用；SpecialPanels 的普通资料为 shared rows + material-status，SPD 为独立 SPD dataset | `GET material-status` + `GET spd-dashboard` | 当前季度 | 已迁移；SPD 汇总优先 API summary，Q2 `count=0` 显示空状态；无 SPD drilldown |
| `ImportDashboard` | 本机导入历史 | `import-history` | 不适用 | import history | 跨季度 | 任务明确 deferred：`IMPORT_HISTORY_UI_REQUIRED_LATER = YES` |

## API 与请求评估

已迁移的当前季度组件共享 `DashboardDataProvider`：页面生命周期内为 `GET /api/quarters` + 当前季度一次 `GET /api/quarter/[code]/reconciliations`。历史趋势额外按已存在季度各请求一次 reconciliation，且不会按 reconciliation 行请求。

当前季度 Provider 请求为 `GET /api/quarters` 加五个 quarter-level 读取：reconciliations、difference-items、followups、material-status、spd-dashboard。所有 Dashboard 复用这些数据与 Map 索引；不存在 reconciliation 行级 GET 或 localStorage 业务回退。
