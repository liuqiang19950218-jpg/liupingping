#!/usr/bin/env bash
# Shared safeguards for formal release commands.  Do not put credentials here.
set -euo pipefail

FORMAL_NAMESPACE="${FORMAL_NAMESPACE:-quarterly-recon}"
FORMAL_DEPLOYMENT="${FORMAL_DEPLOYMENT:-quarterly-recon}"
FORMAL_CONTAINER="${FORMAL_CONTAINER:-web}"
FORMAL_URL="${FORMAL_URL:-http://192.168.51.182:8000}"
FORMAL_REMOTE_ROOT="${FORMAL_REMOTE_ROOT:-/home/liupp/apps/quarterly-recon}"
FORMAL_POSTGRES_CONTAINER="${FORMAL_POSTGRES_CONTAINER:-quarterly-postgres}"

die() { echo "FORMAL_RELEASE_BLOCKED: $*" >&2; exit 1; }
note() { echo "[formal] $*"; }

require_command() { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }

validate_sha() {
  [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]] || die "target must be an exact 40-character lowercase Git SHA";
}

assert_mutation_approval() {
  [[ "${FORMAL_RELEASE_APPROVED:-}" == "YES" ]] || die "set FORMAL_RELEASE_APPROVED=YES only after an explicitly approved formal release"
  [[ "${FORMAL_RELEASE_ENV:-}" == "formal" ]] || die "set FORMAL_RELEASE_ENV=formal; staging values are never accepted"
  [[ "${FORMAL_SSH_TARGET:-}" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$ ]] || die "FORMAL_SSH_TARGET must be configured as user@host"
  [[ "$FORMAL_REMOTE_ROOT" == /home/*/apps/quarterly-recon ]] || die "unsafe FORMAL_REMOTE_ROOT"
}

remote() {
  require_command ssh
  ssh "${FORMAL_SSH_TARGET:?FORMAL_SSH_TARGET is required}" "$@"
}

version_json() {
  require_command curl
  curl --fail --silent --show-error --max-time 30 "$FORMAL_URL/api/version"
}

json_field() {
  local field="$1"
  node -e 'const field=process.argv[1]; let text=""; process.stdin.on("data", d => text += d); process.stdin.on("end", () => { const value=JSON.parse(text)[field]; if (typeof value !== "string") process.exit(2); process.stdout.write(value); });' "$field"
}
