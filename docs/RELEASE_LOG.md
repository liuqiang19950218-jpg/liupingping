# 生产发布记录

## 2026-08-21

- 生产地址：`http://192.168.51.182:8000`
- 部署方式：k3s，单副本 Deployment，hostPort 对外提供 8000 端口。
- 生产镜像：`quarterly-recon:prod-20260821-101423`
- 部署状态：Deployment `1/1`，Pod `Running`，无重启。
- 健康检查：首页与 `/api/local-state` 均返回 HTTP 200。
- 数据备份：`/home/liupp/apps/quarterly-recon/backups/wrangler-20260821-100111.tgz`
- 代码提交：`cc6e242`、`1e6c08c`、`71d9289`
- 技术检查：TypeScript、构建、渲染测试通过；ESLint 无 error。

### 尚未完成

- GitHub 账号尚未在本机授权，因此上述提交尚未推送远端。
- 服务器共享快照当前为空；需要从保存原始数据的浏览器执行一次 `?syncServer=1` 数据同步。
- PostgreSQL、Redis、MinIO 尚未成为应用正式数据源，当前生产仍使用 Wrangler 持久目录与服务器快照过渡方案。

### 数据迁移安全要求

- 迁移前只允许读取、备份和校验，不清空旧浏览器数据或生产 Wrangler 数据。
- 必须核对各季度记录数、客户数、金额合计、空值语义、差额发票与跟进状态后，才能切换正式数据库。
- 数据库切换必须保留可回滚的旧生产镜像和部署前备份。
