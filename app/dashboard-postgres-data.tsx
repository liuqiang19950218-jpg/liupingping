"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { reconciliationApi, type MaterialStatus, type Quarter, type QuarterDifferenceItem, type QuarterFollowupItem, type Reconciliation } from "../lib/api/reconciliation-api";

const SELECTED_QUARTER_KEY = "postgres-quarterly-reconciliation-selected-quarter";

export type DashboardQuarter = Quarter & { label: string };
export type DashboardData = {
  quarters: DashboardQuarter[];
  quarter: DashboardQuarter | null;
  rows: Reconciliation[];
  reconciliationById: Map<string, Reconciliation>;
  differenceItems: QuarterDifferenceItem[];
  differencesByReconciliation: Map<string, QuarterDifferenceItem[]>;
  followups: QuarterFollowupItem[];
  followupsByReconciliation: Map<string, QuarterFollowupItem[]>;
  materialStatus: MaterialStatus[];
  loading: boolean;
  error: string | null;
  selectQuarter: (code: string) => void;
  refresh: () => void;
};

const DashboardDataContext = createContext<DashboardData | null>(null);

const labelOf = (quarter: Quarter) => `${quarter.year} Q${quarter.quarter}`;

export function moneyToCents(value: string | null): bigint | null {
  if (value === null || !value.trim()) return null;
  const match = value.trim().match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const cents = BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  return match[1] === "-" ? -cents : cents;
}

export function formatCents(cents: bigint, maximumFractionDigits = 2) {
  const sign = cents < 0n ? "-" : "";
  const absolute = cents < 0n ? -cents : cents;
  const integer = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, "0");
  const grouped = integer.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (maximumFractionDigits === 0 || fraction === "00") return `${sign}${grouped}`;
  return `${sign}${grouped}.${maximumFractionDigits === 1 ? fraction[0] : fraction}`;
}

export function DashboardDataProvider({ children }: { children: ReactNode }) {
  const [quarters, setQuarters] = useState<DashboardQuarter[]>([]);
  const [quarterCode, setQuarterCode] = useState("");
  const [rows, setRows] = useState<Reconciliation[]>([]);
  const [differenceItems, setDifferenceItems] = useState<QuarterDifferenceItem[]>([]);
  const [followups, setFollowups] = useState<QuarterFollowupItem[]>([]);
  const [materialStatus, setMaterialStatus] = useState<MaterialStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    reconciliationApi.listQuarters(controller.signal)
      .then(({ quarters: value }) => {
        if (controller.signal.aborted) return;
        const next = [...value].sort((a, b) => b.code.localeCompare(a.code)).map((item) => ({ ...item, label: labelOf(item) }));
        setQuarters(next);
        setQuarterCode((current) => {
          const preferred = current || (typeof window === "undefined" ? "" : localStorage.getItem(SELECTED_QUARTER_KEY) ?? "");
          return next.some((item) => item.code === preferred) ? preferred : next[0]?.code ?? "";
        });
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "无法读取季度数据");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (!quarterCode) { setRows([]); setDifferenceItems([]); setFollowups([]); setMaterialStatus([]); return; }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([
      reconciliationApi.list(quarterCode, controller.signal),
      reconciliationApi.listQuarterDifferenceItems(quarterCode, controller.signal),
      reconciliationApi.listQuarterFollowups(quarterCode, controller.signal),
      reconciliationApi.getMaterialStatus(quarterCode, undefined, controller.signal),
    ])
      .then(([reconciliationResult, differenceResult, followupResult, materialResult]) => {
        if (controller.signal.aborted) return;
        setRows(reconciliationResult.reconciliations);
        setDifferenceItems(differenceResult.items);
        setFollowups(followupResult.items);
        setMaterialStatus(materialResult.material);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setRows([]); setDifferenceItems([]); setFollowups([]); setMaterialStatus([]);
          setError(caught instanceof Error ? caught.message : "无法读取本季度看板数据");
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [quarterCode, revision]);

  const value = useMemo<DashboardData>(() => {
    const reconciliationById = new Map(rows.map((item) => [item.id, item]));
    const group = <T extends { reconciliationId: string }>(items: T[]) => items.reduce((result, item) => {
      const list = result.get(item.reconciliationId) ?? [];
      list.push(item); result.set(item.reconciliationId, list); return result;
    }, new Map<string, T[]>());
    return ({
    quarters,
    quarter: quarters.find((item) => item.code === quarterCode) ?? null,
    rows,
    reconciliationById,
    differenceItems,
    differencesByReconciliation: group(differenceItems),
    followups,
    followupsByReconciliation: group(followups),
    materialStatus,
    loading,
    error,
    selectQuarter: (code) => {
      localStorage.setItem(SELECTED_QUARTER_KEY, code);
      setQuarterCode(code);
    },
    refresh: () => setRevision((current) => current + 1),
  });
  }, [quarters, quarterCode, rows, differenceItems, followups, materialStatus, loading, error]);

  return <DashboardDataContext.Provider value={value}>{children}</DashboardDataContext.Provider>;
}

export function useDashboardData() {
  const value = useContext(DashboardDataContext);
  if (!value) throw new Error("DashboardDataProvider is required");
  return value;
}

export function useAllDashboardQuarterRows() {
  const { quarters, quarter, rows: currentRows } = useDashboardData();
  const [rowsByQuarter, setRowsByQuarter] = useState<Record<string, Reconciliation[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!quarters.length) { setRowsByQuarter({}); return; }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all(quarters.filter((item) => item.code !== quarter?.code).map(async (item) => [item.code, (await reconciliationApi.list(item.code, controller.signal)).reconciliations] as const))
      .then((entries) => { if (!controller.signal.aborted) setRowsByQuarter(Object.fromEntries(entries)); })
      .catch((caught: unknown) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "无法读取历史季度数据"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [quarters, quarter?.code]);
  return { rowsByQuarter: { ...rowsByQuarter, ...(quarter ? { [quarter.code]: currentRows } : {}) }, loading, error };
}
