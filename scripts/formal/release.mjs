import { exactSha, requireApproval, remote } from "./remote.mjs";

const target = process.argv[2];
if (!exactSha(target)) throw new Error("target must be an exact lowercase 40-character SHA");
requireApproval();

const serverPath = (name) => {
  const value = process.env[name];
  if (!/^\/[A-Za-z0-9._/-]+$/.test(value || "")) {
    throw new Error(`FORMAL_RELEASE_BLOCKED: ${name} must be an absolute server path using only safe path characters`);
  }
  return value;
};

// These are deliberately explicit inputs. The caller's cwd is never a source
// of release code, and a release directory is not a durable Git repository.
const gitRoot = serverPath("FORMAL_GIT_ROOT");
const releaseRoot = serverPath("FORMAL_RELEASE_ROOT");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const release = `${stamp}-${target.slice(0, 12)}`;
// The server owns the worktree, runtime env, Docker/k3s tools, and DB credentials.
// This command intentionally never transmits DATABASE_URL or any other secret.
const command = `set -euo pipefail; git_root='${gitRoot}'; release_root='${releaseRoot}'; release="$release_root/${release}"; src="$release/src"; git -C "$git_root" rev-parse --git-dir >/dev/null; test -z "$(git -C "$git_root" status --porcelain)"; git -C "$git_root" fetch origin; git -C "$git_root" cat-file -e '${target}^{commit}'; mkdir -p "$release"; git -C "$git_root" worktree add --detach "$src" ${target}; context_sha=$(git -C "$src" rev-parse HEAD); test "$context_sha" = "${target}"; test -z "$(git -C "$src" status --porcelain)"; test -f "$src/Dockerfile.offline"; echo FORMAL_GIT_ROOT="$git_root"; echo RELEASE_ROOT="$release_root"; echo BUILD_CONTEXT_PATH="$src"; echo BUILD_CONTEXT_SHA="$context_sha"; "$src/scripts/formal/server-build.sh" "$src" "$(sudo k3s kubectl -n quarterly-recon get deploy quarterly-recon -o jsonpath='{.spec.template.spec.containers[0].image}')"; docker exec quarterly-postgres pg_dump -U postgres -d quarterly_recon -Fc > "$release/quarterly_recon.dump"; sha256sum "$release/quarterly_recon.dump" > "$release/quarterly_recon.dump.sha256"; image=quarterly-recon:prod-${release}; docker build -f "$src/Dockerfile.offline" --build-arg BASE_IMAGE=$(sudo k3s kubectl -n quarterly-recon get deploy quarterly-recon -o jsonpath='{.spec.template.spec.containers[0].image}') --build-arg BUILD_SHA=${target} --build-arg BUILD_TIME=${stamp} --build-arg ENVIRONMENT=formal -t "$image" "$src"; docker run --rm --entrypoint cat "$image" /app/release-metadata.json | grep -F "${target}"; docker save "$image" | sudo k3s ctr images import -; previous=$(sudo k3s kubectl -n quarterly-recon get deploy quarterly-recon -o jsonpath='{.spec.template.spec.containers[0].image}'); printf '%s' "$previous" > "$release/previous-image.txt"; sudo k3s kubectl -n quarterly-recon set image deploy/quarterly-recon web="$image"; sudo k3s kubectl -n quarterly-recon rollout status deploy/quarterly-recon --timeout=420s`;
const dryRun = process.env.FORMAL_RELEASE_DRY_RUN === "YES";
const result = remote(command, { write: true, dryRun });
if (dryRun) process.stdout.write(result.stdout);
console.log(`FORMAL_RELEASE_DISPATCHED=YES\nRELEASE=${release}\nTARGET_SHA=${target}`);
