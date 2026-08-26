import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("builds the reconciliation worker and loading shell", async () => {
  const [worker, page, layout] = await Promise.all([
    readFile(new URL("../dist/server/index.js", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  // Vinext's production worker imports the Cloudflare runtime, which Node's
  // default ESM loader cannot execute directly.  The build itself is the
  // production smoke test; these assertions verify the emitted worker and the
  // deterministic server shell without pretending to provide Cloudflare APIs.
  assert.match(worker, /cloudflare:/);
  assert.match(layout, /title:\s*"季度对账复核"/);
  assert.match(page, /正在加载本机对账数据/);
  assert.match(page, /aria-busy="true"/);
  assert.doesNotMatch(page, /Your site is taking shape/);
});

test("keeps browser-only reconciliation state behind hydration", async () => {
  const [page, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /export const metadata:\s*Metadata/);
  assert.match(layout, /title:\s*"季度对账复核"/);
  assert.match(layout, /suppressHydrationWarning/);
  assert.match(page, /const \[hydrated, setHydrated\] = useState\(false\)/);
  assert.match(page, /if \(!hydrated\)/);
  assert.match(page, /<ServerStateBridge \/>/);
  assert.doesNotMatch(page, /export const metadata:\s*Metadata/);
});
