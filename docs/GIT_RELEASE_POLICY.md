# 季度对账系统 Git 版本统一与开发发布规范

版本：1.1（2026-11-02，原 1.0 的脱敏入库及版本接口治理修订）。
适用范围：本季度对账系统，所有 Codex、Hermes 及人工开发、审计、发布操作。

原文已完整读取并检查；原文件 SHA-256：`78f52d3714ae43194dacf725eddbb3486dd7594a23b1c2563e2ad8680098e171`。未发现密码、私钥或真实令牌。入库时去除服务器用户目录、具体发布目录、机器专属 remote 名称与镜像标识；连接信息由仓库外配置管理。保留原文全部开发、测试、Git、发布、验收和回退主题。

本版按当前任务要求修订两点：构建使用完整提交树及文件哈希，而非只覆盖 app/；releaseId 使用独立 RELEASE_ID，不以 BUILD_SHA 或旧 marker 回退。历史现场快照另行标识，不作为永久环境事实。

## 0. 最终目标（铁律）

**本地正式 main = Git 远程 main = 正式运行源码 = 同一已验收的完整 Git Commit SHA。**

每次正式发布后应能以源码清单、运行镜像、版本接口及远程提交证明一致。独立候选允许领先 main，但必须明确标识候选分支和环境，不代表已经上线。

## 1. 长期开发发布规则（强制）

1. 所有 Codex、Hermes 的业务源码修改必须 Git commit，包括 CSS、TSX、TS、JS、配置、脚本和新增依赖。不得让有效源码仅留在本地目录、服务器、容器或未提交工作区。
2. 所有正式开发修改必须 push 至受控远程功能或候选分支；提交与推送前检查敏感内容。未完成的实验留在可追溯独立分支，不能冒充已验收功能。
3. 每次开发从最新 origin/main 建立功能分支：先 `git fetch origin`，再 `git switch -c feature/<主题> origin/main`。保护原工作区未提交修改；需要时使用隔离 worktree。
4. 8011 staging 必须从明确完整 SHA 的源码树构建。生成 Git 归档及 SHA-256 清单；禁止以旧发布目录、服务器散落文件或部分 app/ 覆盖代替完整源码基线。
5. Hermes 独立验收：真实 staging 数据；手机 320/375/390/430px，桌面 1280/1366/1440px；记录计算样式、DOM 度量、截图及真实业务流程。报告明确 PASS、FAIL、BLOCKED、NOT_RUN，不得以 build 成功代替业务验收。
6. 验收通过且获准后，才允许 fast-forward 合并 main 并 push。main 已前进或存在冲突时，回候选分支整合、重新验收；禁止直接整文件 ours/theirs 覆盖已上线功能。
7. 8000 formal 必须从已验收 main tip 构建。离线复用基础镜像时记录旧镜像身份，并校验最终完整源码，发现继承残留或依赖不匹配即停止。
8. 正式部署后核验 /api/version：sourceGitSha 为该提交完整 40 位 SHA，environment=formal，buildTime 为实际构建时间，releaseId 为独立发布编号。
9. 禁止服务器直接修改源码而不回写 Git；紧急修改也必须进入受控分支、测试和验收流程。
10. 禁止跳过 Git 记录直接正式上线。提交/推送权限不自动包含部署、重启或数据库写入权限。
11. 禁止以旧版本 marker 冒充 Git SHA；BUILD_SHA 的旧兼容语义不得擅自改变。版本接口的消费者须按独立字段识别源码与发布。

## 2. 分支策略

- main：唯一正式分支，只接受已验收且基于当前 main 的快进整合；不在 main 直接开发。
- feature/<主题>：日常开发分支；integration/<主题>：多来源安全整合候选。二者都应从最新 origin/main 新建。
- 历史功能分支（包括 feature/restore-followup-legacy-ui）保留，不整体盲合、不删除。有效独有逻辑逐项提取；重复实现保留 main；有争议项保留原引用并标记待确认。
- 重大 Git 操作前记录原分支 SHA，必要时建立 backup/<分支>-<sha>-<日期> 引用。
- 禁止 force push、丢弃未备份修改的 reset --hard、未经授权删除历史分支、提交、镜像、容器或验收证据。

## 3. 环境与构建链条

```text
功能/候选分支的已提交完整源码
  → Git 归档 + SHA-256 清单 + 自动推导的 sourceGitSha
  → staging 构建（独立 releaseId；实际 buildTime；environment=staging）
  → 获准后的 8011 独立预览/验收（Hermes）
  → 验收 PASS + 合并授权 → fast-forward main → push origin/main
  → main 完整树的正式归档与 formal 构建
  → 另行授权的镜像导入和服务切换
  → /api/version 连续三次核验 + 首页 200 + 六页验收 + 获准的数据库只读计数
```

运行配置在仓库外管理。runtime.env、secrets、连接凭据不得进入源码归档或 Git；环境文件路径及挂载信息在受控运维记录中保管。复用基础镜像不能继承错误 SOURCE_GIT_SHA 或残余业务源码。

## 4. 版本接口治理

- SOURCE_GIT_SHA 自动来自实际构建提交或该提交的受信任 Git 归档；必须为完整 40 位十六进制 SHA。缺失实际 Git/归档证明、非法值或与源码不一致，均阻止 staging/formal 发布。
- BUILD_SHA 继续兼容既有消费者，可保留独立 marker；不得回退成 sourceGitSha，也不得改写其既有语义。
- BUILD_TIME 在实际构建开始时生成 UTC ISO 时间，不复制旧镜像时间。
- ENVIRONMENT 发布时只允许 staging/formal；本地 development 明确 unreleased，源码 SHA 和发布编号允许为空，不伪装正式版本。
- RELEASE_ID 独立管理；不与 Git SHA 混淆，不默认借用旧 BUILD_SHA。
- /api/version 必须含 sourceGitSha、buildTime、environment、releaseId，同时保留已有 buildSha 兼容字段。具体实现、失败状态和消费者检查见 [VERSION_METADATA.md](VERSION_METADATA.md)。
- 验收断言：正式 sourceGitSha == 已验收 main 的完整 SHA；staging sourceGitSha == 被验收候选提交。
- 不为改变版本显示单独重启当前正式服务；变更随另行授权的发布生效。

