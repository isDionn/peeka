// E2E ortak yardımcılar: Vite'ı boş bir portta açar, headless Chromium başlatır. Masaüstü penceresi hiç açılmaz.
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

/** Yeni sayfa açar; sayfa hatalarını toplar. `url` taban adrese göre. */
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

/** `fn` doğru bir değer verene dek yoklar (uyku yok, koşul bekler). */
export async function until(fn, msg, ms = 3000) {
  const t = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t > ms) throw new Error("zaman aşımı: " + msg);
    await new Promise((r) => setTimeout(r, 40));
  }
}

/** Yay animasyonları oturana dek bekler: `fn` çıktısı art arda 4 okumada aynı kalmalı. */
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
  throw new Error("yerleşmedi");
}

/** Açık üst yüzeyler: açık şerit panelleri + adanın kartı. Çıkıntılar (grup) sayılmaz. */
export const layers = (page) => page.evaluate(() => {
  const out = [];
  document.querySelectorAll("[data-panel]").forEach((e) => { if (e.getAttribute("aria-hidden") !== "true") out.push("panel:" + e.dataset.panel); });
  const c = document.querySelector('#ada [role="dialog"]');
  if (c) out.push("kart:" + c.getAttribute("aria-label"));
  return out;
});

/** Sekme çubuğundaki her sekmenin kutusu. */
export const tabRects = (page, bar) => page.evaluate((b) => [...document.querySelectorAll(`[role="tablist"][aria-label="${b}"] [role="tab"]`)].map((e) => {
  const r = e.getBoundingClientRect();
  return { k: e.getAttribute("aria-label"), x: r.x, y: r.y, w: r.width, h: r.height };
}), bar);

export const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Kutu farkı (px): a ve b aynı anahtarlı listeler; `skip` anahtarı atlanır, `keys` karşılaştırılan alanlar. */
export function boxDiff(a, b, skip, keys = ["x", "y", "w", "h"]) {
  const out = [];
  for (const o of a) {
    if (o.k === skip) continue;
    const n = b.find((q) => q.k === o.k);
    if (!n) { out.push(`${o.k}: kayboldu`); continue; }
    for (const f of keys) if (Math.abs(o[f] - n[f]) > 1) out.push(`${o.k}.${f}: ${o[f].toFixed(1)} -> ${n[f].toFixed(1)}`);
  }
  return out;
}
