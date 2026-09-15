import { spawnSync } from "node:child_process";

export const FORMAL_HOST = process.env.FORMAL_SSH_TARGET || "liupp@192.168.51.182";
export const exactSha = (value) => /^[0-9a-f]{40}$/.test(value || "");
export function requireApproval() {
  if (process.env.FORMAL_RELEASE_APPROVED !== "YES" || process.env.FORMAL_RELEASE_ENV !== "formal") {
    throw new Error("FORMAL_RELEASE_BLOCKED: explicit FORMAL_RELEASE_APPROVED=YES and FORMAL_RELEASE_ENV=formal are required");
  }
}
export function noSecret(text) {
  if (/postgres(?:ql)?:\/\/[^\s]*:[^\s@]+@|DATABASE_URL\s*=\s*\S+/i.test(text)) throw new Error("FORMAL_RELEASE_BLOCKED: secret-looking output is prohibited");
  return text;
}
export function remote(command, { write = false, dryRun = false } = {}) {
  if (write) requireApproval();
  if (dryRun) return { status: 0, stdout: `DRY_RUN_REMOTE=${command}\n`, stderr: "" };
  const result = spawnSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", FORMAL_HOST, command], { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`remote command failed: ${result.stderr || result.error?.message || result.status}`);
  return { status: 0, stdout: noSecret(result.stdout), stderr: result.stderr };
}
