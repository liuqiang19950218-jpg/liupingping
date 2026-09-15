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
  const dockerignore = readFileSync(".dockerignore", "utf8");
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
  assert.match(dockerignore, /^\.npm-cache$/m);
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

test("staging runner uses the durable Git root and an exact worktree", () => {
  const staging = readFileSync("scripts/formal/staging.mjs", "utf8");
  assert.match(staging, /FORMAL_GIT_ROOT/);
  assert.match(staging, /STAGING_RELEASE_ROOT/);
  assert.match(staging, /STAGING_RUNTIME_ENV_FILE/);
  assert.match(staging, /git -C "\$git_root" worktree add --detach "\$src"/);
  assert.match(staging, /-f "\$src\/Dockerfile\.offline"/);
  assert.match(staging, /-t "\$image" "\$src"/);
  assert.match(staging, /port 8011/);
  assert.doesNotMatch(staging, /historical-dashboard-build/);
});

test("offline handoff is explicit and transfers verified Git objects", () => {
  const release = readFileSync("scripts/formal/release.mjs", "utf8");
  const staging = readFileSync("scripts/formal/staging.mjs", "utf8");
  const handoff = readFileSync("scripts/formal/offline-git-handoff.mjs", "utf8");
  for (const runner of [release, staging]) {
    assert.match(runner, /OFFLINE_EXACT_GIT_HANDOFF_APPROVED/);
    assert.match(runner, /OFFLINE_BUNDLE_VERIFIED/);
    assert.match(runner, /OFFLINE_VERIFIED_GIT_BUNDLE/);
    assert.match(runner, /REMOTE_FETCH_MODE/);
  }
  assert.match(handoff, /git", \["bundle", "create"/);
  assert.match(handoff, /git", \["bundle", "verify"/);
  assert.match(handoff, /createHash\("sha256"\)/);
  assert.match(handoff, /BUNDLE_TRANSFER_INTEGRITY=PASS/);
  assert.match(handoff, /SERVER_TARGET_COMMIT_AVAILABLE=YES/);
  assert.match(handoff, /git -C "\$root" fetch "\$bundle"/);
  assert.doesNotMatch(handoff, /zip|dist\//i);
});

test("data task manifest requires scope, hash, rows, and gates", () => {
  const result = spawnSync(process.execPath, ["scripts/formal/validate-data-manifest.mjs", "tests/fixtures/formal-data-task.valid.json"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DATA_TASK_MANIFEST=VALID/);
  const invalid = spawnSync(process.execPath, ["scripts/formal/validate-data-manifest.mjs", "tests/fixtures/formal-data-task.invalid.json"], { encoding: "utf8" });
  assert.notEqual(invalid.status, 0);
});
