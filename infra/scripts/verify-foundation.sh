#!/bin/sh
set -eu

NAMESPACE="quarterly-recon"

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl 未安装或不在 PATH 中。" >&2
  exit 1
fi

kubectl -n "$NAMESPACE" get statefulset quarterly-recon-postgresql quarterly-recon-redis quarterly-recon-minio
kubectl -n "$NAMESPACE" get service quarterly-recon-postgresql quarterly-recon-redis quarterly-recon-minio
kubectl -n "$NAMESPACE" get cronjob quarterly-recon-postgresql-backup

postgres_pod="$(kubectl -n "$NAMESPACE" get pod -l app=quarterly-recon-postgresql -o jsonpath='{.items[0].metadata.name}')"
redis_pod="$(kubectl -n "$NAMESPACE" get pod -l app=quarterly-recon-redis -o jsonpath='{.items[0].metadata.name}')"
minio_pod="$(kubectl -n "$NAMESPACE" get pod -l app=quarterly-recon-minio -o jsonpath='{.items[0].metadata.name}')"

kubectl -n "$NAMESPACE" exec "$postgres_pod" -- sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "select version, applied_at from recon.schema_migrations order by applied_at;"'

kubectl -n "$NAMESPACE" exec "$redis_pod" -- sh -c \
  'redis-cli -a "$REDIS_PASSWORD" ping'

kubectl -n "$NAMESPACE" get pod "$minio_pod" -o jsonpath='{.status.containerStatuses[0].ready}'
echo

echo "基础设施只读校验完成。"
