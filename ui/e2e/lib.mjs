// Shared E2E helpers: start Vite on a free port and launch headless Chromium. No desktop window ever opens.
import { chromium } from "playwright";
import { createServer as netServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ui = join(dirname(fileURLToPath(import.meta.url)), "..");

const freePort = () => new Promise((ok, no) => { const s = netServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); s.on("error", no); });

export async function start() {
  const { createServer } = await import("vite");
  const port = await freePort();
  const server = await createServer({ root: ui, logLevel: "error", server: { host: "127.0.0.1", port, strictPort: true } });
  await server.listen();
  // launch fails (e.g. browser not installed) → close Vite, or the test process hangs forever
  const browser = await chromium.launch({ headless: true }).catch(async (e) => { await server.close(); throw e; });
  const base = `http://127.0.0.1:${port}`;
  return { base, browser, stop: async () => { await browser.close(); await server.close(); } };
}

/** Opens a new page and collects page errors. `url` is relative to the base address. */
export async function open(env, url, size = { width: 1920, height: 1080 }) {
  const ctx = await env.browser.newContext({ viewport: size });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(env.base + url);
  await page.waitForSelector("#root *", { timeout: 15000 });
  page.close2 = () => ctx.close();
  return page;
}

/** Polls until `fn` returns a truthy value (no fixed sleep; waits on the condition). */
export async function until(fn, msg, ms = 3000) {
  const t = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t > ms) throw new Error("timed out: " + msg);
    await new Promise((r) => setTimeout(r, 40));
  }
}

/** Waits for spring animations to settle: the output of `fn` must stay the same over 4 consecutive reads. */
export async function stable(fn, ms = 6000) {
  let last = "", n = 0;
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = JSON.stringify(await fn());
    n = v === last ? n + 1 : 0;
    if (n >= 3) return JSON.parse(v);
    last = v;
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error("did not settle");
}

/** Open top surfaces: open strip panels + the island card. Peeks (group) don't count. */
export const layers = (page) => page.evaluate(() => {
  const out = [];
  document.querySelectorAll("[data-panel]").forEach((e) => { if (e.getAttribute("aria-hidden") !== "true") out.push("panel:" + e.dataset.panel); });
  const c = document.querySelector('#island [role="dialog"]');
  if (c) out.push("card:" + c.getAttribute("aria-label"));
  return out;
});

/** The box of every tab in a tab bar. */
export const tabRects = (page, bar) => page.evaluate((b) => [...document.querySelectorAll(`[role="tablist"][aria-label="${b}"] [role="tab"]`)].map((e) => {
  const r = e.getBoundingClientRect();
  return { k: e.getAttribute("aria-label"), x: r.x, y: r.y, w: r.width, h: r.height };
}), bar);

export const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Box difference (px): a and b are lists with the same keys; the `skip` key is ignored, `keys` are the compared fields. */
export function boxDiff(a, b, skip, keys = ["x", "y", "w", "h"]) {
  const out = [];
  for (const o of a) {
    if (o.k === skip) continue;
    const n = b.find((q) => q.k === o.k);
    if (!n) { out.push(`${o.k}: disappeared`); continue; }
    for (const f of keys) if (Math.abs(o[f] - n[f]) > 1) out.push(`${o.k}.${f}: ${o[f].toFixed(1)} -> ${n[f].toFixed(1)}`);
  }
  return out;
}
