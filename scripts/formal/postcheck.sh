#!/usr/bin/env bash
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$ROOT"
source scripts/formal/lib.sh
TARGET="${1:-}"; RELEASE_ID="${2:-}"
validate_sha "$TARGET"
[[ "$RELEASE_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$ ]] || die "invalid release id"
assert_mutation_approval

JSON="$(version_json)"
SHA="$(printf '%s' "$JSON" | json_field buildSha)"
ENVIRONMENT="$(printf '%s' "$JSON" | json_field environment)"
[[ "$SHA" == "$TARGET" ]] || die "/api/version buildSha does not match target"
[[ "$ENVIRONMENT" == "formal" ]] || die "/api/version environment is not formal"
remote "set -euo pipefail; sudo k3s kubectl -n '$FORMAL_NAMESPACE' get deployment '$FORMAL_DEPLOYMENT' -o jsonpath='{.status.readyReplicas}/{.status.replicas}' | grep -qx '1/1'; docker exec '$FORMAL_POSTGRES_CONTAINER' psql -v ON_ERROR_STOP=1 -U postgres -d quarterly_recon -Atqc 'select count(*) from recon.schema_migrations' | grep -Eq '^[1-9][0-9]*$'"
printf 'FORMAL_POSTCHECK=PASS\nFORMAL_VERSION=%s\n' "$JSON"
