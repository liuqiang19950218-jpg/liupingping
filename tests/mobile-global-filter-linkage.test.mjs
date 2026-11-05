import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import WebSocket from "ws";

const root = new URL("..", import.meta.url);
const quarterCode = "2026-Q2";
const fixtureRows = [
  { id: "leaf-nj", sourceRowKey: "1", quarterCode, sourceSequence: "1", importOrder: 1, region: "南京", accountSet: "华东", customer: "南京测试医院", companyReceivable: "600000", customerBookAmount: "500000", reconciliationDifference: "100000", reconciliationStatus: "未对清", badDebtAmount: null, badDebtReason: null, adjustmentAmount: null, adjustmentReason: null, solution: "等待医院处理", solutionDate: "2026-10-01", manualResolutionStatus: null, financeAttention: "none", ownerId: null, ownerName: "叶孝彤" },
  { id: "leaf-sz", sourceRowKey: "2", quarterCode, sourceSequence: "2", importOrder: 2, region: "苏州", accountSet: "华东", customer: "苏州测试医院", companyReceivable: "500000", customerBookAmount: "440000", reconciliationDifference: "60000", reconciliationStatus: "未对清", badDebtAmount: null, badDebtReason: null, adjustmentAmount: null, adjustmentReason: null, solution: "财务调账", solutionDate: "2026-10-02", manualResolutionStatus: null, financeAttention: "需财务复核", ownerId: null, ownerName: "叶孝彤" },
  { id: "other-nt", sourceRowKey: "3", quarterCode, sourceSequence: "3", importOrder: 3, region: "南通", accountSet: "华东", customer: "南通测试医院", companyReceivable: "480000", customerBookAmount: "400000", reconciliationDifference: "80000", reconciliationStatus: "未对清", badDebtAmount: null, badDebtReason: null, adjustmentAmount: null, adjustmentReason: null, solution: "等待销售申请", solutionDate: "2026-10-03", manualResolutionStatus: null, financeAttention: "none", ownerId: null, ownerName: "其他负责人" },
];
const fixtureFollowups = [
  { id: "f-leaf-nj", reconciliationId: "leaf-nj", quarterCode, followStatus: "pending", processStage: "待销售去医院处理", riskLevel: "high", expectedCompleteAt: "2026-10-01", nextFollowUpAt: null, latestFollowUpAt: "2026-09-20", closedAt: null, createdAt: "2026-09-01", updatedAt: "2026-09-20", events: [{ id: "e1", eventType: "follow_up", content: "等待医院", occurredAt: "2026-09-20" }], latestEvent: { id: "e1", eventType: "follow_up", content: "等待医院", occurredAt: "2026-09-20" } },
  { id: "f-leaf-sz", reconciliationId: "leaf-sz", quarterCode, followStatus: "pending", processStage: "待财务调账", riskLevel: "medium", expectedCompleteAt: "2026-10-02", nextFollowUpAt: null, latestFollowUpAt: "2026-10-01", closedAt: null, createdAt: "2026-10-01", updatedAt: "2026-10-01", events: [{ id: "e2", eventType: "follow_up", content: "财务调账", occurredAt: "2026-10-01" }], latestEvent: { id: "e2", eventType: "follow_up", content: "财务调账", occurredAt: "2026-10-01" } },
  { id: "f-other-nt", reconciliationId: "other-nt", quarterCode, followStatus: "pending", processStage: "待销售走申请", riskLevel: "low", expectedCompleteAt: "2026-10-03", nextFollowUpAt: null, latestFollowUpAt: "2026-10-02", closedAt: null, createdAt: "2026-10-02", updatedAt: "2026-10-02", events: [{ id: "e3", eventType: "follow_up", content: "等待销售申请", occurredAt: "2026-10-02" }], latestEvent: { id: "e3", eventType: "follow_up", content: "等待销售申请", occurredAt: "2026-10-02" } },
];

