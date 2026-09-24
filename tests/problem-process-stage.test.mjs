import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { processManagementStage } from "../lib/problem-process-stage.mjs";

test("process-stage presentation keeps a dated unconfirmed customer pending", () => {
  assert.equal(processManagementStage({ processStage: "待销售去医院处理", overdueDays: 0 }), "等待客户反馈");
  assert.equal(processManagementStage({ processStage: "待财务调账", overdueDays: 0 }), "处理中");
  assert.equal(processManagementStage({ processStage: "待核查", overdueDays: 0 }), "待确认");
  assert.equal(processManagementStage({ processStage: "待销售走申请", overdueDays: 1 }), "超期跟进");
  assert.equal(processManagementStage({ isClosed: true, processStage: "待销售去医院处理", overdueDays: 9 }), "已关闭");
});

test("dashboard stages and drawer use the read-only process mapping", async () => {
  const [dashboard, drawer, tracker] = await Promise.all([
    readFile(new URL("../app/ProblemDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ProblemFollowupDrawer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/UnresolvedFollowupDashboard.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, /buildManagementStageDistribution/);
  assert.match(dashboard, /\["已关闭", closedCount/);
  assert.match(drawer, /搜索问题客户/);
  assert.match(drawer, /pfd-pagination/);
  assert.match(drawer, /对账负责人/);
  assert.match(tracker, /followupManagementStage/);
});
