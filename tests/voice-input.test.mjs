import assert from "node:assert/strict";
import test from "node:test";
import { appendVoiceTranscript, voiceErrorMessage } from "../lib/voice-input.ts";
import { readFile } from "node:fs/promises";

test("final transcript fills an empty field and appends to an existing field", () => {
  assert.equal(appendVoiceTranscript("", " 客户反馈已处理 "), "客户反馈已处理");
  assert.equal(appendVoiceTranscript("已联系客户财务", "客户反馈发票还未收到"), "已联系客户财务\n客户反馈发票还未收到");
});

test("voice errors have simple user-facing messages", () => {
  assert.equal(voiceErrorMessage("not-allowed"), "无法使用麦克风，请检查浏览器麦克风权限。");
  assert.equal(voiceErrorMessage("no-speech"), "未识别到语音，请重试。");
  assert.equal(voiceErrorMessage("audio-capture"), "无法访问麦克风，请检查设备后重试。");
});

test("shared component owns native recognition, cleanup, and no save API", async () => {
  const component = await readFile(new URL("../app/VoiceInputButton.tsx", import.meta.url), "utf8");
  assert.match(component, /recognition\.lang = "zh-CN"/);
  assert.match(component, /recognition\.start\(\)/);
  assert.match(component, /recognitionRef\.current\?\.stop\(\)/);
  assert.match(component, /useEffect\(\(\) => \(\) => recognitionRef\.current\?\.stop\(\), \[\]\)/);
  assert.doesNotMatch(component, /fetch\(|reconciliationApi|save|submit/i);
});

test("all supported field locations reuse the component without field cross-wiring", async () => {
  const reconciliation = await readFile(new URL("../app/QuarterlyReconciliation.tsx", import.meta.url), "utf8");
  const followup = await readFile(new URL("../app/UnresolvedFollowupDashboard.tsx", import.meta.url), "utf8");
  assert.match(reconciliation, /<VoiceTextField[\s\S]*label="死账原因"/);
  assert.match(reconciliation, /label="死账原因"[\s\S]{0,200}value=\{form\.badDebtReason\}[\s\S]{0,200}badDebtReason/);
  assert.doesNotMatch(reconciliation, /label="呆账原因"/);
  assert.match(reconciliation, /<VoiceTextField[\s\S]*label="调账原因"/);
  assert.match(reconciliation, /<VoiceInputButton value=\{entry\.note\} onChange=\{\(value\) => update\(index, "note", value\)\}/);
  assert.match(followup, /<VoiceInputButton value=\{followSolution\} onChange=\{setFollowSolution\}/);
});
