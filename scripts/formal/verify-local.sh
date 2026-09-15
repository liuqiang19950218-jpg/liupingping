#!/usr/bin/env bash
# Safe local/staging quality gate.  It has no database, SSH, Docker, or kubectl action.
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$ROOT"
npm ci --include=dev
npm run build
npm run lint
node --test tests/*.test.mjs
printf 'FORMAL_PIPELINE_LOCAL_GATE=PASS\n'
