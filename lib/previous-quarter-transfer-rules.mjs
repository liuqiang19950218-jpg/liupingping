export function previousQuarterCode(quarter) {
  const match = String(quarter).match(/^(\d{4})-Q([1-4])$/);
  if (!match) throw new Error("INVALID_QUARTER");
  const year = Number(match[1]);
  const number = Number(match[2]);
  return number === 1 ? `${year - 1}-Q4` : `${year}-Q${number - 1}`;
}

// Cross-quarter comparison only. Persisted account-set names are never changed.
export const ACCOUNT_SET_EQUIVALENCE_GROUPS = Object.freeze({
  "江苏英科": "account_group_inke", "英科": "account_group_inke",
  "江苏生一": "account_group_shengyi", "生一": "account_group_shengyi",
  "国药控股": "account_group_guokong", "国控": "account_group_guokong",
  "万和": "account_group_wanhe", "苏州万和": "account_group_wanhe",
  "明生医疗": "account_group_mingsheng", "明生": "account_group_mingsheng",
});

export function normalizeAccountSetForCrossQuarterMatch(accountSet) {
  const raw = String(accountSet ?? "");
  return ACCOUNT_SET_EQUIVALENCE_GROUPS[raw] ?? raw;
}

export function crossQuarterAccountSetMatchMode(currentAccountSet, sourceAccountSet) {
  if (String(currentAccountSet) === String(sourceAccountSet)) return "EXACT_ACCOUNT_SET";
  return normalizeAccountSetForCrossQuarterMatch(currentAccountSet) === normalizeAccountSetForCrossQuarterMatch(sourceAccountSet)
    ? "EQUIVALENT_ACCOUNT_SET"
    : null;
}
