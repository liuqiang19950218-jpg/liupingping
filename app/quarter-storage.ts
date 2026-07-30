export const ACTIVE_SHEET_KEY = "local-quarterly-reconciliation";
export const QUARTER_ARCHIVE_KEY = "local-quarterly-reconciliation-archive";
export const SELECTED_QUARTER_KEY = "local-quarterly-reconciliation-selected-quarter";

export type ArchivedSheet = {
  headers: string[];
  rows: unknown[][];
  fileName: string;
  details?: Record<string, unknown>;
};
export type QuarterArchive = Record<string, ArchivedSheet>;

export function quarterOf(fileName: string, headers: unknown[] = []) {
  const match = `${fileName} ${headers.join(" ")}`.match(/(\d{2,4})\s*\u5e74?\s*([1-4])\s*\u5b63\u5ea6/);
  return match
    ? `${match[1].length === 2 ? `20${match[1]}` : match[1]} Q${match[2]}`
    : "\u672a\u8bc6\u522b\u5b63\u5ea6";
}

export function readArchive(): QuarterArchive {
  try {
    const archive = JSON.parse(localStorage.getItem(QUARTER_ARCHIVE_KEY) || "{}");
    return archive && typeof archive === "object" ? (archive as QuarterArchive) : {};
  } catch {
    return {};
  }
}

export function writeArchivedSheet(sheet: ArchivedSheet) {
  const quarter = quarterOf(sheet.fileName, sheet.headers);
  const archive = readArchive();
  archive[quarter] = sheet;
  localStorage.setItem(QUARTER_ARCHIVE_KEY, JSON.stringify(archive));
  localStorage.setItem(ACTIVE_SHEET_KEY, JSON.stringify(sheet));
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
      archive[quarterOf(sheet.fileName, sheet.headers)] = sheet;
      localStorage.setItem(QUARTER_ARCHIVE_KEY, JSON.stringify(archive));
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

export function selectQuarter(quarter: string) {
  localStorage.setItem(SELECTED_QUARTER_KEY, quarter);
  window.dispatchEvent(new Event("reconciliation-quarter-selected"));
}
