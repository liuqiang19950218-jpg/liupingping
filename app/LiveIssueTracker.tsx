"use client";

import {
  useEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import "./issue-tracker.css";

const KEY = "local-quarterly-reconciliation";
const VIEW_KEY = "local-quarterly-reconciliation-issue-tracker-view";

type FollowUp = { time: string; solution: string };
type Detail = {
  resolutionSolution?: string;
  resolutionTime?: string;
  resolved?: boolean;
  reopened?: boolean;
  followUps?: FollowUp[];
};
type Sheet = {
  headers: string[];
  rows: unknown[][];
  fileName: string;
  details?: Record<string, Detail>;
};
type Item = {
  id: number;
  quarter: string;
  accountSet: string;
  region: string;
  customer: string;
  owner: string;
  amount: string;
  solution: string;
  time: string;
  resolved: boolean;
  followUps: FollowUp[];
};
type RegionStat = { region: string; customers: number; amount: number };
type ColumnKey =
  | "quarter"
  | "accountSet"
  | "region"
  | "customer"
  | "owner"
  | "amount"
  | "time"
  | "solution"
  | "followUpTime"
  | "followUpSolution"
  | "followUpActions"
  | "actions";
type TrackerColumn = {
  key: ColumnKey;
  label: string;
  width: number;
  className?: string;
};

const columns: TrackerColumn[] = [
  { key: "quarter", label: "季度", width: 86 },
  { key: "accountSet", label: "账套", width: 110 },
  { key: "region", label: "区域", width: 88 },
  { key: "customer", label: "客户", width: 190, className: "tracker-customer" },
  { key: "owner", label: "负责人", width: 113 },
  { key: "amount", label: "对账差额", width: 189, className: "tracker-money" },
  { key: "time", label: "初步解决时间", width: 189 },
  {
    key: "solution",
    label: "首次解决方案",
    width: 378,
    className: "tracker-long-text",
  },
  { key: "followUpTime", label: "继续解决时间", width: 150 },
  {
    key: "followUpSolution",
    label: "继续解决方案",
    width: 240,
    className: "tracker-long-text",
  },
  { key: "followUpActions", label: "跟进记录操作", width: 150 },
  { key: "actions", label: "操作", width: 160 },
];

function read(): Item[] {
  try {
    const sheet = JSON.parse(
      localStorage.getItem(KEY) || "null",
    ) as Sheet | null;
    if (!sheet) return [];
    const at = (name: string) => sheet.headers.indexOf(name);
    const contains = (name: string) => sheet.headers.findIndex((header) => String(header).replace(/\s/g, "").includes(name));
    const match = String(sheet.fileName).match(/(\d{2,4}).*?([1-4])季度/);
    const quarter = match
      ? `${match[1].length === 2 ? `20${match[1]}` : match[1]} Q${match[2]}`
      : "2026 Q2";
    return sheet.rows
      .map((row, id) => {
        const detail = sheet.details?.[String(id)] ?? {};
        const solution =
          detail.resolutionSolution || String(row[at("解决方案")] ?? "");
        const time = detail.resolutionTime || String(row[at("解决时间")] ?? "");
        const followUps = Array.isArray(detail.followUps)
          ? detail.followUps
              .filter((entry) => entry && typeof entry.solution === "string")
              .map((entry) => ({
                time: String(entry.time ?? ""),
                solution: String(entry.solution ?? ""),
              }))
          : [];
        return {
          id,
          quarter,
          accountSet: String(row[contains("账套")] ?? ""),
          region: String(row[at("区域")] ?? ""),
          customer: String(row[at("客户名称")] ?? ""),
          owner: String(row[at("对账负责人")] ?? ""),
          amount: String(row[at("对账差额")] ?? ""),
          solution,
          time,
          resolved: detail.resolved === true || (!time && detail.reopened !== true),
          followUps,
        };
      })
      .filter((item) => item.customer && item.solution.trim() !== "");
  } catch {
    return [];
  }
}

function updateDetail(id: number, changes: Partial<Detail>) {
  const sheet = JSON.parse(localStorage.getItem(KEY) || "null") as Sheet | null;
  if (!sheet) return;
  sheet.details = {
    ...(sheet.details ?? {}),
    [String(id)]: { ...(sheet.details?.[String(id)] ?? {}), ...changes },
  };
  localStorage.setItem(KEY, JSON.stringify(sheet));
  window.dispatchEvent(new Event("reconciliation-updated"));
}

function amountOf(value: string) {
  const amount = Number(value.replace(/,/g, ""));
  return Number.isFinite(amount) ? Math.abs(amount) : 0;
}
function formatAmount(value: string) {
  const amount = Number(value.replace(/,/g, ""));
  return Number.isFinite(amount)
    ? amount.toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : value || "—";
}

function latestFollowUpTime(item: Item) {
  for (let index = item.followUps.length - 1; index >= 0; index -= 1) {
    const value = item.followUps[index].time.trim();
    if (value) return value;
  }
  return item.time.trim();
}

function daysSince(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

function OverdueFollowUpDashboard({ items }: { items: Item[] }) {
  const overdue = items
    .map((item) => ({ item, lastTime: latestFollowUpTime(item) }))
    .map((entry) => ({ ...entry, days: daysSince(entry.lastTime) }))
    .filter(
      (entry): entry is { item: Item; lastTime: string; days: number } =>
        entry.days !== null && entry.days > 7,
    )
    .sort((a, b) => b.days - a.days);
  return (
    <section className="overdue-followup-dashboard" aria-label="超期未跟进预警">
      <header>
        <div>
          <p>跟进时效预警</p>
          <h3>超期未跟进预警</h3>
          <span>
            以最后一次继续解决时间为准；没有继续记录时，使用初步解决时间。超过 7
            天未跟进将触发预警。
          </span>
        </div>
        <strong>{overdue.length} 家</strong>
      </header>
      {overdue.length ? (
        <div className="overdue-followup-list">
          {overdue.map(({ item, lastTime, days }) => (
            <article key={item.id}>
              <b>{item.customer}</b>
              <span>
                {item.region || "未填写区域"} · {item.owner || "未填写负责人"}
              </span>
              <em>对账差额：{item.amount || "—"}</em>
              <small>
                最后跟进：{lastTime} · 已超期 {days} 天
              </small>
            </article>
          ))}
        </div>
      ) : (
        <p className="overdue-followup-empty">
          当前没有超过 7 天未跟进的待解决客户。
        </p>
      )}
    </section>
  );
}

function RegionDashboard({ items }: { items: Item[] }) {
  const byRegion = new Map<string, RegionStat>();
  items.forEach((item) => {
    const region = item.region.trim() || "未填写区域";
    const current = byRegion.get(region) ?? { region, customers: 0, amount: 0 };
    current.customers += 1;
    current.amount += amountOf(item.amount);
    byRegion.set(region, current);
  });
  const stats = [...byRegion.values()];
  const totalCustomers = items.length;
  const totalAmount = stats.reduce((total, item) => total + item.amount, 0);
  const renderRows = (
    list: RegionStat[],
    kind: "customers" | "amount",
    total: number,
  ) =>
    list.length ? (
      list.map((item) => {
        const value = kind === "customers" ? item.customers : item.amount;
        const percent = total ? (value / total) * 100 : 0;
        return (
          <div className="region-row" key={item.region}>
            <span>{item.region}</span>
            <div className="region-progress">
              <i style={{ width: `${percent}%` }} />
            </div>
            <strong>
              {kind === "customers"
                ? `${item.customers} 客`
                : item.amount.toLocaleString("zh-CN", {
                    maximumFractionDigits: 2,
                  })}
            </strong>
            <small>{percent.toFixed(1)}%</small>
          </div>
        );
      })
    ) : (
      <p className="region-empty">暂无待解决数据</p>
    );
  return (
    <>
      <OverdueFollowUpDashboard items={items} />
      <section className="region-dashboard">
        <article>
          <header>
            <h3>待解决客户区域占比</h3>
            <span>共 {totalCustomers} 客</span>
          </header>
          {renderRows(
            [...stats].sort((a, b) => b.customers - a.customers),
            "customers",
            totalCustomers,
          )}
        </article>
        <article>
          <header>
            <h3>待解决金额区域占比</h3>
            <span>
              合计{" "}
              {totalAmount.toLocaleString("zh-CN", {
                maximumFractionDigits: 2,
              })}
            </span>
          </header>
          {renderRows(
            [...stats].sort((a, b) => b.amount - a.amount),
            "amount",
            totalAmount,
          )}
        </article>
      </section>
    </>
  );
}

export function LiveIssueTracker() {
  const [items, setItems] = useState<Item[]>([]);
  const [tab, setTab] = useState("待解决清单");
  const [editing, setEditing] = useState<Item | null>(null);
  const [editingFollowUp, setEditingFollowUp] = useState<number | null>(null);
  const [followUpSolution, setFollowUpSolution] = useState("");
  const [followUpTime, setFollowUpTime] = useState("");
  const [message, setMessage] = useState("");
  const [columnWidths, setColumnWidths] = useState<
    Partial<Record<ColumnKey, number>>
  >({});
  const [filterKey, setFilterKey] = useState<ColumnKey | null>(null);
  const [columnFilters, setColumnFilters] = useState<Partial<Record<ColumnKey, string>>>({});
  const sync = () => setItems(read());
  useEffect(() => {
    sync();
    window.addEventListener("reconciliation-updated", sync);
    return () => window.removeEventListener("reconciliation-updated", sync);
  }, []);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(VIEW_KEY) || "{}");
      if (saved && typeof saved === "object")
        setColumnWidths(saved as Partial<Record<ColumnKey, number>>);
    } catch {
      /* ignore invalid local preference */
    }
  }, []);
  useEffect(() => {
    localStorage.setItem(VIEW_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);
  const pending = items.filter((item) => !item.resolved);
  const resolved = items.filter((item) => item.resolved);
  const rows = tab === "待解决清单" ? pending : resolved;
  const valueOf = (item: Item, key: ColumnKey) => {
    if (key === "quarter") return item.quarter;
    if (key === "accountSet") return item.accountSet;
    if (key === "region") return item.region;
    if (key === "customer") return item.customer;
    if (key === "owner") return item.owner;
    if (key === "amount") return item.amount;
    if (key === "time") return item.time;
    if (key === "solution") return item.solution;
    if (key === "followUpTime") return item.followUps.map(entry => entry.time).join(" ");
    if (key === "followUpSolution") return item.followUps.map(entry => entry.solution).join(" ");
    if (key === "followUpActions") return item.followUps.length ? "修改 删除" : "";
    return item.resolved ? "已解决" : "待解决";
  };
  const filteredRows = rows.filter(item => Object.entries(columnFilters).every(([key, value]) => !value || valueOf(item, key as ColumnKey).toLocaleLowerCase().includes(value.toLocaleLowerCase().trim())));
  const startColumnResize = (
    event: ReactPointerEvent<HTMLButtonElement>,
    key: ColumnKey,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const initial =
      columnWidths[key] ??
      columns.find((column) => column.key === key)?.width ??
      120;
    const move = (pointer: PointerEvent) =>
      setColumnWidths((current) => ({
        ...current,
        [key]: Math.max(72, initial + pointer.clientX - startX),
      }));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };
  const startFollowUp = (item: Item) => {
    setEditing(item);
    setEditingFollowUp(null);
    setFollowUpSolution("");
    setFollowUpTime("");
    setMessage("");
  };
  const editFollowUp = (item: Item, index: number) => {
    const entry = item.followUps[index];
    setEditing(item);
    setEditingFollowUp(index);
    setFollowUpSolution(entry.solution);
    setFollowUpTime(entry.time);
    setMessage("");
  };
  const closeEditor = () => {
    setEditing(null);
    setEditingFollowUp(null);
  };
  const saveFollowUp = () => {
    if (!editing) return;
    if (!followUpSolution.trim()) {
      setMessage("请填写继续解决方案。");
      return;
    }
    const followUps = [...editing.followUps];
    const next = { time: followUpTime, solution: followUpSolution.trim() };
    if (editingFollowUp === null) followUps.push(next);
    else followUps[editingFollowUp] = next;
    updateDetail(editing.id, { followUps, resolved: false });
    closeEditor();
    setMessage(
      editingFollowUp === null
        ? "已新增一条继续跟进记录，首次填写的信息保持不变。"
        : "已修改这条继续跟进记录。",
    );
  };
  const deleteFollowUp = (item: Item, index: number) => {
    const followUps = item.followUps.filter(
      (_, entryIndex) => entryIndex !== index,
    );
    updateDetail(item.id, { followUps });
    if (editing?.id === item.id && editingFollowUp === index) closeEditor();
    setMessage("已删除这条继续跟进记录。");
  };
  const complete = (item: Item) => {
    updateDetail(item.id, { resolved: true, reopened: false });
    setMessage("已转入已解决档案。");
  };
  const undoComplete = (item: Item) => {
    updateDetail(item.id, { resolved: false, reopened: true });
    setMessage("已撤销已解决，该客户已返回待解决清单。");
  };
  const widthOf = (column: TrackerColumn) => ({
    width: `${columnWidths[column.key] ?? column.width}px`,
    minWidth: `${columnWidths[column.key] ?? column.width}px`,
  });
  const cell = (column: TrackerColumn, content: ReactNode) => (
    <td key={column.key} className={column.className} style={widthOf(column)}>
      {column.key === "amount" ? formatAmount(String(content ?? "")) : content}
    </td>
  );
  return (
    <section className="issue-tracker">
      <div className="tracker-top">
        <div>
          <p>与对账明细自动同步</p>
          <h2>未解决客户跟进</h2>
          <span>
            继续跟进记录可随时修改或删除，首次填写的解决时间和方案不会被覆盖。
          </span>
        </div>
      </div>
      <div className="tracker-tabs">
        <button
          type="button"
          className={tab === "待解决清单" ? "active" : ""}
          onClick={() => setTab("待解决清单")}
        >{`待解决清单（${pending.length}）`}</button>
        <button
          type="button"
          className={tab === "已解决档案" ? "active" : ""}
          onClick={() => setTab("已解决档案")}
        >{`已解决档案（${resolved.length}）`}</button>
      </div>
      {editing && (
        <div className="resolve-box">
          <div>
            <label>
              继续解决时间
              <input
                type="date"
                value={followUpTime}
                onChange={(event) => setFollowUpTime(event.target.value)}
              />
            </label>
            <label className="follow-solution">
              继续解决方案
              <input
                value={followUpSolution}
                placeholder="填写本次继续跟进方案"
                onChange={(event) => setFollowUpSolution(event.target.value)}
              />
            </label>
          </div>
          <button type="button" onClick={saveFollowUp}>
            {editingFollowUp === null ? "新增跟进" : "保存修改"}
          </button>
          <button type="button" className="secondary" onClick={closeEditor}>
            取消
          </button>
        </div>
      )}
      {message && (
        <p className="tracker-message" role="status">
          {message}
        </p>
      )}
      <div className="issue-table">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={column.className}
                  style={widthOf(column)}
                  scope="col"
                >
                  <span>{column.label}</span>
                  <button
                    className={`tracker-column-filter${columnFilters[column.key] ? " is-filtered" : ""}`}
                    type="button"
                    aria-label={`筛选${column.label}`}
                    onClick={() => setFilterKey(current => current === column.key ? null : column.key)}
                  >
                    ⌕
                  </button>
                  {filterKey === column.key && (
                    <div className="tracker-filter-popover">
                      <input
                        autoFocus
                        aria-label={`筛选${column.label}`}
                        value={columnFilters[column.key] ?? ""}
                        placeholder={`筛选${column.label}`}
                        onChange={event => setColumnFilters(current => ({ ...current, [column.key]: event.target.value }))}
                      />
                      <button type="button" onClick={() => { setColumnFilters(current => ({ ...current, [column.key]: "" })); setFilterKey(null); }}>清除</button>
                    </div>
                  )}
                  <button
                    className="tracker-column-resize"
                    type="button"
                    aria-label={`调整${column.label}列宽`}
                    onPointerDown={(event) =>
                      startColumnResize(event, column.key)
                    }
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.length ? (
              filteredRows.map((item) => (
                <tr key={item.id}>
                  {columns.map((column) => {
                    switch (column.key) {
                      case "quarter":
                        return cell(column, item.quarter);
                      case "accountSet":
                        return cell(column, item.accountSet || "—");
                      case "region":
                        return cell(column, item.region);
                      case "customer":
                        return cell(column, item.customer);
                      case "owner":
                        return cell(column, item.owner || "—");
                      case "amount":
                        return cell(column, item.amount || "—");
                      case "time":
                        return cell(column, item.time || "—");
                      case "solution":
                        return cell(column, item.solution);
                      case "followUpTime":
                        return cell(
                          column,
                          item.followUps.length
                            ? item.followUps.map((entry, index) => (
                                <span className="follow-up-entry" key={index}>
                                  {entry.time || "—"}
                                </span>
                              ))
                            : "—",
                        );
                      case "followUpSolution":
                        return cell(
                          column,
                          item.followUps.length
                            ? item.followUps.map((entry, index) => (
                                <span className="follow-up-entry" key={index}>
                                  {entry.solution}
                                </span>
                              ))
                            : "—",
                        );
                      case "followUpActions":
                        return cell(
                          column,
                          item.followUps.length
                            ? item.followUps.map((_, index) => (
                                <span
                                  className="follow-up-entry follow-up-actions"
                                  key={index}
                                >
                                  <button
                                    type="button"
                                    onClick={() => editFollowUp(item, index)}
                                  >
                                    修改
                                  </button>
                                  <button
                                    type="button"
                                    className="delete-follow-up"
                                    onClick={() => deleteFollowUp(item, index)}
                                  >
                                    删除
                                  </button>
                                </span>
                              ))
                            : "—",
                        );
                      case "actions":
                        return cell(
                          column,
                          !item.resolved ? (
                            <div className="issue-actions">
                              <button
                                type="button"
                                onClick={() => startFollowUp(item)}
                              >
                                继续填写
                              </button>
                              <button
                                type="button"
                                className="resolve-button"
                                onClick={() => complete(item)}
                              >
                                已解决
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="undo-resolve-button"
                              onClick={() => undoComplete(item)}
                            >
                              撤销已解决
                            </button>
                          ),
                        );
                    }
                  })}
                </tr>
              ))
            ) : (
              <tr>
                <td className="issue-empty" colSpan={columns.length}>
                  {tab === "待解决清单"
                    ? "暂无待解决客户。请先在对账明细中填写解决方案和初步解决时间。"
                    : "暂无已解决档案。"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <RegionDashboard items={pending} />
    </section>
  );
}
