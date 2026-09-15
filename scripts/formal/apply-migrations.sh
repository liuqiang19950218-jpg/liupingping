#!/usr/bin/env bash
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$ROOT"
source scripts/formal/lib.sh
TARGET="${1:-}"
BASE="${2:-}"
RELEASE_ID="${3:-}"
validate_sha "$TARGET"; validate_sha "$BASE"
[[ "$RELEASE_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$ ]] || die "invalid release id"
assert_mutation_approval

mapfile -t migrations < <(git diff --name-only --diff-filter=A "$BASE" "$TARGET" -- infra/postgres/migrations | sort)
for file in "${migrations[@]}"; do
  [[ "$file" =~ ^infra/postgres/migrations/[0-9]{3}_[A-Za-z0-9_]+\.sql$ ]] || die "illegal migration filename: $file"
  grep -q 'INSERT INTO recon.schema_migrations' "$file" || die "migration lacks schema_migrations marker: $file"
done

if [[ ${#migrations[@]} -eq 0 ]]; then
  note "No new Git migrations between formal SHA and target."
  exit 0
fi

remote "set -euo pipefail; release='$FORMAL_REMOTE_ROOT/releases/$RELEASE_ID'; test -d \"\$release\"; docker inspect '$FORMAL_POSTGRES_CONTAINER' >/dev/null; $(for file in "${migrations[@]}"; do printf 'docker exec -i %q psql -v ON_ERROR_STOP=1 -U postgres -d quarterly_recon < %q; ' "$FORMAL_POSTGRES_CONTAINER" "\$release/$file"; done)"
for file in "${migrations[@]}"; do
  version="${file##*/}"; version="${version%.sql}"
  remote "set -euo pipefail; docker exec '$FORMAL_POSTGRES_CONTAINER' psql -v ON_ERROR_STOP=1 -U postgres -d quarterly_recon -Atqc \"select 1 from recon.schema_migrations where version = '$version'\" | grep -qx 1"
done
printf 'FORMAL_MIGRATIONS=PASS\n'
