#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
K8S_DIR="$ROOT_DIR/infra/k8s"
MIGRATION_DIR="$ROOT_DIR/infra/postgres/migrations"
NAMESPACE="quarterly-recon"
SECRET_FILE="$K8S_DIR/01-secrets.yaml"

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl 未安装或不在 PATH 中。" >&2
  exit 1
fi

kubectl apply -f "$K8S_DIR/00-namespace.yaml"

if [ -f "$SECRET_FILE" ]; then
  kubectl apply -f "$SECRET_FILE"
elif kubectl -n "$NAMESPACE" get secret quarterly-recon-data-secrets >/dev/null 2>&1; then
  echo "复用集群中已有的生产密钥。"
else
  echo "缺少生产密钥。请先执行 infra/scripts/bootstrap-secrets.sh。" >&2
  exit 1
fi
kubectl apply -f "$K8S_DIR/10-postgresql.yaml"
kubectl apply -f "$K8S_DIR/20-redis.yaml"
kubectl apply -f "$K8S_DIR/30-minio.yaml"

kubectl -n "$NAMESPACE" rollout status statefulset/quarterly-recon-postgresql --timeout=300s
kubectl -n "$NAMESPACE" rollout status statefulset/quarterly-recon-redis --timeout=300s
kubectl -n "$NAMESPACE" rollout status statefulset/quarterly-recon-minio --timeout=300s

kubectl -n "$NAMESPACE" create configmap quarterly-recon-db-migrations \
  --from-file="$MIGRATION_DIR" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n "$NAMESPACE" delete job quarterly-recon-db-migrate-v001 --ignore-not-found
kubectl apply -f "$K8S_DIR/50-db-migrate.yaml"
kubectl -n "$NAMESPACE" wait --for=condition=complete job/quarterly-recon-db-migrate-v001 --timeout=300s

kubectl apply -f "$K8S_DIR/40-postgresql-backup.yaml"

echo "基础数据服务已应用。请继续运行 infra/scripts/verify-foundation.sh。"
