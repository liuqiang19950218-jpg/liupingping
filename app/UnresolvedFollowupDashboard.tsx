"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { reconciliationApi, type QuarterFollowupItem, type Reconciliation } from "../lib/api/reconciliation-api";
import {
  isFollowupTrackerReconciliation,
  isResolvedArchiveReconciliation,
} from "../lib/closed-reconciliation-qualification.mjs";
import { businessDayDistance, normalizeDateOnly } from "../lib/date-only.mjs";
import { useDashboardData } from "./dashboard-postgres-data";
import { VoiceInputButton } from "./VoiceInputButton";
import "./unresolved-followup.css";
import "./unresolved-followup-layout-overrides.css";

type FollowUp = { time: string; solution: string };
const PROCESS_STAGES = [
  "待销售走申请",
  "待销售去医院处理",
  "待财务调账",
  "待核查",
  "已关闭",
] as const;
type ProcessStage = (typeof PROCESS_STAGES)[number];
type Detail = {
  resolutionSolution?: string;
  resolutionTime?: string;
  resolved?: boolean;
  reopened?: boolean;
  followUps?: FollowUp[];
  financeAttention?: "无需关注" | "一般关注" | "需财务复核";
  processStage?: Exclude<ProcessStage, "已关闭">;
};
type Sheet = {
  headers: string[];
  rows: unknown[][];
  fileName: string;
  details?: Record<string, Detail>;
};
type Risk = "高风险" | "中风险" | "一般关注";
type Finance = "none" | "需财务复核" | "一般关注" | "无需关注";
const TABLE_FILTER_COLUMNS = [
  { key: "quarter", label: "季度" },
  { key: "region", label: "区域" },
  { key: "customer", label: "客户名称" },
  { key: "owner", label: "负责人" },
  { key: "amount", label: "对账差额" },
  { key: "overdue", label: "超期天数" },
  { key: "firstSolution", label: "首次解决方案" },
  { key: "latest", label: "最近跟进时间" },
  { key: "followUp", label: "跟进解决方案" },
  { key: "finance", label: "财务关注" },
  { key: "stage", label: "问题处理阶段" },
] as const;
type TableFilterKey = (typeof TABLE_FILTER_COLUMNS)[number]["key"];
export type FollowupTrackerItem = {
  id: string;
  reconciliationId: string;
  followupId?: string;
  quarter: string;
  accountSet: string;
  region: string;
  customer: string;
  owner: string;
  amount: number;
  firstTime: string;
  expectedDate: string;
  firstSolution: string;
  followUps: FollowUp[];
  resolved: boolean;
  financeAttention: Finance;
  processStage: Exclude<ProcessStage, "已关闭"> | null;
};
type Item = FollowupTrackerItem;

type DashboardMetricFilter =
  | ""
  | "all"
  | "overdue"
  | "untouched"
  | "customer"
  | "internal"
  | "leader"
  | "week";

const ALL = "全部区域";
const OVERDUE_DAYS = 7;
const HIGH_AMOUNT = 100000;

const value = (row: unknown[], headers: string[], names: string[]) => {
  const index = headers.findIndex((header) =>
    names.some((name) => String(header).replace(/\s/g, "").includes(name)),
  );
  return index < 0 ? "" : String(row[index] ?? "").trim();
};
const amountOf = (value: unknown) => {
  const number = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) ? number : 0;
};
const money = (value: number) =>
  value === 0
    ? "0"
    : value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
export const latestFollowupAt = (item: Item) =>
  normalizeDateOnly([...item.followUps]
    .reverse()
    .find((entry) => entry.time.trim())
    ?.time.trim() || item.firstTime);
const latest = latestFollowupAt;
export const latestFollowupContent = (item: Item) =>
  [...item.followUps].reverse().find((entry) => entry.solution.trim())?.solution.trim() || item.firstSolution;
const dayDistance = (value: string) => businessDayDistance(value);
const text = (item: Item) =>
  [item.firstSolution, ...item.followUps.map((entry) => entry.solution)].join(
    " ",
  );
