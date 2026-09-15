#!/usr/bin/env bash
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$ROOT"
source scripts/formal/lib.sh
RELEASE_ID="${1:-}"
TARGET="${2:-}"
[[ "$RELEASE_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$ ]] || die "invalid release id"
validate_sha "$TARGET"
assert_mutation_approval
SHORT_SHA="${TARGET:0:12}"

remote "set -euo pipefail; release='$FORMAL_REMOTE_ROOT/releases/$RELEASE_ID'; image=\"quarterly-recon:prod-$RELEASE_ID-$SHORT_SHA\"; current=\$(sudo k3s kubectl -n '$FORMAL_NAMESPACE' get deployment '$FORMAL_DEPLOYMENT' -o jsonpath='{.spec.template.spec.containers[0].image}'); test -n \"\$current\"; cd \"\$release\"; docker build -f Dockerfile.offline --build-arg BASE_IMAGE=\"\$current\" --build-arg BUILD_SHA='$TARGET' --build-arg BUILD_TIME='$RELEASE_ID' --build-arg ENVIRONMENT='formal' -t \"\$image\" .; docker save \"\$image\" | sudo k3s ctr images import -; printf '%s\\n' \"\$image\""
