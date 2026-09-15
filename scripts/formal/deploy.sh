#!/usr/bin/env bash
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$ROOT"
source scripts/formal/lib.sh
RELEASE_ID="${1:-}"; SHORT_SHA="${2:-}"
[[ "$RELEASE_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$ ]] || die "invalid release id"
[[ "$SHORT_SHA" =~ ^[0-9a-f]{12}$ ]] || die "invalid short SHA"
assert_mutation_approval
IMAGE="quarterly-recon:prod-$RELEASE_ID-$SHORT_SHA"

# Verify the live deployment consumes the existing formal secret by reference;
# neither this script nor the image receives a DATABASE_URL value.
remote "set -euo pipefail; env=\$(sudo k3s kubectl -n '$FORMAL_NAMESPACE' get deployment '$FORMAL_DEPLOYMENT' -o jsonpath='{range .spec.template.spec.containers[?(@.name==\"$FORMAL_CONTAINER\")].env[?(@.name==\"DATABASE_URL\")]}{.valueFrom.secretKeyRef.name}:{.valueFrom.secretKeyRef.key}{end}'); test \"\$env\" = 'quarterly-recon-data-secrets:DATABASE_URL'; sudo k3s kubectl -n '$FORMAL_NAMESPACE' set image deployment/'$FORMAL_DEPLOYMENT' '$FORMAL_CONTAINER=$IMAGE'; sudo k3s kubectl -n '$FORMAL_NAMESPACE' annotate deployment/'$FORMAL_DEPLOYMENT' deployment.quarterly-recon/release='$RELEASE_ID' --overwrite; sudo k3s kubectl -n '$FORMAL_NAMESPACE' rollout status deployment/'$FORMAL_DEPLOYMENT' --timeout=420s; sudo k3s kubectl -n '$FORMAL_NAMESPACE' get deployment '$FORMAL_DEPLOYMENT' -o jsonpath='{.status.readyReplicas}/{.status.replicas}' | grep -qx '1/1'; sudo k3s kubectl -n '$FORMAL_NAMESPACE' logs deployment/'$FORMAL_DEPLOYMENT' --tail=100"
