#!/usr/bin/env bash
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$ROOT"
source scripts/formal/lib.sh
RELEASE_ID="${1:-}"
[[ "$RELEASE_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$ ]] || die "invalid release id"
assert_mutation_approval

# Runtime-only rollback: retain the post-release database as evidence.  A DB
# restore is a separately approved recovery operation and is never automatic.
remote "set -euo pipefail; backup='/var/lib/quarterly-recon/postgres/backups/releases/$RELEASE_ID'; test -s \"\$backup/previous-image.txt\"; image=\$(cat \"\$backup/previous-image.txt\"); test -n \"\$image\"; sudo k3s kubectl -n '$FORMAL_NAMESPACE' set image deployment/'$FORMAL_DEPLOYMENT' '$FORMAL_CONTAINER='\"\$image\"; sudo k3s kubectl -n '$FORMAL_NAMESPACE' rollout status deployment/'$FORMAL_DEPLOYMENT' --timeout=420s; sudo k3s kubectl -n '$FORMAL_NAMESPACE' get deployment '$FORMAL_DEPLOYMENT' -o jsonpath='{.status.readyReplicas}/{.status.replicas}' | grep -qx '1/1'"
printf 'FORMAL_RUNTIME_ROLLBACK=PASS\nRELEASE_ID=%s\n' "$RELEASE_ID"
