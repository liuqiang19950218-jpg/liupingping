import assert from "node:assert/strict";
import test from "node:test";
import { DIRECT_IMAGE_BYTES, MAX_IMAGE_BYTES, optimizationSteps, prepareAttachmentImage } from "../lib/attachment-image-optimization.mjs";
import { DEFAULT_STORAGE_THRESHOLDS, storageMetrics } from "../services/attachment-service/metrics.mjs";

test("images at or below 10MB stay direct; 10-20MB images use progressive browser optimization", async () => {
  const direct = { size: DIRECT_IMAGE_BYTES, type: "image/jpeg" };
  assert.equal((await prepareAttachmentImage(direct)).optimized, false);
  const calls = [];
  const optimized = await prepareAttachmentImage({ size: DIRECT_IMAGE_BYTES + 1, type: "image/jpeg" }, async () => ({
    width: 6000, height: 4000,
    encode: async (step) => { calls.push(step); return new Blob([Buffer.alloc(calls.length === 1 ? DIRECT_IMAGE_BYTES + 1 : DIRECT_IMAGE_BYTES - 1)]); },
  }));
  assert.equal(optimized.optimized, true);
  assert.equal(optimized.file.type, "image/webp");
  assert.equal(optimized.file.size, DIRECT_IMAGE_BYTES - 1);
  assert.deepEqual(optimizationSteps(6000, 4000).map(({ width, height }) => [width, height]), [[4096, 2731], [3200, 2133], [2560, 1707]]);
  await assert.rejects(() => prepareAttachmentImage({ size: MAX_IMAGE_BYTES + 1, type: "image/jpeg" }), /20MB/);
});

test("storage metrics classify normal, warning, critical, blocked, and low-free-space", () => {
  const metric = (usedPercent, freeBytes = DEFAULT_STORAGE_THRESHOLDS.minFreeBytes) => storageMetrics({ attachmentCount: 2, attachmentBytes: 10, diskTotalBytes: 1000, diskFreeBytes: freeBytes === DEFAULT_STORAGE_THRESHOLDS.minFreeBytes ? 1000 - usedPercent * 10 : freeBytes }, { ...DEFAULT_STORAGE_THRESHOLDS, minFreeBytes: freeBytes === DEFAULT_STORAGE_THRESHOLDS.minFreeBytes ? 0 : DEFAULT_STORAGE_THRESHOLDS.minFreeBytes });
  assert.equal(metric(79).storageLevel, "normal");
  assert.equal(metric(80).storageLevel, "warning");
  assert.equal(metric(90).storageLevel, "critical");
  assert.equal(metric(95).storageLevel, "blocked");
  assert.equal(storageMetrics({ attachmentCount: 0, attachmentBytes: 0, diskTotalBytes: 1000, diskFreeBytes: 1 }, { ...DEFAULT_STORAGE_THRESHOLDS, minFreeBytes: 2 }).storageLevel, "blocked");
});
