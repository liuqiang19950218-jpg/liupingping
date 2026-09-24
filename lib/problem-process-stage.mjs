export const PROCESS_MANAGEMENT_STAGES = ["待确认", "处理中", "等待客户反馈", "超期跟进", "已关闭"];

// Presentation-only process grouping. It never changes follow-up membership
// or the closed qualification.
export function processManagementStage({ isClosed = false, processStage = "", overdueDays = 0 }) {
  if (isClosed) return "已关闭";
  if (Number(overdueDays) > 0) return "超期跟进";
  if (processStage === "待销售走申请" || processStage === "待销售去医院处理") return "等待客户反馈";
  if (processStage === "待财务调账") return "处理中";
  return "待确认";
}
