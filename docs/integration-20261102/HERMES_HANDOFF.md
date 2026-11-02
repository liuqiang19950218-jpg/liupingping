# integration 候选独立审计交接

候选分支：`integration/restore-followup-reconcile-20261102`。基线：`eab7d5bb8e685758d57e2c868898de46851ebe59`。本文件不代表合入 main 或部署；以远程该分支最终完整 SHA 为验收对象。

## 代码归属与整合决定

- 完整差异、A/B/C/D 裁决、26 个独有提交文件及六个冲突逐项说明见 [BRANCH_INVENTORY.md](BRANCH_INVENTORY.md)。19 个最终树差异逐项检查后，没有确认需要从旧分支补回的独有应用业务逻辑。
- 保留 main 的全部业务 UI、CSS、图片和数据链路；旧已关闭 KPI 卡片、桌面 tab/箭头/样式及重复手机 CSS 不引入。争议项保留原分支，不删除历史。
- 七个辅助文件保持原 feature Git 归属。浏览器审计工具有保全价值，但固定基线、URL、敏感字段过滤和大数据处理问题尚待独立治理；三份文档/PPT 工具存在过期或无关内容。没有将业务导出、数据库、运行配置或凭据带入候选。
- 新增功能是明确授权的版本接口治理；长期规范在独立提交中入库。版本链路的两个现场问题（大资源读取缓冲、Windows Git 归档换行）另有独立修复提交与回归测试，保留全部历史。

## 已完成验证与限制

| 项目 | 本轮结果 |
| --- | --- |
| npm run build | PASS；本地开发标识产物，API 路由被正确构建。最终 Git 归档的构建与 HTTP 版本值以交付证据为准。 |
| npm run lint | PASS，0 errors / 68 既有 warnings；新增版本代码定向 lint 通过。 |
| 全量 node --test tests/*.test.mjs | 214/214 PASS（含原有业务及新增版本测试）；无跳过。 |
| 版本定向测试 | 13/13 PASS；真实临时 Git 仓库、40 位 SHA、staging/formal、marker 隔离、实际时间、独立 releaseId、工作树/归档篡改与大文件/CRLF、GET/OPTIONS/CORS。 |
| 发布脚本 | PowerShell AST 与 bash -n PASS；完整仓库 Git 归档及逐文件验证 PASS。未执行部署脚本或 Docker 镜像构建。 |
| 运行时版本 smoke | 本地构建的 GET /api/version HTTP 200，development/unreleased，sourceGitSha=null，不伪装已发布。 |
| 真实业务数据 | BLOCKED；隔离本地 GET /api/quarters HTTP 500，DATABASE_URL is not configured。未复制正式 runtime.env 或使用真实数据库凭据。 |
| 业务源码保护 | 171 个现有 app（除版本路由）、public、lib、services、worker/数据库相关文件与 main 无差异；所有 CSS 和侧栏资源保留。 |
| 依赖与引用 | 新增模块相对导入完整；仅使用 Node 内置模块，无 npm 依赖或 lockfile 变化；完整构建检查了组件依赖。 |
| CSS 媒体查询 | 无任何 CSS 变更；保持 main 的桌面 min-width:761px 和手机 max-width:760px 及更窄分支。 |

| 视口宽度 | 源码/样式保护 | 本次真实业务浏览器验收 |
| --- | --- | --- |
| 320px | 与 main 一致 | BLOCKED |
| 375px | 与 main 一致 | BLOCKED |
| 390px | 与 main 一致 | BLOCKED |
| 430px | 与 main 一致 | BLOCKED |
| 1280px | 与 main 一致 | BLOCKED |
| 1366px | 与 main 一致 | BLOCKED |
| 1440px | 与 main 一致 | BLOCKED |

静态一致性不代表浏览器验收 PASS。未伪造截图、真实业务统计或 8011 验收结论。8000/8011 与 main 相等属于用户提供的基线，本轮未重新检查服务器全文件。

## Hermes 后续步骤（需另行具备 8011 验收授权）

1. fetch 并记录远程 integration 完整 SHA，与交付 SHA、清单及 Git 对象核对；确认 main 和原 feature 分支未改变。独立 worktree，不复用脏目录。
2. 先读 [GIT_RELEASE_POLICY.md](../GIT_RELEASE_POLICY.md) 和 [VERSION_METADATA.md](../VERSION_METADATA.md)。生成 staging Git 归档，SHA 自动来自当前提交；不手填旧 marker。检查 manifest 文件数与哈希。
3. 在独立 staging 发布目录使用受控配置和真实 staging 数据；禁止正式数据库写入。本轮没有提供部署授权或运行配置。
4. 核验 /api/version.sourceGitSha == 被构建的完整提交 SHA、environment=staging、实际 UTC buildTime、独立 releaseId；保留 buildSha 旧消费者兼容。测试 OPTIONS、缓存和错误响应。外部版本消费者未在本轮访问，需独立检查。
5. 对七个视口分别验收六页面：历史看板、当前季度、未解决跟进、驾驶舱、问题看板、数据导入。记录 DOM 宽度/滚动、计算样式和截图。
6. 特别保护：霓虹侧栏及三张图片、桌面浅蓝灰表头、共享问题抽屉表头、数据导入布局、手机筛选全宽及 50/50、未解决客户数量随筛选联动、历史模块；核对主列表→二级抽屉→详情的真实数据集合与只读统计。
7. 输出 PASS/FAIL/BLOCKED 与证据；未通过则只在候选分支修复并重验。不要直接合 main 或部署 8000；待独立验收通过后再接受下一步授权。

## 仍待确认

- 是否需要恢复已关闭 KPI 卡片；主线已有同一统计与档案穿透，不应未经业务确认变动布局。
- D 类工具的脱敏与独立维护范围。
- 外部消费者是否严格限制 /api/version 字段；现有 buildSha 保留，但其源码识别逻辑应切到 sourceGitSha。
- 现有离线基础镜像是否残留额外源码/配置；新校验会阻止此类构建，不能绕过验证或删除历史镜像。
- Docker 镜像构建、服务器配置生成后的实际发布、真实 staging 业务浏览器验收均由后续授权阶段完成。

本轮未修改 main、未 force push、未部署/重启服务、未写数据库、未删除历史分支/镜像/容器/证据。候选远程保存后停止。
