/*
 * 季度对账系统浏览器本地数据只读审计与导出工具
 *
 * 用法：
 * 1. 打开实际业务页面（生产或验收环境，勿在空白页/错误页运行）
 * 2. 按 F12 打开开发者工具，在 Console 或 Snippets 中粘贴并运行本文件全部内容
 * 3. 等待自动下载 quarterly-recon-browser-audit-YYYYMMDD-HHMMSS.json
 *
 * 安全边界：
 * - 只读取 localStorage / sessionStorage / IndexedDB
 * - 不 setItem / removeItem / clear
 * - 不 deleteDatabase
 * - 不 put / add / delete / clear
 */
(async () => {
  "use strict";

  const VERSION = "2026-08-25.readonly-audit.v1";
  const STARTED_AT = new Date();

  const CONFIG = {
    businessLocalStorageKeys: [
      "local-quarterly-reconciliation",
      "local-quarterly-reconciliation-archive",
      "local-quarterly-reconciliation-selected-quarter",
      "local-quarterly-reconciliation-spd-sheet-archive",
      "quarterly-reconciliation-import-history-v1",
      "local-quarterly-reconciliation-dashboard",
      "reconciliation-detail-target",
      "reconciliation-server-snapshot-updated-at",
      "reconciliation-server-ledger-updated-at",
      "local-quarterly-reconciliation-table-view",
      "local-quarterly-reconciliation-issue-tracker-view",
    ],
    indexedDbNamePattern:
      /quarter|recon|reconciliation|ledger|spd|invoice|对账|季度|往来|发票/i,
    sensitiveKeyPattern:
      /token|access[_-]?token|refresh[_-]?token|session|password|passwd|secret|credential|authorization|auth/i,
    // Optional server-side baseline, injected at runtime (never hardcode business
    // numbers or hostnames in the repository). Example before running:
    //   window.__QUARTERLY_RECON_AUDIT_BASELINE =
    //     { quarter: "2026 Q2", rows: 851, uniqueCustomers: 649, companyReceivable: 514473239.51 }
    serverBaseline:
      (typeof window !== "undefined" && window.__QUARTERLY_RECON_AUDIT_BASELINE) || null,
  };

  const FIELD_ALIASES = {
    quarter: ["对账季度", "季度", "期间", "账期", "对账期间"],
    accountSet: ["账套", "帐套", "公司", "主体"],
    region: ["区域", "地区", "大区"],
    owner: ["对账负责人", "负责人", "销售", "业务员", "责任人"],
    customerName: ["客户名称", "客户", "单位名称", "往来单位", "客户/供应商"],
    companyReceivable: ["公司应收", "公司应收金额", "我方应收", "应收金额"],
    customerBookAmount: ["客户账面金额", "客户账面", "客户账面余额"],
    reconciliationDiff: ["对账差额", "差额", "未对清金额", "待解决差额"],
    status: ["是否对清", "对清状态", "对账状态", "状态"],
    badDebtAmount: ["死账金额", "坏账金额"],
    badDebtReason: ["死账原因", "坏账原因"],
    adjustAmount: ["调账金额", "调整金额"],
    adjustReason: ["调账原因", "调整原因"],
    resolveTime: ["解决时间", "解决日期", "处理时间"],
    resolveSolution: ["解决方案", "处理方案"],
    financeAttention: ["财务关注", "财务复核", "财务状态"],
    processStage: ["处理阶段", "问题处理阶段", "阶段"],
  };

  const DIFFERENCE_CATEGORIES = [
    {
      id: "transit",
      name: "在途金额",
      amountAliases: ["在途金额", "在途"],
      marker: /在途/,
    },
    {
      id: "returnedInvoice",
      name: "退票金额",
      amountAliases: ["退票金额", "退票"],
      marker: /退票/,
    },
    {
      id: "lostInvoice",
      name: "丢票金额",
      amountAliases: ["丢票金额", "丢票"],
      marker: /丢票/,
    },
    {
      id: "equipment",
      name: "仪器设备金额",
      amountAliases: ["仪器设备金额", "仪器设备", "设备金额"],
      marker: /仪器|设备/,
    },
    {
      id: "otherWithInvoice",
      name: "其他（有发票）",
      amountAliases: ["其他原因", "其他金额", "其他（有发票）", "其他有发票"],
      marker: /其他.*发票|其他原因|其他金额/,
    },
    {
      id: "otherWithoutInvoice",
      name: "其他（无发票及无法验证）",
      amountAliases: [
        "其他（无发票及无法验证）",
        "其他无发票",
        "无法验证",
        "无发票",
      ],
      marker: /无发票|无法验证/,
    },
  ];

  const INVOICE_NO_ALIASES = ["发票号", "发票号码", "票号", "发票代码号码"];
  const INVOICE_DATE_ALIASES = ["开票日期", "发票日期", "日期"];
  const INVOICE_AMOUNT_ALIASES = ["金额", "发票金额", "差额金额", "金额（元）"];
  const REASON_ALIASES = ["差额说明", "差额原因", "说明", "原因", "备注"];

  function logStep(text) {
    console.log(`[季度对账只读审计] ${text}`);
  }

  function normalizeLabel(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/[\s　:_：/\\|,，.。()（）[\]【】{}<>《》"'“”‘’-]/g, "");
  }

  function isBlank(value) {
    if (value === null || value === undefined) return true;
    const text = String(value).trim();
    return (
      text === "" ||
      text === "-" ||
      text === "—" ||
      text === "--" ||
      text === "无" ||
      text === "未填写" ||
      text.toLowerCase() === "null" ||
      text.toLowerCase() === "undefined"
    );
  }

  function parseAmount(value) {
    if (isBlank(value)) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const text = String(value).replace(/,/g, "").replace(/￥|¥|元/g, "").trim();
    const multiplier = /万/.test(text) ? 10000 : 1;
    const numeric = Number(text.replace(/万/g, "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(numeric) ? numeric * multiplier : null;
  }

  function formatDateTime(date) {
    const pad = (num) => String(num).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate()
    )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
      date.getSeconds()
    )}`;
  }

  function fileTimestamp(date) {
    return formatDateTime(date).replace(/[-:]/g, "").replace(" ", "-");
  }

  function safeJsonParse(raw) {
    if (typeof raw !== "string") return { ok: false, value: null, error: "not string" };
    try {
      return { ok: true, value: JSON.parse(raw), error: null };
    } catch (error) {
      return { ok: false, value: null, error: String(error && error.message ? error.message : error) };
    }
  }

  function getType(value) {
    if (Array.isArray(value)) return "array";
    if (value === null) return "null";
    return typeof value;
  }

  function summarizeParsed(value) {
    const type = getType(value);
    if (Array.isArray(value)) {
      return { type, arrayLength: value.length };
    }
    if (value && typeof value === "object") {
      return {
        type,
        objectKeyCount: Object.keys(value).length,
        firstLevelKeys: Object.keys(value).slice(0, 80),
      };
    }
    return { type, sample: String(value).slice(0, 200) };
  }

  async function sha256(text) {
    if (!crypto?.subtle || typeof TextEncoder === "undefined") return null;
    const buffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(text)
    );
    return Array.from(new Uint8Array(buffer))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function isSensitiveKey(key) {
    return CONFIG.sensitiveKeyPattern.test(String(key));
  }

  function getHeadersFromParsed(parsed) {
    if (!parsed || typeof parsed !== "object") return [];
    const candidates = [
      parsed.headers,
      parsed.header,
      parsed.columns,
      parsed.cols,
      parsed?.sheet?.headers,
      parsed?.data?.headers,
    ];
    const found = candidates.find(
      (candidate) => Array.isArray(candidate) && candidate.length > 0
    );
    return found ? found.map((item) => String(item ?? "")) : [];
  }

  function findRowsCandidate(value, depth = 0) {
    if (depth > 5 || !value) return [];
    if (Array.isArray(value)) {
      if (value.length === 0) return [];
      if (value.some((item) => item && typeof item === "object")) return value;
      return [];
    }
    if (typeof value !== "object") return [];
    const priorityKeys = ["rows", "data", "records", "items", "list", "tableData"];
    for (const key of priorityKeys) {
      const rows = findRowsCandidate(value[key], depth + 1);
      if (rows.length) return rows;
    }
    for (const key of Object.keys(value)) {
      const rows = findRowsCandidate(value[key], depth + 1);
      if (rows.length) return rows;
    }
    return [];
  }

  function rowToObject(row, headers) {
    if (row && typeof row === "object" && !Array.isArray(row)) return row;
    if (Array.isArray(row)) {
      const result = {};
      row.forEach((cell, index) => {
        result[headers[index] || `列${index + 1}`] = cell;
      });
      return result;
    }
    return {};
  }

  function getRowObjects(parsed) {
    const headers = getHeadersFromParsed(parsed);
    const rows = findRowsCandidate(parsed);
    return {
      headers,
      rows,
      rowObjects: rows.map((row) => rowToObject(row, headers)),
    };
  }

  function findMatchingKey(keys, aliases) {
    const normalizedAliases = aliases.map(normalizeLabel);
    return keys.find((key) => normalizedAliases.includes(normalizeLabel(key))) || null;
  }

  function readField(row, aliases) {
    const keys = Object.keys(row || {});
    const exactKey = findMatchingKey(keys, aliases);
    if (exactKey) return { key: exactKey, value: row[exactKey] };
    const normalizedAliases = aliases.map(normalizeLabel);
    const fuzzyKey =
      keys.find((key) => normalizedAliases.some((alias) => normalizeLabel(key).includes(alias))) ||
      null;
    return fuzzyKey ? { key: fuzzyKey, value: row[fuzzyKey] } : { key: null, value: undefined };
  }

  function fieldStat(rowObjects, aliases, numeric = false) {
    const keys = Array.from(new Set(rowObjects.flatMap((row) => Object.keys(row || {}))));
    const field = findMatchingKey(keys, aliases);
    if (!field) return { available: false, aliases };
    const values = rowObjects.map((row) => row[field]);
    const nonBlankCount = values.filter((value) => !isBlank(value)).length;
    if (!numeric) return { available: true, field, nonBlankCount };
    const numbers = values.map(parseAmount).filter((value) => value !== null);
    return {
      available: true,
      field,
      nonBlankCount,
      numericCount: numbers.length,
      sum: numbers.reduce((sum, value) => sum + value, 0),
    };
  }

  function uniqueCount(rowObjects, aliases) {
    const keys = Array.from(new Set(rowObjects.flatMap((row) => Object.keys(row || {}))));
    const field = findMatchingKey(keys, aliases);
    if (!field) return { available: false, aliases };
    return {
      available: true,
      field,
      count: new Set(
        rowObjects.map((row) => String(row[field] ?? "").trim()).filter(Boolean)
      ).size,
    };
  }

  function countStatus(rowObjects) {
    const stat = fieldStat(rowObjects, FIELD_ALIASES.status);
    if (!stat.available) return stat;
    const result = {
      available: true,
      field: stat.field,
      reconciled: 0,
      unreconciled: 0,
      notReconciled: 0,
      blank: 0,
      other: {},
    };
    for (const row of rowObjects) {
      const text = String(row[stat.field] ?? "").trim();
      if (!text) result.blank += 1;
      else if (/未对账/.test(text)) result.notReconciled += 1;
      else if (/未对清|不一致|异常/.test(text)) result.unreconciled += 1;
      else if (/已对清|对清|一致/.test(text)) result.reconciled += 1;
      else result.other[text] = (result.other[text] || 0) + 1;
    }
    return result;
  }

  function summarizeSheet(parsed, storageKey) {
    const { headers, rows, rowObjects } = getRowObjects(parsed);
    const fileName =
      parsed?.fileName ||
      parsed?.filename ||
      parsed?.sourceFile ||
      parsed?.originalFileName ||
      null;
    const quarter =
      parsed?.quarter ||
      parsed?.selectedQuarter ||
      parsed?.currentQuarter ||
      readField(rowObjects[0] || {}, FIELD_ALIASES.quarter).value ||
      null;

    return {
      storageKey,
      fileName,
      quarter,
      headers,
      rowCount: rows.length,
      fieldStats: {
        accountSets: uniqueCount(rowObjects, FIELD_ALIASES.accountSet),
        regions: uniqueCount(rowObjects, FIELD_ALIASES.region),
        owners: uniqueCount(rowObjects, FIELD_ALIASES.owner),
        customers: uniqueCount(rowObjects, FIELD_ALIASES.customerName),
        companyReceivable: fieldStat(rowObjects, FIELD_ALIASES.companyReceivable, true),
        customerBookAmount: fieldStat(rowObjects, FIELD_ALIASES.customerBookAmount, true),
        reconciliationDiff: fieldStat(rowObjects, FIELD_ALIASES.reconciliationDiff, true),
        badDebtAmount: fieldStat(rowObjects, FIELD_ALIASES.badDebtAmount, true),
        badDebtReason: fieldStat(rowObjects, FIELD_ALIASES.badDebtReason),
        adjustAmount: fieldStat(rowObjects, FIELD_ALIASES.adjustAmount, true),
        adjustReason: fieldStat(rowObjects, FIELD_ALIASES.adjustReason),
        resolveTime: fieldStat(rowObjects, FIELD_ALIASES.resolveTime),
        resolveSolution: fieldStat(rowObjects, FIELD_ALIASES.resolveSolution),
        financeAttention: fieldStat(rowObjects, FIELD_ALIASES.financeAttention),
        processStage: fieldStat(rowObjects, FIELD_ALIASES.processStage),
      },
      statusCounts: countStatus(rowObjects),
      sampleRows: rowObjects.slice(0, 3),
    };
  }

  function inferDifferenceCategory(path, row) {
    const haystack = `${path.join(".")} ${Object.keys(row || {}).join(" ")} ${Object.values(row || {})
      .slice(0, 8)
      .join(" ")}`;
    return (
      DIFFERENCE_CATEGORIES.find((category) => category.marker.test(haystack)) || null
    );
  }

  function collectDifferenceRecords(root) {
    const records = [];
    const visited = new WeakSet();

    function visit(value, path) {
      if (!value || typeof value !== "object") return;
      if (visited.has(value)) return;
      visited.add(value);

      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, path.concat(`[${index}]`)));
        return;
      }

      const keys = Object.keys(value);
      const invoiceNo = readField(value, INVOICE_NO_ALIASES);
      const invoiceDate = readField(value, INVOICE_DATE_ALIASES);
      const amount = readField(value, INVOICE_AMOUNT_ALIASES);
      const reason = readField(value, REASON_ALIASES);
      const category = inferDifferenceCategory(path, value);
      const hasInvoiceLikeData =
        !isBlank(invoiceNo.value) || !isBlank(invoiceDate.value) || parseAmount(amount.value) !== null;

      if (category && (hasInvoiceLikeData || keys.some((key) => category.marker.test(key)))) {
        records.push({
          path: path.join("."),
          categoryId: category.id,
          categoryName: category.name,
          invoiceNoField: invoiceNo.key,
          invoiceNoPresent: !isBlank(invoiceNo.value),
          invoiceDateField: invoiceDate.key,
          invoiceDatePresent: !isBlank(invoiceDate.value),
          amountField: amount.key,
          amountPresent: parseAmount(amount.value) !== null,
          amount: parseAmount(amount.value),
          reasonField: reason.key,
          reasonPresent: !isBlank(reason.value),
          reasonSample: isBlank(reason.value) ? null : String(reason.value).slice(0, 120),
        });
      }

      for (const key of keys) visit(value[key], path.concat(key));
    }

    visit(root, ["root"]);

    const summary = {};
    for (const category of DIFFERENCE_CATEGORIES) {
      const items = records.filter((item) => item.categoryId === category.id);
      summary[category.id] = {
        name: category.name,
        count: items.length,
        amountSum: items.reduce((sum, item) => sum + (item.amount || 0), 0),
        invoiceNoPresent: items.filter((item) => item.invoiceNoPresent).length,
        invoiceDatePresent: items.filter((item) => item.invoiceDatePresent).length,
        reasonPresent: items.filter((item) => item.reasonPresent).length,
        samplePaths: items.slice(0, 8).map((item) => item.path),
      };
    }

    return { summary, sampleRecords: records.slice(0, 50), totalRecords: records.length };
  }

  function collectFollowUpPaths(root) {
    const matches = [];
    const visited = new WeakSet();
    const marker =
      /解决方案|解决时间|处理阶段|财务关注|follow|followups|跟进|resolved|已解决|待解决|latestfollowup/i;

    function visit(value, path) {
      if (!value || typeof value !== "object") return;
      if (visited.has(value)) return;
      visited.add(value);
      if (Array.isArray(value)) {
        if (marker.test(path.join("."))) {
          matches.push({
            path: path.join("."),
            type: "array",
            count: value.length,
            sampleKeys:
              value[0] && typeof value[0] === "object" ? Object.keys(value[0]).slice(0, 30) : [],
          });
        }
        value.forEach((item, index) => visit(item, path.concat(`[${index}]`)));
        return;
      }
      const keys = Object.keys(value);
      const hitKeys = keys.filter((key) => marker.test(key));
      if (hitKeys.length || marker.test(path.join("."))) {
        matches.push({
          path: path.join("."),
          type: "object",
          hitKeys,
          sampleKeys: keys.slice(0, 30),
        });
      }
      keys.forEach((key) => visit(value[key], path.concat(key)));
    }

    visit(root, ["root"]);
    return matches.slice(0, 200);
  }

  function summarizeArchive(parsed, activeSummary) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { available: false };
    }
    const entries = Object.entries(parsed).map(([key, value]) => {
      const sheetSummary = summarizeSheet(value, `archive.${key}`);
      return {
        archiveKey: key,
        quarter: sheetSummary.quarter || key,
        fileName: sheetSummary.fileName,
        rowCount: sheetSummary.rowCount,
        updatedAt: value?.updatedAt || value?.importedAt || value?.createdAt || null,
      };
    });
    const activeQuarter = activeSummary?.quarter;
    const matched = activeQuarter
      ? entries.find((entry) => String(entry.quarter).includes(String(activeQuarter)))
      : null;
    return {
      available: true,
      entryCount: entries.length,
      entries,
      activeQuarterComparison: matched
        ? {
            activeQuarter,
            activeRows: activeSummary.rowCount,
            archiveRows: matched.rowCount,
            matchedArchiveKey: matched.archiveKey,
          }
        : { activeQuarter, matched: false },
    };
  }

  async function auditLocalStorage() {
    const result = {};
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      keys.push(localStorage.key(index));
    }
    const allKeys = Array.from(
      new Set([...CONFIG.businessLocalStorageKeys, ...keys.filter(Boolean)])
    ).filter(Boolean);

    for (const key of allKeys) {
      const exists = localStorage.getItem(key) !== null;
      const sensitive = isSensitiveKey(key);
      const raw = exists ? localStorage.getItem(key) : null;
      const parsed = raw !== null ? safeJsonParse(raw) : { ok: false, value: null, error: null };
      result[key] = {
        exists,
        sensitiveExcluded: sensitive,
        rawLength: raw ? raw.length : 0,
        jsonParse: raw === null ? null : { ok: parsed.ok, error: parsed.error },
        parsedSummary: parsed.ok ? summarizeParsed(parsed.value) : null,
        raw: exists && !sensitive && CONFIG.businessLocalStorageKeys.includes(key) ? raw : undefined,
        parsed:
          exists && !sensitive && CONFIG.businessLocalStorageKeys.includes(key) && parsed.ok
            ? parsed.value
            : undefined,
      };
    }
    return result;
  }

  async function auditSessionStorage() {
    const result = {};
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (!key) continue;
      const raw = sessionStorage.getItem(key);
      result[key] = {
        exists: true,
        sensitiveExcluded: isSensitiveKey(key),
        rawLength: raw ? raw.length : 0,
        note: isSensitiveKey(key) ? "敏感键已排除值" : "只记录概要，不导出 sessionStorage 原文",
      };
    }
    return result;
  }

  function openIndexedDbReadonly(name) {
    return new Promise((resolve) => {
      const request = indexedDB.open(name);
      request.onerror = () => resolve({ ok: false, error: String(request.error) });
      request.onsuccess = () => resolve({ ok: true, db: request.result });
      request.onupgradeneeded = () => {
        try {
          request.transaction.abort();
        } catch (_) {
          // keep readonly intent; do not create stores
        }
        resolve({ ok: false, error: "数据库不存在或需要升级，已中止以保持只读" });
      };
    });
  }

  function idbRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function summarizeLedger(value) {
    const rows = findRowsCandidate(value);
    const rowObjects = rows.map((row) => rowToObject(row, getHeadersFromParsed(value)));
    const invoiceMap = new Map();
    let earliestDate = null;
    let latestDate = null;
    let amountTotal = 0;
    let amountCount = 0;

    for (const row of rowObjects) {
      const invoiceNo = readField(row, INVOICE_NO_ALIASES).value;
      const invoiceDate = readField(row, INVOICE_DATE_ALIASES).value;
      const amount = parseAmount(readField(row, INVOICE_AMOUNT_ALIASES).value);
      if (!isBlank(invoiceNo)) {
        const key = `${invoiceNo}|${invoiceDate || ""}|${amount ?? ""}`;
        invoiceMap.set(key, (invoiceMap.get(key) || 0) + 1);
      }
      if (!isBlank(invoiceDate)) {
        const dateText = String(invoiceDate).slice(0, 10);
        if (!earliestDate || dateText < earliestDate) earliestDate = dateText;
        if (!latestDate || dateText > latestDate) latestDate = dateText;
      }
      if (amount !== null) {
        amountTotal += amount;
        amountCount += 1;
      }
    }

    return {
      recordCount: rowObjects.length,
      invoiceKeyCount: invoiceMap.size,
      earliestDate,
      latestDate,
      amountTotal,
      amountCount,
      duplicateInvoiceKeys: Array.from(invoiceMap.entries())
        .filter(([, count]) => count > 1)
        .slice(0, 50)
        .map(([key, count]) => ({ key, count })),
    };
  }

  async function auditIndexedDb() {
    if (!window.indexedDB) return { available: false, reason: "indexedDB unavailable" };

    const databaseInfos =
      typeof indexedDB.databases === "function"
        ? await indexedDB.databases()
        : [{ name: "quarterly-reconciliation" }];

    const databases = [];
    const importantRawForHash = {};

    for (const info of databaseInfos) {
      const name = info?.name;
      if (!name || !CONFIG.indexedDbNamePattern.test(name)) continue;
      const opened = await openIndexedDbReadonly(name);
      if (!opened.ok) {
        databases.push({ name, openError: opened.error });
        continue;
      }
      const db = opened.db;
      const stores = [];
      for (const storeName of Array.from(db.objectStoreNames)) {
        try {
          const tx = db.transaction(storeName, "readonly");
          const store = tx.objectStore(storeName);
          const count = await idbRequest(store.count());
          let sample = null;
          let all = null;
          try {
            all = await idbRequest(store.getAll());
            sample = Array.isArray(all) ? all.slice(0, 3).map(summarizeParsed) : summarizeParsed(all);
          } catch (_) {
            sample = "getAll unavailable";
          }
          let currentRecord = null;
          if (storeName === "ledger") {
            try {
              currentRecord = await idbRequest(store.get("current"));
              if (currentRecord) importantRawForHash[`${name}/${storeName}/current`] = JSON.stringify(currentRecord);
            } catch (_) {
              currentRecord = null;
            }
          }
          stores.push({
            storeName,
            count,
            keyPath: store.keyPath,
            autoIncrement: store.autoIncrement,
            indexes: Array.from(store.indexNames),
            sample,
            ledgerSummary:
              storeName === "ledger"
                ? summarizeLedger(currentRecord || all || [])
                : CONFIG.indexedDbNamePattern.test(storeName)
                ? summarizeLedger(all || [])
                : undefined,
          });
        } catch (error) {
          stores.push({ storeName, error: String(error && error.message ? error.message : error) });
        }
      }
      db.close();
      databases.push({ name, version: db.version, stores });
    }

    return { available: true, databases, importantRawForHash };
  }

  function compareServerBaseline(activeSummary) {
    const companyReceivable = activeSummary?.fieldStats?.companyReceivable;
    return {
      baseline: CONFIG.serverBaseline,
      currentActive: activeSummary
        ? {
            quarter: activeSummary.quarter,
            rows: activeSummary.rowCount,
            uniqueCustomers: activeSummary.fieldStats?.customers,
            companyReceivable,
          }
        : null,
      notes:
        "本工具只做浏览器端本地数据审计；服务器端数据库内容需由服务器查询另行确认。可在运行前注入 window.__QUARTERLY_RECON_AUDIT_BASELINE 做只读对比（仓库不内置业务基线）。",
    };
  }

  function downloadJson(data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quarterly-recon-browser-audit-${fileTimestamp(STARTED_AT)}.json`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  logStep("[1/5] 读取 localStorage / sessionStorage 概要");
  const localStorageAudit = await auditLocalStorage();
  const sessionStorageAudit = await auditSessionStorage();

  logStep("[2/5] 分析当前季度表、归档和差额/跟进结构");
  const activeRaw = localStorage.getItem("local-quarterly-reconciliation");
  const activeParsed = activeRaw ? safeJsonParse(activeRaw) : { ok: false, value: null };
  const archiveRaw = localStorage.getItem("local-quarterly-reconciliation-archive");
  const archiveParsed = archiveRaw ? safeJsonParse(archiveRaw) : { ok: false, value: null };
  const spdRaw = localStorage.getItem("local-quarterly-reconciliation-spd-sheet-archive");

  const activeSheetSummary = activeParsed.ok
    ? summarizeSheet(activeParsed.value, "local-quarterly-reconciliation")
    : null;
  const archiveSummary =
    archiveParsed.ok && activeSheetSummary
      ? summarizeArchive(archiveParsed.value, activeSheetSummary)
      : { available: false };
  const differenceAudit = activeParsed.ok
    ? collectDifferenceRecords(activeParsed.value)
    : { totalRecords: 0, summary: {}, sampleRecords: [] };
  const followUpAudit = activeParsed.ok ? collectFollowUpPaths(activeParsed.value) : [];

  logStep("[3/5] 只读扫描 IndexedDB");
  const indexedDbAudit = await auditIndexedDb();

  logStep("[4/5] 计算关键数据 SHA-256 指纹");
  const hashes = {
    "local-quarterly-reconciliation": activeRaw ? await sha256(activeRaw) : null,
    "local-quarterly-reconciliation-archive": archiveRaw ? await sha256(archiveRaw) : null,
    "local-quarterly-reconciliation-spd-sheet-archive": spdRaw ? await sha256(spdRaw) : null,
  };
  if (indexedDbAudit.importantRawForHash) {
    for (const [key, raw] of Object.entries(indexedDbAudit.importantRawForHash)) {
      hashes[`IndexedDB:${key}`] = await sha256(raw);
    }
  }

  const report = {
    meta: {
      tool: "季度对账系统浏览器本地数据只读审计与导出工具",
      version: VERSION,
      generatedAt: formatDateTime(new Date()),
      locationHref: location.href,
      userAgent: navigator.userAgent,
      readOnlyGuarantee:
        "本脚本未调用 localStorage/sessionStorage 写入删除方法，未调用 indexedDB.deleteDatabase，IndexedDB 事务只使用 readonly。",
    },
    localStorage: localStorageAudit,
    sessionStorage: sessionStorageAudit,
    activeSheetSummary,
    archiveSummary,
    differenceAudit,
    followUpAudit,
    indexedDb: indexedDbAudit,
    serverBaselineComparison: compareServerBaseline(activeSheetSummary),
    hashes,
  };

  logStep("[5/5] 导出 JSON 审计文件");
  downloadJson(report);
  console.log("审计完成 / 未修改任何浏览器数据", report);
})();
