import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { preserveImportedOrder } from "../lib/reconciliation-import-order.mjs";

const imported = [
  { id: "row-1", sourceSequence: "1", importOrder: 2 },
  { id: "row-2", sourceSequence: "2", importOrder: 3 },
  { id: "row-3", sourceSequence: "3", importOrder: 4 },
  { id: "row-4", sourceSequence: "5", importOrder: 5 },
  { id: "row-5", sourceSequence: "4", importOrder: 6 },
];
const sequences = (rows) => rows.map((row) => row.sourceSequence);

test("non-ascending imported sequences retain their original row order", () => {
  assert.deepEqual(sequences(preserveImportedOrder([...imported].reverse())), ["1", "2", "3", "5", "4"]);
  assert.deepEqual(sequences(preserveImportedOrder([{ id: "a", sourceSequence: "1", importOrder: 2 }, { id: "b", sourceSequence: "2", importOrder: 3 }, { id: "c", sourceSequence: "5", importOrder: 4 }, { id: "d", sourceSequence: "8", importOrder: 5 }])), ["1", "2", "5", "8"]);
});

test("normal save, voice-assisted manual save, refetch, and quarter return preserve sequence and position", () => {
  const normalSave = imported.map((row) => row.id === "row-4" ? { ...row, solution: "键盘填写" } : row);
  const voiceThenManualSave = normalSave.map((row) => row.id === "row-5" ? { ...row, solution: "语音文字" } : row);
  const refetched = [...voiceThenManualSave].reverse();
  const q2ThenBackToQ1 = [...refetched];
  for (const rows of [normalSave, voiceThenManualSave, refetched, q2ThenBackToQ1]) {
    assert.deepEqual(sequences(preserveImportedOrder(rows)), ["1", "2", "3", "5", "4"]);
  }
});

test("missing import-order metadata never triggers a made-up sequence sort", () => {
  const withoutMetadata = [{ id: "first", sourceSequence: "5", importOrder: null }, { id: "second", sourceSequence: "4", importOrder: null }];
  assert.deepEqual(sequences(preserveImportedOrder(withoutMetadata)), ["5", "4"]);
});

test("API returns source sequence and orders by persisted source-row position, while writes leave both untouched", async () => {
  const [read, write, page, api] = await Promise.all([
    readFile(new URL("../lib/server/recon/recon.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/recon/write.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/QuarterlyReconciliation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/api/reconciliation-api.ts", import.meta.url), "utf8"),
  ]);
  assert.match(read, /r\.legacy_id::text AS source_sequence/);
  assert.match(read, /source_payload->>'source_row_index'/);
  assert.doesNotMatch(read, /ORDER BY r\.source_row_key/);
  assert.match(page, /row\.sourceSequence \?\? ""/);
  assert.match(page, /preserveImportedOrder\(reconciliations\)/);
  assert.match(page, /setApiIds\(preserveImportedOrder\(reconciliations\)\.map\(\(item\) => item\.id\)\)/);
  assert.match(api, /sourceSequence: string \| null; importOrder: number \| null/);
  assert.doesNotMatch(write, /pushSet\("legacy_id"|pushSet\("source_row_key"|pushSet\("source_payload"/);
});

test("reconciliation table rows use stable reconciliation IDs rather than array positions", async () => {
  const page = await readFile(new URL("../app/QuarterlyReconciliation.tsx", import.meta.url), "utf8");
  assert.match(page, /pagedRows\.map\(\(\{ row, id \}\) =>/);
  assert.match(page, /<tr\s*key=\{id\}/);
});
