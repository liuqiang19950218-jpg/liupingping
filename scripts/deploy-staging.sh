#!/bin/sh
# Deploy staging on port 8001 backed by the PostgreSQL test database (READ ONLY runtime).
# Usage: BUILD_SHA is derived from the current git HEAD unless already set.
set -eu
cd "$(dirname "$0")/.."

export ENVIRONMENT="${ENVIRONMENT:-staging}"
export BUILD_SHA="${BUILD_SHA:-$(git rev-parse HEAD)}"
export BUILD_TIME="${BUILD_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

echo "BUILD_SHA=$BUILD_SHA"
echo "BUILD_TIME=$BUILD_TIME"
echo "ENVIRONMENT=$ENVIRONMENT"

echo "==> npm run build"
npm run build

echo "==> staging ready: run with DATABASE_URL=<test db> and:"
echo "    npx wrangler dev --config dist/server/wrangler.json --ip 0.0.0.0 --port 8001 --persist-to .wrangler"