## 5. 一致性校验（部署后/日常）

以下为通用只读校验步骤，路径和地址从受控配置提供；不在本文写入真实机器信息。

```bash
set -eu
cd "$REPOSITORY_DIR"
git fetch origin
LOCAL_MAIN=$(git rev-parse main)
REMOTE_MAIN=$(git rev-parse origin/main)
test "$LOCAL_MAIN" = "$REMOTE_MAIN"
REL_TREE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/recon-main-check-XXXXXXXX")
git archive "$LOCAL_MAIN" | tar -x -C "$REL_TREE_DIR"
# 使用归档清单逐文件 SHA-256 比对 RELEASE_SOURCE_DIR 和运行镜像源码。
# 仅排除经批准的依赖/构建产物、生成版本模块和仓库外运行配置。
# 检查不存在额外业务源码；记录每个排除项，不只对比 app/。
# 读取 /api/version：sourceGitSha == LOCAL_MAIN，environment == formal。
```

通过条件：local main == remote main == /api/version.sourceGitSha，发布目录与镜像源码逐文件一致，发布编号和构建时间与该次构建记录一致。临时审计目录在验证与证据归档前不得自动覆盖或删除。源 manifest 不等同数字签名，必须从可信 Git 来源复核。

## 6. 工具文件归档

| 文件 | 原有用途 | 归档要求 |
| --- | --- | --- |
| browser-data-audit.js 及 README | 浏览器 localStorage/IndexedDB 只读导出 | 有价值；tools/ 独立提交，泛化环境与历史基线、审查导出内容；JSON 业务数据仅内部保管，不入 Git。 |
| chatgpt-site-data-audit.js 及 README | 旧站点只读数据保全 | tools/archive/ 或保留原分支；标识旧环境，修复 URL/敏感字段暴露与哈希口径后再作为通用工具。 |
| build_project_application.py、build_project_proposal.py、make_ppt.py | 申报、提案和 PPT 生成 | 如仍有业务价值，脱敏/参数化后纳入 tools/docs/，声明 Python 依赖；过期方案和无关材料保留历史引用，不混入 app/。 |
| deploy-production.ps1、deploy-staging.sh | 参数化运维入口 | 保留 scripts/，配置外置；配置示例用占位符，不包含凭据。 |

工具可在独立 chore/tools-archive 分支整理，也可在明确授权的 integration 分支独立提交。不能为了增加代码数量而合入旧运行时实现。禁止整批提交机器专属部署脚本、secret 挂载配置、临时验收脚本、数据库文件、私钥、日志或个人状态。当前逐项裁决见 [整合盘点](integration-20261102/BRANCH_INVENTORY.md)。

## 7. 标准操作流程、测试与回退

1. fetch 并核实完整 SHA、工作区状态及远程分支，建立隔离候选；保留既有工作区。
2. 列明改动文件与业务影响；检查真实 DOM、数据路径、调用方及依赖；保留已验收手机和桌面行为。
3. Build、Lint、全量测试及定向业务测试；检查组件引用、CSS 媒体查询、完整依赖、基线差异与敏感内容。失败先修复；数据环境缺失标记 BLOCKED。
4. 按明确文件白名单 git add，分类提交。提交说明必须包含文件、原因及测试结果；push 候选分支后用 ls-remote 核实完整 SHA 一致。
5. 交 Hermes 独立验收，记录七种视口、六页面、抽屉/筛选/分页/统计联动及源码版本。验收前不得合入 main。
6. 验收通过且获准后才执行 `git switch main`、`git merge --ff-only <候选分支>`、`git push origin main`。若不能快进，停止并回候选分支处理及重验。
7. 正式发布须单独授权：归档 main tip、生成版本元数据、构建、镜像导入、服务切换、连续三次版本校验。源代码整合任务默认到候选推送为止。
8. 发布前记录回退目标：旧提交、旧镜像 tag/digest、旧运行配置的受控引用、备份工作负载配置和必要的数据备份位置；不得将含敏感值的备份提交 Git。获准的数据库只读计数在发布前后对比。
9. FAIL 或异常时停止推广，按该次授权的预案回退到已记录的旧镜像及运行配置，重新核验版本、首页、业务页面与只读计数；不得擅自写数据库来掩盖异常。保留失败候选和证据，记录原因及后续修复分支。

## 8. 原文历史基线快照及本次边界

原文记录日期为 2026-11-02：正式远程 main 为 `eab7d5bb8e685758d57e2c868898de46851ebe59`，tree 为 `4af1fed42d7f489963d821c166ea1a82b7cc8891`，并记录当时 8000/8011 源码与其相同。现场镜像标记、服务器目录已从公开文档移除；原文中旧 BUILD_SHA 属发布 marker，不能解释成完整 Git SHA。

以上服务器状态是来源文档的历史记录，不代表本次重新部署或验收。本次 Windows checkout 的 local main 尚为 `308a1f4dfb1bd2c732a861b9f1327867fcd5ec88`；integration 直接从 fetch 后的 origin/main 创建，未修改该 local main 引用。

本轮仅功能盘点、安全候选实现、测试、规范入库和 integration 远程保存；不合并 main，不部署 8011/8000，不修改正式 runtime.env，不重启服务，不写数据库。完成后停止，交 Hermes 独立审计。
