"use client";
import { useEffect, useMemo, useState } from "react";
import { CockpitRow, cockpitRows, latestQuarterlyCockpitRows, updateDashboardSnapshot } from "./cockpit-data";
import { quarterOptions, selectQuarter, selectedQuarter } from "./quarter-storage";
import { CockpitTrendChart } from "./CockpitTrendChart";
import { DifferenceStructureChart } from "./DifferenceStructureChart";
import {
  AgingBucket,
  AgingDetailDrawer,
  buildDifferenceAgingBuckets,
  DifferenceAgingAnalysisCard,
  DifferenceAgingDetail,
} from "./DifferenceAgingAnalysis";
import { issuesForQuarter } from "./reconciliation-insights";
import "./management-cockpit.css";
import "./management-cockpit-refined.css";
type Props = {
  activeTab: "cockpit" | "issue";
  onTabChange: (tab: "cockpit" | "issue") => void;
};
type Filters = {
  quarter: string;
  region: string;
  accountSet: string;
  owner: string;
  customer: string;
  cleared: string;
  follow: string;
};
const money = (n: number) =>
    `${(n / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 1 })}万`,
  detailMoney = (n: number) =>
    n === 0
      ? "0"
      : n.toLocaleString("zh-CN", { maximumFractionDigits: 2 }),
  reconciliationStatus = (r: CockpitRow) =>
    !r.filled ? "未对账" : r.cleared ? "对清" : "未对清",
  today = new Date("2026-05-20").getTime(),
  overdue = (r: CockpitRow) =>
    new Date(r.expectedDate).getTime() < today && !r.actualDate;
const hasInvoiceException = (r: CockpitRow) =>
  Boolean(
    r.transitInvoiceFail ||
      r.returnInvoiceFail ||
      r.lostInvoiceFail ||
      r.instrumentInvoiceFail ||
      r.otherInvoiceFail ||
      r.duplicateInvoice,
  );
const LOST_DETAIL_TITLE = "\u4e22\u7968";
const AMOUNT_RATE_DETAIL_TITLE = "\u91d1\u989d\u5bf9\u8d26\u5b8c\u6210\u7387";
const CUSTOMER_RATE_DETAIL_TITLE = "\u5ba2\u6237\u5bf9\u6e05\u7387";
const PENDING_LIST_DETAIL_TITLE = "\u5f85\u89e3\u51b3\u6e05\u5355";
const HISTORICAL_INVOICE_RISK_TITLE = "\u5386\u53f2\u5b63\u5ea6\u5dee\u989d\u53d1\u7968\u98ce\u9669";
const hasHistoricalInvoiceReference = (value: string) =>
  /(?:19|20)(?:0\d|1\d|2[0-5])|(?:^|\D)(?:0\d|1\d|2[0-5])\s*[./-]\s*\d{1,2}/.test(value);
const historicalInvoiceAmount = (row: CockpitRow) => {
  const detailedAmount = row.historicalInvoices?.reduce(
    (sum, item) => sum + item.amount,
    0,
  ) ?? 0;
  if (detailedAmount) return detailedAmount;
  if (!hasHistoricalInvoiceReference(row.cause)) return 0;
  return Math.abs(
    row.transit + row.returned + (row.lost ?? 0) + (row.instrument ?? 0) + row.otherInvoice,
  );
};
const needsFollowUp = (r: CockpitRow) => r.followStatus !== "已解决";
// Keep the cockpit aligned with the execution page: a reconciliation only
// becomes an unresolved item after a first solution has been recorded, and it
// leaves the pending list once it is resolved.
const isPendingFollowUp = (r: CockpitRow) =>
  Boolean(r.solution.trim()) && r.followStatus !== "已解决";
const invoiceExceptionReason = (r: CockpitRow) =>
  [
    r.transitInvoiceFail && "在途明细缺少发票号、日期或金额",
    r.returnInvoiceFail && "退票明细缺少发票号、日期或金额",
    r.lostInvoiceFail && "丢票明细缺少发票号、日期或金额",
    r.instrumentInvoiceFail && "仪器设备明细缺少发票号、日期或金额",
    r.otherInvoiceFail && "其他（有发票）明细缺少发票号、日期或金额",
    r.duplicateInvoice && "存在重复发票号",
  ]
    .filter(Boolean)
    .join("；");
const score = (r: CockpitRow) =>
  Math.min(
    100,
    (r.difference ? 30 : 0) +
      (r.consecutiveUnclear ? 20 : 0) +
      (overdue(r) ? 20 : 0) +
      (hasInvoiceException(r) ? 15 : 0) +
      (r.difference && r.otherNoInvoice / r.difference > 0.2 ? 10 : 0) +
      (!r.solution ? 5 : 0),
  );
const level = (r: CockpitRow) =>
  score(r) >= 80
    ? "高风险"
    : score(r) >= 60
      ? "中风险"
      : score(r) >= 40
        ? "需关注"
        : "低风险";
// D 区风险口径按超期天数统一：超过 30 天为高风险，其余为低风险。
const overdueRiskLevel = (r: CockpitRow) =>
  (r.overdueDays ?? 0) > 30 ? "高风险" : "低风险";

