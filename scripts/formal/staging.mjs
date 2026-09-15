import { exactSha, remote } from "./remote.mjs";

const target = process.argv[2];
if (!exactSha(target)) throw new Error("target must be an exact lowercase 40-character SHA");

const serverPath = (name) => {
  const value = process.env[name];
  if (!/^\/[A-Za-z0-9._/-]+$/.test(value || "")) {
    throw new Error(`STAGING_RELEASE_BLOCKED: ${name} must be an absolute server path using only safe path characters`);
  }
  return value;
};

// Source, release worktrees, and the staging runtime configuration are separate.
const gitRoot = serverPath("FORMAL_GIT_ROOT");
const releaseRoot = serverPath("STAGING_RELEASE_ROOT");
const runtimeEnv = serverPath("STAGING_RUNTIME_ENV_FILE");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const release = `${stamp}-${target.slice(0, 12)}`;
const command = `set -euo pipefail; git_root='${gitRoot}'; release_root='${releaseRoot}'; runtime_env='${runtimeEnv}'; release="$release_root/${release}"; src="$release/src"; test -f "$runtime_env"; git -C "$git_root" rev-parse --git-dir >/dev/null; test -z "$(git -C "$git_root" status --porcelain)"; git -C "$git_root" fetch origin; git -C "$git_root" cat-file -e '${target}^{commit}'; mkdir -p "$release"; git -C "$git_root" worktree add --detach "$src" ${target}; context_sha=$(git -C "$src" rev-parse HEAD); test "$context_sha" = "${target}"; test -z "$(git -C "$src" status --porcelain)"; test -f "$src/Dockerfile.offline"; echo FORMAL_GIT_ROOT="$git_root"; echo STAGING_RELEASE_ROOT="$release_root"; echo BUILD_CONTEXT_PATH="$src"; echo BUILD_CONTEXT_SHA="$context_sha"; base_image=$(docker inspect quarterly-recon-codex-pipeline --format '{{.Config.Image}}'); "$src/scripts/formal/server-build.sh" "$src" "$base_image"; image=quarterly-recon:staging-${release}; docker build -f "$src/Dockerfile.offline" --build-arg BASE_IMAGE="$base_image" --build-arg BUILD_SHA=${target} --build-arg BUILD_TIME=${stamp} --build-arg ENVIRONMENT=staging -t "$image" "$src"; docker run --rm --entrypoint cat "$image" /app/release-metadata.json | grep -F "${target}"; docker rm -f quarterly-recon-codex-pipeline >/dev/null 2>&1 || true; docker run -d --name quarterly-recon-codex-pipeline --network host --restart unless-stopped -e NODE_ENV=production -v "$runtime_env:/app/.env.runtime:ro" "$image" npx wrangler dev --config dist/server/wrangler.json --ip 0.0.0.0 --port 8011 --persist-to .wrangler --env-file /app/.env.runtime >/dev/null; for attempt in $(seq 1 30); do version=$(curl -fsS http://127.0.0.1:8011/api/version || true); test -n "$version" && break; sleep 1; done; test -n "$version"; printf '%s\n' "$version"; echo STAGING_IMAGE="$image"`;
const dryRun = process.env.STAGING_RELEASE_DRY_RUN === "YES";
const result = remote(command, { dryRun });
if (dryRun) process.stdout.write(result.stdout);
console.log(`STAGING_RELEASE_DISPATCHED=YES\nRELEASE=${release}\nTARGET_SHA=${target}`);
