export function previousQuarterCode(quarter) {
  const match = String(quarter).match(/^(\d{4})-Q([1-4])$/);
  if (!match) throw new Error("INVALID_QUARTER");
  const year = Number(match[1]);
  const number = Number(match[2]);
  return number === 1 ? `${year - 1}-Q4` : `${year}-Q${number - 1}`;
}
