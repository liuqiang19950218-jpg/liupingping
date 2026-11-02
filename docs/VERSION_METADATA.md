# 源码版本与发布编号

`GET /api/version` 保留原 `buildSha`、`sourceGitSha`、`buildTime`、`environment` 字段，新增 `releaseId` 与 `releaseStatus`。CORS 和 OPTIONS 204 保留；GET 禁止缓存。

| 字段 / 配置 | 来源与语义 |
| --- | --- |
| sourceGitSha / SOURCE_GIT_SHA | 完整 40 位 Git 提交；从干净 Git HEAD 自动取得，或从该提交生成且逐文件 SHA-256 校验通过的归档取得。外部 SOURCE_GIT_SHA 只能作一致性断言，不能覆盖源码身份。 |
| buildTime / BUILD_TIME | npm run build 实际开始时生成的 UTC ISO 时间；旧 BUILD_TIME 不得覆盖新构建时间。 |
| environment / ENVIRONMENT | 发布为 staging 或 formal；普通本地构建为 development。 |
| releaseId / RELEASE_ID | 独立发布编号，默认环境加 UTC 时间；不允许填写完整 Git SHA。 |
| buildSha / BUILD_SHA | 保留原环境值语义：运行时 BUILD_SHA 优先，其次构建值；不解析、不截短、不当作 sourceGitSha 回退。发布构建未提供时仍默认实际 Git HEAD，保持旧 staging 习惯。 |
| releaseStatus | released / unreleased / invalid。本地 development 返回 sourceGitSha=null、releaseId=null；无有效发布身份的构建不能伪装为正式版本。 |

## 构建链路

1. 提交全部源码，确认干净工作树。运行 `node scripts/prepare-release.mjs --environment staging --archive <仓库外的归档路径>`（正式构建使用 formal；可选 `--release-id`）。命令不部署、不连接服务、不写数据库。
2. 生成器直接读取 Git 对象并使用 git archive，生成 `.release/source-manifest.json`（提交、环境、发布编号、兼容 BUILD_SHA、全部 Git 文件 SHA-256）。不能使用旧镜像 marker 或手填 SHA 生成此文件。
3. 在新目录提取归档后安装依赖并 npm run build；Docker 三种入口均要求该 manifest。构建校验文件哈希、额外继承文件、环境、源码 SHA 和发布编号；任何不符立即失败。旧离线镜像若残留额外源码会阻止构建，需要以后在独立发布目录处理，不在本次自动清理。
3a. 基础镜像必须干净：除 `node_modules` 外不得继承业务源码或旧版本元数据（旧 SOURCE_GIT_SHA/BUILD_SHA、runtime.env/.env*/secrets）；已验证的干净基础镜像派生方法见 [GIT_RELEASE_POLICY.md](GIT_RELEASE_POLICY.md) §3.1。构建产物（`lib/build-version.generated.mjs`）必须对应被构建的 Commit：sourceGitSha/environment/releaseId 由归档 manifest 决定，运行环境不可改写；不一致即阻止发布。
4. 生成的 `lib/build-version.generated.mjs` 被打包进版本路由，运行环境不能改变已编译的源码 SHA、构建时间、环境或发布编号。生成文件及归档 manifest 不入 Git；每次 build 重新生成。本地 npm run dev 明确为未发布。
5. staging 脚本只生成和构建独立候选；正式 PowerShell 发布入口使用同一归档生成器。本次仅修改并离线验证这些入口，未执行部署。

源归档须来自受信任的 Git 提交；manifest 是完整性证据，不是数字签名。独立审计者必须将其中 SHA 与远程分支以及 Git 文件哈希再核对。Windows 的自动换行转换可能导致直接 Git 目录字节校验失败，应优先使用 Git 归档构建，不得放宽校验。

## 消费者与失败行为

仓库内未发现版本接口的业务调用者；旧 API 契约已同步更新。外部 Hermes/部署探针若用 buildSha 识别源码，必须切换到 sourceGitSha；保留 buildSha 本身不会更改旧 marker。使用严格字段白名单的外部消费者需在独立验收中验证新增字段。

非法发布元数据返回 HTTP 503、releaseStatus=invalid、sourceGitSha=null；不回退 BUILD_SHA。development 产物在运行环境声明 formal/staging 时同样返回 503。合法发布元数据固定在产物中；重建同一提交可有新的构建时间和 releaseId。

定向测试：`node --test tests/version-metadata.test.mjs`。全量测试：先 npm run build，再 `node --test tests/*.test.mjs`。测试使用临时 Git 仓库及本地合成数据，不连接业务数据库。
