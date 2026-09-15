#!/usr/bin/env bash
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$ROOT"
source scripts/formal/lib.sh
RELEASE_ID="${1:-}"
[[ "$RELEASE_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$ ]] || die "invalid release id"
assert_mutation_approval

# Credentials stay in the existing server-side PostgreSQL container.  No secret
# is copied to this worktree, the archive, command output, or Kubernetes YAML.
remote "set -euo pipefail; out='/var/lib/quarterly-recon/postgres/backups/releases/$RELEASE_ID'; sudo install -d -m 0700 -o \$(id -u) -g \$(id -g) \"\$out\"; docker inspect '$FORMAL_POSTGRES_CONTAINER' >/dev/null; docker exec '$FORMAL_POSTGRES_CONTAINER' pg_dump -U postgres -d quarterly_recon -Fc > \"\$out/quarterly_recon.dump\"; sha256sum \"\$out/quarterly_recon.dump\" > \"\$out/quarterly_recon.dump.sha256\"; sudo k3s kubectl -n '$FORMAL_NAMESPACE' get deployment '$FORMAL_DEPLOYMENT' -o yaml > \"\$out/deployment.yaml\"; sudo k3s kubectl -n '$FORMAL_NAMESPACE' get deployment '$FORMAL_DEPLOYMENT' -o jsonpath='{.spec.template.spec.containers[0].image}' > \"\$out/previous-image.txt\"; sha256sum -c \"\$out/quarterly_recon.dump.sha256\"; printf '%s\\n' \"\$out\""
