#!/usr/bin/env node
/**
 * Q1 browser backup -> PostgreSQL normalized migration plan (DRY RUN ONLY).
 * Deliberately self-contained: no pg/Drizzle imports, no DATABASE_URL access,
 * no network APIs, and no writes outside migration-output/q1-dry-run.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..", "..");
const sourceDir = "C:\\Users\\lenovo\\Desktop\\季度对账数据库迁移备份\\2026-08-25原始数据";
const outputDir = path.join(projectRoot, "migration-output", "q1-dry-run");
const sources = {
  manifest: ["quarterly-recon-browser-manifest-20260825-152916.json", "563ad4d865c098085db7ae5c293d052cc286581c0fbca53ad9030a08b01c5e55"],
  localStorage: ["quarterly-recon-localstorage-20260825-152916.json", "7743eab24ae3337e37cdaaccd968ba0ddc1d1c97daf2614b5db2c27f3093cdbb"],
  indexedDb: ["quarterly-recon-indexeddb-20260825-152916.json", "16a2a98e13482267770c3f648910e047784b63c125e16b3dc4ff17c5c76fc88b"],
};
const expectedDifference = {
  transit: [594, 2235979664], returned: [21, 74609412], lost: [14, 24629574],
  instrument: [45, 799921800], otherInvoice: [16, -116030045], other: [166, 1542889932],
};
const categoryMap = { transit: "transit", returned: "returned_invoice", lost: "lost_invoice", instrument: "equipment", otherInvoice: "other_with_invoice", other: "other_without_invoice" };
const invoiceCategories = new Set(["transit", "returned", "lost", "instrument", "otherInvoice"]);
const materialColumns = ["对账函", "对账确认函", "SPD确认表", "SPD库存确认函", "在途证明", "精准核销", "催款函送达证明"];
const accountSetAliases = { "英科": "江苏英科", "国控": "国药控股", "万和": "苏州万和", "生一": "江苏生一" };

class DryRunError extends Error { constructor(code, detail) { super(`${code}: ${detail}`); this.code = code; } }
const sha = (data) => createHash("sha256").update(data).digest("hex");
const sourceKey = (...parts) => `q1:${sha(parts.map((v) => String(v ?? "")).join("\u001f")).slice(0, 24)}`;
const text = (value) => String(value ?? "").trim();
const has = (value) => text(value) !== "";
const normalizeBusinessText = (value) => text(value).replace(/\u3000/g, " ").replace(/\s+/g, " ");
const normalizeBusinessKey = (accountSet, region, customerName) => {
  const normalizedAccountSet = normalizeBusinessText(accountSet);
  return [accountSetAliases[normalizedAccountSet] ?? normalizedAccountSet, normalizeBusinessText(region), normalizeBusinessText(customerName)].join("\u001f");
};
const centsToDecimal = (cents) => (cents / 100).toFixed(2);
const money = (value) => {
  // Browser-exported JSON numbers may carry a binary tail (for example
  // 477975.019999999). Normalize each individual source value to cents before
  // any aggregation; no floating-point totals are used.
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) : null;
  const input = text(value).replace(/,/g, "");
  if (!input) return null;
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(input)) return null;
  const negative = input.startsWith("-");
  const [integer, fraction = ""] = (negative ? input.slice(1) : input).split(".");
  return (negative ? -1 : 1) * (Number(integer) * 100 + Number((fraction + "00").slice(0, 2)));
};
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(text(value)) && !Number.isNaN(Date.parse(`${text(value)}T00:00:00Z`));
const parseItem = (hit) => {
  if (hit && hit.parsed !== undefined && hit.parsed !== null) return hit.parsed;
  try { return JSON.parse(hit?.raw ?? ""); } catch { throw new DryRunError("SOURCE_STRUCTURE_ASSERTION_FAILED", `cannot parse ${hit?.key ?? "unknown localStorage item"}`); }
};
const col = (headers, row, name) => row[headers.indexOf(name)];
const mapRow = (headers, row) => Object.fromEntries(headers.map((name, index) => [name, row[index]]));
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function loadVerifiedSources() {
  const loaded = {};
  for (const [name, [fileName, expectedHash]] of Object.entries(sources)) {
    const raw = await readFile(path.join(sourceDir, fileName));
    const actualHash = sha(raw);
    if (actualHash !== expectedHash) throw new DryRunError("SOURCE_CHECKSUM_MISMATCH", `${name} expected ${expectedHash}, got ${actualHash}`);
    loaded[name] = { fileName, sha256: actualHash, raw, parsed: JSON.parse(raw.toString("utf8")) };
  }
  return loaded;
}

function buildPlan(loaded) {
  const local = loaded.localStorage.parsed;
  if (!Array.isArray(local.items)) throw new DryRunError("SOURCE_STRUCTURE_ASSERTION_FAILED", "localStorage.items is not an array");
  const item = (key, required = true) => {
    const hit = local.items.find((entry) => entry.key === key);
    if (!hit && required) throw new DryRunError("SOURCE_STRUCTURE_ASSERTION_FAILED", `missing ${key}`);
    return hit ? parseItem(hit) : undefined;
  };
  const active = item("local-quarterly-reconciliation");
  const dashboard = item("local-quarterly-reconciliation-dashboard");
  const archive = item("local-quarterly-reconciliation-archive");
  const spdArchive = item("local-quarterly-reconciliation-spd-sheet-archive");
  const importHistory = item("quarterly-reconciliation-import-history-v1", false) ?? [];
  if (!Array.isArray(active?.rows) || active.rows.length !== 752 || Object.keys(active?.details ?? {}).length !== 748 || !Array.isArray(dashboard) || dashboard.length !== 752) {
    throw new DryRunError("SOURCE_STRUCTURE_ASSERTION_FAILED", `rows=${active?.rows?.length}, details=${Object.keys(active?.details ?? {}).length}, dashboard=${dashboard?.length}`);
  }

  const review = [];
  const issue = (code, severity, context) => review.push({ code, severity, ...context });
  const headers = active.headers;
  const quarter = { source_key: "quarter:2026-q1", code: "2026-Q1", year: 2026, quarter: 1, cutoff_date: "2026-03-31", status: "archived", source_payload: { source_key: "local-quarterly-reconciliation" } };
  const regions = new Map(), accountSets = new Map(), customers = new Map(), primaryBusinessKeys = new Map(), reconciliations = [], detailRows = [];
  const reconciliationKeys = new Set();
  let companyTotal = 0, customerTotal = 0, customerFilled = 0, customerEmpty = 0;
  const statuses = { "未对账": 0, "已对清": 0, "未对清": 0 };

  active.rows.forEach((row, index) => {
    const original = mapRow(headers, row);
    const detail = active.details?.[String(index)] ?? {};
    const accountSet = text(col(headers, row, "账套"));
    const region = text(col(headers, row, "区域"));
    const customerName = text(col(headers, row, "客户名称"));
    if (!accountSet) issue("EMPTY_ACCOUNT_SET", "blocking", { row_index: index });
    if (!region) issue("EMPTY_REGION", "blocking", { row_index: index });
    if (!customerName) issue("EMPTY_CUSTOMER", "blocking", { row_index: index });
    const accountKey = sourceKey("account-set", accountSet), regionKey = sourceKey("region", region), customerKey = sourceKey("customer", accountSet, region, customerName);
    if (accountSet) accountSets.set(accountKey, { source_key: accountKey, code: accountSet, name: accountSet });
    if (region) regions.set(regionKey, { source_key: regionKey, code: region, name: region });
    if (customerName) customers.set(customerKey, { source_key: customerKey, external_code: null, name: customerName, account_set_source_key: accountKey, region_source_key: regionKey, deterministic_source_identity: [accountSet, region, customerName] });
    // PRIMARY rows are authoritative for company receivable. Detail.companyAmount
    // is retained in source_payload only because it can be a stale UI-side copy.
    const companyRaw = col(headers, row, "公司应收");
    const customerRaw = has(detail.customerAmount) ? detail.customerAmount : col(headers, row, "客户账面金额");
    const company = money(companyRaw), customer = money(customerRaw);
    if (company === null) issue("ILLEGAL_AMOUNT", "blocking", { row_index: index, field: "companyReceivable", value: companyRaw });
    if (customer === null) customerEmpty++; else customerFilled++;
    if (customer !== null) customerTotal += customer;
    if (company !== null) companyTotal += company;
    const difference = (company ?? 0) - (customer ?? 0);
    const rawStatus = text(col(headers, row, "26年1季度是否对清"));
    const status = customer === null ? "未对账" : (rawStatus === "对清" ? "已对清" : "未对清");
    statuses[status]++;
    const reconciliationKey = sourceKey("reconciliation", "2026-Q1", accountSet, region, customerName);
    if (reconciliationKeys.has(reconciliationKey)) issue("RECONCILIATION_KEY_CONFLICT", "blocking", { row_index: index, reconciliation_source_key: reconciliationKey });
    reconciliationKeys.add(reconciliationKey);
    const businessKey = normalizeBusinessKey(accountSet, region, customerName);
    const candidates = primaryBusinessKeys.get(businessKey) ?? [];
    candidates.push({ index, reconciliationKey, accountKey, customerKey });
    primaryBusinessKeys.set(businessKey, candidates);
    const ownerRaw = text(detail.responsible) || text(col(headers, row, "对账负责人"));
    if (ownerRaw) issue("UNRESOLVED_USER_REFERENCE", "review", { row_index: index, field: "owner_raw_name", value: ownerRaw });
    const solutionDate = text(detail.resolutionTime) || text(col(headers, row, "解决时间"));
    if (solutionDate && !validDate(solutionDate)) issue("ILLEGAL_DATE", "review", { row_index: index, field: "solution_date", value: solutionDate });
    reconciliations.push({ source_key: reconciliationKey, legacy_id: `local-${index}`, quarter_source_key: quarter.source_key, account_set_source_key: accountKey, customer_source_key: customerKey, owner_id: null, owner_raw_name: ownerRaw || null, responsible_raw_name: text(detail.responsible) || null, company_receivable: company === null ? null : centsToDecimal(company), customer_book_amount: customer === null ? null : centsToDecimal(customer), reconciliation_difference: centsToDecimal(difference), reconciliation_status: status, cleared: status === "已对清", solution_date: validDate(solutionDate) ? solutionDate : null, solution: text(detail.resolutionSolution) || text(col(headers, row, "解决方案")) || null, bad_debt_amount: money(detail.badDebt) === null ? null : centsToDecimal(money(detail.badDebt)), bad_debt_reason: text(detail.badDebtReason) || null, adjustment_amount: money(detail.adjustment) === null ? null : centsToDecimal(money(detail.adjustment)), adjustment_reason: text(detail.adjustmentReason) || null, financial_attention: text(detail.financeAttention) || "none", process_stage: text(detail.processStage) || null, source_payload: { row_index: index, row: original, detail } });
    detailRows.push({ index, detail, reconciliationKey, accountKey, regionKey, customerKey, original });
  });

  if (companyTotal !== 51090101372 || customerTotal !== 43121749461 || customerFilled !== 730 || customerEmpty !== 22 || statuses["未对账"] !== 22 || statuses["已对清"] !== 726 || statuses["未对清"] !== 4) {
    throw new DryRunError("SOURCE_STRUCTURE_ASSERTION_FAILED", `financial baseline company=${companyTotal}, customer=${customerTotal}, filled=${customerFilled}, empty=${customerEmpty}, statuses=${JSON.stringify(statuses)}`);
  }

  const differenceItems = [], invoiceKeys = new Map(); let skippedPlaceholders = 0;
  const counts = Object.fromEntries(Object.keys(categoryMap).map((name) => [name, { count: 0, cents: 0 }]));
  for (const { index, detail, reconciliationKey } of detailRows) {
    for (const [sourceCategory, category] of Object.entries(categoryMap)) {
      const entries = Array.isArray(detail[sourceCategory]) ? detail[sourceCategory] : [];
      entries.forEach((entry, entryIndex) => {
        const amount = money(entry?.amount), invoiceNo = text(entry?.invoice), invoiceDate = text(entry?.date), note = text(entry?.note), attachment = text(entry?.attachment ?? entry?.image);
        const invoiceCategory = invoiceCategories.has(sourceCategory);
        const empty = invoiceCategory ? !invoiceNo && !invoiceDate && !note && !attachment && (amount === null || amount === 0) : !note && !attachment && (amount === null || amount === 0);
        if (empty) { skippedPlaceholders++; return; }
        if (has(entry?.amount) && amount === null) issue("ILLEGAL_AMOUNT", "review", { row_index: index, category: sourceCategory, entry_index: entryIndex, value: entry?.amount });
        if (invoiceDate && !validDate(invoiceDate)) issue("ILLEGAL_DATE", "review", { row_index: index, category: sourceCategory, entry_index: entryIndex, value: invoiceDate });
        if (invoiceCategory && !invoiceNo) issue("INCOMPLETE_INVOICE_EVIDENCE", "review", { row_index: index, category: sourceCategory, entry_index: entryIndex });
        const verification = invoiceNo ? "pending" : "not_applicable";
        const itemKey = sourceKey("difference", index, sourceCategory, entryIndex);
        const payload = { row_index: index, category: sourceCategory, entry_index: entryIndex, classification: invoiceNo ? "DIFFERENCE_INVOICE_EVIDENCE" : "NON_LEDGER_DIFFERENCE_EVIDENCE", entry };
        differenceItems.push({ source_key: itemKey, reconciliation_source_key: reconciliationKey, category, invoice_id: null, invoice_no: invoiceNo || null, invoice_date: validDate(invoiceDate) ? invoiceDate : null, difference_amount: amount === null ? null : centsToDecimal(amount), difference_description: note || null, attachment_keys: attachment ? [attachment] : [], verification_status: verification, verification_message: invoiceNo ? "pending: no authoritative historical ledger source" : null, source_payload: payload });
        counts[sourceCategory].count++; counts[sourceCategory].cents += amount ?? 0;
        if (invoiceNo) { const key = invoiceNo; const group = invoiceKeys.get(key) ?? []; group.push({ row_index: index, source_category: sourceCategory, entry_index: entryIndex }); invoiceKeys.set(key, group); }
      });
    }
  }
  for (const [invoiceNo, occurrences] of invoiceKeys) if (occurrences.length > 1) issue("INVOICE_CONFLICT", "review", { invoice_no: invoiceNo, occurrences });
  for (const [name, [count, cents]] of Object.entries(expectedDifference)) if (counts[name].count !== count || counts[name].cents !== cents) throw new DryRunError("DIFFERENCE_BASELINE_MISMATCH", `${name}: ${JSON.stringify(counts[name])}`);

  const followupItems = [], followupEvents = [], materialStatus = [];
  const followupAudit = { contentField: "resolutionSolution", dateField: "resolutionTime", sourceRowsWithFollowupContent: 0, sourceRowsWithFollowupDate: 0, contentAndDateCount: 0, contentWithoutDateCount: 0, dateWithoutContentCount: 0, noContentNoDateCount: 0, generatedUnresolvedFollowupItems: 0, generatedResolvedFollowupItems: 0, generatedFollowupItemsTotal: 0, sourceFollowUpEventCount: 0, generatedFollowUpEventCount: 0, generatedLegacyStateEventCount: 0 };
  const materialAudit = { possibleMaterialSlots: 0, nonEmptyMaterialSourceValues: 0, generatedMaterialStatusCount: 0, emptyMaterialStatusSkippedCount: 0 };
  for (const { index, detail, reconciliationKey, accountKey, customerKey, original } of detailRows) {
    const content = text(detail.resolutionSolution);
    const followupDate = text(detail.resolutionTime);
    if (content) followupAudit.sourceRowsWithFollowupContent++;
    if (followupDate) followupAudit.sourceRowsWithFollowupDate++;
    let followupKey = null;
    if (content && followupDate) {
      followupAudit.contentAndDateCount++;
      followupKey = sourceKey("followup", index);
      followupAudit.generatedUnresolvedFollowupItems++;
    } else if (content) {
      followupAudit.contentWithoutDateCount++;
      followupKey = sourceKey("followup", index);
      followupAudit.generatedResolvedFollowupItems++;
    } else if (followupDate) {
      followupAudit.dateWithoutContentCount++;
      issue("FOLLOWUP_DATE_WITHOUT_CONTENT", "review", { row_index: index, legacy_id: `local-${index}`, date_field: "resolutionTime", value: followupDate });
    } else {
      followupAudit.noContentNoDateCount++;
    }
    if (followupKey) {
      const key = sourceKey("followup", index);
      const unresolved = Boolean(followupDate);
      followupItems.push({ source_key: key, reconciliation_source_key: reconciliationKey, owner_id: null, owner_raw_name: text(detail.responsible) || null, expected_complete_at: unresolved && validDate(followupDate) ? followupDate : null, next_follow_up_at: null, latest_follow_up_at: null, follow_status: unresolved ? "pending" : "closed", process_stage: text(detail.processStage) || null, risk_level: "low", closed_at: null });
      (Array.isArray(detail.followUps) ? detail.followUps : []).forEach((event, eventIndex) => {
        followupAudit.sourceFollowUpEventCount++;
        const at = text(event?.time); if (at && !validDate(at)) issue("ILLEGAL_DATE", "review", { row_index: index, field: "followUps.time", event_index: eventIndex, value: at });
        followupEvents.push({ source_key: sourceKey("followup-event", index, eventIndex), followup_item_source_key: key, event_type: "followup", content: text(event?.solution) || null, occurred_at: validDate(at) ? at : null, payload: { row_index: index, event_index: eventIndex, event } });
        followupAudit.generatedFollowUpEventCount++;
      });
    } else {
      followupAudit.sourceFollowUpEventCount += Array.isArray(detail.followUps) ? detail.followUps.length : 0;
    }
    for (const materialType of materialColumns) {
      const rawValue = text(original[materialType]);
      materialAudit.possibleMaterialSlots++;
      if (!rawValue) { materialAudit.emptyMaterialStatusSkippedCount++; continue; }
      materialAudit.nonEmptyMaterialSourceValues++;
      materialStatus.push({ source_key: sourceKey("material", index, materialType), reconciliation_source_key: reconciliationKey, quarter_source_key: quarter.source_key, account_set_source_key: accountKey, customer_source_key: customerKey, material_type: materialType, provided: ["已提供", "已回函", "是"].includes(rawValue) ? true : (["未对账", "", "—"].includes(rawValue) ? null : false), raw_value: rawValue || null, source_batch_source_key: null, source_payload: { row_index: index, source: "PRIMARY", value: original[materialType] } });
      materialAudit.generatedMaterialStatusCount++;
    }
  }
  const spdRows = spdArchive?.["2026 Q1"]?.rows ?? [];
  const spdHeaders = spdArchive?.["2026 Q1"]?.headers ?? [];
  const spdAudit = { sourceRows: spdRows.length, completeKeyRows: 0, exactMatchedRows: 0, unresolvedRows: 0, duplicateCandidateRows: 0, missingAccountSet: 0, missingRegion: 0, missingCustomerName: 0, previousZeroMatchRootCause: "The previous implementation hashed raw account-set text separately: PRIMARY uses full names (for example 江苏英科) while SPD uses fixed abbreviations (英科, 国控, 万和, 生一)." };
  spdRows.forEach((row, index) => {
    const accountSet = text(col(spdHeaders, row, "账套")), region = text(col(spdHeaders, row, "区域")), customerName = text(col(spdHeaders, row, "客户名称"));
    if (!accountSet) spdAudit.missingAccountSet++;
    if (!region) spdAudit.missingRegion++;
    if (!customerName) spdAudit.missingCustomerName++;
    const candidates = accountSet && region && customerName ? (primaryBusinessKeys.get(normalizeBusinessKey(accountSet, region, customerName)) ?? []) : [];
    if (accountSet && region && customerName) spdAudit.completeKeyRows++;
    const matched = candidates.length === 1;
    if (matched) spdAudit.exactMatchedRows++;
    else if (candidates.length > 1) { spdAudit.duplicateCandidateRows++; issue("DUPLICATE_SPD_EXACT_CANDIDATE", "review", { spd_row_index: index, candidate_count: candidates.length }); }
    else { spdAudit.unresolvedRows++; issue("UNRESOLVED_SPD_LINK", "review", { spd_row_index: index }); }
    const linked = candidates[0];
    ["SPD确认表", "SPD库存确认函"].forEach((materialType) => {
      const rawValue = text(col(spdHeaders, row, materialType));
      materialAudit.possibleMaterialSlots++;
      if (!rawValue) { materialAudit.emptyMaterialStatusSkippedCount++; return; }
      materialAudit.nonEmptyMaterialSourceValues++;
      materialStatus.push({ source_key: sourceKey("spd-material", index, materialType), reconciliation_source_key: matched ? linked.reconciliationKey : null, quarter_source_key: quarter.source_key, account_set_source_key: matched ? linked.accountKey : null, customer_source_key: matched ? linked.customerKey : null, material_type: materialType, provided: rawValue === "是" ? true : (rawValue === "否" ? false : null), raw_value: rawValue, source_batch_source_key: "import:historical-spd", source_payload: { source: "SPD_SOURCE", spd_row_index: index, row, normalized_business_key: normalizeBusinessKey(accountSet, region, customerName), unresolved_link: !matched } });
      materialAudit.generatedMaterialStatusCount++;
    });
  });
  followupAudit.generatedFollowupItemsTotal = followupItems.length;
  if (followupAudit.generatedLegacyStateEventCount !== 0 || followupAudit.generatedFollowUpEventCount !== followupAudit.sourceFollowUpEventCount) throw new DryRunError("FOLLOWUP_EVENT_BASELINE_MISMATCH", JSON.stringify(followupAudit));
  const importBatches = (Array.isArray(importHistory) ? importHistory : []).map((batch, index) => ({ source_key: `import:historical-${text(batch.dataType) || index}`, quarter_source_key: quarter.source_key, data_type: text(batch.dataType), original_file_name: text(batch.fileName) || null, source_sha256: null, storage_key: text(batch.targetStore) || null, imported_at: null, imported_by: null, valid_record_count: Number(batch.recordCount) || 0, inserted_count: null, updated_count: null, skipped_count: null, error_count: null, target_module: text(batch.targetStore) || "browser_backup", status: "historical", details: batch }));
  const legacySnapshots = Object.entries(loaded).map(([name, source]) => ({ source: name, source_sha256: source.sha256, payload: source.parsed, captured_at: local.meta?.exportedAt ?? null, migrated_at: null, migration_status: "validated", details: { file_name: source.fileName, source_priority: name === "localStorage" ? "PRIMARY_AND_DERIVED_ARCHIVE_SPD" : "ARCHIVE" } }));
  const blocking = review.filter((entry) => entry.severity === "blocking");
  const reviewBreakdown = review.reduce((result, entry) => ({ ...result, [entry.code]: (result[entry.code] ?? 0) + 1 }), {});
  return { quarter, regions: [...regions.values()], accountSets: [...accountSets.values()], customers: [...customers.values()], importBatches, reconciliations, differenceItems, followupItems, followupEvents, materialStatus, legacySnapshots, review, summary: { companyTotal, customerTotal, customerFilled, customerEmpty, statuses, counts, skippedPlaceholders, invoiceEvidenceCount: differenceItems.filter((x) => x.invoice_no).length, uniqueInvoiceCount: invoiceKeys.size, spdRows: spdRows.length, unresolvedSpdLinks: spdAudit.unresolvedRows, blockingErrors: blocking.length }, followupAudit, materialAudit, spdAudit, reviewBreakdown };
}

async function main() {
  const loaded = await loadVerifiedSources();
  const plan = buildPlan(loaded);
  await mkdir(outputDir, { recursive: true });
  const files = {
    "quarters.json": [plan.quarter], "regions.json": plan.regions, "account_sets.json": plan.accountSets, "customers.json": plan.customers,
    "import_batches.json": plan.importBatches, "reconciliations.json": plan.reconciliations, "difference_items.json": plan.differenceItems,
    "followup_items.json": plan.followupItems, "followup_events.json": plan.followupEvents, "material_status.json": plan.materialStatus,
    "legacy_snapshots-plan.json": plan.legacySnapshots, "review-required.json": plan.review,
  };
  const manifest = { dry_run: true, database_connection: false, network_requests: false, ledger_invoices_generated: false, verification_strategy: "difference invoice evidence only; invoice verification_status=pending without an authoritative ledger", sources: Object.fromEntries(Object.entries(loaded).map(([name, value]) => [name, { file_name: value.fileName, sha256: value.sha256 }])), output_files: Object.keys(files), source_assertions: { rows: 752, details: 748, dashboard: 752, indexeddb_ledger_records: 0 }, readyForDatabaseTest: plan.summary.blockingErrors === 0 };
  const report = { status: "DRY_RUN_COMPLETED", ...manifest, summary: { companyReceivable: centsToDecimal(plan.summary.companyTotal), customerBook: centsToDecimal(plan.summary.customerTotal), ...plan.summary, differenceCounts: Object.fromEntries(Object.entries(plan.summary.counts).map(([key, value]) => [key, { count: value.count, amount: centsToDecimal(value.cents) }])) }, followupAudit: plan.followupAudit, materialAudit: plan.materialAudit, spdAudit: plan.spdAudit, reviewBreakdown: { UNRESOLVED_USER_REFERENCE: plan.reviewBreakdown.UNRESOLVED_USER_REFERENCE ?? 0, UNRESOLVED_SPD_LINK: plan.reviewBreakdown.UNRESOLVED_SPD_LINK ?? 0, FOLLOWUP_DATE_WITHOUT_CONTENT: plan.reviewBreakdown.FOLLOWUP_DATE_WITHOUT_CONTENT ?? 0, ILLEGAL_AMOUNT: plan.reviewBreakdown.ILLEGAL_AMOUNT ?? 0, INVOICE_CONFLICT: plan.reviewBreakdown.INVOICE_CONFLICT ?? 0, other: Object.entries(plan.reviewBreakdown).filter(([code]) => !["UNRESOLVED_USER_REFERENCE", "UNRESOLVED_SPD_LINK", "FOLLOWUP_DATE_WITHOUT_CONTENT", "ILLEGAL_AMOUNT", "INVOICE_CONFLICT"].includes(code)).reduce((sum, [, count]) => sum + count, 0) }, policies: { current_archive: "PRIMARY current rows create reconciliations; archive is preserved only via legacy_snapshots; archive-only fields are review-only supplemental data", dashboard: "DERIVED; cannot overwrite PRIMARY, used only for source structure assertion", spd: "Both PRIMARY and SPD use normalizeBusinessKey (trim, full-width/half-width whitespace normalization, and fixed account-set aliases) before exact matching; no fuzzy matching is used.", resolved: "resolved/reopened are preserved in reconciliation source_payload and do not create or classify follow-up items." } };
  files["migration_manifest.json"] = manifest; files["Dry_Run_Report.json"] = report;
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(outputDir, name), json(content), "utf8");
  const md = `# Q1 PostgreSQL Dry Run Report\n\n- Status: ${report.status}\n- Sources: SHA-256 verified; 752 primary rows, 748 details, 752 dashboard records.\n- Reconciliations: ${plan.reconciliations.length}; difference items: ${plan.differenceItems.length}; skipped UI placeholders: ${plan.summary.skippedPlaceholders}.\n- Ledger invoices: not generated. Difference invoice evidence is pending verification because IndexedDB has no authoritative ledger records.\n- Blocking errors: ${plan.summary.blockingErrors}; review-required: ${plan.review.length}.\n- Database/network access: none.\n`;
  await writeFile(path.join(outputDir, "DRY_RUN_REPORT.md"), md, "utf8");
  console.log(JSON.stringify({ status: report.status, outputDir, summary: report.summary, readyForDatabaseTest: manifest.readyForDatabaseTest }, null, 2));
}

main().catch((error) => { console.error(error instanceof DryRunError ? `${error.code}: ${error.message}` : error.stack); process.exitCode = 1; });
