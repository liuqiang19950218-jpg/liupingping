#!/bin/sh
# Build a staging Git archive. Does not start, replace, or deploy any service.
set -eu
cd "$(dirname "$0")/.."

artifact_dir=$(mktemp -d "${TMPDIR:-/tmp}/recon-staging-XXXXXXXX")
node scripts/prepare-release.mjs --environment staging --archive "$artifact_dir/application.tgz"
mkdir "$artifact_dir/source"
tar -xzf "$artifact_dir/application.tgz" -C "$artifact_dir/source"
cd "$artifact_dir/source"
npm ci
ENVIRONMENT=staging npm run build
printf 'Staging build ready for independent acceptance: %s\n' "$artifact_dir/source"
