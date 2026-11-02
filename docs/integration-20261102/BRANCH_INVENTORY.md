# 两分支完整文件盘点（2026-11-02）

- origin/main: `eab7d5bb8e685758d57e2c868898de46851ebe59`
- origin/feature/restore-followup-legacy-ui: `4f86977264a351b5b39294a4d0d8a71bbf264ef5`
- merge-base: `b82a87733b5a8e6eb0e55865f712be3e94163790`
- 现场 fetch 完成；本机本地 main 为 `308a1f4dfb1bd2c732a861b9f1327867fcd5ec88`，未修改该引用。
- 方向为 main → feature：新增 7，删除 4，修改 8，共 19；不是候选将执行的新增/删除清单。
- 模拟合并使用 git merge-tree --write-tree，未实际 merge；6 个冲突。

## 19 个完整树差异

| 状态 | 文件 | 分类 | 分析与处理 |
| --- | --- | --- | --- |
| M | `app/ProblemDashboard.tsx` | B/C | 唯一语义差异是恢复已关闭 KPI 卡片。main 保留 closedCount、阶段分布、stage=已关闭下钻和档案资格逻辑；业务功能已存在，旧卡片是否恢复待确认，不改已上线 KPI 布局。 |
| M | `app/Q1SpecialPanels.tsx` | B/C | main 已包含资料收集、SPD 汇总、手机标签切换/展开、下钻。分支恢复 useRef/上下箭头、按旧 tab 挂载桌面区块、旧表头和直接在 td 上截断；会回退主线三块同时挂载及 15/40/45 列宽和内层 span 修复，不引入。 |
| D | `app/SidebarIcon.tsx` | B | 功能分支删除该组件；main 霓虹侧栏实际依赖，保留。 |
| M | `app/data-import-tech.css` | B | 仅 CRLF/LF 行尾差异，忽略行尾后无差异。保留 main 字节与桌面导入布局。 |
| M | `app/page.tsx` | B/C | 分支退回字符图标、旧品牌和导航，去除 SidebarIcon 与插画。主线六页面入口、手机导航及业务 handlers 均保留。 |
| M | `app/q1-special-panels.css` | C | 分支追加一套旧手机卡片/表格转换 CSS；main 使用 reconciliation-dashboard-mobile-v1.css 及 layout overrides 已有完整适配。重复 display/table/block 覆盖风险，不引入。 |
| M | `app/reconciliation-mobile.css` | B | 仅行尾差异；main 当前季度全宽、50/50 筛选布局原样保留。 |
| M | `app/shell-overrides.css` | B/C | 分支退回旧桌面侧栏并移除主线 V1.6 至 V1.6.5.8 大段修复：三卡布局、白底抽屉、浅蓝灰表头、导入布局和共享问题抽屉表头。全部保留 main。 |
| M | `app/unresolved-followup-mobile.css` | B | 仅行尾差异；手机动态联动、卡片、分页等主线实现原样保留。 |
| D | `public/sidebar-neon/illustration.png` | B | 功能分支缺失，main 霓虹侧栏资源引用完整；必须保留 main 原始 blob。 |
| D | `public/sidebar-neon/logo.png` | B | 功能分支缺失，main 霓虹侧栏资源引用完整；必须保留 main 原始 blob。 |
| D | `public/sidebar-neon/top-arc.png` | B | 功能分支缺失，main 霓虹侧栏资源引用完整；必须保留 main 原始 blob。 |
| A | `scripts/build_project_application.py` | D | python-docx 文档生成器；包含过期计划、人员与奖金信息，非运行时代码。原分支保留；公开入库需业务内容脱敏、模板参数化和 python-docx 独立依赖声明。 |
| A | `scripts/build_project_proposal.py` | D | python-docx 立项说明书；旧站点地址和 localStorage 主存储方案已过时。保留原分支历史，不作为现行架构文档；需更新内容和独立依赖后再纳入工具。 |
| A | `scripts/make_ppt.py` | D | 依赖 python-pptx，生成标书急救指南.pptx；与季度对账业务无关，导入即执行且写当前目录。保留原分支，不纳入本应用候选。 |
| A | `tools/browser-data-audit-README.md` | D | 对应工具说明；含具体内网站点与旧操作口径，应在工具治理时同步泛化。 |
| A | `tools/browser-data-audit.js` | D | 有价值的旧浏览器本地状态只读审计。未发现远程写入/网络调用；但硬编码历史基线、location.href、原始业务值导出、IndexedDB getAll 内存与事务生命周期需治理。先留原分支；输出不得入库。 |
| A | `tools/chatgpt-site-data-audit-README.md` | D | 旧站点与 Q2 固定基线说明，随工具脱敏/参数化后再入候选。 |
| A | `tools/chatgpt-site-data-audit.js` | D | 有价值的旧站点保全工具：origin 校验、只读游标、JSON 分片、摘要。固定站点和历史金额、performance 完整 URL、嵌套凭据过滤不完整、manifest 自哈希口径需修正；原分支保留，不能当当前正式数据基线。 |

## 分支独有提交与提交内全部文件

- feature 独有 1 个提交：`4f86977264a351b5b39294a4d0d8a71bbf264ef5` — chore: capture pending reconciliation source and tools。
- main 独有 `818a8b8`、`eab7d5b`；不能用分支提交数推断未合并功能数量。
- 以下列出 feature 独有提交相对 merge-base 的全部 26 个文件（忽略行尾差异后为 25 个）；与上表取并集即覆盖审计范围。

