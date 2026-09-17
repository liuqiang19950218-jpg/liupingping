// Browser-safe shaping for the sealed historical settlement snapshot API.
// This module deliberately knows nothing about live reconciliation rows.

const asNumber = (value, field) => {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`INVALID_HISTORICAL_SNAPSHOT_${field}`);
  return result;
};

const periodLabel = (year, quarter) => `${year} Q${quarter}`;

export function normalizeHistoricalSettlementPeriods(payload) {
  if (!payload || !Array.isArray(payload.periods)) throw new Error("INVALID_HISTORICAL_SNAPSHOT_PAYLOAD");

  return payload.periods
    .map((period) => {
      const year = asNumber(period.year, "YEAR");
      const quarter = asNumber(period.quarter, "QUARTER");
      const sourceTotal = period.total;
      if (!sourceTotal || !Array.isArray(period.regions)) throw new Error("INVALID_HISTORICAL_SNAPSHOT_PERIOD");
      const total = {
        customerTotal: asNumber(sourceTotal.customerTotal, "CUSTOMER_TOTAL"),
        settledCount: asNumber(sourceTotal.settledCount, "SETTLED_COUNT"),
        unsettledCount: sourceTotal.unsettledCount === null ? null : asNumber(sourceTotal.unsettledCount, "UNSETTLED_COUNT"),
        unclassifiedCount: asNumber(sourceTotal.unclassifiedCount ?? 0, "UNCLASSIFIED_COUNT"),
        settlementRate: asNumber(sourceTotal.settlementRate, "SETTLEMENT_RATE"),
      };
      return {
        year,
        quarter,
        label: typeof period.label === "string" ? period.label : periodLabel(year, quarter),
        total,
        // Do not aggregate or sort: sealed source_row order is the presentation order.
        regions: period.regions.map((region) => ({
          region: String(region.region),
          customerTotal: asNumber(region.customerTotal, "REGION_CUSTOMER_TOTAL"),
          settledCount: asNumber(region.settledCount, "REGION_SETTLED_COUNT"),
          unsettledCount: region.unsettledCount === null ? 0 : asNumber(region.unsettledCount, "REGION_UNSETTLED_COUNT"),
          settlementRate: asNumber(region.settlementRate, "REGION_SETTLEMENT_RATE"),
          sourceRow: asNumber(region.sourceRow, "SOURCE_ROW"),
        })),
      };
    })
    .sort((left, right) => left.year - right.year || left.quarter - right.quarter);
}

export function historicalTrend(periods) {
  return periods.map((period) => ({
    quarter: period.label,
    // NULL is preserved by the API; only the UI display treats it as zero.
    unsettledCustomers: period.total.unsettledCount ?? 0,
    reconciliationRate: period.total.settlementRate * 100,
  }));
}

// Keep chart tooltip values defensive at the last presentation boundary. The
// trend builders above always supply numbers, while this also prevents a chart
// library callback from ever rendering undefined or NaN to a user.
export function formatHistoricalTrendTooltip(params) {
  return `${params[0]?.axisValue ?? ""}<br/>${params.map((item) => {
    const value = Number(item.value);
    const displayValue = Number.isFinite(value) ? value : 0;
    return `${item.seriesName}：${item.seriesName === "未对清客户数" ? `${displayValue}户` : `${displayValue.toFixed(2)}%`}`;
  }).join("<br/>")}`;
}

export function latestHistoricalPeriod(periods) {
  return periods.at(-1) ?? null;
}
