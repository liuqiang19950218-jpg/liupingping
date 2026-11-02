#!/bin/sh
set -eu

NAMESPACE="quarterly-recon"
SECRET_NAME="quarterly-recon-data-secrets"

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl 未安装或不在 PATH 中。" >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl 未安装，无法安全生成生产密码。" >&2
  exit 1
fi

kubectl apply -f "$(CDPATH= cd -- "$(dirname -- "$0")/../k8s" && pwd)/00-namespace.yaml"

if kubectl -n "$NAMESPACE" get secret "$SECRET_NAME" >/dev/null 2>&1; then
  echo "生产密钥已存在，保持原值不变。"
  exit 0
fi

POSTGRES_PASSWORD="$(openssl rand -hex 24)"
REDIS_PASSWORD="$(openssl rand -hex 24)"
MINIO_PASSWORD="$(openssl rand -hex 24)"
SESSION_SECRET="$(openssl rand -hex 32)"

kubectl -n "$NAMESPACE" create secret generic "$SECRET_NAME" \
  --from-literal=POSTGRES_DB=quarterly_recon \
  --from-literal=POSTGRES_USER=quarterly_recon \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --from-literal=DATABASE_URL="postgresql://quarterly_recon:${POSTGRES_PASSWORD}@quarterly-recon-postgresql:5432/quarterly_recon" \
  --from-literal=REDIS_PASSWORD="$REDIS_PASSWORD" \
  --from-literal=REDIS_URL="redis://:${REDIS_PASSWORD}@quarterly-recon-redis:6379/0" \
  --from-literal=MINIO_ROOT_USER=quarterly_recon \
  --from-literal=MINIO_ROOT_PASSWORD="$MINIO_PASSWORD" \
  --from-literal=MINIO_ENDPOINT="http://quarterly-recon-minio:9000" \
  --from-literal=MINIO_BUCKET=quarterly-recon \
  --from-literal=SESSION_SECRET="$SESSION_SECRET"

unset POSTGRES_PASSWORD REDIS_PASSWORD MINIO_PASSWORD SESSION_SECRET
echo "生产密钥已在 k3s Secret 中创建；脚本未输出任何密码。"