| 文件 | 归属与结论 |
| --- | --- |
| `app/ManagementCockpit.tsx` | B：main 与 feature 的 Git blob 完全相同，已在正式源码。 |
| `app/ProblemDashboard.tsx` | 见上表逐项分析。 |
| `app/Q1SpecialPanels.tsx` | 见上表逐项分析。 |
| `app/QuarterlyReconciliation.tsx` | B：main 与 feature 的 Git blob 完全相同，已在正式源码。 |
| `app/ReconciliationHistoryDashboard.tsx` | B：main 与 feature 的 Git blob 完全相同，已在正式源码。 |
| `app/UnresolvedFollowupDashboard.tsx` | B：main 与 feature 的 Git blob 完全相同，已在正式源码。 |
| `app/app-shell.css` | B：main 与 feature 的 Git blob 完全相同，已在正式源码。 |
| `app/data-import-tech.css` | 见上表逐项分析。 |
| `app/history-dashboard.css` | B：main 与 feature 的 Git blob 完全相同，已在正式源码。 |
| `app/management-cockpit-refined.css` | B：main 与 feature 的 Git blob 完全相同，已在正式源码。 |
| `app/page.tsx` | 见上表逐项分析。 |
| `app/problem-dashboard-layout.css` | B：main 与 feature 的 Git blob 完全相同，已在正式源码。 |
| `app/problem-followup-drawer.css` | B：main 与 feature 的 Git blob 完全相同，已在正式源码。 |
| `app/q1-action-panel.css` | B：main 与 feature 的 Git blob 完全相同，已在正式源码。 |
| `app/q1-special-panels-layout-overrides.css` | B：main 与 feature 的 Git blob 完全相同，已在正式源码。 |
| `app/q1-special-panels.css` | 见上表逐项分析。 |
| `app/reconciliation-dashboard-mobile-v1.css` | B：main 与 feature 的 Git blob 完全相同，已在正式源码。 |
| `app/shell-overrides.css` | 见上表逐项分析。 |
| `app/unresolved-followup-mobile.css` | 见上表逐项分析。 |
| `scripts/build_project_application.py` | 见上表逐项分析。 |
| `scripts/build_project_proposal.py` | 见上表逐项分析。 |
| `scripts/make_ppt.py` | 见上表逐项分析。 |
| `tools/browser-data-audit-README.md` | 见上表逐项分析。 |
| `tools/browser-data-audit.js` | 见上表逐项分析。 |
| `tools/chatgpt-site-data-audit-README.md` | 见上表逐项分析。 |
| `tools/chatgpt-site-data-audit.js` | 见上表逐项分析。 |

## A / B / C / D 功能结论

A（本分支独有且确认应补回的应用业务逻辑）：0 项。不能为形成整合提交而编造新功能或恢复旧样式。新增版本接口治理属于用户追加的 A 类基础工程，单独提交。

B：手机六页面、当前季度明细、未解决跟进数量/区域联动、资料/回函/SPD、历史趋势/区域模块、跟进闭环与共享抽屉均已在 main。API、lib 数据逻辑、数据库定义、services、worker、依赖清单在两个分支之间无差异。`QuarterlyReconciliation.tsx` 两端 blob 完全相同。

C：待确认的已关闭 KPI 卡片、旧桌面 tab 挂载/滚动箭头、旧表格截断、旧侧栏和重复手机 CSS。不引入、不删除原分支；上线功能以 main 实现为准。

D：7 个辅助文件全部有明确历史 Git 归属，未散落丢失。审计工具有价值但需上述治理后再迁移；文档生成器不作为现行规范。标准库以外依赖分别为 python-docx/python-pptx，分支未提供独立 Python requirements。两个浏览器工具无 npm 依赖，依赖浏览器存储/Blob/crypto API；未在真实业务浏览器执行。

## 六个冲突逐项处理

| 冲突文件 | 类型 | 人工分析结论 |
| --- | --- | --- |
| `app/ProblemDashboard.tsx` | content | 唯一语义差异是恢复已关闭 KPI 卡片。main 保留 closedCount、阶段分布、stage=已关闭下钻和档案资格逻辑；业务功能已存在，旧卡片是否恢复待确认，不改已上线 KPI 布局。 |
| `app/Q1SpecialPanels.tsx` | content | main 已包含资料收集、SPD 汇总、手机标签切换/展开、下钻。分支恢复 useRef/上下箭头、按旧 tab 挂载桌面区块、旧表头和直接在 td 上截断；会回退主线三块同时挂载及 15/40/45 列宽和内层 span 修复，不引入。 |
| `app/data-import-tech.css` | content | 仅 CRLF/LF 行尾差异，忽略行尾后无差异。保留 main 字节与桌面导入布局。 |
| `app/page.tsx` | content | 分支退回字符图标、旧品牌和导航，去除 SidebarIcon 与插画。主线六页面入口、手机导航及业务 handlers 均保留。 |
| `app/shell-overrides.css` | content | 分支退回旧桌面侧栏并移除主线 V1.6 至 V1.6.5.8 大段修复：三卡布局、白底抽屉、浅蓝灰表头、导入布局和共享问题抽屉表头。全部保留 main。 |
| `app/unresolved-followup-mobile.css` | add/add | 仅行尾差异；手机动态联动、卡片、分页等主线实现原样保留。 |

没有运行 merge、checkout --ours/--theirs 或整文件覆盖解决冲突。候选从 main 新建，逐段判断后没有需要提取的 feature 运行时代码。

所有未采用代码继续归属于原 feature 分支及上述完整 SHA。未清理历史提交、分支、镜像、容器或验收证据。

完整树每个文件的 SHA-256、字节数与 Git blob 见 `main-files-sha256.tsv` 和 `feature-files-sha256.tsv`。清单基于 Git 对象字节，避免 Windows 自动换行转换误判。
