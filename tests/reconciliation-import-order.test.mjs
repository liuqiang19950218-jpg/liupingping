import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { preserveImportedOrder } from "../lib/reconciliation-import-order.mjs";

const imported = [
  { id: "row-1", legacyId: "local-492", sourceSequence: "1", importOrder: 2 },
  { id: "row-2", legacyId: "local-493", sourceSequence: "2", importOrder: 3 },
  { id: "row-3", legacyId: "local-494", sourceSequence: "3", importOrder: 4 },
  { id: "row-4", legacyId: "local-495", sourceSequence: "5", importOrder: 5 },
  { id: "row-5", legacyId: "local-496", sourceSequence: "4", importOrder: 6 },
];
const sequences = (rows) => rows.map((row) => row.sourceSequence);

test("non-ascending imported sequences retain their original row order", () => {
  assert.deepEqual(sequences(preserveImportedOrder([...imported].reverse())), ["1", "2", "3", "5", "4"]);
  assert.deepEqual(sequences(preserveImportedOrder([{ id: "a", sourceSequence: "1", importOrder: 2 }, { id: "b", sourceSequence: "2", importOrder: 3 }, { id: "c", sourceSequence: "5", importOrder: 4 }, { id: "d", sourceSequence: "8", importOrder: 5 }])), ["1", "2", "5", "8"]);
});

test("Excel sequence is displayed even when the obsolete legacy ID is local-N", () => {
  assert.deepEqual(sequences(preserveImportedOrder(imported)), ["1", "2", "3", "5", "4"]);
  assert.deepEqual(imported.map((row) => row.legacyId), ["local-492", "local-493", "local-494", "local-495", "local-496"]);
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

test("API reads the original Excel sequence from payload and orders only by persisted import position, while writes leave both untouched", async () => {
  const [read, write, page, api] = await Promise.all([
    readFile(new URL("../lib/server/recon/recon.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/recon/write.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/QuarterlyReconciliation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/api/reconciliation-api.ts", import.meta.url), "utf8"),
  ]);
  assert.match(read, /jsonb_typeof\(r\.source_payload->'row'\) = 'object'/);
  assert.match(read, /r\.source_payload->'row'->>'序号'/);
  assert.match(read, /jsonb_typeof\(r\.source_payload->'row'\) = 'array'/);
  assert.match(read, /r\.source_payload->'headers'/);
  assert.match(read, /r\.source_payload->'allowed_source_columns'/);
  assert.match(read, /header\.name = '序号'/);
  assert.doesNotMatch(read, /r\.legacy_id::text AS source_sequence/);
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
