#!/usr/bin/env bash
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$ROOT"
source scripts/formal/lib.sh

if [[ "${1:-}" == "--help" || -z "${1:-}" ]]; then
  echo "Usage: FORMAL_RELEASE_APPROVED=YES FORMAL_RELEASE_ENV=formal FORMAL_SSH_TARGET=user@host ./scripts/formal/release.sh <exact-40-char-git-sha>"
  exit 0
fi
TARGET="$1"; validate_sha "$TARGET"
assert_mutation_approval

scripts/formal/precheck.sh "$TARGET"
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-${TARGET:0:12}"
ARCHIVE="$(mktemp "${TMPDIR:-/tmp}/quarterly-recon-${RELEASE_ID}.XXXXXX.tgz")"
trap 'rm -f "$ARCHIVE"' EXIT
git archive --format=tar.gz --output="$ARCHIVE" "$TARGET"
remote "set -euo pipefail; install -d -m 0750 '$FORMAL_REMOTE_ROOT/releases/$RELEASE_ID'"
require_command scp
scp "$ARCHIVE" "$FORMAL_SSH_TARGET:$FORMAL_REMOTE_ROOT/releases/$RELEASE_ID/application.tgz"
remote "set -euo pipefail; cd '$FORMAL_REMOTE_ROOT/releases/$RELEASE_ID'; tar -xzf application.tgz"

CURRENT_JSON="$(version_json)"; BASE="$(printf '%s' "$CURRENT_JSON" | json_field buildSha)"
scripts/formal/backup-db.sh "$RELEASE_ID"
scripts/formal/apply-migrations.sh "$TARGET" "$BASE" "$RELEASE_ID"
scripts/formal/build.sh "$RELEASE_ID" "$TARGET"
scripts/formal/deploy.sh "$RELEASE_ID" "${TARGET:0:12}"
scripts/formal/postcheck.sh "$TARGET" "$RELEASE_ID"
printf 'FORMAL_DEPLOYED=YES\nTARGET_SHA=%s\n' "$TARGET"
