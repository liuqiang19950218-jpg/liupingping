import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("import mode loads reconciliation business data from PostgreSQL APIs", async () => {
  const source = await readFile(
    new URL("../app/QuarterlyReconciliation.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /reconciliationApi\.listQuarters\(controller\.signal\)/);
  assert.match(source, /reconciliationApi\.list\(quarter, controller\.signal\)/);
  assert.match(source, /reconciliationApi\.getMaterialStatus\(quarter\)/);
  assert.match(source, /reconciliationApi\.listQuarterDifferenceItems\(quarter, controller\.signal\)/);
  assert.match(source, /reconciliationApi\.getSpdDashboard\(quarter\)/);
  assert.match(source, /setPostgresQuarters\(options\)/);
});

test("import mode never restores or writes the legacy business sheet snapshots", async () => {
  const source = await readFile(
    new URL("../app/QuarterlyReconciliation.tsx", import.meta.url),
    "utf8",
  );

  for (const legacyOperation of [
    "ensureArchiveFromActive",
    "sheetForQuarter",
    "writeArchivedSheet",
    "saveSheet",
    "selectQuarter",
    "local-quarterly-reconciliation-archive",
    "local-quarterly-reconciliation-spd-sheet-archive",
  ]) {
    assert.doesNotMatch(source, new RegExp(legacyOperation));
  }
  assert.doesNotMatch(source, /localStorage\.(?:getItem|setItem)\(STORAGE_KEY/);
  assert.match(source, /TABLE_VIEW_KEY/, "only the table-view UI preference remains browser-persisted");
});
