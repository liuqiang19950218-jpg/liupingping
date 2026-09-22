import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("only no-invoice other rows expose a single-image draft uploader", () => {
  const page = readFileSync("app/QuarterlyReconciliation.tsx", "utf8");
  assert.match(page, /type OtherEntry = .*pendingImage.*previewUrl.*removeImage/s);
  assert.match(page, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(page, /file\.size > 10 \* 1024 \* 1024/);
  assert.match(page, /category === 'other' \? savedOtherEntries/);
  assert.match(page, /differenceAttachmentApi\.upload\(entry\.pendingImage\)/);
  assert.doesNotMatch(page, /readAsDataURL\(file\)/);
  assert.match(page, /Boolean\(entry\.image \|\| entry\.pendingImage\)/);
  assert.match(page, /attachmentKeys: category === 'other' \? \[String/);
  assert.match(page, /uploadedAttachmentKeys\.map\(\(key\) => differenceAttachmentApi\.remove\(key\)\)/);
  assert.match(page, /oldKey && oldKey !== nextKey \? \[oldKey\]/);
  assert.match(page, /attachmentKeysToDelete\.map\(\(key\) => differenceAttachmentApi\.remove\(key\)\)/);
});

test("image route validates bytes and prevents arbitrary object keys", () => {
  const route = readFileSync("app/api/attachments/images/route.ts", "utf8");
  assert.match(route, /MAX_IMAGE_BYTES = 10 \* 1024 \* 1024/);
  assert.match(route, /image\/jpeg.*image\/png.*image\/webp/s);
  assert.match(route, /item\.valid\(bytes\)/);
  assert.match(route, /crypto\.randomUUID\(\)/);
  assert.match(route, /KEY_PATTERN/);
  assert.match(route, /bucket\(\)\.put/);
  assert.match(route, /bucket\(\)\.get/);
  assert.match(route, /bucket\(\)\.delete/);
});
