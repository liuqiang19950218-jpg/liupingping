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

test("Worker attachment route proxies the internal filesystem service and prevents arbitrary keys", () => {
  const route = readFileSync("app/api/attachments/images/route.ts", "utf8");
  assert.match(route, /MAX_IMAGE_BYTES = 10 \* 1024 \* 1024/);
  assert.match(route, /image\/jpeg.*image\/png.*image\/webp/s);
  assert.match(route, /item\.valid\(bytes\)/);
  assert.match(route, /ATTACHMENT_SERVICE_URL/);
  assert.match(route, /ATTACHMENT_SERVICE_TOKEN/);
  assert.match(route, /proxy\("\/internal\/attachments"/);
  assert.doesNotMatch(route, /env\.FILES|R2Bucket|site-creator-r2/);
  assert.match(route, /KEY_PATTERN/);
  assert.match(route, /proxy\(`\/internal\/attachments\?key=/);
});