const responseFor = (url) => {
  const pathname = new URL(url).pathname;
  if (pathname === "/api/quarters") return { quarters: [{ code: quarterCode, year: 2026, quarter: 2, cutoffDate: "2026-06-30", status: "OPEN", reconciliationCount: fixtureRows.length }] };
  if (pathname.endsWith("/reconciliations")) return { quarter: quarterCode, reconciliations: fixtureRows };
  if (pathname.endsWith("/difference-items")) return { quarter: quarterCode, count: 0, items: [] };
  if (pathname.endsWith("/followups")) return { quarter: quarterCode, count: fixtureFollowups.length, eventCount: 3, items: fixtureFollowups };
  if (pathname.endsWith("/material-status")) return { material: [] };
  if (pathname === "/api/historical-settlement-snapshots") return { periods: [] };
  if (pathname.endsWith("/spd-dashboard")) return { quarter: quarterCode, count: 0, summary: { spdConfirmation: { total: 0, submitted: 0, unsubmitted: 0, submissionRate: null }, spdInventoryConfirmation: { total: 0, submitted: 0, unsubmitted: 0, submissionRate: null } }, items: [] };
  throw new Error(`Unexpected browser API request: ${pathname}`);
};
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const freePort = async () => new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

class Cdp {
  constructor(socket) {
    this.socket = socket; this.sequence = 0; this.pending = new Map(); this.listeners = new Map();
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.id) {
        const waiter = this.pending.get(message.id); if (!waiter) return;
        this.pending.delete(message.id);
        if (message.error) {
          const error = new Error(`${message.error.message} (${waiter.method})`);
          error.stack = `${error.stack}\nCalled from:\n${waiter.caller}`;
          waiter.reject(error);
        } else waiter.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
    });
  }
  send(method, params = {}) {
    const id = ++this.sequence; this.socket.send(JSON.stringify({ id, method, params }));
    const caller = new Error().stack;
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method, caller }));
  }
  on(method, listener) { this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]); }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  async waitFor(expression, message) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) { if (await this.evaluate(expression)) return; await delay(80); }
    const body = await this.evaluate("document.body?.innerText?.slice(0, 1000) || document.documentElement?.outerHTML?.slice(0, 1000)");
    throw new Error(`Timed out waiting for ${message}: ${body}`);
  }
}

