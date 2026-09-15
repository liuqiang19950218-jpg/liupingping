import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { spawnSync } from "node:child_process";

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

test("data task manifest requires scope, hash, rows, and gates", () => {
  const result = spawnSync(process.execPath, ["scripts/formal/validate-data-manifest.mjs", "tests/fixtures/formal-data-task.valid.json"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DATA_TASK_MANIFEST=VALID/);
  const invalid = spawnSync(process.execPath, ["scripts/formal/validate-data-manifest.mjs", "tests/fixtures/formal-data-task.invalid.json"], { encoding: "utf8" });
  assert.notEqual(invalid.status, 0);
});