const getRisks = (r: CockpitRow) =>
  [
    r.difference !==
      r.transit +
        r.returned +
        (r.lost ?? 0) +
        (r.instrument ?? 0) +
        r.otherInvoice +
        r.otherNoInvoice +
        r.badDebt +
        r.adjustment && "四类差额合计不一致",
    r.transitInvoiceFail && "在途发票校验失败",
    r.returnInvoiceFail && "退回发票校验失败",
    r.consecutiveUnclear && "连续两季度未对清",
    r.difference && r.otherNoInvoice / r.difference > 0.4 && "其他无票占比过高",
    overdue(r) && "逾期未解决",
    !r.solution && "未填写解决方案",
    r.duplicateInvoice && "存在重复发票",
  ].filter(Boolean) as string[];
export function ManagementCockpit({ activeTab, onTabChange }: Props) {
  const [f, setF] = useState<Filters>({
      quarter: "2026 Q2",
      region: "全部",
      accountSet: "全部",
      owner: "全部",
      customer: "",
      cleared: "全部",
      follow: "全部",
    }),
    [modal, setModal] = useState<{ title: string; rows: CockpitRow[] } | null>(
      null,
    ),
    [agingBucket, setAgingBucket] = useState<AgingBucket | null>(null),
    [range, setRange] = useState(4);
  const [availableQuarters, setAvailableQuarters] = useState<string[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  useEffect(() => {
    const syncQuarter = () => {
      setAvailableQuarters(quarterOptions());
      setF((value) => ({ ...value, quarter: selectedQuarter() || value.quarter }));
      setDataVersion((value) => value + 1);
    };
    syncQuarter();
    window.addEventListener("reconciliation-quarter-selected", syncQuarter);
    window.addEventListener("reconciliation-quarter-updated", syncQuarter);
    window.addEventListener("reconciliation-dashboard-updated", syncQuarter);
    return () => { window.removeEventListener("reconciliation-quarter-selected", syncQuarter); window.removeEventListener("reconciliation-quarter-updated", syncQuarter); window.removeEventListener("reconciliation-dashboard-updated", syncQuarter); };
  }, []);
  // The cockpit only reports customers that have been reconciled.  A blank
  // customer-book amount is "未对账"; even a customer-book amount of 0 is valid.
  const sourceQuarterRows = useMemo(
    () => cockpitRows.filter((row) => row.quarter === f.quarter),
    [f.quarter, dataVersion],
  );
  const quarterRows = useMemo(
    () =>
      sourceQuarterRows.filter((row) => row.filled),
    [sourceQuarterRows],
  );
  const regions = useMemo(
      () => [...new Set(quarterRows.map((row) => row.region))],
      [quarterRows],
    ),
    owners = useMemo(
      () => [...new Set(quarterRows.map((row) => row.owner))],
      [quarterRows],
    ),
    accountSets = useMemo(
      () => [...new Set(quarterRows.map((row) => row.accountSet))],
      [quarterRows],
    );
  const rows = useMemo(
    () =>
      quarterRows.filter(
        (r) =>
          r.quarter === f.quarter &&
          (f.region === "全部" || r.region === f.region) &&
          (f.accountSet === "全部" || r.accountSet === f.accountSet) &&
          (f.owner === "全部" || r.owner === f.owner) &&
          (!f.customer || r.customer.includes(f.customer)) &&
          (f.cleared === "全部" ||
            (f.cleared === "已对清" ? r.cleared : !r.cleared)) &&
          (f.follow === "全部" || r.followStatus === f.follow),
      ),
    [f, quarterRows],
  );
  const unaccountedRows = useMemo(
    () =>
      sourceQuarterRows.filter(
        (row) =>
          !row.filled &&
          (f.region === "全部" || row.region === f.region) &&
          (f.accountSet === "全部" || row.accountSet === f.accountSet) &&
          (f.owner === "全部" || row.owner === f.owner) &&
          (!f.customer || row.customer.includes(f.customer)) &&
          (f.follow === "全部" || row.followStatus === f.follow),
      ),
    [f, sourceQuarterRows],
  );
  // Difference categories must always use the latest current-year detail
  // fields, including columns added after an older dashboard snapshot.
  const categoryRows = useMemo(
    () =>
      latestQuarterlyCockpitRows().filter(
        (row) =>
          row.quarter === f.quarter &&
          row.filled &&
          (f.region === "全部" || row.region === f.region) &&
          (f.accountSet === "全部" || row.accountSet === f.accountSet) &&
          (f.owner === "全部" || row.owner === f.owner) &&
          (!f.customer || row.customer.includes(f.customer)) &&
          (f.cleared === "全部" ||
            (f.cleared === "已对清" ? row.cleared : !row.cleared)) &&
          (f.follow === "全部" || row.followStatus === f.follow),
      ),
    [f, dataVersion],
  );
  // 应对账总额固定取本季度对账明细：只排除未对账客户，不继承驾驶舱其余筛选条件。
  const reconciliationTotalRows = useMemo(() => {
    const latestRows = latestQuarterlyCockpitRows();
    const source = latestRows.length ? latestRows : cockpitRows;
    return source.filter((row) => row.quarter === f.quarter && row.filled);
  }, [f.quarter, dataVersion]);
  const pendingFollowUpRows = useMemo(
    () =>
      issuesForQuarter(f.quarter).filter(
        (row) =>
          (f.region === "全部" || row.region === f.region) &&
          (f.accountSet === "全部" || row.accountSet === f.accountSet) &&
          (f.owner === "全部" || row.owner === f.owner) &&
          (!f.customer || row.customer.includes(f.customer)) &&
          (f.cleared === "全部" || (f.cleared === "已对清" ? row.cleared : !row.cleared)) &&
          (f.follow === "全部" || row.followStatus === f.follow),
      ),
    [f],
  );
  const m = useMemo(() => {
    const currentDetailRows = categoryRows.length ? categoryRows : rows;
    let clear = rows.filter((x) => x.cleared).length,
      unclear = rows.length - clear;
    return {
      total: rows.length,
      // 应对账总额统一以客户账面金额为准，不再使用公司应收金额。
      reconciliationTotal: reconciliationTotalRows.reduce(
        (sum, row) => sum + row.companyReceivable,
        0,
      ),
      amountRate: rows.reduce((sum, row) => sum + (row.cleared ? row.companyReceivable : 0), 0) / Math.max(rows.reduce((sum, row) => sum + row.companyReceivable, 0), 1) * 100,
      // 未对清金额按未对清客户的公司应收总额统计，不采用对账差额。
      pendingConfirmation: rows.filter((row) => !row.cleared).reduce((sum, row) => sum + Math.abs(row.companyReceivable), 0),
      unaccounted: unaccountedRows.length,
      clear,
      unclear,
      rate: rows.length ? (clear / rows.length) * 100 : 0,
      unresolved: pendingFollowUpRows.reduce((sum, row) => sum + Math.abs(row.difference), 0),
      invoice: rows.filter(hasInvoiceException).length,
      overdue: rows.filter(overdue).length,
      overdueAmount: rows.filter(overdue).reduce((sum, row) => sum + Math.abs(row.difference), 0),
      adjustmentAmount: currentDetailRows.reduce((sum, row) => sum + Math.abs(row.adjustment), 0),
      badDebtAmount: currentDetailRows.reduce((sum, row) => sum + Math.abs(row.badDebt), 0),
      resolved: rows.filter((x) => x.followStatus === "已解决").length,
    };
  }, [rows, unaccountedRows, categoryRows, reconciliationTotalRows, pendingFollowUpRows]);
  const currentDetailRows = categoryRows.length ? categoryRows : rows;
  const agingBuckets = useMemo(
    () => buildDifferenceAgingBuckets(currentDetailRows, f.quarter),
    [currentDetailRows, f.quarter],
  );
  const lostDetails = currentDetailRows.filter((row) => (row.lost ?? 0) !== 0);
  const regionRows = regions
    .map((region) => {
      const x = rows.filter((r) => r.region === region),
        clear = x.filter((r) => r.cleared).length;
      return {
        region,
        x,
        clear,
        unclear: x.filter((row) => !row.cleared).length,
        rate: x.length ? (clear / x.length) * 100 : 0,
        amountRate:
          (x.reduce((sum, row) => sum + (row.cleared ? row.companyReceivable : 0), 0) /
            Math.max(x.reduce((sum, row) => sum + row.companyReceivable, 0), 1)) *
          100,
        // 区域表现的金额口径：未对清客户的公司应收，不使用待解决清单差额。
        unreconciledAmount: x
          .filter((row) => !row.cleared)
          .reduce((sum, row) => sum + Math.abs(row.companyReceivable), 0),
        risk: x.reduce((s, r) => s + getRisks(r).length, 0),
      };
    })
    .filter((x) => x.x.length)
    .sort((a, b) => b.unreconciledAmount - a.unreconciledAmount || b.risk - a.risk);
  const cats = [
    { name: "在途金额", color: "#2c78f6", value: categoryRows.reduce((sum, row) => sum + row.transit, 0), matches: (row: CockpitRow) => row.transit > 0 },
    { name: "退票金额", color: "#18b79b", value: categoryRows.reduce((sum, row) => sum + row.returned, 0), matches: (row: CockpitRow) => row.returned > 0 },
    { name: "丢票金额", color: "#f7af2d", value: categoryRows.reduce((sum, row) => sum + (row.lost ?? 0), 0), matches: (row: CockpitRow) => (row.lost ?? 0) > 0 },
    { name: "仪器设备", color: "#8d70e8", value: categoryRows.reduce((sum, row) => sum + (row.instrument ?? 0), 0), matches: (row: CockpitRow) => (row.instrument ?? 0) > 0 },
    {
      name: "其他",
      color: "#5aaeea",
      value: categoryRows.reduce((sum, row) => sum + row.otherInvoice + row.otherNoInvoice, 0),
      matches: (row: CockpitRow) => row.otherInvoice + row.otherNoInvoice > 0,
    },
  ].filter((item) => item.value);
  const categorizedDifference = cats.reduce((sum, item) => sum + item.value, 0);
  const historicalInvoiceRiskRows = categoryRows
    .filter((row) => historicalInvoiceAmount(row) > 0)
    .sort((a, b) => historicalInvoiceAmount(b) - historicalInvoiceAmount(a));
  const risks = Array.from(
    historicalInvoiceRiskRows
      .reduce((groups, row) => {
        const accountSet = row.accountSet || "未填写账套";
        const customer = row.customer || "未填写客户名称";
        const key = `${accountSet}__${customer}`;
        const current = groups.get(key) ?? {
          key,
          accountSet,
          customer,
          amount: 0,
          list: [] as CockpitRow[],
        };
        current.amount += historicalInvoiceAmount(row);
        current.list.push(row);
        groups.set(key, current);
        return groups;
      }, new Map<string, { key: string; accountSet: string; customer: string; amount: number; list: CockpitRow[] }>())
      .values(),
  )
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
  // D 区直接使用“未解决客户跟进”的待解决清单口径，不再额外按风险等级过滤。
  // 因此 Top10 与执行页的待解决客户一致，并以未解决金额从高到低排序。
  const highRiskUnresolvedCustomers = issuesForQuarter(f.quarter)
    .filter(
      (row) =>
        (f.region === "全部" || row.region === f.region) &&
        (f.accountSet === "全部" || row.accountSet === f.accountSet) &&
        (f.owner === "全部" || row.owner === f.owner) &&
        (!f.customer || row.customer.includes(f.customer)) &&
        (f.cleared === "全部" || (f.cleared === "已对清" ? row.cleared : !row.cleared)) &&
        (f.follow === "全部" || row.followStatus === f.follow),
    )
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || b.overdueDays - a.overdueDays);
  const priority = [...rows]
      .filter(isPendingFollowUp)
      .sort((a, b) => score(b) - score(a) || b.difference - a.difference),
    trend = quarterOptions()
      .slice()
      .sort((a, b) => a.localeCompare(b))
      .map((quarter) => {
        const reconciled = cockpitRows.filter(
          (row) =>
            row.quarter === quarter &&
            row.filled &&
            (f.region === "全部" || row.region === f.region) &&
            (f.accountSet === "全部" || row.accountSet === f.accountSet) &&
            (f.owner === "全部" || row.owner === f.owner) &&
            (!f.customer || row.customer.includes(f.customer)) &&
            (f.cleared === "全部" ||
              (f.cleared === "已对清" ? row.cleared : !row.cleared)) &&
            (f.follow === "全部" || row.followStatus === f.follow),
        );
        const cleared = reconciled.filter((row) => row.cleared).length;
        return {
          quarter,
          rate: reconciled.length ? (cleared / reconciled.length) * 100 : 0,
          unresolved: reconciled
            .filter(isPendingFollowUp)
            .reduce((sum, row) => sum + row.difference, 0),
          overdue: reconciled
            .filter(overdue)
            .reduce((sum, row) => sum + row.difference, 0),
          highRisk: reconciled
            .filter((row) => level(row) === "高风险")
            .reduce((sum, row) => sum + row.difference, 0),
        };
      })
      .slice(-range),
    compare = trend.length > 1 ? trend.at(-1)!.rate - trend.at(-2)!.rate : 0;
  const change = (key: keyof Filters, value: string) => {
      if (key === "quarter") {
        selectQuarter(value);
        setF((current) => ({
          ...current,
          quarter: value,
          region: "全部",
          accountSet: "全部",
          owner: "全部",
        }));
        return;
      }
      setF((current) => ({ ...current, [key]: value }));
    },
    refreshData = () => {
      updateDashboardSnapshot();
      setAvailableQuarters(quarterOptions());
      setF((current) => ({
        ...current,
        quarter: selectedQuarter() || current.quarter,
      }));
      setDataVersion((current) => current + 1);
    },
    open = (title: string, list: CockpitRow[]) =>
      setModal({ title, rows: list });
  const openAgingReconciliation = (detail: DifferenceAgingDetail) => {
    localStorage.setItem("reconciliation-detail-target", JSON.stringify(detail));
    selectQuarter(detail.quarter);
    window.dispatchEvent(new CustomEvent("reconciliation-open-current-detail", { detail }));
    setAgingBucket(null);
  };
  const download = () => {
    const data = [
        "客户,区域,账套,负责人,差额,状态,风险等级",
        ...rows.map((r) =>
          [
            r.customer,
            r.region,
            r.accountSet,
            r.owner,
            r.difference,
            r.cleared ? "已对清" : "未对清",
            level(r),
          ].join(","),
        ),
      ].join("\n"),
      a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob(["\ufeff" + data], { type: "text/csv" }),
    );
    a.download = `${f.quarter}-管理层驾驶舱.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const metrics = [
    { name: "应对账总额", value: money(m.reconciliationTotal), list: rows, tone: "blue", icon: "¥", note: "客户账面金额总额" },
    { name: CUSTOMER_RATE_DETAIL_TITLE, value: `${m.rate.toFixed(1)}%`, list: rows, tone: "blue", icon: "◎", note: "已对清客户占比" },
    { name: AMOUNT_RATE_DETAIL_TITLE, value: `${m.amountRate.toFixed(1)}%`, list: rows.filter((row) => row.cleared), tone: "green", icon: "✓", note: "较上季度 +0.6%" },
    { name: "未对清金额", value: money(m.pendingConfirmation), list: rows.filter((row) => !row.cleared), tone: "orange", icon: "⌛", note: "未对清客户公司应收总额" },
    { name: "未解决差额", value: money(m.unresolved), list: pendingFollowUpRows, detailTitle: PENDING_LIST_DETAIL_TITLE, tone: "red", icon: "△", note: "来自待解决清单" },
    { name: "调账金额", value: money(m.adjustmentAmount), list: currentDetailRows.filter((row) => row.adjustment !== 0), tone: "orange", icon: "⇄", note: "来自本年度对账明细" },
    { name: "死账金额", value: money(m.badDebtAmount), list: currentDetailRows.filter((row) => row.badDebt !== 0), tone: "purple", icon: "▣", note: "来自本年度对账明细" },
    { name: LOST_DETAIL_TITLE, value: money(lostDetails.reduce((sum, row) => sum + Math.abs(row.lost ?? 0), 0)), list: lostDetails, tone: "orange", icon: "▣", note: "来自对账看板票据情况" },
  ];
  return (
    <div className="cockpit">
      <div className="cockpit-tabs" hidden>
        <button
          className={activeTab === "cockpit" ? "active" : ""}
          onClick={() => onTabChange("cockpit")}
        >
          管理层驾驶舱
        </button>
        <button
          className={activeTab === "issue" ? "active" : ""}
          onClick={() => onTabChange("issue")}
        >
          问题解决看板
        </button>
      </div>
      {activeTab !== "cockpit" && (
        <div className="cockpit-subnotice">
          当前为问题解决
          视图，已复用同一筛选范围；完整业务操作可从左侧对账明细和客户跟进进入。
        </div>
      )}
      <section className="cockpit-filter">
        <label>
          季度
          <select
            value={f.quarter}
            onChange={(e) => change("quarter", e.target.value)}
          >
            {(availableQuarters.length ? availableQuarters : [f.quarter]).map((quarter) => <option key={quarter}>{quarter}</option>)}
          </select>
        </label>
        <label>
          区域
          <select
            value={f.region}
            onChange={(e) => change("region", e.target.value)}
          >
            <option>全部</option>
            {regions.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          账套
          <select
            value={f.accountSet}
            onChange={(e) => change("accountSet", e.target.value)}
          >
            <option>全部</option>
            {accountSets.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          对账负责人
          <select
            value={f.owner}
            onChange={(e) => change("owner", e.target.value)}
          >
            <option>全部</option>
            {owners.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label className="customer-search">
          客户名称
          <input
            value={f.customer}
            onChange={(e) => change("customer", e.target.value)}
            placeholder="请输入客户名称"
          />
        </label>
        <label>
          对清状态
          <select
            value={f.cleared}
            onChange={(e) => change("cleared", e.target.value)}
          >
            <option>全部</option>
            <option>已对清</option>
            <option>未对清</option>
          </select>
        </label>
        <label>
          跟进状态
          <select
            value={f.follow}
            onChange={(e) => change("follow", e.target.value)}
          >
            <option>全部</option>
            <option>待资料</option>
            <option>待跟进</option>
            <option>待财务复核</option>
            <option>已解决</option>
          </select>
        </label>
        <div className="filter-actions">
          <button
            onClick={() =>
              setF({
                quarter: selectedQuarter() || f.quarter,
                region: "全部",
                accountSet: "全部",
                owner: "全部",
                customer: "",
                cleared: "全部",
                follow: "全部",
              })
            }
          >
            重置筛选
          </button>
          <button onClick={download}>导出看板</button>
          <button className="primary" onClick={refreshData}>
            刷新数据
          </button>
        </div>
      </section>
      <div className="cockpit-conclusion">
        📣 <b>{f.quarter}</b> 共完成 <em>{m.total}</em> 家客户对账，对清率{" "}
        <em>{m.rate.toFixed(1)}%</em>，未对清 <strong>{m.unclear}</strong>{" "}
        家，未解决差额 <strong>{money(m.unresolved)}</strong>，风险主要集中在{" "}
        <strong>
          {regionRows
            .slice(0, 2)
            .map((x) => x.region)
            .join("和") || "当前筛选范围"}
        </strong>{" "}
        区域。
      </div>
      <section className="metric-grid">
        {metrics.map(({ name, value, list, detailTitle, tone, icon, note }) => (
          <button
            key={String(name)}
            className={`metric-card ${tone}`}
            onClick={() => open(detailTitle ?? name, list)}
          >
            <span className="metric-icon" aria-hidden="true">{icon}</span>
            <span>{name}</span>
            <b>{value}</b>
            <i>{note}</i>
          </button>
        ))}
      </section>
      <section className="cockpit-three">
        <>
        <DifferenceAgingAnalysisCard buckets={agingBuckets} formatAmount={money} onOpen={setAgingBucket} />
        <article className="panel risks" style={{ display: "none" }} aria-hidden="true">
          <h3>A. 核心风险与异常提醒 Top5</h3>
          <div className="risk-column-head" aria-hidden="true">
            <span>序号</span>
            <span>账套</span>
            <span>客户名称</span>
            <span>异常总金额</span>
          </div>
          {risks.length ? risks.map((x, i) => (
            <button key={x.key} onClick={() => open(`${HISTORICAL_INVOICE_RISK_TITLE}：${x.customer}`, x.list)}>
              <span className={`risk-rank ${i < 2 ? "danger" : i < 5 ? "warning" : "normal"}`}>
                {i + 1}
              </span>
              <span className="risk-account" title={x.accountSet}>{x.accountSet}</span>
              <b title={x.customer}>{x.customer}</b>
              <em title={`历史发票总金额：${detailMoney(x.amount)}元`}>
                {detailMoney(x.amount)}
              </em>
            </button>
          )) : <p className="risk-empty">暂无可识别的历史季度差额发票</p>}
          {historicalInvoiceRiskRows.length ? <a onClick={() => open(HISTORICAL_INVOICE_RISK_TITLE, historicalInvoiceRiskRows)}>查看全部风险 ›</a> : null}
        </article>
        </>
        <article className="panel region-panel">
          <h3>B. 区域对账表现 <small>按未对清金额排序</small></h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>区域</th>
                  <th>客户数</th>
                  <th>金额完成率</th>
                  <th>客户对清率</th>
                  <th>未对清金额</th>
                  <th>异常</th>
                </tr>
              </thead>
              <tbody>
                {regionRows.map((x) => (
                  <tr key={x.region} onClick={() => change("region", x.region)}>
                    <td>{x.region}</td>
                    <td>{x.x.length}</td>
                    <td>
                      <span
                        className={`rate blue ${x.amountRate < 80 ? "orange" : ""}`}
                      >
                        <i style={{ width: `${x.amountRate}%` }}></i>
                        {x.amountRate.toFixed(1)}%
                      </span>
                    </td>
                    <td>
                      <span
                        className={`rate ${x.rate >= 90 ? "green" : x.rate >= 80 ? "blue" : x.rate >= 70 ? "orange" : "red"}`}
                      >
                        <i style={{ width: `${x.rate}%` }}></i>
                        {x.rate.toFixed(1)}%
                      </span>
                    </td>
                    <td>{money(x.unreconciledAmount)}</td>
                    <td>{x.unclear}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td>合计</td>
                  <td>{m.total}</td>
                  <td>{m.amountRate.toFixed(1)}%</td>
                  <td>{m.rate.toFixed(1)}%</td>
                  <td>{money(rows.filter((row) => !row.cleared).reduce((sum, row) => sum + Math.abs(row.companyReceivable), 0))}</td>
                  <td>{m.unclear}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
        <article className="panel donut-panel">
          <h3>
            C. 差额结构分析 <small>（单位：元）</small>
          </h3>
          <div className="donut-wrap">
            <DifferenceStructureChart
              data={cats}
              total={categorizedDifference}
              onClick={() => open("未解决差额客户", rows.filter(isPendingFollowUp))}
            />
            <div>
              {cats.map((x) => (
                <button
                  className="legend"
                  key={x.name}
                  onClick={() =>
                    open(
                      x.name,
                      categoryRows.filter(x.matches),
                    )
                  }
                >
                  <i style={{ background: x.color }}></i>
                  {x.name}
                  <b>{money(x.value)}</b>
                  <small>
                    {categorizedDifference
                      ? `${((x.value / categorizedDifference) * 100).toFixed(1)}%`
                      : "0%"}
                  </small>
                </button>
              ))}
            </div>
          </div>
        </article>
      </section>
      <section className="cockpit-lower">
        <article className="panel follow-panel">
          <h3>
            D. 高风险未解决客户 Top10{" "}
            <button onClick={() => open("全部高风险未解决客户", highRiskUnresolvedCustomers)}>
              查看全部客户 ›
            </button>
          </h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>客户</th>
                  <th>区域</th>
                  <th>负责人</th>
                  <th>对账差额</th>
                  <th>超期天数</th>
                  <th>状态</th>
                  <th>预计完成</th>
                  <th>风险</th>
                </tr>
              </thead>
              <tbody>
                {highRiskUnresolvedCustomers.slice(0, 10).map((r) => (
                  <tr key={r.id} onClick={() => open(r.customer, [r])}>
                    <td>{r.customer}</td>
                    <td>{r.region}</td>
                    <td>{r.owner}</td>
                    <td>{money(r.difference)}</td>
                    <td
                      className={`overdue-days ${
                        r.overdueDays > 30 ? "high" : ""
                      }`}
                    >
                      {r.overdueDays}天
                    </td>
                    <td>
                      <span className="status">{r.followStatus}</span>
                    </td>
                    <td>{r.expectedDate}</td>
                    <td>
                      <span
                        className={`risk-badge ${
                          overdueRiskLevel(r) === "高风险" ? "high" : ""
                        }`}
                      >
                        {overdueRiskLevel(r)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
        {false && <article className="panel trend-panel">
          <h3>
            E. 历史趋势{" "}
            <span>
              <button
                onClick={() => setRange(4)}
                className={range === 4 ? "picked" : ""}
              >
                最近4季
              </button>
              <button
                onClick={() => setRange(2)}
                className={range === 2 ? "picked" : ""}
              >
                最近2季
              </button>
            </span>
          </h3>
          <CockpitTrendChart data={trend} onQuarterClick={(quarter) => change("quarter", quarter)} />
          <p>
            对清率较上季{" "}
            <b className={compare >= 0 ? "up" : "down"}>
              {compare >= 0 ? "提升" : "下降"} {Math.abs(compare).toFixed(1)}{" "}
              个百分点
            </b>
            ，未解决差额呈 <b>{compare >= 0 ? "收窄" : "扩大"}</b> 趋势。
          </p>
        </article>}
        <article className="panel analysis">
          <h3>F. 自动财务分析结论</h3>
          <ol>
            <li>
              本季度对清率为 <b>{m.rate.toFixed(1)}%</b>，较上季
              {compare >= 0 ? "提升" : "下降"}{" "}
              <b>{Math.abs(compare).toFixed(1)}</b> 个百分点；
            </li>
            <li>
              {regionRows[0]?.region || "当前"}区域未对清金额最高，占比{" "}
              <b>
                {m.pendingConfirmation
                  ? `${((regionRows[0]?.unreconciledAmount / m.pendingConfirmation) * 100).toFixed(1)}%`
                  : "0%"}
              </b>
              ；
            </li>
            <li>
              高风险客户{" "}
              <b>{priority.filter((x) => level(x) === "高风险").length}</b>{" "}
              家，优先处理逾期与连续未对清客户；
            </li>
            <li>
              发票校验异常 <b>{m.invoice}</b>{" "}
              笔，需完成票号、日期和金额一致性核验；
            </li>
            <li>
              建议先推进{" "}
              <b>
                {priority
                  .slice(0, 2)
                  .map((x) => x.customer)
                  .join("、") || "当前筛选客户"}
              </b>{" "}
              的方案闭环。
            </li>
          </ol>
          <footer>数据统计截止：2026-05-20 18:00　数据仅供参考</footer>
        </article>
      </section>
      {f.quarter === "2026 Q1" && (
        <section className="q1-cockpit-extra">
          <b>2026 Q1 专项信息</b>
          <span>
            资料收集、丢票与不对账客户专项数据已联动至左侧历史看板；可继续查看专属行动清单与区域完成率。
          </span>
        </section>
      )}
      {agingBucket && <AgingDetailDrawer bucket={agingBucket} onClose={() => setAgingBucket(null)} onOpenReconciliation={openAgingReconciliation} formatAmount={money} />}
      {modal && (
        <div
          className="cockpit-modal"
          role="presentation"
          onMouseDown={() => setModal(null)}
        >
          <section
            className="cockpit-detail-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`${modal.title}明细`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="cockpit-detail-head">
              <div>
                <span>指标明细</span>
                <h2>{modal.title}</h2>
                <p>当前筛选范围内共 {modal.rows.length} 条记录</p>
              </div>
              <button
                className="modal-close"
                aria-label="关闭明细"
                onClick={() => setModal(null)}
              >
              ×
              </button>
            </header>
            <div className="cockpit-detail-table-wrap">
              {modal.title === PENDING_LIST_DETAIL_TITLE ? (
                <table className="cockpit-detail-table cockpit-pending-detail-table">
                  <thead>
                    <tr>
                      <th scope="col">季度</th>
                      <th scope="col">账套</th>
                      <th scope="col">区域</th>
                      <th scope="col">客户</th>
                      <th scope="col">负责人</th>
                      <th scope="col">对账差额</th>
                      <th scope="col">初步解决时间</th>
                      <th scope="col">首次解决方案</th>
                      <th scope="col">问题处理阶段</th>
                      <th scope="col">跟进状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modal.rows.map((row) => (
                      <tr key={row.id} className="has-difference">
                        <td>{row.quarter}</td>
                        <td>{row.accountSet || "—"}</td>
                        <td>{row.region}</td>
                        <td className="detail-customer" title={row.customer}>{row.customer}</td>
                        <td>{row.owner || "—"}</td>
                        <td className="detail-money difference-money">{detailMoney(row.difference)}</td>
                        <td>{row.expectedDate || "—"}</td>
                        <td><span className="detail-clamp" title={row.solution}>{row.solution || "—"}</span></td>
                        <td>{row.processStage || "—"}</td>
                        <td><span className="detail-status">{row.followStatus || "—"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : modal.title === AMOUNT_RATE_DETAIL_TITLE || modal.title === CUSTOMER_RATE_DETAIL_TITLE ? (
                <table className="cockpit-detail-table cockpit-amount-reason-table">
                  <thead>
                    <tr>
                      <th scope="col">区域</th>
                      <th scope="col">客户数</th>
                      <th scope="col">{modal.title}</th>
                      <th scope="col">未对清金额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regionRows.map((row) => {
                      const rate = modal.title === AMOUNT_RATE_DETAIL_TITLE ? row.amountRate : row.rate;
                      return <tr key={row.region}>
                        <td>{row.region}</td>
                        <td className="detail-money">{row.x.length}</td>
                        <td className="detail-money primary-money">{rate.toFixed(1)}%</td>
                        <td className={`detail-money ${row.unreconciledAmount ? "difference-money" : "muted-money"}`}>{detailMoney(row.unreconciledAmount)}</td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              ) : modal.title.startsWith(HISTORICAL_INVOICE_RISK_TITLE) ? (
                <table className="cockpit-detail-table cockpit-amount-reason-table">
                  <thead>
                    <tr>
                      <th scope="col">序号</th>
                      <th scope="col">季度</th>
                      <th scope="col">账套</th>
                      <th scope="col">区域</th>
                      <th scope="col">客户名称</th>
                      <th scope="col">差额类型</th>
                      <th scope="col">开票日期</th>
                      <th scope="col">发票号</th>
                      <th scope="col">历史发票金额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modal.rows
                      .flatMap((row) =>
                        (row.historicalInvoices ?? []).map((invoice) => ({
                          row,
                          invoice,
                        })),
                      )
                      .sort((a, b) => b.invoice.amount - a.invoice.amount)
                      .map(({ row, invoice }, index) => (
                        <tr key={`${row.id}-${invoice.category}-${invoice.invoice}-${index}`}>
                          <td>{index + 1}</td>
                          <td>{row.quarter}</td>
                          <td>{row.accountSet || "—"}</td>
                          <td>{row.region}</td>
                          <td className="detail-customer" title={row.customer}>{row.customer}</td>
                          <td>{invoice.category}</td>
                          <td>{invoice.date}</td>
                          <td>{invoice.invoice}</td>
                          <td className="detail-money difference-money">{detailMoney(invoice.amount)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ) : modal.title === LOST_DETAIL_TITLE ? (
                <table className="cockpit-detail-table cockpit-amount-reason-table">
                  <thead>
                    <tr>
                      <th scope="col">序号</th>
                      <th scope="col">季度</th>
                      <th scope="col">账套</th>
                      <th scope="col">区域</th>
                      <th scope="col">客户名称</th>
                      <th scope="col">丢票金额</th>
                      <th scope="col">差额原因备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modal.rows.map((r, index) => (
                      <tr key={r.id}>
                        <td>{index + 1}</td>
                        <td>{r.quarter}</td>
                        <td>{r.accountSet || "—"}</td>
                        <td>{r.region}</td>
                        <td className="detail-customer" title={r.customer}>{r.customer}</td>
                        <td className="detail-money difference-money">{detailMoney(r.lost ?? 0)}</td>
                        <td><span className="detail-clamp" title={r.cause}>{r.cause || "—"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : modal.title === "调账金额" || modal.title === "死账金额" ? (
                <table className="cockpit-detail-table cockpit-amount-reason-table">
                  <thead>
                    <tr>
                      <th scope="col">序号</th>
                      <th scope="col">季度</th>
                      <th scope="col">账套</th>
                      <th scope="col">区域</th>
                      <th scope="col">客户名称</th>
                      <th scope="col">对账负责人</th>
                      <th scope="col">{modal.title}</th>
                      <th scope="col">{modal.title === "调账金额" ? "调账原因" : "死账原因"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modal.rows.map((r, index) => {
                      const isAdjustment = modal.title === "调账金额";
                      const amount = isAdjustment ? r.adjustment : r.badDebt;
                      const reason = isAdjustment ? r.adjustmentReason : r.badDebtReason;
                      return <tr key={r.id}>
                        <td>{index + 1}</td>
                        <td>{r.quarter}</td>
                        <td>{r.accountSet || "—"}</td>
                        <td>{r.region}</td>
                        <td className="detail-customer" title={r.customer}>{r.customer}</td>
                        <td>{r.owner}</td>
                        <td className="detail-money difference-money">{detailMoney(amount)}</td>
                        <td><span className="detail-clamp" title={reason}>{reason || "—"}</span></td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              ) : (
              <table className="cockpit-detail-table">
                <thead>
                  <tr>
                    <th scope="col">序号</th>
                    <th scope="col">季度</th>
                    <th scope="col">账套</th>
                    <th>区域</th>
                    <th scope="col">客户名称</th>
                    <th scope="col">对账负责人</th>
                    <th scope="col">公司应收</th>
                    <th scope="col">客户账面金额</th>
                    <th scope="col">对账差额</th>
                    <th scope="col">在途金额</th>
                    <th scope="col">退票金额</th>
                    <th scope="col">调账金额</th>
                    <th scope="col">死账金额</th>
                    <th scope="col">其他（有发票）</th>
                    <th scope="col">其他（无发票）</th>
                    <th scope="col">差额原因备注</th>
                    <th scope="col">是否对清</th>
                    <th scope="col">解决方案</th>
                    <th scope="col">解决时间</th>
                  </tr>
                </thead>
                <tbody>
                  {modal.rows.map((r, index) => (
                    <tr key={r.id} className={r.difference ? "has-difference" : ""}>
                      <td>{index + 1}</td>
                      <td>{r.quarter}</td>
                      <td>{r.accountSet || "—"}</td>
                      <td>{r.region}</td>
                      <td className="detail-customer" title={r.customer}>{r.customer}</td>
                      <td>{r.owner}</td>
                      <td className="detail-money primary-money">{detailMoney(r.companyReceivable)}</td>
                      <td className="detail-money primary-money">{r.filled ? detailMoney(r.customerBook) : "—"}</td>
                      <td className={`detail-money ${r.difference ? "difference-money" : "muted-money"}`}>{r.filled ? detailMoney(r.difference) : "—"}</td>
                      <td className="detail-money">{detailMoney(r.transit)}</td>
                      <td className="detail-money">{detailMoney(r.returned)}</td>
                      <td className="detail-money">{detailMoney(r.adjustment)}</td>
                      <td className="detail-money">{detailMoney(r.badDebt)}</td>
                      <td className="detail-money">{detailMoney(r.otherInvoice)}</td>
                      <td className="detail-money">{detailMoney(r.otherNoInvoice)}</td>
                      <td><span className="detail-clamp" title={modal.title === "发票校验异常" ? invoiceExceptionReason(r) : r.cause}>{modal.title === "发票校验异常" ? invoiceExceptionReason(r) : r.cause || "—"}</span></td>
                      <td><span className={`detail-status ${reconciliationStatus(r)}`}>{reconciliationStatus(r)}</span></td>
                      <td><span className="detail-clamp" title={r.solution}>{r.solution || "—"}</span></td>
                      <td>{r.actualDate || r.expectedDate || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
