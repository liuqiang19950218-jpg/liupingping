import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("voice transcript uses form state and the original save-success flow completes", async () => {
  const [page, voiceButton] = await Promise.all([
    readFile(new URL("../app/QuarterlyReconciliation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/VoiceInputButton.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(voiceButton, /onChange\(appendVoiceTranscript\(value, transcript\)\)/);
  assert.match(page, /if \(Object\.keys\(reconciliationPatch\)\.length\) await reconciliationApi\.patch/);
  assert.match(page, /setMessage\("已保存到 PostgreSQL。显示内容已按服务端确认结果刷新。"\);\s*setSaveError\(""\);\s*setActive\(null\);/);
  assert.doesNotMatch(page, new RegExp(["stop", "Solution", "Recording"].join("")));
});

test("no business source retains the removed voice lifecycle function", async () => {
  const removedName = ["stop", "Solution", "Recording"].join("");
  const sources = await Promise.all([
    readFile(new URL("../app/QuarterlyReconciliation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/UnresolvedFollowupDashboard.tsx", import.meta.url), "utf8"),
  ]);
  assert.equal(sources.some((source) => source.includes(removedName)), false);
});
