/** UI-only labels for persisted API codes. Never use these labels for writes or filtering. */
const FOLLOWUP_STATUS_LABELS = Object.freeze({
  pending: "待解决",
  closed: "已解决",
  reopened: "已撤销",
});

const DIFFERENCE_CATEGORY_LABELS = Object.freeze({
  transit: "在途证明",
  returned_invoice: "退票金额",
  lost_invoice: "丢票金额",
  equipment: "仪器设备金额",
  other_with_invoice: "其他（有发票）",
  other_without_invoice: "其他（无发票及无法验证）",
});

export function formatFollowupStatusLabel(status) {
  const value = String(status ?? "").trim();
  return (FOLLOWUP_STATUS_LABELS[value] ?? value) || "未设置";
}

export function formatDifferenceCategoryLabel(category) {
  const value = String(category ?? "").trim();
  return (DIFFERENCE_CATEGORY_LABELS[value] ?? value) || "未设置";
}
