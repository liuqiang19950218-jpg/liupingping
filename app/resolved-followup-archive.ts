import { sheetForQuarter } from "./quarter-storage";

type ArchiveDetail = {
  resolutionSolution?: unknown;
  resolutionTime?: unknown;
  resolved?: unknown;
  reopened?: unknown;
};

export type ResolvedFollowupArchiveItem = {
  id: string;
  region: string;
  owner: string;
  customer: string;
};

const valueOf = (value: unknown) => String(value ?? "").trim();

const headerValue = (row: unknown[], headers: string[], names: string[]) => {
  const index = headers.findIndex((header) =>
    names.some((name) => valueOf(header).replace(/\s/g, "").includes(name)),
  );
  return index < 0 ? "" : valueOf(row[index]);
};

const detailOf = (value: unknown): ArchiveDetail =>
  typeof value === "object" && value !== null ? (value as ArchiveDetail) : {};

/**
 * The execution page owns the resolved archive.  Keep summary views on this
 * exact source so its "已关闭" count cannot drift from "已解决档案".
 */
export function resolvedFollowupArchiveItemsForQuarter(
  quarter: string,
): ResolvedFollowupArchiveItem[] {
  const sheet = sheetForQuarter(quarter);
  if (!sheet?.headers?.length) return [];

  return sheet.rows.flatMap((row, index) => {
    const detail = detailOf(sheet.details?.[String(index)]);
    const firstSolution =
      valueOf(detail.resolutionSolution) ||
      headerValue(row, sheet.headers, ["\u89e3\u51b3\u65b9\u6848"]);
    const firstTime =
      valueOf(detail.resolutionTime) ||
      headerValue(row, sheet.headers, ["\u89e3\u51b3\u65f6\u95f4"]);
    const resolved =
      detail.resolved === true ||
      (Boolean(firstSolution && !firstTime) && detail.reopened !== true);
    const customer = headerValue(row, sheet.headers, ["\u5ba2\u6237\u540d\u79f0"]);

    if (!customer || !firstSolution || !resolved) return [];
    return [{
      id: String(index),
      region: headerValue(row, sheet.headers, ["\u533a\u57df"]),
      owner: headerValue(row, sheet.headers, ["\u5bf9\u8d26\u8d1f\u8d23\u4eba"]),
      customer,
    }];
  });
}
