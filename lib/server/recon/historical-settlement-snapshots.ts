import { withPostgresClient } from "../../../db/postgres";

type HistoricalSnapshotRow = {
  period_year: number;
  period_quarter: number;
  record_type: "total" | "region";
  region: string;
  customer_total: number;
  settled_count: number;
  unsettled_count: number | null;
  unclassified_count: number;
  settlement_rate: string;
  source_row: number;
};

export type HistoricalSettlementPeriods = {
  periods: Array<{
    year: number;
    quarter: number;
    label: string;
    total: {
      customerTotal: number;
      settledCount: number;
      unsettledCount: number | null;
      unclassifiedCount: number;
      settlementRate: string;
    };
    regions: Array<{
      region: string;
      customerTotal: number;
      settledCount: number;
      unsettledCount: number | null;
      settlementRate: string;
      sourceRow: number;
    }>;
  }>;
};

// Read one internally consistent, sealed version for every quarter. The CTE is
// per-quarter, so a total row and region rows can never be mixed across versions.
export async function listHistoricalSettlementSnapshots(): Promise<HistoricalSettlementPeriods> {
  const result = await withPostgresClient((client) => client.query<HistoricalSnapshotRow>(`
    WITH latest_sealed_versions AS (
      SELECT period_year, period_quarter, MAX(snapshot_version) AS snapshot_version
      FROM recon.historical_settlement_snapshots
      WHERE sealed = TRUE
      GROUP BY period_year, period_quarter
    )
    SELECT
      snapshot.period_year,
      snapshot.period_quarter,
      snapshot.record_type,
      snapshot.region,
      snapshot.customer_total,
      snapshot.settled_count,
      snapshot.unsettled_count,
      snapshot.unclassified_count,
      snapshot.settlement_rate::text AS settlement_rate,
      snapshot.source_row
    FROM recon.historical_settlement_snapshots AS snapshot
    INNER JOIN latest_sealed_versions AS latest
      ON latest.period_year = snapshot.period_year
      AND latest.period_quarter = snapshot.period_quarter
      AND latest.snapshot_version = snapshot.snapshot_version
    WHERE snapshot.sealed = TRUE
    ORDER BY snapshot.period_year ASC,
      snapshot.period_quarter ASC,
      CASE snapshot.record_type WHEN 'total' THEN 0 ELSE 1 END ASC,
      snapshot.source_row ASC
  `));

  const periods = new Map<number, HistoricalSettlementPeriods["periods"][number]>();
  for (const row of result.rows) {
    const key = row.period_year * 10 + row.period_quarter;
    let period = periods.get(key);
    if (!period) {
      period = {
        year: row.period_year,
        quarter: row.period_quarter,
        label: `${row.period_year} Q${row.period_quarter}`,
        total: null as unknown as HistoricalSettlementPeriods["periods"][number]["total"],
        regions: [],
      };
      periods.set(key, period);
    }
    if (row.record_type === "total") {
      period.total = {
        customerTotal: row.customer_total,
        settledCount: row.settled_count,
        unsettledCount: row.unsettled_count,
        unclassifiedCount: row.unclassified_count,
        settlementRate: row.settlement_rate,
      };
    } else {
      period.regions.push({
        region: row.region,
        customerTotal: row.customer_total,
        settledCount: row.settled_count,
        unsettledCount: row.unsettled_count,
        settlementRate: row.settlement_rate,
        sourceRow: row.source_row,
      });
    }
  }

  return { periods: [...periods.values()].filter((period) => period.total !== null) };
}
