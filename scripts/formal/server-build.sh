#!/usr/bin/env bash
# Runs a clean build inside a known Node image without root-owned host artifacts.
set -euo pipefail
worktree="${1:?worktree required}"
image="${2:?build image required}"
test -d "$worktree"
uid="$(id -u)"; gid="$(id -g)"
rm -rf "$worktree/node_modules" "$worktree/dist"
mkdir -p "$worktree/.npm-cache"
docker run --rm --user "$uid:$gid" -e NODE_ENV=production -e NPM_CONFIG_INCLUDE=dev -e npm_config_cache=/work/.npm-cache \
  -v "$worktree:/work" -w /work --entrypoint sh "$image" -c '
    set -eu
    export PATH=/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
    npm ci --include=dev
    test -f node_modules/vinext/dist/cli.js
    npm run build
    npm run lint
    node --test tests/*.test.mjs
  '
