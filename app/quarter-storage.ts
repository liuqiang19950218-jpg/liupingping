export const ACTIVE_SHEET_KEY = "local-quarterly-reconciliation";
export const QUARTER_ARCHIVE_KEY = "local-quarterly-reconciliation-archive";
export const SELECTED_QUARTER_KEY = "local-quarterly-reconciliation-selected-quarter";
export const SPD_SHEET_ARCHIVE_KEY = "local-quarterly-reconciliation-spd-sheet-archive";

export type ArchivedSheet = {
  headers: string[];
  rows: unknown[][];
  fileName: string;
  details?: Record<string, unknown>;
};
export type QuarterArchive = Record<string, ArchivedSheet>;
export type SpdSheetArchive = Record<string, ArchivedSheet>;

const LEGACY_SPD_CONFIRMATION_HEADER = "SPD\u786e\u8ba4\u51fd";
const SPD_CONFIRMATION_HEADER = "SPD\u786e\u8ba4\u8868";

function migrateSpdConfirmationHeader(sheet: ArchivedSheet) {
  const legacyIndex = sheet.headers.indexOf(LEGACY_SPD_CONFIRMATION_HEADER);
  if (legacyIndex < 0) return { sheet, changed: false };
  const currentIndex = sheet.headers.indexOf(SPD_CONFIRMATION_HEADER);
  if (currentIndex < 0) {
    return {
      sheet: {
        ...sheet,
        headers: sheet.headers.map((header, index) =>
          index === legacyIndex ? SPD_CONFIRMATION_HEADER : header,
        ),
        rows: sheet.rows.map((row) => [...row]),
      },
      changed: true,
    };
  }
  return {
    sheet: {
      ...sheet,
      headers: sheet.headers.filter((_, index) => index !== legacyIndex),
      rows: sheet.rows.map((row) => {
        const next = [...row];
        if (
          !String(next[currentIndex] ?? "").trim() &&
          String(next[legacyIndex] ?? "").trim()
        )
          next[currentIndex] = next[legacyIndex];
        next.splice(legacyIndex, 1);
        return next;
      }),
    },
    changed: true,
  };
}

function migrateArchive(archive: QuarterArchive) {
  let changed = false;
  const next = Object.fromEntries(
    Object.entries(archive).map(([quarter, sheet]) => {
      const migrated = migrateSpdConfirmationHeader(sheet);
      changed ||= migrated.changed;
      return [quarter, migrated.sheet];
    }),
  );
  return { archive: next, changed };
}

export function quarterOf(
  fileName: string,
  headers: unknown[] = [],
  rows: unknown[][] = [],
) {
  const timeIndex = headers.findIndex((header) =>
    String(header).replace(/\s/g, "").includes("\u5bf9\u8d26\u65f6\u95f4\u70b9"),
  );
  const timePoint =
    timeIndex < 0
      ? ""
      : rows
          .map((row) => String(row[timeIndex] ?? "").trim())
          .find(Boolean) ?? "";
  const pointMatch = timePoint.match(
    /(?:20)?(\d{2})\s*(?:[.\/-]|\u5e74)\s*(0?[1-9]|1[0-2])(?:\s*\u6708)?/,
  );
  if (pointMatch) {
    const year = `20${pointMatch[1]}`;
    const quarter = Math.ceil(Number(pointMatch[2]) / 3);
    return `${year} Q${quarter}`;
  }
  const match = `${fileName} ${headers.join(" ")}`.match(/(\d{2,4})\s*\u5e74?\s*([1-4])\s*\u5b63\u5ea6/);
  return match
    ? `${match[1].length === 2 ? `20${match[1]}` : match[1]} Q${match[2]}`
    : "\u672a\u8bc6\u522b\u5b63\u5ea6";
}

export function readArchive(): QuarterArchive {
  try {
    const archive = JSON.parse(localStorage.getItem(QUARTER_ARCHIVE_KEY) || "{}");
    if (!archive || typeof archive !== "object") return {};
    const migrated = migrateArchive(archive as QuarterArchive);
    if (migrated.changed)
      localStorage.setItem(QUARTER_ARCHIVE_KEY, JSON.stringify(migrated.archive));
    return migrated.archive;
  } catch {
    return {};
  }
}

export function writeArchivedSheet(sheet: ArchivedSheet) {
  const migrated = migrateSpdConfirmationHeader(sheet).sheet;
  const quarter = quarterOf(migrated.fileName, migrated.headers, migrated.rows);
  const archive = readArchive();
  archive[quarter] = migrated;
  localStorage.setItem(QUARTER_ARCHIVE_KEY, JSON.stringify(archive));
  localStorage.setItem(ACTIVE_SHEET_KEY, JSON.stringify(migrated));
  localStorage.setItem(SELECTED_QUARTER_KEY, quarter);
  window.dispatchEvent(new Event("reconciliation-quarter-updated"));
  return quarter;
}

export function ensureArchiveFromActive() {
  const archive = readArchive();
  if (Object.keys(archive).length) return archive;
  try {
    const sheet = JSON.parse(localStorage.getItem(ACTIVE_SHEET_KEY) || "null") as ArchivedSheet | null;
    if (sheet?.headers?.length && sheet?.rows) {
      const migrated = migrateSpdConfirmationHeader(sheet).sheet;
      archive[quarterOf(migrated.fileName, migrated.headers, migrated.rows)] = migrated;
      localStorage.setItem(QUARTER_ARCHIVE_KEY, JSON.stringify(archive));
      localStorage.setItem(ACTIVE_SHEET_KEY, JSON.stringify(migrated));
    }
  } catch {
    // Keep a malformed legacy value from blocking the page.
  }
  return archive;
}

export function quarterOptions() {
  return Object.keys(ensureArchiveFromActive()).sort((a, b) => b.localeCompare(a));
}

export function selectedQuarter() {
  const options = quarterOptions();
  const selected = localStorage.getItem(SELECTED_QUARTER_KEY);
  return selected && options.includes(selected) ? selected : options[0] || "";
}

export function sheetForQuarter(quarter: string) {
  return ensureArchiveFromActive()[quarter];
}

export function readSpdSheetArchive(): SpdSheetArchive {
  try {
    const archive = JSON.parse(
      localStorage.getItem(SPD_SHEET_ARCHIVE_KEY) || "{}",
    );
    return archive && typeof archive === "object" ? archive : {};
  } catch {
    return {};
  }
}

export function spdSheetForQuarter(quarter: string) {
  return readSpdSheetArchive()[quarter];
}

/** Stores the independent SPD material sheet without changing reconciliation details. */
export function writeSpdSheetForQuarter(quarter: string, sheet: ArchivedSheet) {
  const archive = readSpdSheetArchive();
  archive[quarter] = {
    ...sheet,
    headers: [...sheet.headers],
    rows: sheet.rows.map((row) => [...row]),
  };
  localStorage.setItem(SPD_SHEET_ARCHIVE_KEY, JSON.stringify(archive));
  window.dispatchEvent(new Event("reconciliation-spd-sheet-updated"));
}

export function selectQuarter(quarter: string) {
  localStorage.setItem(SELECTED_QUARTER_KEY, quarter);
  window.dispatchEvent(new Event("reconciliation-quarter-selected"));
}