const financeOf = (item: Item): Finance => item.financeAttention;
const financeLabel = (value: Finance) => value === "none" ? "未设置" : value;
export const followupStage = (item: Item): ProcessStage => {
  if (item.resolved) return "已关闭";
  if (item.processStage) return item.processStage;
  const content = `${item.firstSolution} ${text(item)}`;
  if (content.includes("调账") || content.includes("财务")) return "待财务调账";
  if (content.includes("医院")) return "待销售去医院处理";
  if (content.includes("申请")) return "待销售走申请";
  return "待核查";
};
const stageOf = followupStage;
export const matchesFollowupDashboardMetric = (item: Item, filter: DashboardMetricFilter) => {
  const daysSinceFollowUp = dayDistance(latest(item)) ?? 0;
  switch (filter) {
    case "overdue":
      return (dayDistance(item.expectedDate) ?? 0) > 0;
    case "untouched":
      return daysSinceFollowUp >= OVERDUE_DAYS;
    case "customer":
      return stageOf(item) === "待销售走申请" || stageOf(item) === "待销售去医院处理";
    case "internal":
      return stageOf(item) === "待财务调账";
    case "leader":
      return financeOf(item) === "需财务复核";
    case "week":
      return daysSinceFollowUp <= 7;
    default:
      return true;
  }
};
const riskOf = (item: Item): Risk => {
  const days = dayDistance(latest(item)) ?? 0;
  if (
    days > 90 ||
    item.amount >= HIGH_AMOUNT ||
    financeOf(item) === "需财务复核"
  )
    return "高风险";
  if (days > 30 || item.amount > 0) return "中风险";
  return "一般关注";
};
const tableFilterValue = (item: Item, key: TableFilterKey) => {
  switch (key) {
    case "quarter":
      return item.quarter;
    case "region":
      return item.region;
    case "customer":
      return `${item.customer} ${item.accountSet}`;
    case "owner":
      return item.owner;
    case "amount":
      return money(item.amount);
    case "overdue":
      return String(dayDistance(latest(item)) ?? "—");
    case "firstSolution":
      return item.firstSolution;
    case "latest":
      return latest(item);
    case "followUp":
      return item.followUps.map((entry) => entry.solution).join("；");
    case "finance":
      return financeOf(item);
    case "stage":
      return stageOf(item);
  }
};
export function toItems(quarter: string, rows: Map<string, Reconciliation>, followups: QuarterFollowupItem[]): Item[] {
  const followupByReconciliation = new Map(followups.map((item) => [item.reconciliationId, item]));
  return [...rows.values()].flatMap((row) => {
    const followup = followupByReconciliation.get(row.id);
    const firstTime = row.solutionDate?.trim() ?? "";
    if (!isFollowupTrackerReconciliation(row)) return [];
    return [{
      id: followup?.id ?? `solution:${row.id}`,
      reconciliationId: row.id,
      followupId: followup?.id,
      quarter,
      accountSet: row.accountSet ?? "",
      region: row.region ?? "未填写区域",
      customer: row.customer ?? "",
      owner: row.ownerName ?? "",
      amount: amountOf(row.reconciliationDifference),
      firstTime,
      expectedDate: firstTime,
      firstSolution: row.solution?.trim() ?? "",
      followUps: followup?.events.map((event) => ({ time: event.occurredAt, solution: event.content ?? "" })) ?? [],
      financeAttention: row.financeAttention ?? "none",
      processStage: followup?.processStage && followup.processStage !== "已关闭" ? followup.processStage as Exclude<ProcessStage, "已关闭"> : null,
      resolved: isResolvedArchiveReconciliation(row),
    }];
  }).filter((item) => item.customer);
}

/**
 * The canonical read-only mapping for filters sent by ProblemDashboard.
 * Both the secondary drawer and the formal tracker use this same function so
 * a drill-down cannot silently grow or shrink its customer set.
 */
export function filterFollowupTrackerItems(items: Item[], filters: Record<string, string> = {}) {
  const filter = (filters.filter ?? "") as DashboardMetricFilter;
  const stage = filters.stage ?? "";
  const query = (filters.owner || filters.customer || "").trim().toLocaleLowerCase();
  const salesGroup = stage === "等待销售处理";
  return filterFollowupTrackerItemsByState(items, {
    tab: stage === "已关闭" ? "resolved" : "pending",
    region: filters.region ?? ALL,
    search: query,
    risk: "全部",
    finance: "全部",
    processStage: salesGroup ? "全部" : stage || "全部",
    dashboardMetricFilter: filter,
    tableFilters: {},
  }).filter((item) => !salesGroup || followupStage(item) === "待销售走申请" || followupStage(item) === "待销售去医院处理");
}

export type FollowupTrackerFilterState = {
  tab: "pending" | "resolved";
  region: string;
  search: string;
  risk: string;
  finance: string;
  processStage: string;
  dashboardMetricFilter: DashboardMetricFilter;
  tableFilters: Partial<Record<string, string>>;
};

/** The single predicate used by the formal tracker and dashboard drawer. */
export function filterFollowupTrackerItemsByState(items: Item[], state: FollowupTrackerFilterState) {
  return items.filter((item) =>
    (state.tab === "resolved" ? item.resolved : !item.resolved) &&
    (state.region === ALL || item.region === state.region) &&
    (!state.search || [item.customer, item.owner, item.region, item.accountSet].join(" ").toLocaleLowerCase().includes(state.search)) &&
    (state.risk === "全部" || riskOf(item) === state.risk) &&
    (state.finance === "全部" || financeOf(item) === state.finance) &&
    (state.processStage === "全部" || state.processStage === "已关闭" || followupStage(item) === state.processStage) &&
    matchesFollowupDashboardMetric(item, state.dashboardMetricFilter) &&
    Object.entries(state.tableFilters).every(([key, value]) =>
      !value || tableFilterValue(item, key as TableFilterKey).toLocaleLowerCase().includes(value.trim().toLocaleLowerCase()),
    ),
  );
}

