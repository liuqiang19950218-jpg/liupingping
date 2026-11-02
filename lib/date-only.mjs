/**
 * Returns the business-date prefix without converting timestamps between time
 * zones. PostgreSQL timestamps here represent a business day, not an instant.
 */
export function normalizeDateOnly(value) {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[ T])/);
  if (!match) return "";
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day
    ? `${match[1]}-${match[2]}-${match[3]}`
    : "";
}

export function businessDayDistance(value, today = new Date()) {
  const date = normalizeDateOnly(value);
  const current = normalizeDateOnly(today);
  if (!date || !current) return null;
  const toUtcDay = (text) => Date.UTC(Number(text.slice(0, 4)), Number(text.slice(5, 7)) - 1, Number(text.slice(8, 10)));
  return Math.max(0, Math.floor((toUtcDay(current) - toUtcDay(date)) / 86_400_000));
}
