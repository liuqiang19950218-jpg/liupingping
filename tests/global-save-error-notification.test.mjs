import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("save failures use one persistent body-portal notification above every reconciliation drawer", () => {
  const page = readFileSync("app/QuarterlyReconciliation.tsx", "utf8");
  const css = readFileSync("app/reconciliation.css", "utf8");

  assert.match(page, /createPortal\([\s\S]*document\.body/);
  assert.match(page, /const \[saveError, setSaveError\] = useState\(""\)/);
  assert.match(page, /setSaveError\(error instanceof Error \? `保存失败：\$\{error\.message\}。未使用本地数据回退。`/);
  assert.match(page, /setSaveError\(""\);[\s\S]*stopSolutionRecording/);
  assert.match(page, /GlobalSaveErrorNotification message=\{saveError\}/);
  assert.match(page, /aria-label="关闭保存失败提示"/);
  assert.doesNotMatch(page, /setMessage\(error instanceof Error \? `保存失败：/);
  assert.match(css, /\.global-save-error-notification \{ position: fixed; z-index: 1400;/);
  assert.match(css, /\.difference-detail-drawer \{ position: fixed; z-index: 1100;/);
  assert.match(css, /\.invoice-screenshot-backdrop\{position:fixed;z-index:1300;/);
});