function Badge({
  type,
  children,
  variant,
}: {
  type: string;
  children: string;
  variant?: "finance";
}) {
  return <span className={`uf-badge ${variant ?? ""} ${type}`}>{children}</span>;
}

export function UnresolvedFollowupDashboard() {
  const { quarter, reconciliationById, followups, refresh } = useDashboardData();
  const items = useMemo(() => toItems(quarter?.label ?? "", reconciliationById, followups), [quarter, reconciliationById, followups]);
  const [region, setRegion] = useState(ALL);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [risk, setRisk] = useState("全部");
  const [finance, setFinance] = useState("全部");
  const [processStage, setProcessStage] = useState("全部");
  const [dashboardMetricFilter, setDashboardMetricFilter] = useState<DashboardMetricFilter>("");
  const [tableFilters, setTableFilters] = useState<
    Partial<Record<TableFilterKey, string>>
  >({});
  const [filterColumns, setFilterColumns] = useState<TableFilterKey[]>([]);
  const [tab, setTab] = useState<"pending" | "resolved">("pending");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [editing, setEditing] = useState<Item | null>(null);
  const [followTime, setFollowTime] = useState("");
  const [followSolution, setFollowSolution] = useState("");
  const [detail, setDetail] = useState<Item | null>(null);
  const [message, setMessage] = useState("");
  const overdueCardsRef = useRef<HTMLDivElement>(null);
  const scrollOverdueCards = (direction: number) => overdueCardsRef.current?.scrollBy({ left: direction * Math.max(260, overdueCardsRef.current.clientWidth * 0.72), behavior: "smooth" });
  useEffect(() => {
    const initialFilter = Object.fromEntries(new URLSearchParams(window.location.search));
    if (initialFilter.region) setRegion(initialFilter.region);
    if (initialFilter.owner || initialFilter.customer) setQuery(initialFilter.owner || initialFilter.customer || "");
    if (initialFilter.filter === "finance" || initialFilter.filter === "leader") setFinance("需财务复核");
    if (PROCESS_STAGES.includes(initialFilter.stage as ProcessStage)) {
      setProcessStage(initialFilter.stage);
      setTab(initialFilter.stage === "已关闭" ? "resolved" : "pending");
    }
    if (["all", "overdue", "untouched", "customer", "internal", "leader", "week"].includes(initialFilter.filter ?? "")) {
      setDashboardMetricFilter(initialFilter.filter as DashboardMetricFilter);
      setTab("pending");
    }
    const applyDashboardFilter = (event: Event) => {
      const filter = (event as CustomEvent<Record<string, string>>).detail;
      if (!filter) return;
      if (filter.region) setRegion(filter.region);
      if (filter.owner || filter.customer) setQuery(filter.owner || filter.customer || "");
      if (filter.filter === "finance" || filter.filter === "leader") setFinance("需财务复核");
      if (PROCESS_STAGES.includes(filter.stage as ProcessStage)) {
        setDashboardMetricFilter("");
        setProcessStage(filter.stage);
        setTab(filter.stage === "已关闭" ? "resolved" : "pending");
        return;
      }
      if (["all", "overdue", "untouched", "customer", "internal", "leader", "week"].includes(filter.filter ?? "")) {
        setDashboardMetricFilter(filter.filter as DashboardMetricFilter);
        setProcessStage("全部");
        setRisk("全部");
        setFinance("全部");
        setTableFilters({});
        if (!filter.owner && !filter.customer) setQuery("");
      } else setDashboardMetricFilter("");
      setTab("pending");
    };
    window.addEventListener("reconciliation-followup-filter", applyDashboardFilter);
    return () => {
      window.removeEventListener("reconciliation-followup-filter", applyDashboardFilter);
    };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setSearch(query.trim().toLocaleLowerCase()),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    setPage(1);
  }, [region, search, risk, finance, processStage, tableFilters, tab, pageSize]);
  const pending = useMemo(
    () => items.filter((item) => !item.resolved),
    [items],
  );
  const resolved = useMemo(
    () => items.filter((item) => item.resolved),
    [items],
  );
  const visible = useMemo(
    () => filterFollowupTrackerItemsByState(items, { tab, region, search, risk, finance, processStage, dashboardMetricFilter, tableFilters }),
    [items, tab, region, search, risk, finance, processStage, dashboardMetricFilter, tableFilters],
  );
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const rows = visible.slice((page - 1) * pageSize, page * pageSize);
  const regions = useMemo(
    () => [...new Set(pending.map((item) => item.region))],
    [pending],
  );
  const overdue = useMemo(
    () =>
      pending.filter((item) => (dayDistance(latest(item)) ?? 0) > OVERDUE_DAYS),
    [pending],
  );
  const overdueAmount = overdue.reduce(
    (total, item) => total + Math.abs(item.amount),
    0,
  );
  const financeItems = pending.filter((item) => financeOf(item) !== "无需关注");
  const weekNew = pending.filter((item) => {
    const days = dayDistance(item.firstTime);
    return days !== null && days <= 7;
  }).length;
  const regionStats = useMemo(
    () =>
      [ALL, ...regions].map((name) => {
        const list =
          name === ALL
            ? overdue
            : overdue.filter((item) => item.region === name);
        const amount = list.reduce(
          (total, item) => total + Math.abs(item.amount),
          0,
        );
        return {
          name,
          list,
          amount,
          average: list.length
            ? Math.round(
                list.reduce(
                  (total, item) => total + (dayDistance(latest(item)) ?? 0),
                  0,
                ) / list.length,
              )
            : 0,
        };
      }),
    [regions, overdue],
  );
  const selectedOverdue = (
    region === ALL ? overdue : overdue.filter((item) => item.region === region)
  ).sort(
    (a, b) =>
      Math.abs(b.amount) - Math.abs(a.amount) ||
      (dayDistance(latest(b)) ?? 0) - (dayDistance(latest(a)) ?? 0),
  );
  const reset = () => {
    setRegion(ALL);
    setQuery("");
    setRisk("全部");
    setFinance("全部");
    setProcessStage("全部");
    setTableFilters({});
    setFilterColumns([]);
  };
  const toggleColumnFilter = (column: TableFilterKey) =>
    setFilterColumns((columns) =>
      columns.includes(column)
        ? columns.filter((item) => item !== column)
        : [...columns, column],
    );
  const submitFollowUp = async () => {
    if (!editing || !followSolution.trim()) {
      setMessage("请填写本次跟进解决方案。");
      return;
    }
    if (!quarter) return;
    const event = { eventType: "follow_up", content: followSolution.trim(), occurredAt: followTime || new Date().toISOString() };
    if (editing.followupId) await reconciliationApi.createFollowupEvent(quarter.code, editing.reconciliationId, event);
    else await reconciliationApi.createFollowup(quarter.code, editing.reconciliationId, { followStatus: "pending", event });
    refresh();
    setEditing(null);
    setFollowTime("");
    setFollowSolution("");
    setMessage("已保存跟进记录，首次解决方案与首次时间保持不变。");
  };
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const withSaving = async (item: Item, action: () => Promise<void>) => {
    setSavingIds((current) => new Set(current).add(item.reconciliationId));
    try {
      await action();
      refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? `保存失败：${caught.message}` : "保存失败，请稍后重试。");
    } finally {
      setSavingIds((current) => { const next = new Set(current); next.delete(item.reconciliationId); return next; });
    }
  };
  const resolve = (item: Item) => withSaving(item, async () => {
    if (!quarter) return;
    await reconciliationApi.patch(quarter.code, item.reconciliationId, { manualResolutionStatus: "resolved" });
    setMessage("已转入已解决档案。");
  });
  const restore = (item: Item) => withSaving(item, async () => {
    if (!quarter) return;
    await reconciliationApi.patch(quarter.code, item.reconciliationId, { manualResolutionStatus: "reopened" });
    setMessage("已撤销解决状态，客户已回到待解决清单。");
  });
  const updateFinanceAttention = (item: Item, financeAttention: Finance) => {
    if (!quarter || item.financeAttention === financeAttention) return;
    void withSaving(item, async () => {
      await reconciliationApi.patch(quarter.code, item.reconciliationId, { financeAttention });
      setMessage(`已将${item.customer}设置为${financeLabel(financeAttention)}。`);
    });
  };
  const updateProcessStage = async (
    item: Item,
    nextStage: Exclude<ProcessStage, "已关闭">,
  ) => {
    if (!quarter || item.processStage === nextStage) return;
    if (!item.followupId) {
      setMessage(`无法保存：${item.customer}（${item.reconciliationId}）没有可匹配的 followup_item。`);
      return;
    }
    await withSaving(item, async () => {
      await reconciliationApi.updateFollowup(quarter.code, item.reconciliationId, { processStage: nextStage });
      setMessage(`已将${item.customer}设置为${nextStage}。`);
    });
  };
  const exportRows = () => {
    const header = [
      "季度",
      "账套",
      "区域",
      "客户名称",
      "负责人",
      "对账差额",
      "超期天数",
      "财务关注",
      "首次解决时间",
      "首次解决方案",
      "最近跟进时间",
      "跟进解决方案",
    ];
    const content = [
      header,
      ...visible.map((item) => [
        item.quarter,
        item.accountSet,
        item.region,
        item.customer,
        item.owner,
        money(item.amount),
        String(dayDistance(latest(item)) ?? "—"),
        financeOf(item),
        item.firstTime,
        item.firstSolution,
        latest(item),
        item.followUps.map((entry) => entry.solution).join("；"),
      ]),
    ]
      .map((row) =>
        row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([`\ufeff${content}`], { type: "text/csv;charset=utf-8" }),
    );
    link.download = `${quarter?.label || "季度"}-未解决客户跟进.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const exportCurrentList = () => {
    const isArchive = tab === "resolved";
    const exportName = isArchive
      ? "\u5df2\u89e3\u51b3\u6863\u6848"
      : "\u5f85\u89e3\u51b3\u6e05\u5355";
    const exportItems = isArchive ? resolved : pending;
    const header = [
      "\u5b63\u5ea6",
      "\u8d26\u5957",
      "\u533a\u57df",
      "\u5ba2\u6237\u540d\u79f0",
      "\u8d1f\u8d23\u4eba",
      "\u5bf9\u8d26\u5dee\u989d",
      "\u8d22\u52a1\u5173\u6ce8",
      "\u9996\u6b21\u89e3\u51b3\u65f6\u95f4",
      "\u9996\u6b21\u89e3\u51b3\u65b9\u6848",
      "\u6700\u8fd1\u8ddf\u8fdb\u65f6\u95f4",
      "\u8ddf\u8fdb\u89e3\u51b3\u65b9\u6848",
      "\u5f52\u6863\u72b6\u6001",
    ];
    const content = [
      header,
      ...exportItems.map((item) => [
        item.quarter,
        item.accountSet,
        item.region,
        item.customer,
        item.owner,
        money(item.amount),
        financeOf(item),
        item.firstTime,
        item.firstSolution,
        latest(item),
        item.followUps.map((entry) => entry.solution).join("\u3001"),
        isArchive ? "\u5df2\u89e3\u51b3" : "\u5f85\u89e3\u51b3",
      ]),
    ]
      .map((row) =>
        row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([`\ufeff${content}`], { type: "text/csv;charset=utf-8" }),
    );
    link.download = `${quarter?.label || "\u5bf9\u8d26\u5b63\u5ea6"}-${exportName}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    setMessage(`\u5df2\u5bfc\u51fa${exportName}\uff08${exportItems.length}\u6761\uff09\u3002`);
  };
  const maxCustomers = Math.max(
    1,
    ...regionStats.map((item) => item.list.length),
  );
  const maxAmount = Math.max(1, ...regionStats.map((item) => item.amount));
  return (
    <section className="uf-page" aria-busy={false}>
      <section className="uf-kpis" aria-label="未解决客户核心指标">
        {[
          {
            label: "未解决客户总数",
            value: pending.length,
            tone: "blue",
            icon: "◉",
          },
          {
            label: "超期客户数",
            value: overdue.length,
            tone: "orange",
            icon: "◷",
          },
          {
            label: "超期金额总额",
            value: overdueAmount ? money(overdueAmount) : "—",
            tone: "red",
            icon: "¥",
          },
          {
            label: "财务关注事项数",
            value: financeItems.length,
            tone: "purple",
            icon: "◆",
          },
          { label: "本周新增问题数", value: weekNew, tone: "green", icon: "↗" },
        ].map((card) => (
          <article className={`uf-kpi ${card.tone}`} key={card.label}>
            <i aria-hidden="true">{card.icon}</i>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>当前季度真实数据</small>
          </article>
        ))}
      </section>
      <section className="uf-card uf-table-card">
        <header className="uf-card-head">
          <div>
            <p>与财务联动清单</p>
            <h2>未解决客户跟进</h2>
            <span>
              跟踪高风险客户、超期客户与财务重点关注客户，支持销售与财务协同处理。
            </span>
          </div>
          <div className="uf-tools">
            <select
              value={region}
              aria-label="按区域筛选"
              onChange={(event) => setRegion(event.target.value)}
            >
              <option>{ALL}</option>
              {regions.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
            <input
              value={query}
              aria-label="搜索客户或负责人"
              placeholder="搜索客户 / 负责人"
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              value={risk}
              aria-label="筛选风险等级"
              onChange={(event) => setRisk(event.target.value)}
            >
              <option>全部</option>
              <option>高风险</option>
              <option>中风险</option>
              <option>一般关注</option>
            </select>
            <select
              value={finance}
              aria-label="筛选财务关注状态"
              onChange={(event) => setFinance(event.target.value)}
            >
              <option>全部</option>
              <option>需财务复核</option>
              <option>一般关注</option>
              <option>无需关注</option>
            </select>
            <select
              value={processStage}
              aria-label="筛选问题处理阶段"
              onChange={(event) => {
                const nextStage = event.target.value;
                setProcessStage(nextStage);
                if (nextStage === "已关闭") setTab("resolved");
                else if (nextStage !== "全部") setTab("pending");
              }}
            >
              <option>全部</option>
              {PROCESS_STAGES.map((stage) => (
                <option key={stage}>{stage}</option>
              ))}
            </select>
            <button type="button" className="uf-secondary" onClick={reset}>
              清空筛选
            </button>
            <button type="button" className="uf-primary" onClick={exportCurrentList}>
              导出
            </button>
          </div>
        </header>
        <div className="uf-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "pending"}
            className={tab === "pending" ? "active" : ""}
            onClick={() => setTab("pending")}
          >
            待解决清单（{pending.length}）
          </button>
          <button
            role="tab"
            aria-selected={tab === "resolved"}
            className={tab === "resolved" ? "active" : ""}
            onClick={() => setTab("resolved")}
          >
            已解决档案（{resolved.length}）
          </button>
        </div>
        {filterColumns.length > 0 && (
          <div className="uf-multi-column-filter" aria-label="表格列筛选">
            {filterColumns.map((column) => {
              const definition = TABLE_FILTER_COLUMNS.find(
                (item) => item.key === column,
              );
              if (!definition) return null;
              return (
                <div className="uf-filter-item" key={column}>
                  <b>筛选“{definition.label}”</b>
                  <input
                    autoFocus
                    aria-label={`输入${definition.label}筛选内容`}
                    value={tableFilters[column] ?? ""}
                    placeholder="输入筛选内容"
                    onChange={(event) =>
                      setTableFilters((filters) => ({
                        ...filters,
                        [column]: event.target.value,
                      }))
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setTableFilters((filters) => ({
                        ...filters,
                        [column]: "",
                      }))
                    }
                  >
                    清除
                  </button>
                  <button type="button" onClick={() => toggleColumnFilter(column)}>
                    关闭
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {message && (
          <p className="uf-message" role="status">
            {message}
          </p>
        )}
        <div className="uf-table-wrap">
          <table>
            <thead>
              <tr>
                {TABLE_FILTER_COLUMNS.map((column) => (
                  <th key={column.key} scope="col">
                    <span className="uf-column-filter">
                      {column.label}
                      <button
                        type="button"
                        className={`uf-header-filter ${filterColumns.includes(column.key) ? "active" : ""}`}
                        aria-label={`筛选${column.label}`}
                        aria-pressed={filterColumns.includes(column.key)}
                        onClick={() => toggleColumnFilter(column.key)}
                      >
                        ⌕
                      </button>
                    </span>
                  </th>
                ))}
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((item) => {
                  const days = dayDistance(latest(item));
                  return (
                    <tr key={item.id}>
                      <td>{item.quarter}</td>
                      <td>{item.region}</td>
                      <td className="uf-sticky-customer" title={item.customer}>
                        <strong>{item.customer}</strong>
                        <small>{item.accountSet || "—"}</small>
                      </td>
                      <td>{item.owner || "—"}</td>
                      <td
                        className={
                          item.amount ? "uf-money danger" : "uf-money muted"
                        }
                      >
                        {money(item.amount)}
                      </td>
                      <td>
                        {days === null ? (
                          "—"
                        ) : (
                          <span
                            className={days > OVERDUE_DAYS ? "uf-overdue" : ""}
                          >
                            {days} 天
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="uf-clamp" title={item.firstSolution}>
                          {item.firstSolution}
                        </span>
                      </td>
                      <td>{latest(item) || "—"}</td>
                      <td>
                        <span
                          className="uf-clamp"
                          title={item.followUps
                            .map((entry) => entry.solution)
                            .join("；")}
                        >
                          {item.followUps
                            .map((entry) => entry.solution)
                            .join("；") || "—"}
                        </span>
                      </td>
                      <td>
                        <select
                          aria-label={`${item.customer} 财务关注`}
                          className={`uf-finance-select ${financeOf(item) === "需财务复核" ? "is-review" : financeOf(item) === "一般关注" ? "is-general" : ""}`}
                          value={item.financeAttention}
                          disabled={savingIds.has(item.reconciliationId)}
                          onChange={(event) =>
                            updateFinanceAttention(
                              item,
                              event.target.value as Finance,
                            )
                          }
                        >
                          <option value="none">未设置</option>
                          <option value="无需关注">无需关注</option>
                          <option value="一般关注">一般关注</option>
                          <option value="需财务复核">需财务复核</option>
                        </select>
                      </td>
                      <td>
                        <select
                          aria-label={`${item.customer} 问题处理阶段`}
                          className={`uf-stage-select ${item.processStage === "待财务调账" ? "is-finance" : ""}`}
                          value={item.processStage ?? ""}
                          disabled={!item.followupId || savingIds.has(item.reconciliationId)}
                          onChange={(event) =>
                            updateProcessStage(
                              item,
                              event.target.value as Exclude<ProcessStage, "已关闭">,
                            )
                          }
                        >
                          <option value="" disabled>未设置</option>
                          {PROCESS_STAGES.filter(
                            (stage) => stage !== "已关闭",
                          ).map((stage) => (
                            <option key={stage}>{stage}</option>
                          ))}
                        </select>
                      </td>
                      <td className="uf-actions">
                        <button
                          type="button"
                          className="uf-primary"
                          onClick={() => {
                            setEditing(item);
                            setFollowTime("");
                            setFollowSolution("");
                          }}
                        >
                          跟进填写
                        </button>
                        <button
                          type="button"
                          className="uf-secondary"
                          onClick={() => setDetail(item)}
                        >
                          查看详情
                        </button>
                        {tab === "pending" ? (
                          <button
                            type="button"
                            className="uf-resolve"
                            onClick={() => resolve(item)}
                            disabled={savingIds.has(item.reconciliationId)}
                          >
                            {savingIds.has(item.reconciliationId) ? "保存中…" : "已解决"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="uf-secondary"
                            onClick={() => restore(item)}
                            disabled={savingIds.has(item.reconciliationId)}
                          >
                            {savingIds.has(item.reconciliationId) ? "保存中…" : "撤销"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="uf-empty" colSpan={12}>
                    没有符合当前条件的数据。
                    <button type="button" onClick={reset}>
                      清空筛选
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <footer className="uf-pagination">
          <span>共 {visible.length} 条记录</span>
          <div>
            <button
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              上一页
            </button>
            <b>
              {page} / {pageCount}
            </b>
            <button
              disabled={page >= pageCount}
              onClick={() => setPage((value) => value + 1)}
            >
              下一页
            </button>
            <select
              value={pageSize}
              aria-label="每页条数"
              onChange={(event) => setPageSize(Number(event.target.value))}
            >
              <option value={10}>每页 10 条</option>
              <option value={20}>每页 20 条</option>
              <option value={50}>每页 50 条</option>
            </select>
          </div>
        </footer>
      </section>
      <section className="uf-grid uf-region-grid">
        <article className="uf-card uf-region">
          <header>
            <div>
              <p>超期客户区域跟踪</p>
              <h2>超期客户按区域跟踪</h2>
            </div>
            <button type="button" onClick={() => setRegion(ALL)}>
              查看全部
            </button>
          </header>
          <div className="uf-region-body">
            <aside>
              {regionStats.map((stat) => (
                <button
                  key={stat.name}
                  className={region === stat.name ? "selected" : ""}
                  onClick={() => setRegion(stat.name)}
                >
                  <b>{stat.name}</b>
                  <span>{stat.list.length} 客户</span>
                  <em>¥ {money(stat.amount)}</em>
                </button>
              ))}
            </aside>
            <div className="uf-region-customers">
              <div className="uf-region-metrics">
                <b>
                  <small>超期客户数</small>
                  {selectedOverdue.length}
                </b>
                <b>
                  <small>超期金额</small>¥{" "}
                  {money(
                    selectedOverdue.reduce(
                      (sum, item) => sum + Math.abs(item.amount),
                      0,
                    ),
                  )}
                </b>
                <b>
                  <small>平均超期天数</small>
                  {regionStats.find((stat) => stat.name === region)?.average ??
                    0}{" "}
                  天
                </b>
                <b>
                  <small>高风险客户数</small>
                  {
                    selectedOverdue.filter((item) => riskOf(item) === "高风险")
                      .length
                  }
                </b>
                <b>
                  <small>最近跟进时间</small>
                  {selectedOverdue
                    .map((item) => latest(item))
                    .filter(Boolean)
                    .sort()
                    .at(-1) || "—"}
                </b>
              </div>
              {selectedOverdue.length ? (
                <div className="uf-overdue-slider">
                  <button type="button" className="uf-card-scroll" aria-label="查看上一批超期客户" onClick={() => scrollOverdueCards(-1)}>‹</button>
                  <div className="uf-overdue-cards" ref={overdueCardsRef}>
                  {selectedOverdue.map((item) => (
                    <button
                      className="uf-customer-card"
                      key={item.id}
                      onClick={() => setDetail(item)}
                    >
                      <strong title={item.customer}>{item.customer}</strong>
                      <span>区域：<b>{item.region}</b></span>
                      <span>负责人：<b>{item.owner || "未填写"}</b></span>
                      <span>对账差额：<b>{money(item.amount)}</b></span>
                      <span>
                        超期天数：
                        <b className="uf-overdue">{dayDistance(latest(item)) ?? 0} 天</b>
                      </span>
                      <span>
                        财务关注：
                        <b
                          className={
                            financeOf(item) === "需财务复核"
                              ? "uf-finance-review"
                              : financeOf(item) === "一般关注"
                                ? "uf-finance-general"
                                : "uf-finance-none"
                          }
                        >
                          {financeLabel(financeOf(item))}
                        </b>
                      </span>
                    </button>
                  ))}
                  </div>
                  <button type="button" className="uf-card-scroll" aria-label="查看下一批超期客户" onClick={() => scrollOverdueCards(1)}>›</button>
                </div>
              ) : (
                <p className="uf-no-data">当前区域暂无超期客户。</p>
              )}
            </div>
          </div>
        </article>
      </section>
      <section className="uf-grid uf-charts">
        <article className="uf-card uf-distribution uf-count-distribution">
          <header>
            <h2>超期客户区域分布</h2>
            <span>单位：客户数</span>
          </header>
          {regionStats
            .filter((stat) => stat.name !== ALL)
            .sort(
              (a, b) =>
                b.list.length - a.list.length || b.amount - a.amount,
            )
            .map((stat) => (
              <button
                className="uf-bar"
                key={stat.name}
                onClick={() => setRegion(stat.name)}
              >
                <span>{stat.name}</span>
                <i>
                  <b
                    style={{
                      width: `${(stat.list.length / maxCustomers) * 100}%`,
                    }}
                  />
                </i>
                <strong>{stat.list.length}</strong>
                <em>
                  {(overdue.length
                    ? (stat.list.length / overdue.length) * 100
                    : 0
                  ).toFixed(1)}
                  %
                </em>
              </button>
            ))}
        </article>
        <article className="uf-card uf-distribution uf-amount-distribution">
          <header>
            <h2>超期金额区域分布</h2>
            <span>单位：元</span>
          </header>
          {regionStats
            .filter((stat) => stat.name !== ALL)
            .sort(
              (a, b) =>
                b.amount - a.amount || b.list.length - a.list.length,
            )
            .map((stat) => (
              <button
                className="uf-bar"
                key={stat.name}
                onClick={() => setRegion(stat.name)}
              >
                <span>{stat.name}</span>
                <i>
                  <b style={{ width: `${(stat.amount / maxAmount) * 100}%` }} />
                </i>
                <strong>¥ {money(stat.amount)}</strong>
                <em>
                  {(overdueAmount
                    ? (stat.amount / overdueAmount) * 100
                    : 0
                  ).toFixed(1)}
                  %
                </em>
              </button>
            ))}
        </article>
      </section>
      {editing && (
        <div
          className="uf-modal-backdrop"
          role="presentation"
          onMouseDown={() => setEditing(null)}
        >
          <section
            className="uf-modal"
            role="dialog"
            aria-modal="true"
            aria-label="跟进填写"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="uf-close"
              aria-label="关闭"
              onClick={() => setEditing(null)}
            >
              ×
            </button>
            <p>销售与财务协同跟进</p>
            <h2>{editing.customer}</h2>
            <span>
              对账差额：<b>{money(editing.amount)}</b>　首次方案：
              {editing.firstSolution}
            </span>
            <label>
              跟进解决时间
              <input
                type="date"
                value={followTime}
                onChange={(event) => setFollowTime(event.target.value)}
              />
            </label>
            <div className="uf-voice-field">
              <label>
              跟进解决方案
              <textarea
                value={followSolution}
                placeholder="填写本次跟进处理过程与下一步动作"
                onChange={(event) => setFollowSolution(event.target.value)}
              />
              </label>
              <VoiceInputButton value={followSolution} onChange={setFollowSolution} />
            </div>
            <button className="uf-primary" onClick={submitFollowUp}>
              保存本次跟进
            </button>
          </section>
        </div>
      )}
      {detail && (
        <div
          className="uf-modal-backdrop"
          role="presentation"
          onMouseDown={() => setDetail(null)}
        >
          <section
            className="uf-modal uf-detail"
            role="dialog"
            aria-modal="true"
            aria-label="客户详情"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="uf-close"
              aria-label="关闭"
              onClick={() => setDetail(null)}
            >
              ×
            </button>
            <p>
              {detail.quarter} · {detail.region}
            </p>
            <h2>{detail.customer}</h2>
            <dl>
              <div>
                <dt>对账差额</dt>
                <dd>{money(detail.amount)}</dd>
              </div>
              <div>
                <dt>风险等级</dt>
                <dd>
                  <Badge type={riskOf(detail)}>{riskOf(detail)}</Badge>
                </dd>
              </div>
              <div>
                <dt>财务关注</dt>
                <dd>
                  <Badge type={financeOf(detail)} variant="finance">
                    {financeLabel(financeOf(detail))}
                  </Badge>
                </dd>
              </div>
            </dl>
            <h3>首次解决方案</h3>
            <p>{detail.firstSolution}</p>
            <h3>跟进记录</h3>
            {detail.followUps.length ? (
              <ol>
                {detail.followUps.map((entry, index) => (
                  <li key={`${entry.time}-${index}`}>
                    <b>{entry.time || "未填写日期"}</b>
                    {entry.solution}
                  </li>
                ))}
              </ol>
            ) : (
              <p>暂无继续跟进记录。</p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
