# 182 服务器基础设施

本目录用于在 `192.168.51.182` 的 k3s 中部署独立的数据服务。生产访问地址仍为
`http://192.168.51.182:8000`，不设独立测试地址。

## 组件

- PostgreSQL 16：结构化业务数据与审计数据
- Redis 7：会话、缓存、短时锁和任务状态
- MinIO：Excel、图片、录音及导出文件
- PostgreSQL CronJob：每日逻辑备份，保留 30 天

所有持久卷均固定在 `/var/lib/quarterly-recon` 下，与应用镜像和应用 Pod 分离。

## 首次部署顺序

1. 推荐执行 `infra/scripts/bootstrap-secrets.sh`，在 k3s Secret 中自动生成强密码；脚本不会输出密码。
2. `kubectl apply -f infra/k8s/00-namespace.yaml`
3. 应用服务器侧私密清单（严禁提交 Git）。
4. 依次应用 `10-postgresql.yaml`、`20-redis.yaml`、`30-minio.yaml`。
5. 等待 StatefulSet Ready 后创建迁移 ConfigMap，再执行 `50-db-migrate.yaml`。
6. 应用 `40-postgresql-backup.yaml`。

推荐从本机 PowerShell 执行（脚本会硬性校验目标只能是 `192.168.51.182:8000`）：

```powershell
Copy-Item deploy.production.config.example.psd1 deploy.production.config.psd1
.\scripts\deploy-production.ps1 preflight
.\scripts\deploy-production.ps1 foundation
```

本机私有配置已加入 `.gitignore`，不保存密码；SSH 密码由终端交互输入。也可以在
182 服务器的仓库目录执行：

```sh
sh infra/scripts/bootstrap-secrets.sh
sh infra/scripts/apply-foundation.sh
sh infra/scripts/verify-foundation.sh
```

如需人工维护 `01-secrets.yaml`，该文件也已加入 `.gitignore`，不得提交真实密码。部署脚本只创建或升级
独立数据服务，不会切换当前应用，也不会删除现有 Wrangler、本机浏览器数据。

## 数据安全约束

- 不自动清理现有 `.wrangler`、浏览器 localStorage 或 IndexedDB 数据。
- 旧数据迁移前先做原始快照、记录总数和 SHA-256 清单。
- 金额空值保持 `NULL`，不能转成 `0`；未填写发票号的差额不参与往来发票核验。
- 迁移按批次幂等执行，失败批次可回滚，旧数据保持可读。