const startTestServer = async (port, stateDirectory) => {
  // The application is deployed as a Cloudflare Worker.  Use the existing
  // Wrangler production-artifact path rather than Vite dev mode, whose RSC
  // module URLs are intentionally different from the shipped application.
  // `stateDirectory` is a per-test temporary Miniflare location; browser API
  // calls are intercepted below, so no real business database is contacted.
  const child = spawn(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "dev", "--config", "dist/server/wrangler.json", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", stateDirectory], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { output += chunk; });
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(1_000) })).ok) return child;
    } catch { /* The production worker is starting. */ }
    if (child.exitCode !== null) throw new Error(`Isolated Worker exited early: ${output}`);
    await delay(250);
  }
  child.kill(); throw new Error(`Timed out starting isolated browser fixture server: ${output}`);
};
const startBrowser = async (port, profile) => {
  const executable = path.join(process.env.LOCALAPPDATA, "ms-playwright", "chromium_headless_shell-1228", "chrome-headless-shell-win64", "chrome-headless-shell.exe");
  const child = spawn(executable, [`--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const details = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1_000) })).json();
      const browserSocket = new WebSocket(details.webSocketDebuggerUrl); await once(browserSocket, "open");
      const browserCdp = new Cdp(browserSocket);
      const { targetId } = await browserCdp.send("Target.createTarget", { url: "about:blank" });
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1_000) })).json();
      const target = targets.find((item) => item.id === targetId);
      if (!target?.webSocketDebuggerUrl) throw new Error("New Chromium page target was not discoverable");
      const socket = new WebSocket(target.webSocketDebuggerUrl); await once(socket, "open");
      browserSocket.close();
      return { child, cdp: new Cdp(socket) };
    } catch { await delay(100); }
  }
  child.kill(); throw new Error("Chromium DevTools endpoint did not start");
};
const selectValue = (cdp, selector, value) => cdp.evaluate(`(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!(element instanceof HTMLSelectElement)) throw new Error("Missing select: ${selector}");
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  setter.call(element, ${JSON.stringify(value)});
  element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true }));
})()`);
const click = async (cdp, selector, exactText = "") => {
  const point = await cdp.evaluate(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find((item) => !${JSON.stringify(exactText)} || item.textContent.includes(${JSON.stringify(exactText)}));
    if (!(element instanceof HTMLElement)) throw new Error(${JSON.stringify(`Missing clickable element: ${selector} ${exactText}`)});
    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
};
const metrics = (cdp, selector) => cdp.evaluate(`Object.fromEntries([...document.querySelectorAll(${JSON.stringify(selector)})].map((card) => [card.querySelector("span:not(.metric-icon)")?.textContent.trim() || card.querySelector("span")?.textContent.trim(), card.querySelector("strong, b")?.textContent.trim()]))`);

test("mobile filters are interactive while desktop shows seven and phones show six KPIs", { timeout: 120_000 }, async () => {
  const appPort = await freePort(); const debugPort = await freePort();
  const profile = await mkdtemp(path.join(os.tmpdir(), "recon-mobile-browser-"));
  const workerState = await mkdtemp(path.join(os.tmpdir(), "recon-mobile-worker-"));
  let server; let browser;
  try {
    server = await startTestServer(appPort, workerState); browser = await startBrowser(debugPort, profile);
    const { cdp } = browser; const consoleErrors = [];
    cdp.on("Runtime.consoleAPICalled", ({ type, args }) => { if (type === "error") consoleErrors.push(args.map((entry) => entry.value ?? entry.description ?? "").join(" ")); });
    cdp.on("Fetch.requestPaused", async ({ requestId, request }) => {
      try { await cdp.send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify(responseFor(request.url))).toString("base64") }); }
      catch (error) { await cdp.send("Fetch.failRequest", { requestId, errorReason: "Failed" }); consoleErrors.push(error instanceof Error ? error.message : String(error)); }
    });
    await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.send("Page.navigate", { url: `http://localhost:${appPort}` });
    await cdp.waitFor("document.querySelector('.mobile-bottom-nav') && !document.querySelector('.app-shell-loading')", "hydrated mobile shell");
    assert.equal(await cdp.evaluate("window.innerWidth"), 390); assert.ok(await cdp.evaluate("navigator.maxTouchPoints >= 1"));

    await click(cdp, '.mobile-bottom-nav button[aria-label="问题解决看板"]');
    await cdp.waitFor("document.querySelectorAll('.pd-kpi').length === 7", "seven problem KPIs");
    assert.deepEqual(await metrics(cdp, ".pd-kpi"), { "未关闭问题": "3", "超期未关闭": "3", "7天未跟进": "3", "待销售处理": "2", "待内部处理": "1", "需财务复核": "1", "需领导介入": "0" });
    for (const width of [1280, 1366, 1440]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false }); await delay(80);
      const layout = await cdp.evaluate(`(() => { const cards = [...document.querySelectorAll('.pd-kpi')]; const leader = cards.find((item) => item.textContent.includes('需领导介入')); return { visible: cards.filter((item) => getComputedStyle(item).display !== 'none').length, leaderDisplay: getComputedStyle(leader).display }; })()`);
      assert.equal(layout.visible, 7, `${width}px desktop shows all seven KPIs`); assert.notEqual(layout.leaderDisplay, "none", `${width}px desktop shows the leadership KPI`);
    }
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    for (const width of [320, 375, 390, 430]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 2, mobile: true }); await delay(80);
      const layout = await cdp.evaluate(`(() => { const cards = [...document.querySelectorAll('.pd-kpi')]; const leader = cards.find((item) => item.textContent.includes('需领导介入')); const visible = cards.filter((item) => getComputedStyle(item).display !== 'none'); return { leaderDisplay: getComputedStyle(leader).display, visible: visible.length, cardsInsideViewport: visible.every((item) => { const rect = item.getBoundingClientRect(); return rect.width > 0 && rect.right <= window.innerWidth; }), viewport: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }; })()`);
      assert.equal(layout.leaderDisplay, "none", `${width}px hides the leadership KPI on mobile`); assert.equal(layout.visible, 6, `${width}px shows six mobile KPIs`); assert.ok(layout.cardsInsideViewport, `${width}px keeps every visible KPI inside the viewport`);
      if (width === 320) assert.ok(layout.scrollWidth <= layout.viewport, "320px has no document horizontal overflow");
    }
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    assert.equal(await cdp.evaluate("document.querySelectorAll('.pd-preview tbody tr').length"), 3);
    await selectValue(cdp, ".pd-filter select", "叶孝彤");
    await cdp.waitFor("[...document.querySelectorAll('.pd-kpi')].find((card) => card.textContent.includes('未关闭问题')).querySelector('strong').textContent.trim() === '2'", "problem KPI owner filter");
    assert.equal(await cdp.evaluate("document.querySelectorAll('.pd-preview tbody tr').length"), 2);

    await click(cdp, '.mobile-bottom-nav button[aria-label="管理层驾驶舱"]'); await cdp.waitFor("Boolean(document.querySelector('.cockpit-filter'))", "cockpit");
    const cockpitOwner = "[...document.querySelectorAll('.cockpit-filter label')].find((label) => label.textContent.includes('对账负责人')).querySelector('select')";
    assert.equal((await metrics(cdp, ".metric-card"))["未解决差额"], "24万");
    await cdp.evaluate(`(() => { const element = ${cockpitOwner}; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(element, '叶孝彤'); element.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await cdp.waitFor("[...document.querySelectorAll('.metric-card')].find((card) => card.textContent.includes('未解决差额')).querySelector('b').textContent.trim() === '16万'", "cockpit unresolved amount owner filter");
    await click(cdp, ".metric-card", "未解决差额"); await cdp.waitFor("Boolean(document.querySelector('.cockpit-detail-dialog'))", "unresolved balance drill-down");
    assert.match(await cdp.evaluate("document.querySelector('.cockpit-detail-head h2').textContent"), /待解决清单/); assert.match(await cdp.evaluate("document.querySelector('.cockpit-detail-head p').textContent"), /2 条记录/);
    await click(cdp, ".modal-close");
    await cdp.evaluate(`(() => { const element = ${cockpitOwner}; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(element, '全部'); element.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await cdp.waitFor("[...document.querySelectorAll('.metric-card')].find((card) => card.textContent.includes('未解决差额')).querySelector('b').textContent.trim() === '24万'", "cockpit clear owner filter");
    await cdp.evaluate(`(() => { const element = ${cockpitOwner}; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(element, '叶孝彤'); element.dispatchEvent(new Event('change', { bubbles: true })); const region = [...document.querySelectorAll('.cockpit-filter label')].find((label) => label.textContent.trim().startsWith('区域')).querySelector('select'); setter.call(region, '南京'); region.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await cdp.waitFor("[...document.querySelectorAll('.metric-card')].find((card) => card.textContent.includes('未解决差额')).querySelector('b').textContent.trim() === '10万'", "cockpit region plus owner filter");

    await click(cdp, '.mobile-bottom-nav button[aria-label="未解决客户跟进"]'); await cdp.waitFor("Boolean(document.querySelector('.uf-mobile-owner select'))", "mobile follow-up owner control");
    assert.match(await cdp.evaluate("document.querySelector('.uf-tabs button').textContent"), /3/);
    await selectValue(cdp, ".uf-mobile-owner select", "叶孝彤"); await cdp.waitFor("document.querySelector('.uf-tabs button').textContent.includes('2')", "follow-up tab count owner filter");
    assert.equal(await cdp.evaluate("document.querySelectorAll('.uf-mobile-item').length"), 2);
    await click(cdp, ".uf-mobile-regions button", "南京"); await cdp.waitFor("document.querySelector('.uf-tabs button').textContent.includes('1')", "follow-up region plus owner filter");
    assert.equal(await cdp.evaluate("document.querySelectorAll('.uf-mobile-item').length"), 1);
    await selectValue(cdp, ".uf-mobile-owner select", "全部"); await click(cdp, ".uf-mobile-regions button", "全部区域");
    await cdp.waitFor("document.querySelector('.uf-tabs button').textContent.includes('3')", "mobile filter clear restore"); assert.equal(await cdp.evaluate("document.querySelectorAll('.uf-mobile-item').length"), 3);
    assert.deepEqual(consoleErrors, []);
  } finally {
    browser?.cdp.socket.close();
    for (const child of [browser?.child, server]) {
      if (!child) continue;
      if (child.exitCode === null) {
        child.kill();
        await Promise.race([once(child, "exit"), delay(5_000)]);
      }
    }
    // Chromium can hold its debug log briefly after its process exits on
    // Windows. Cleanup is retried without allowing a temporary file lock to
    // hide a completed browser assertion.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { await rm(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); break; }
      catch { await delay(150); }
    }
    await rm(workerState, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
  }
});
