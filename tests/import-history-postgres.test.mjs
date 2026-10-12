import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("import history reads every database batch instead of browser storage", async () => {
  const [dashboard, route, compatibility] = await Promise.all([
    readFile(new URL("../app/ImportDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/imports/history/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/import-history.ts", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /fetch\("\/api\/imports\/history", \{ cache: "no-store" \}\)/);
  assert.doesNotMatch(dashboard, /readImportHistory|backfillImportHistory|localStorage/);
  assert.match(route, /FROM recon\.import_batches b/);
  assert.match(route, /LEFT JOIN recon\.quarters/);
  assert.match(route, /LEFT JOIN recon\.users/);
  assert.match(route, /b\.source_sha256/);
  assert.match(route, /b\.error_count/);
  assert.doesNotMatch(route, /data_type = ANY/);
  assert.doesNotMatch(compatibility.slice(compatibility.indexOf("export function recordImport")), /localStorage\.setItem/);
});

test("database import fields remain visible after a dashboard reload", async () => {
  const dashboard = await readFile(new URL("../app/ImportDashboard.tsx", import.meta.url), "utf8");

  for (const field of [
    "fileName",
    "dataType",
    "importedAt",
    "operator",
    "validRecordCount",
    "status",
    "sourceSha256",
  ]) {
    assert.match(dashboard, new RegExp(field));
  }
  assert.match(dashboard, /window\.addEventListener\(IMPORT_HISTORY_UPDATED, refreshFromDatabase\)/);
});
