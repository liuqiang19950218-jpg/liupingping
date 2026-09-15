import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { FORMAL_HOST, exactSha, remote } from "./remote.mjs";

const target = process.argv[2];
if (!exactSha(target)) throw new Error("target must be an exact lowercase 40-character SHA");
const branch = process.env.FORMAL_RELEASE_BRANCH || "feature/historical-quarter-settlement-dashboard";
const safeServerPath = (name) => {
  const value = process.env[name];
  if (!/^\/[A-Za-z0-9._/-]+$/.test(value || "")) throw new Error(`OFFLINE_HANDOFF_BLOCKED: ${name} must be an absolute server path using only safe path characters`);
  return value;
};
const gitRoot = safeServerPath("FORMAL_GIT_ROOT");
const incomingRoot = safeServerPath("OFFLINE_BUNDLE_INCOMING_ROOT");
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.error?.message || result.status}`);
  return result.stdout;
};
const repository = run("git", ["rev-parse", "--show-toplevel"]).trim();
run("git", ["fetch", "origin"], { cwd: repository });
const localHead = run("git", ["rev-parse", "HEAD"], { cwd: repository }).trim();
const remoteHead = run("git", ["rev-parse", `origin/${branch}`], { cwd: repository }).trim();
if (localHead !== target || remoteHead !== target) throw new Error("OFFLINE_HANDOFF_BLOCKED: local HEAD and GitHub remote branch must both equal target");

const short = target.slice(0, 12);
const ref = `refs/codex-release/${short}`;
const temp = mkdtempSync(join(tmpdir(), "codex-offline-git-"));
const bundle = join(temp, `quarterly-recon-${target}.bundle`);
const serverBundle = `${incomingRoot}/quarterly-recon-${target}.bundle`;
try {
  const existing = spawnSync("git", ["show-ref", "--verify", "--quiet", ref], { cwd: repository });
  if (existing.status === 0) throw new Error(`OFFLINE_HANDOFF_BLOCKED: temporary release ref already exists: ${ref}`);
  run("git", ["update-ref", ref, target], { cwd: repository });
  run("git", ["bundle", "create", bundle, ref], { cwd: repository });
  run("git", ["bundle", "verify", bundle], { cwd: repository });
  if (!run("git", ["bundle", "list-heads", bundle], { cwd: repository }).includes(`${target} ${ref}`)) {
    throw new Error("OFFLINE_HANDOFF_BLOCKED: bundle does not contain the exact release ref");
  }
  const bundleSha256 = createHash("sha256").update(readFileSync(bundle)).digest("hex");
  remote(`set -euo pipefail; mkdir -p '${incomingRoot}'; test ! -e '${serverBundle}'`);
  run("scp", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", bundle, `${FORMAL_HOST}:${serverBundle}`]);
  const imported = remote(`set -euo pipefail; root='${gitRoot}'; bundle='${serverBundle}'; expected='${bundleSha256}'; test "$(sha256sum "$bundle" | awk '{print $1}')" = "$expected"; git -C "$root" rev-parse --git-dir >/dev/null; git -C "$root" fetch "$bundle" '${ref}:${ref}'; git -C "$root" cat-file -e '${target}^{commit}'; actual=$(git -C "$root" show -s --format=%H '${target}'); test "$actual" = '${target}'; echo BUNDLE_TRANSFER_INTEGRITY=PASS; echo SERVER_TARGET_COMMIT_AVAILABLE=YES; echo BUNDLE_SHA256="$expected"; echo SOURCE_ACQUISITION_MODE=OFFLINE_VERIFIED_GIT_BUNDLE`);
  process.stdout.write(`WINDOWS_REMOTE_SHA_VERIFIED=YES\nBUNDLE_SHA256=${bundleSha256}\n${imported.stdout}`);
} finally {
  spawnSync("git", ["update-ref", "-d", ref], { cwd: repository });
  rmSync(temp, { recursive: true, force: true });
}
