-- 为 Web/API 运行时账号建立最小权限访问层。
-- 注意：quarterly_app 由服务器基础设施预先创建。
-- 本迁移不创建账号、不修改密码、不提升权限，只对既有账号授权。

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'quarterly_app'
  ) THEN
    RAISE EXCEPTION 'Role quarterly_app does not exist. Create it via infrastructure before running 002_runtime_access.';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE quarterly_recon TO quarterly_app;
GRANT USAGE ON SCHEMA recon TO quarterly_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA recon TO quarterly_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA recon TO quarterly_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA recon
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO quarterly_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA recon
  GRANT USAGE, SELECT ON SEQUENCES TO quarterly_app;

INSERT INTO recon.schema_migrations (version)
VALUES ('002_runtime_access')
ON CONFLICT (version) DO NOTHING;
