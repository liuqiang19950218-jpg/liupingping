import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";

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
const browserOptions = (platform = process.platform) => ({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  ...(platform === "linux" ? { args: ["--no-sandbox", "--disable-setuid-sandbox"] } : {}),
});
const startBrowser = async () => {
  try { return await chromium.launch(browserOptions()); }
  catch (error) {
    throw new Error(`Chromium could not start. Set CHROME_PATH to an executable, set PLAYWRIGHT_BROWSERS_PATH to an installed Playwright browser directory, or run 'npx playwright install chromium'. ${error instanceof Error ? error.message : String(error)}`);
  }
};
const createFixturePage = async (browser, contextOptions) => {
  const context = await browser.newContext(contextOptions); const browserErrors = []; let fixtureError;
  await context.route("**/api/**", async (route) => {
    try { await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(responseFor(route.request().url())) }); }
    catch (error) { fixtureError = error; await route.abort(); }
  });
  const page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  return { context, page, browserErrors, fixtureError: () => fixtureError };
};
const waitFor = async (page, expression, message) => {
  try { await page.waitForFunction(expression, undefined, { timeout: 20_000 }); }
  catch { throw new Error(`Timed out waiting for ${message}: ${(await page.locator("body").innerText()).slice(0, 1000)}`); }
};
const selectValue = (page, selector, value) => page.locator(selector).first().selectOption(value);
const click = async (page, selector, text = "") => {
  const locator = text ? page.locator(selector).filter({ hasText: text }).first() : page.locator(selector).first();
  await locator.scrollIntoViewIfNeeded(); await locator.click();
};
const metrics = (page, selector) => page.locator(selector).evaluateAll((cards) => Object.fromEntries(cards.map((card) => [card.querySelector("span:not(.metric-icon)")?.textContent.trim() || card.querySelector("span")?.textContent.trim(), card.querySelector("strong, b")?.textContent.trim()])));

