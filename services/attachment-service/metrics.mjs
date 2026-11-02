export const DEFAULT_STORAGE_THRESHOLDS = { warningPercent: 80, criticalPercent: 90, blockPercent: 95, minFreeBytes: 2 * 1024 * 1024 * 1024 };

export function storageLevel({ diskUsedPercent, diskFreeBytes }, thresholds = DEFAULT_STORAGE_THRESHOLDS) {
  if (diskFreeBytes < thresholds.minFreeBytes || diskUsedPercent >= thresholds.blockPercent) return "blocked";
  if (diskUsedPercent >= thresholds.criticalPercent) return "critical";
  if (diskUsedPercent >= thresholds.warningPercent) return "warning";
  return "normal";
}

export function storageMetrics({ attachmentCount, attachmentBytes, diskTotalBytes, diskFreeBytes }, thresholds = DEFAULT_STORAGE_THRESHOLDS) {
  const diskUsedBytes = Math.max(0, diskTotalBytes - diskFreeBytes);
  const diskUsedPercent = diskTotalBytes > 0 ? Number(((diskUsedBytes / diskTotalBytes) * 100).toFixed(1)) : 100;
  return { attachmentCount, attachmentBytes, diskTotalBytes, diskFreeBytes, diskUsedBytes, diskUsedPercent, storageLevel: storageLevel({ diskUsedPercent, diskFreeBytes }, thresholds) };
}
