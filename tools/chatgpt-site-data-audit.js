/*
 * 正式 ChatGPT Site 业务数据只读保全与导出工具
 *
 * 使用方式：
 * 1. 在保存有正式业务数据的浏览器中打开：
 *    https://quarterly-recon-lenovo.poetic-macaw-6673.chatgpt.site/
 * 2. 打开 DevTools Console，粘贴并执行本文件完整内容。
 *
 * 本工具只读 localStorage / IndexedDB / performance resource entries。
 * 不会写入浏览器存储，不会访问 cookie，不会发起网络请求。
 */
(async function quarterlyReconReadonlyAudit() {
  "use strict";

  const REQUIRED_ORIGIN = "https://quarterly-recon-lenovo.poetic-macaw-6673.chatgpt.site";
  const SCRIPT_VERSION = "chatgpt-site-readonly-audit-2026-08-25";
  const SERVER_BASELINE = {
    quarter: "2026 Q2",
    rows: 851,
    customers: 649,
    companyReceivableTotal: 514473239.51,
  };

  if (location.origin !== REQUIRED_ORIGIN) {
    const msg =
      "当前页面不是正式业务站点，已停止执行。请在 quarterly-recon-lenovo.poetic-macaw-6673.chatgpt.site 页面运行。";
    console.error(msg);
    alert(msg);
    return;
  }

  const startedAt = new Date();
  const warnings = [];

  const KNOWN_BUSINESS_KEYS = [
    "local-quarterly-reconciliation",
    "local-quarterly-reconciliation-archive",
    "local-quarterly-reconciliation-selected-quarter",
    "local-quarterly-reconciliation-spd-sheet-archive",
    "local-quarterly-reconciliation-dashboard",
    "local-quarterly-reconciliation-issue-tracker-view",
    "quarterly-reconciliation-import-history-v1",
  ];

  const SENSITIVE_WORDS = [
    "token",
    "auth",
    "authorization",
    "password",
    "secret",
    "credential",
    "session",
    "access",
    "refresh",
  ];

  const FIELD_ALIASES = {
    quarter: ["quarter", "对账季度", "季度"],
    accountSet: ["accountSet", "accountSetName", "账套"],
    region: ["region", "区域"],
    owner: ["owner", "ownerName", "对账负责人", "负责人"],
    customerId: ["customerId", "客户ID", "客户编码", "客户代码"],
    customerName: ["customerName", "客户名称", "客户"],
    companyReceivable: ["companyReceivable", "companyReceivableAmount", "公司应收", "公司应收金额"],
    customerLedgerAmount: ["customerLedgerAmount", "客户账面金额", "客户账面"],
    differenceAmount: ["differenceAmount", "accountDifference", "对账差额", "差额", "差额金额"],
    reconciliationStatus: ["reconciliationStatus", "对账状态", "是否对清", "对清状态"],
    followStatus: ["followStatus", "followUpStatus", "跟进状态"],
    resolveDate: ["resolveDate", "resolveTime", "解决时间"],
    solution: ["solution", "resolveSolution", "解决方案"],
    invoiceNo: ["invoiceNo", "invoiceNumber", "发票号", "发票号码"],
    invoiceDate: ["invoiceDate", "开票日期", "发票日期"],
    invoiceAmount: ["invoiceAmount", "amount", "金额", "发票金额"],
    differenceReason: ["differenceReason", "reason", "差额说明", "差额原因", "原因"],
  };

  const DIFFERENCE_CATEGORY_KEYWORDS = [
    { key: "transit", label: "在途金额", words: ["在途"] },
    { key: "returnedInvoice", label: "退票金额", words: ["退票"] },
    { key: "lostInvoice", label: "丢票金额", words: ["丢票"] },
    { key: "equipment", label: "仪器设备金额", words: ["仪器", "设备"] },
    { key: "otherWithInvoice", label: "其他（有发票）", words: ["其他", "有发票"] },
    { key: "otherWithoutInvoice", label: "其他（无发票及无法验证）", words: ["无发票", "无法验证"] },
  ];

  const MATERIAL_KEYWORDS = ["资料", "材料", "回函", "确认函", "SPD", "在途证明", "催款函"];
  const FOLLOWUP_KEYWORDS = ["跟进", "解决时间", "解决方案", "财务关注", "处理阶段", "待解决", "已解决"];
  const RESOURCE_KEYWORDS = ["api", "graphql", "state", "reconciliation", "ledger", "sync", "storage"];

  function logStep(step, label) {
    console.log(`[${step}/7] ${label}`);
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function formatTimestamp(date) {
    return [
      date.getFullYear(),
      pad2(date.getMonth() + 1),
      pad2(date.getDate()),
      "-",
      pad2(date.getHours()),
      pad2(date.getMinutes()),
      pad2(date.getSeconds()),
    ].join("");
  }

  function formatIsoLocal(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
      date.getHours()
    )}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  }

  function byteLength(text) {
    return new Blob([text]).size;
  }

  function topLevelType(value) {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
  }

  function tryParseJson(raw) {
    if (typeof raw !== "string") return { ok: false, value: undefined };
    const trimmed = raw.trim();
    if (!trimmed) return { ok: false, value: undefined };
    if (!["{", "["].includes(trimmed[0])) return { ok: false, value: undefined };
    try {
      return { ok: true, value: JSON.parse(trimmed) };
    } catch (error) {
      return { ok: false, value: undefined, error: String(error && error.message ? error.message : error) };
    }
  }

  function isSensitiveKey(key) {
    const normalized = String(key || "").toLowerCase();
    if (/selected[-_.:]?quarter/.test(normalized)) return false;
    return SENSITIVE_WORDS.some((word) => normalized.includes(word));
  }

  function isBusinessKey(key) {
    const normalized = String(key || "").toLowerCase();
    return (
      KNOWN_BUSINESS_KEYS.includes(key) ||
      /(quarter|quarterly|recon|reconciliation|ledger|follow|material|spd|archive|dashboard|issue|import-history)/i.test(
        normalized
      )
    );
  }

  function stableStringify(value, space) {
    const seen = new WeakSet();
    return JSON.stringify(
      value,
      function stableReplacer(_key, val) {
        if (val && typeof val === "object") {
          if (seen.has(val)) return "[Circular]";
          seen.add(val);
          if (Array.isArray(val)) return val;
          if (val instanceof Date) return val.toISOString();
          const sorted = {};
          Object.keys(val)
            .sort()
            .forEach((objectKey) => {
              sorted[objectKey] = val[objectKey];
            });
          return sorted;
        }
        return val;
      },
      space
    );
  }

  async function sha256Text(text) {
    if (!crypto || !crypto.subtle || !crypto.subtle.digest) {
      warnings.push("当前浏览器不支持 crypto.subtle.digest，无法生成 SHA-256。");
      return { available: false };
    }
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function serializeValue(value, seen) {
    if (value === null || value === undefined) return value;
    const valueType = typeof value;
    if (valueType === "string" || valueType === "number" || valueType === "boolean") return value;
    if (valueType === "bigint") return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Blob) {
      return {
        binaryExportRequired: true,
        kind: value instanceof File ? "File" : "Blob",
        name: value instanceof File ? value.name : undefined,
        type: value.type,
        size: value.size,
        lastModified: value instanceof File ? value.lastModified : undefined,
      };
    }
    if (value instanceof ArrayBuffer) {
      return { binaryExportRequired: true, kind: "ArrayBuffer", byteLength: value.byteLength };
    }
    if (ArrayBuffer.isView(value)) {
      return {
        binaryExportRequired: true,
        kind: value.constructor ? value.constructor.name : "TypedArray",
        byteLength: value.byteLength,
      };
    }
    if (valueType !== "object") return String(value);
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => serializeValue(item, seen));
    const output = {};
    Object.keys(value).forEach((key) => {
      output[key] = serializeValue(value[key], seen);
    });
    return output;
  }

  function getField(row, aliases) {
    if (!row || typeof row !== "object") return undefined;
    for (const alias of aliases) {
      if (Object.prototype.hasOwnProperty.call(row, alias)) return row[alias];
    }
    const keys = Object.keys(row);
    const normalizedAliases = aliases.map((alias) => String(alias).replace(/\s+/g, "").toLowerCase());
    const matchedKey = keys.find((key) => normalizedAliases.includes(String(key).replace(/\s+/g, "").toLowerCase()));
    return matchedKey ? row[matchedKey] : undefined;
  }

  function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const normalized = String(value).replace(/[,\s￥¥元万]/g, "");
    if (!normalized || normalized === "-" || normalized === "—") return null;
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function collectTableCandidates(root, sourceKey) {
    const candidates = [];
    const seen = new WeakSet();
    let visited = 0;
    const maxVisited = 150000;

    function visit(value, path) {
      visited += 1;
      if (visited > maxVisited || value === null || typeof value !== "object") return;
      if (seen.has(value)) return;
      seen.add(value);

      if (Array.isArray(value)) {
        if (value.length > 0) {
          const objectRows = value.filter((item) => item && typeof item === "object" && !Array.isArray(item));
          if (objectRows.length >= Math.min(3, value.length)) {
            candidates.push({ sourceKey, path, rowCount: objectRows.length, rows: objectRows });
          }
        }
        value.forEach((item, index) => {
          if (index < 2000) visit(item, `${path}[${index}]`);
        });
        return;
      }

      Object.keys(value).forEach((key) => visit(value[key], path ? `${path}.${key}` : key));
    }

    visit(root, "");
    return candidates;
  }

  function summarizeRows(rows) {
    const summary = {
      rowCount: rows.length,
      uniqueCustomers: { available: false },
      companyReceivableTotal: { available: false },
      customerLedgerAmountTotal: { available: false },
      differenceAmountTotal: { available: false },
      reconciliationStatus: { available: false },
      followups: { available: false },
      invoiceFields: { invoiceNo: false, invoiceDate: false, invoiceAmount: false, differenceReason: false },
      sampleFields: [],
    };

    const customers = new Set();
    let companyReceivableTotal = 0;
    let companyReceivableCount = 0;
    let customerLedgerTotal = 0;
    let customerLedgerCount = 0;
    let differenceTotal = 0;
    let differenceCount = 0;
    const statusCounts = {};
    let followupCount = 0;
    const sampleFieldSet = new Set();

    rows.slice(0, 50).forEach((row) => Object.keys(row || {}).forEach((key) => sampleFieldSet.add(key)));

    rows.forEach((row) => {
      const customerId = getField(row, FIELD_ALIASES.customerId);
      const customerName = getField(row, FIELD_ALIASES.customerName);
      if (customerId || customerName) customers.add(String(customerId || customerName));

      const companyReceivable = toNumberOrNull(getField(row, FIELD_ALIASES.companyReceivable));
      if (companyReceivable !== null) {
        companyReceivableTotal += companyReceivable;
        companyReceivableCount += 1;
      }

      const customerLedger = toNumberOrNull(getField(row, FIELD_ALIASES.customerLedgerAmount));
      if (customerLedger !== null) {
        customerLedgerTotal += customerLedger;
        customerLedgerCount += 1;
      }

      const differenceAmount = toNumberOrNull(getField(row, FIELD_ALIASES.differenceAmount));
      if (differenceAmount !== null) {
        differenceTotal += differenceAmount;
        differenceCount += 1;
      }

      const status = getField(row, FIELD_ALIASES.reconciliationStatus);
      if (status !== undefined && status !== null && String(status).trim()) {
        statusCounts[String(status)] = (statusCounts[String(status)] || 0) + 1;
      }

      const followStatus = getField(row, FIELD_ALIASES.followStatus);
      const resolveDate = getField(row, FIELD_ALIASES.resolveDate);
      const solution = getField(row, FIELD_ALIASES.solution);
      if (followStatus || resolveDate || solution) followupCount += 1;

      if (getField(row, FIELD_ALIASES.invoiceNo)) summary.invoiceFields.invoiceNo = true;
      if (getField(row, FIELD_ALIASES.invoiceDate)) summary.invoiceFields.invoiceDate = true;
      if (getField(row, FIELD_ALIASES.invoiceAmount) !== undefined) summary.invoiceFields.invoiceAmount = true;
      if (getField(row, FIELD_ALIASES.differenceReason)) summary.invoiceFields.differenceReason = true;
    });

    if (customers.size) summary.uniqueCustomers = { available: true, value: customers.size };
    if (companyReceivableCount) {
      summary.companyReceivableTotal = { available: true, value: companyReceivableTotal, rowCount: companyReceivableCount };
    }
    if (customerLedgerCount) {
      summary.customerLedgerAmountTotal = { available: true, value: customerLedgerTotal, rowCount: customerLedgerCount };
    }
    if (differenceCount) {
      summary.differenceAmountTotal = { available: true, value: differenceTotal, rowCount: differenceCount };
    }
    if (Object.keys(statusCounts).length) summary.reconciliationStatus = { available: true, counts: statusCounts };
    if (followupCount) summary.followups = { available: true, rowCount: followupCount };
    summary.sampleFields = Array.from(sampleFieldSet).slice(0, 80);
    return summary;
  }

  function scanKeywordMatches(value, keywords, label) {
    const matches = [];
    const seen = new WeakSet();
    let visited = 0;
    const maxVisited = 100000;

    function visit(node, path) {
      visited += 1;
      if (visited > maxVisited || node === null || node === undefined) return;
      if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
        const text = String(node);
        if (keywords.some((word) => text.includes(word))) {
          matches.push({ path, preview: text.slice(0, 180) });
        }
        return;
      }
      if (typeof node !== "object") return;
      if (seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        node.forEach((item, index) => {
          if (index < 3000) visit(item, `${path}[${index}]`);
        });
      } else {
        Object.keys(node).forEach((key) => {
          if (keywords.some((word) => key.includes(word))) {
            matches.push({ path: path ? `${path}.${key}` : key, preview: "[field]" });
          }
          visit(node[key], path ? `${path}.${key}` : key);
        });
      }
    }

    visit(value, label);
    return { label, matchCount: matches.length, samples: matches.slice(0, 30) };
  }

  function analyzeBusinessData(localStoragePayload, indexedDbPayload) {
    const tableCandidates = [];
    localStoragePayload.items.forEach((item) => {
      if (item.jsonParseable) {
        tableCandidates.push(...collectTableCandidates(item.parsed, `localStorage:${item.key}`));
      }
    });
    indexedDbPayload.records.forEach((record) => {
      if (record.value && record.value.binaryExportRequired !== true) {
        tableCandidates.push(...collectTableCandidates(record.value, `indexedDB:${record.database}/${record.store}`));
      }
    });

    const rankedTables = tableCandidates
      .map((candidate) => ({
        sourceKey: candidate.sourceKey,
        path: candidate.path,
        rowCount: candidate.rowCount,
        summary: summarizeRows(candidate.rows),
      }))
      .sort((a, b) => b.rowCount - a.rowCount)
      .slice(0, 20);

    const primaryCurrentQuarter = rankedTables[0] || null;
    const allInspectableValues = [
      ...localStoragePayload.items.filter((item) => item.jsonParseable).map((item) => ({ label: `localStorage:${item.key}`, value: item.parsed })),
      ...indexedDbPayload.records.map((record) => ({ label: `indexedDB:${record.database}/${record.store}`, value: record.value })),
    ];

    const differenceScans = DIFFERENCE_CATEGORY_KEYWORDS.map((category) => {
      const categoryMatches = allInspectableValues.map((entry) => scanKeywordMatches(entry.value, category.words, entry.label));
      const count = categoryMatches.reduce((sum, entry) => sum + entry.matchCount, 0);
      return { ...category, matchCount: count, samples: categoryMatches.flatMap((entry) => entry.samples).slice(0, 20) };
    });

    const materialScans = allInspectableValues.map((entry) => scanKeywordMatches(entry.value, MATERIAL_KEYWORDS, entry.label));
    const followupScans = allInspectableValues.map((entry) => scanKeywordMatches(entry.value, FOLLOWUP_KEYWORDS, entry.label));

    const sourceCompleteness = {
      companyReceivable: Boolean(primaryCurrentQuarter && primaryCurrentQuarter.summary.companyReceivableTotal.available),
      customerLedgerAmount: Boolean(primaryCurrentQuarter && primaryCurrentQuarter.summary.customerLedgerAmountTotal.available),
      differenceDetails: differenceScans.some((item) => item.matchCount > 0),
      sixDifferenceCategories: differenceScans.every((item) => item.matchCount > 0),
      reconciliationStatus: Boolean(primaryCurrentQuarter && primaryCurrentQuarter.summary.reconciliationStatus.available),
      followups: followupScans.some((item) => item.matchCount > 0),
      ledgerInvoices: rankedTables.some((table) => table.summary.invoiceFields.invoiceNo && table.summary.invoiceFields.invoiceDate),
      spdMaterials: materialScans.some((item) => item.matchCount > 0),
    };

    return {
      tableCandidates: rankedTables,
      primaryCurrentQuarter,
      differenceCategoryAudit: differenceScans,
      materialAudit: {
        matchCount: materialScans.reduce((sum, entry) => sum + entry.matchCount, 0),
        samples: materialScans.flatMap((entry) => entry.samples).slice(0, 40),
      },
      followupAudit: {
        matchCount: followupScans.reduce((sum, entry) => sum + entry.matchCount, 0),
        samples: followupScans.flatMap((entry) => entry.samples).slice(0, 40),
      },
      sourceCompleteness,
    };
  }

  function buildLocalStorageExport() {
    const inventory = [];
    const items = [];

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      const raw = key === null ? null : localStorage.getItem(key);
      const parsed = tryParseJson(raw);
      const sensitive = isSensitiveKey(key);
      const business = isBusinessKey(key);
      const exported = Boolean(!sensitive && business);

      inventory.push({
        key,
        exported,
        excluded: !exported,
        excludeReason: sensitive ? "sensitive-key-name" : business ? undefined : "non-business-key",
        charLength: typeof raw === "string" ? raw.length : 0,
        jsonParseable: parsed.ok,
        topLevelType: parsed.ok ? topLevelType(parsed.value) : "string",
      });

      if (exported) {
        items.push({
          key,
          raw,
          jsonParseable: parsed.ok,
          parsed: parsed.ok ? parsed.value : undefined,
        });
      }
    }

    return {
      meta: {
        scriptVersion: SCRIPT_VERSION,
        origin: location.origin,
        href: location.href,
        exportedAt: formatIsoLocal(new Date()),
        readOnly: true,
      },
      knownBusinessKeys: KNOWN_BUSINESS_KEYS,
      inventory,
      items,
    };
  }

  function openDatabaseReadonly(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onupgradeneeded = function onUpgradeNeeded() {
        try {
          if (request.transaction) request.transaction.abort();
        } catch (error) {
          warnings.push(`阻止 IndexedDB 升级/创建 ${name} 时出现异常：${String(error)}`);
        }
        reject(new Error(`为避免创建或升级数据库，已跳过 ${name}`));
      };
      request.onerror = function onError() {
        reject(request.error || new Error(`打开 IndexedDB ${name} 失败`));
      };
      request.onsuccess = function onSuccess() {
        resolve(request.result);
      };
    });
  }

  function countStore(db, storeName) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve({ available: false, error: String(request.error) });
      } catch (error) {
        resolve({ available: false, error: String(error) });
      }
    });
  }

  function readStoreRecords(db, databaseName, storeName) {
    return new Promise((resolve) => {
      const records = [];
      try {
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const request = store.openCursor();
        request.onsuccess = function onCursorSuccess(event) {
          const cursor = event.target.result;
          if (!cursor) {
            resolve(records);
            return;
          }
          records.push({
            database: databaseName,
            version: db.version,
            store: storeName,
            key: serializeValue(cursor.key, new WeakSet()),
            value: serializeValue(cursor.value, new WeakSet()),
          });
          cursor.continue();
        };
        request.onerror = function onCursorError() {
          warnings.push(`读取 IndexedDB ${databaseName}/${storeName} 失败：${String(request.error)}`);
          resolve(records);
        };
      } catch (error) {
        warnings.push(`读取 IndexedDB ${databaseName}/${storeName} 异常：${String(error)}`);
        resolve(records);
      }
    });
  }

  async function buildIndexedDbExport() {
    const exportPayload = {
      meta: {
        scriptVersion: SCRIPT_VERSION,
        origin: location.origin,
        href: location.href,
        exportedAt: formatIsoLocal(new Date()),
        readOnly: true,
      },
      databaseInventory: [],
      storeInventory: [],
      records: [],
      invoiceDetectionSummary: [],
    };

    if (!("indexedDB" in window)) {
      warnings.push("当前浏览器不支持 IndexedDB。");
      return exportPayload;
    }

    if (typeof indexedDB.databases !== "function") {
      warnings.push("当前浏览器不支持 indexedDB.databases()，为避免误创建数据库，已跳过 IndexedDB 导出。");
      return exportPayload;
    }

    let databases = [];
    try {
      databases = await indexedDB.databases();
    } catch (error) {
      warnings.push(`读取 IndexedDB 数据库列表失败：${String(error)}`);
      return exportPayload;
    }

    const relevantDatabases = databases
      .filter((dbInfo) => dbInfo && dbInfo.name)
      .filter((dbInfo) => /(quarter|quarterly|recon|reconciliation|ledger|storage|local)/i.test(dbInfo.name));

    exportPayload.databaseInventory = databases.map((dbInfo) => ({
      name: dbInfo.name || "",
      version: dbInfo.version || null,
      relevant: Boolean(dbInfo.name && relevantDatabases.some((item) => item.name === dbInfo.name)),
    }));

    for (const dbInfo of relevantDatabases) {
      let db;
      try {
        db = await openDatabaseReadonly(dbInfo.name);
      } catch (error) {
        warnings.push(String(error && error.message ? error.message : error));
        continue;
      }
      const storeNames = Array.from(db.objectStoreNames);
      for (const storeName of storeNames) {
        const count = await countStore(db, storeName);
        exportPayload.storeInventory.push({
          database: dbInfo.name,
          version: db.version,
          store: storeName,
          count,
        });
        const records = await readStoreRecords(db, dbInfo.name, storeName);
        exportPayload.records.push(...records);
      }
      db.close();
    }

    exportPayload.invoiceDetectionSummary = exportPayload.records
      .map((record) => {
        const value = record.value;
        if (!value || typeof value !== "object" || value.binaryExportRequired) return null;
        const invoiceNo = getField(value, FIELD_ALIASES.invoiceNo);
        const invoiceDate = getField(value, FIELD_ALIASES.invoiceDate);
        const invoiceAmount = getField(value, FIELD_ALIASES.invoiceAmount);
        if (!invoiceNo && !invoiceDate && invoiceAmount === undefined) return null;
        return {
          database: record.database,
          store: record.store,
          key: record.key,
          invoiceNo: invoiceNo || { available: false },
          invoiceDate: invoiceDate || { available: false },
          invoiceAmount: invoiceAmount === undefined ? { available: false } : invoiceAmount,
        };
      })
      .filter(Boolean)
      .slice(0, 5000);

    return exportPayload;
  }

  function buildPerformanceClues() {
    if (!performance || typeof performance.getEntriesByType !== "function") return { available: false };
    return performance
      .getEntriesByType("resource")
      .filter((entry) => RESOURCE_KEYWORDS.some((word) => String(entry.name).toLowerCase().includes(word)))
      .map((entry) => ({
        name: entry.name,
        initiatorType: entry.initiatorType,
        startTime: Math.round(entry.startTime),
        duration: Math.round(entry.duration),
      }))
      .slice(0, 200);
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadPayload(prefix, payload, timestamp) {
    const text = stableStringify(payload, 2);
    const size = byteLength(text);
    const files = [];
    const baseName = `${prefix}-${timestamp}`;

    if (size > 50 * 1024 * 1024) {
      warnings.push(`${prefix} 导出文件超过 50MB，请下载后立即复制到安全位置。`);
    }

    if (size <= 100 * 1024 * 1024 || !Array.isArray(payload.records)) {
      const filename = `${baseName}.json`;
      downloadText(filename, text);
      files.push({ filename, bytes: size, split: false });
      return { files, textForHash: text };
    }

    warnings.push(`${prefix} 导出文件超过 100MB，已按记录分片下载。`);
    const metaOnly = { ...payload, records: [] };
    const metaText = stableStringify(metaOnly, 2);
    const metaFilename = `${baseName}-manifest-only.json`;
    downloadText(metaFilename, metaText);
    files.push({ filename: metaFilename, bytes: byteLength(metaText), split: true });

    const chunkSize = 5000;
    for (let start = 0; start < payload.records.length; start += chunkSize) {
      const part = {
        meta: payload.meta,
        part: Math.floor(start / chunkSize) + 1,
        totalParts: Math.ceil(payload.records.length / chunkSize),
        records: payload.records.slice(start, start + chunkSize),
      };
      const partText = stableStringify(part, 2);
      const filename = `${baseName}-part-${String(part.part).padStart(3, "0")}.json`;
      downloadText(filename, partText);
      files.push({ filename, bytes: byteLength(partText), split: true });
    }

    return { files, textForHash: text };
  }

  try {
    logStep(1, "读取 localStorage 清单与业务键。");
    const localStoragePayload = buildLocalStorageExport();

    logStep(2, "只读扫描 IndexedDB 数据库与对象仓库。");
    const indexedDbPayload = await buildIndexedDbExport();

    logStep(3, "分析季度对账、差额、跟进、资料与 SPD 数据完整性。");
    const dataAudit = analyzeBusinessData(localStoragePayload, indexedDbPayload);

    logStep(4, "读取 performance 资源线索，不发起任何网络请求。");
    const performanceClues = buildPerformanceClues();

    logStep(5, "生成导出文件哈希与一致性摘要。");
    const timestamp = formatTimestamp(startedAt);
    const localStorageText = stableStringify(localStoragePayload, 2);
    const indexedDbText = stableStringify(indexedDbPayload, 2);
    const localStorageHash = await sha256Text(localStorageText);
    const indexedDbHash = await sha256Text(indexedDbText);

    const archiveItems = localStoragePayload.items.filter((item) => /archive/i.test(item.key));
    const currentItems = localStoragePayload.items.filter((item) => item.key === "local-quarterly-reconciliation");
    const archiveComparison = {
      feasible: Boolean(currentItems.length && archiveItems.length),
      currentHash: currentItems.length ? await sha256Text(stableStringify(currentItems[0].parsed || currentItems[0].raw, 0)) : { available: false },
      archiveHashes: [],
      exactHashMatchFound: false,
    };
    for (const archiveItem of archiveItems) {
      const hash = await sha256Text(stableStringify(archiveItem.parsed || archiveItem.raw, 0));
      archiveComparison.archiveHashes.push({ key: archiveItem.key, hash });
      if (hash === archiveComparison.currentHash) archiveComparison.exactHashMatchFound = true;
    }

    logStep(6, "下载 localStorage、IndexedDB 与 manifest 文件。");
    const localStorageDownload = downloadPayload("quarterly-recon-localstorage", localStoragePayload, timestamp);
    const indexedDbDownload = downloadPayload("quarterly-recon-indexeddb", indexedDbPayload, timestamp);

    const manifest = {
      meta: {
        scriptVersion: SCRIPT_VERSION,
        origin: location.origin,
        href: location.href,
        startedAt: formatIsoLocal(startedAt),
        finishedAt: formatIsoLocal(new Date()),
        readOnly: true,
        noServerRequest: true,
      },
      serverBaseline: SERVER_BASELINE,
      localStorage: {
        keyCount: localStoragePayload.inventory.length,
        exportedKeyCount: localStoragePayload.items.length,
        inventory: localStoragePayload.inventory,
        sha256: localStorageHash,
        downloadedFiles: localStorageDownload.files,
      },
      indexedDB: {
        databaseInventory: indexedDbPayload.databaseInventory,
        storeInventory: indexedDbPayload.storeInventory,
        recordCount: indexedDbPayload.records.length,
        invoiceDetectionCount: indexedDbPayload.invoiceDetectionSummary.length,
        sha256: indexedDbHash,
        downloadedFiles: indexedDbDownload.files,
      },
      dataAudit,
      archiveComparison,
      performanceClues,
      sourceCompleteness: dataAudit.sourceCompleteness,
      readOnlyGuarantee: {
        localStorage: "length/key/getItem only",
        indexedDB: "databases/open/readonly/count/openCursor only",
        prohibitedWrites: [
          "localStorage write",
          "IndexedDB readwrite",
          "IndexedDB put/add/delete/clear",
          "deleteDatabase",
          "schema upgrade",
          "server request",
          "cookie access",
        ],
      },
      warnings,
    };
    const manifestText = stableStringify(manifest, 2);
    const manifestHash = await sha256Text(manifestText);
    manifest.fileSha256 = {
      manifest: manifestHash,
      localStorage: localStorageHash,
      indexedDB: indexedDbHash,
    };
    const finalManifestText = stableStringify(manifest, 2);
    const manifestFilename = `quarterly-recon-browser-manifest-${timestamp}.json`;
    downloadText(manifestFilename, finalManifestText);

    logStep(7, "完成。请保存下载的 JSON 文件到迁移保全目录。");
    console.log("【季度对账正式站点只读保全完成】", {
      manifest: manifestFilename,
      localStorageFiles: localStorageDownload.files.map((file) => file.filename),
      indexedDbFiles: indexedDbDownload.files.map((file) => file.filename),
      warnings,
      sourceCompleteness: dataAudit.sourceCompleteness,
    });
  } catch (error) {
    console.error("【季度对账正式站点只读保全失败】", error);
    alert(`只读保全工具执行失败：${String(error && error.message ? error.message : error)}`);
  }
})();