test("mobile filters are interactive while desktop shows seven and phones show six KPIs", { timeout: 120_000 }, async () => {
  assert.deepEqual(browserOptions("linux").args, ["--no-sandbox", "--disable-setuid-sandbox"]);
  assert.equal(browserOptions("win32").args, undefined);
  const appPort = await freePort();
  const workerState = await mkdtemp(path.join(os.tmpdir(), "recon-mobile-worker-"));
  let server; let browser;
  try {
    server = await startTestServer(appPort, workerState); browser = await startBrowser();
    const desktop = await createFixturePage(browser, { viewport: { width: 1280, height: 900 } });
    await desktop.page.goto(`http://localhost:${appPort}`);
    await waitFor(desktop.page, "document.querySelector('.side-nav') && !document.querySelector('.app-shell-loading')", "hydrated desktop shell");
    await click(desktop.page, ".side-nav button", "问题解决看板");
    await waitFor(desktop.page, "document.querySelectorAll('.pd-kpi').length === 7", "seven desktop problem KPIs");
    for (const width of [1280, 1366, 1440]) {
      await desktop.page.setViewportSize({ width, height: 900 });
      const layout = await desktop.page.evaluate(() => { const cards = [...document.querySelectorAll(".pd-kpi")]; const leader = cards.find((item) => item.textContent.includes("需领导介入")); return { visible: cards.filter((item) => getComputedStyle(item).display !== "none").length, leaderDisplay: getComputedStyle(leader).display }; });
      assert.equal(layout.visible, 7, `${width}px desktop shows all seven KPIs`); assert.notEqual(layout.leaderDisplay, "none", `${width}px desktop shows the leadership KPI`);
    }
    assert.ifError(desktop.fixtureError()); assert.deepEqual(desktop.browserErrors, []); await desktop.context.close();

    const mobile = await createFixturePage(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const { page } = mobile;
    await page.goto(`http://localhost:${appPort}`);
    await waitFor(page, "document.querySelector('.mobile-bottom-nav') && !document.querySelector('.app-shell-loading')", "hydrated mobile shell");
    assert.equal(await page.evaluate(() => window.innerWidth), 390); assert.ok(await page.evaluate(() => navigator.maxTouchPoints >= 1));
    await click(page, '.mobile-bottom-nav button[aria-label="问题解决看板"]');
    await waitFor(page, "document.querySelectorAll('.pd-kpi').length === 7", "seven problem KPIs");
    assert.deepEqual(await metrics(page, ".pd-kpi"), { "未关闭问题": "3", "超期未关闭": "3", "7天未跟进": "3", "待销售处理": "2", "待内部处理": "1", "需财务复核": "1", "需领导介入": "0" });
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      const layout = await page.evaluate(() => { const cards = [...document.querySelectorAll(".pd-kpi")]; const leader = cards.find((item) => item.textContent.includes("需领导介入")); const visible = cards.filter((item) => getComputedStyle(item).display !== "none"); return { leaderDisplay: getComputedStyle(leader).display, visible: visible.length, cardsInsideViewport: visible.every((item) => { const rect = item.getBoundingClientRect(); return rect.width > 0 && rect.right <= window.innerWidth; }), viewport: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }; });
      assert.equal(layout.leaderDisplay, "none", `${width}px hides the leadership KPI on mobile`); assert.equal(layout.visible, 6, `${width}px shows six mobile KPIs`); assert.ok(layout.cardsInsideViewport, `${width}px keeps every visible KPI inside the viewport`);
      if (width === 320) assert.ok(layout.scrollWidth <= layout.viewport, "320px has no document horizontal overflow");
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator(".pd-preview tbody tr").count(), 3);
    await selectValue(page, ".pd-filter select", "叶孝彤");
    await waitFor(page, "[...document.querySelectorAll('.pd-kpi')].find((card) => card.textContent.includes('未关闭问题')).querySelector('strong').textContent.trim() === '2'", "problem KPI owner filter");
    assert.equal(await page.locator(".pd-preview tbody tr").count(), 2);

    await click(page, '.mobile-bottom-nav button[aria-label="管理层驾驶舱"]'); await waitFor(page, "Boolean(document.querySelector('.cockpit-filter'))", "cockpit");
    const cockpitOwner = page.locator(".cockpit-filter label").filter({ hasText: "对账负责人" }).locator("select");
    assert.equal((await metrics(page, ".metric-card"))["未解决差额"], "24万");
    await cockpitOwner.selectOption("叶孝彤");
    await waitFor(page, "[...document.querySelectorAll('.metric-card')].find((card) => card.textContent.includes('未解决差额')).querySelector('b').textContent.trim() === '16万'", "cockpit unresolved amount owner filter");
    await click(page, ".metric-card", "未解决差额"); await waitFor(page, "Boolean(document.querySelector('.cockpit-detail-dialog'))", "unresolved balance drill-down");
    assert.match(await page.locator(".cockpit-detail-head h2").textContent(), /待解决清单/); assert.match(await page.locator(".cockpit-detail-head p").textContent(), /2 条记录/);
    await click(page, ".modal-close");
    await cockpitOwner.selectOption("全部");
    await waitFor(page, "[...document.querySelectorAll('.metric-card')].find((card) => card.textContent.includes('未解决差额')).querySelector('b').textContent.trim() === '24万'", "cockpit clear owner filter");
    await cockpitOwner.selectOption("叶孝彤");
    await page.locator(".cockpit-filter label").filter({ hasText: /^区域/ }).locator("select").selectOption("南京");
    await waitFor(page, "[...document.querySelectorAll('.metric-card')].find((card) => card.textContent.includes('未解决差额')).querySelector('b').textContent.trim() === '10万'", "cockpit region plus owner filter");

    await click(page, '.mobile-bottom-nav button[aria-label="未解决客户跟进"]'); await waitFor(page, "Boolean(document.querySelector('.uf-mobile-owner select'))", "mobile follow-up owner control");
    assert.match(await page.locator(".uf-tabs button").first().textContent(), /3/);
    await selectValue(page, ".uf-mobile-owner select", "叶孝彤"); await waitFor(page, "document.querySelector('.uf-tabs button').textContent.includes('2')", "follow-up tab count owner filter");
    assert.equal(await page.locator(".uf-mobile-item").count(), 2);
    await click(page, ".uf-mobile-regions button", "南京"); await waitFor(page, "document.querySelector('.uf-tabs button').textContent.includes('1')", "follow-up region plus owner filter");
    assert.equal(await page.locator(".uf-mobile-item").count(), 1);
    await selectValue(page, ".uf-mobile-owner select", "全部"); await click(page, ".uf-mobile-regions button", "全部区域");
    await waitFor(page, "document.querySelector('.uf-tabs button').textContent.includes('3')", "mobile filter clear restore"); assert.equal(await page.locator(".uf-mobile-item").count(), 3);
    assert.ifError(mobile.fixtureError()); assert.deepEqual(mobile.browserErrors, []);
  } finally {
    await browser?.close();
    if (server?.exitCode === null) { server.kill(); await Promise.race([once(server, "exit"), delay(5_000)]); }
    await rm(workerState, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
  }
});
