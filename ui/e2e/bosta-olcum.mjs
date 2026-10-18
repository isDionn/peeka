// Boşta ölçüm (başsız Chromium, masaüstü penceresi yok): `node e2e/bosta-olcum.mjs`. 10 sn boyunca rAF çağrısı, betik/görev süresi (CPU %), JS yığını, DOM düğümü.
import { start, open } from "./lib.mjs";

const SN = 10;
const metric = (m, n) => m.metrics.find((x) => x.name === n)?.value ?? 0;

async function measure(env, url, setup) {
  const ctx = await env.browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.addInitScript(() => {
    window.__raf = 0;
    const r = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => { window.__raf++; return r(cb); };
  });
  const page = await ctx.newPage();
  await page.goto(env.base + url);
  await page.waitForSelector("#root *", { timeout: 15000 });
  await setup(page);
  await page.waitForTimeout(2500); // yerleşme
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  const a = await cdp.send("Performance.getMetrics");
  const r0 = await page.evaluate(() => window.__raf);
  await page.waitForTimeout(SN * 1000);
  const b = await cdp.send("Performance.getMetrics");
  const r1 = await page.evaluate(() => window.__raf);
  const d = (n) => metric(b, n) - metric(a, n);
  const out = { raf: r1 - r0, script: d("ScriptDuration") * 1000 / SN, task: d("TaskDuration") * 100 / SN, heap: metric(b, "JSHeapUsedSize") / 1048576, dom: metric(b, "Nodes"), mascot: await page.locator(".mascot").count() };
  await ctx.close();
  return out;
}

const music = (page) => page.evaluate(async () => {
  const f = (await import("/src/bridge.fake.ts")).fakeBridge;
  f.setMedia({ ...(await f.call("get_media")), playing: true });
});
const rows = [];
const env = await start();
try {
  const run = async (ad, url, setup) => { const r = await measure(env, url, setup); rows.push({ ad, ...r }); console.log(ad, JSON.stringify(r)); };
  const none = async () => {};
  const modul = async (p) => { await music(p); await p.waitForTimeout(500); await p.locator(".adaMerkez").click(); await p.waitForSelector("#ada [role=tab][aria-selected=true]"); await p.mouse.move(5, 900); };
  await run("Ada · dinlenme", "/island.html?autostart=1", none);
  await run("Ada · müzik çalıyor", "/island.html?autostart=1", async (p) => { await music(p); await p.waitForTimeout(8500); await p.mouse.move(5, 900); });
  await run("Ada · Modüller kartı açık", "/island.html?autostart=1", modul);
  await run("Şerit · dinlenme", "/index.html", none);
  await run("Şerit · müzik çalıyor", "/index.html", music);
  await run("Şerit · Ara paneli açık", "/index.html", async (p) => { await p.keyboard.press("Control+k"); await p.waitForTimeout(400); });
  console.log("\n| Durum | rAF/10 sn | Betik ms/sn | Görev CPU % | JS yığını MB | DOM düğümü | Maskot |\n|---|---|---|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.ad} | ${r.raf} | ${r.script.toFixed(1)} | ${r.task.toFixed(1)} | ${r.heap.toFixed(1)} | ${r.dom} | ${r.mascot} |`);
} finally { await env.stop(); }
