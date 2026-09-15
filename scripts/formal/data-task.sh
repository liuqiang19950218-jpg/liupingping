#!/usr/bin/env bash
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$ROOT"
source scripts/formal/lib.sh
MANIFEST="${1:-}"
[[ -f "$MANIFEST" ]] || die "manifest file is required"
node scripts/formal/validate-data-manifest.mjs "$MANIFEST"
assert_mutation_approval
TASK_SCRIPT="$(node -e 'const x=require(process.argv[1]); process.stdout.write(x.taskScript)' "$MANIFEST")"
[[ "$TASK_SCRIPT" =~ ^scripts/data-tasks/[A-Za-z0-9_-]+\.sh$ ]] || die "taskScript must be a versioned scripts/data-tasks/*.sh path"
git ls-files --error-unmatch "$TASK_SCRIPT" >/dev/null || die "taskScript must be tracked by Git"
for phase in pre backup transaction post audit; do "$TASK_SCRIPT" "$phase" "$MANIFEST"; done
printf 'FORMAL_DATA_TASK=PASS\nMANIFEST=%s\n' "$MANIFEST"
