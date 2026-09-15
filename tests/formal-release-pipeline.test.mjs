import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const scripts = ["precheck.sh", "backup-db.sh", "build.sh", "apply-migrations.sh", "deploy.sh", "postcheck.sh", "release.sh", "data-task.sh", "rollback-runtime.sh"];
test("formal pipeline scripts have the required safeguards", () => {
  for (const name of scripts) {
    const path = `scripts/formal/${name}`;
    assert.equal(existsSync(path), true, `${path} exists`);
    const text = readFileSync(path, "utf8");
    assert.match(text, /set -euo pipefail/);
    if (name !== "precheck.sh") assert.match(text, /assert_mutation_approval|precheck\.sh/);
  }
  const release = readFileSync("scripts/formal/release.sh", "utf8");
  assert.match(release, /backup-db\.sh/);
  assert.match(release, /apply-migrations\.sh/);
  assert.match(release, /postcheck\.sh/);
  assert.match(release, /FORMAL_DEPLOYED=YES/);
  assert.match(readFileSync("scripts/formal/deploy.sh", "utf8"), /quarterly-recon-data-secrets:DATABASE_URL/);
  assert.match(readFileSync("scripts/formal/rollback-runtime.sh", "utf8"), /Runtime-only rollback/);
});

test("formal release builds only the exact release worktree", () => {
  const release = readFileSync("scripts/formal/release.mjs", "utf8");
  const dockerfile = readFileSync("Dockerfile.offline", "utf8");
  assert.match(release, /FORMAL_GIT_ROOT/);
  assert.match(release, /FORMAL_RELEASE_ROOT/);
  assert.match(release, /git -C \"\$git_root\" rev-parse --git-dir/);
  assert.match(release, /git -C \"\$git_root\" fetch origin/);
  assert.match(release, /git -C \"\$git_root\" cat-file -e/);
  assert.doesNotMatch(release, /\/home\/liupp\/apps\/quarterly-recon/);
  assert.match(release, /BUILD_CONTEXT_PATH/);
  assert.match(release, /BUILD_CONTEXT_SHA/);
  assert.match(release, /test -f "\$src\/Dockerfile\.offline"/);
  assert.match(release, /-t "\$image" "\$src"/);
  assert.match(release, /release-metadata\.json/);
  assert.match(dockerfile, /builtFrom.*exact-worktree/);
});

test("formal runner ignores caller cwd and fails closed on an invalid Git root", () => {
  const runner = `${process.cwd()}/scripts/formal/release.mjs`;
  const safeEnv = {
    ...process.env,
    FORMAL_RELEASE_APPROVED: "YES",
    FORMAL_RELEASE_ENV: "formal",
    FORMAL_RELEASE_DRY_RUN: "YES",
    FORMAL_GIT_ROOT: "/home/liupp/repos/quarterly-recon",
    FORMAL_RELEASE_ROOT: "/home/liupp/releases/quarterly-recon",
  };
  const result = spawnSync(process.execPath, [runner, "181ce04e300a121073c3611d58b626981c45b2f5"], { cwd: tmpdir(), env: safeEnv, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /git_root='\/home\/liupp\/repos\/quarterly-recon'/);
  assert.match(result.stdout, /release_root='\/home\/liupp\/releases\/quarterly-recon'/);

  const invalid = spawnSync(process.execPath, [runner, "181ce04e300a121073c3611d58b626981c45b2f5"], {
    cwd: tmpdir(),
    env: { ...safeEnv, FORMAL_GIT_ROOT: "relative-path" },
    encoding: "utf8",
  });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /FORMAL_RELEASE_BLOCKED: FORMAL_GIT_ROOT/);
});

test("data task manifest requires scope, hash, rows, and gates", () => {
  const result = spawnSync(process.execPath, ["scripts/formal/validate-data-manifest.mjs", "tests/fixtures/formal-data-task.valid.json"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DATA_TASK_MANIFEST=VALID/);
  const invalid = spawnSync(process.execPath, ["scripts/formal/validate-data-manifest.mjs", "tests/fixtures/formal-data-task.invalid.json"], { encoding: "utf8" });
  assert.notEqual(invalid.status, 0);
});
