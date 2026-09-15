#!/usr/bin/env bash
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$ROOT"
source scripts/formal/lib.sh

TARGET="${1:-}"
validate_sha "$TARGET"
require_command git
require_command npm
require_command node

[[ -z "$(git status --porcelain --untracked-files=all)" ]] || die "worktree is not clean"
[[ "$(git rev-parse HEAD)" == "$TARGET" ]] || die "HEAD does not equal target SHA"
git cat-file -e "$TARGET^{commit}" || die "target SHA is not a local commit"
git ls-remote origin | awk -v sha="$TARGET" '$1 == sha { found=1 } END { exit found ? 0 : 1 }' || die "target SHA does not exist on origin"
git diff --check "$TARGET^" "$TARGET"

CURRENT_JSON="$(version_json)"
CURRENT_SHA="$(printf '%s' "$CURRENT_JSON" | json_field buildSha)"
CURRENT_ENV="$(printf '%s' "$CURRENT_JSON" | json_field environment)"
[[ "$CURRENT_ENV" == "formal" ]] || die "formal /api/version did not report environment=formal"
validate_sha "$CURRENT_SHA"
git cat-file -e "$CURRENT_SHA^{commit}" 2>/dev/null || die "current formal build SHA is not available locally; fetch its exact origin ref before release"
git merge-base --is-ancestor "$CURRENT_SHA" "$TARGET" || die "target is not a descendant of current formal build SHA"

note "npm ci --include=dev"
npm ci --include=dev
note "npm run build"
npm run build
note "npm run lint"
npm run lint
note "node --test tests/*.test.mjs"
node --test tests/*.test.mjs

printf 'FORMAL_PRECHECK=PASS\nTARGET_SHA=%s\nCURRENT_FORMAL_SHA=%s\n' "$TARGET" "$CURRENT_SHA"
