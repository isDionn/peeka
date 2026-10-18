// Maskot her durumda aynı: Asistan yok / bağlı değil / bağlı. 40 px asılı kutu aynı boyutta ve şeridin altında aynı yükseklikte; saat maskotla çakışmaz.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, it } from "node:test";
import { open, start, stable, until } from "./lib.mjs";

let env;
before(async () => { env = await start(); const p = await open(env, "/preview.html?durum=a"); await p.waitForTimeout(800); await p.close2(); }, { timeout: 90000 });
after(async () => { await env?.stop(); });

const read = (page) => page.evaluate(() => {
  const m = document.querySelector(".adaMerkez .mascot"), h = m?.querySelector(".mascot-hit"), c = document.querySelector(".adaMerkez");
  if (!m || !h) return null;
  const r = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.left * 10) / 10, y: Math.round(b.top * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 }; };
  const clock = [...c.querySelectorAll(".num.b6")].find((e) => /\d\d:\d\d/.test(e.textContent));
  return { mood: m.dataset.mood, box: r(m), hit: r(h), clock: clock ? r(clock) : null, center: r(c) };
});

const STATES = [["asistansiz", "/preview.html?durum=a&baglantisiz=1", "idle"], ["asistan-uyuyor", "/preview.html?durum=x0", "idle"], ["asistan-bagli", "/preview.html?durum=a", null]];

it("üç durumda maskot 40x30 asılı kutuda, aynı y'de; saat çakışmaz", { timeout: 120000 }, async () => {
  mkdirSync("kareler", { recursive: true });
  const out = {};
  for (const [name, url, mood] of STATES) {
    const page = await open(env, url, { width: 1280, height: 400 });
    try {
      await until(() => read(page), name + ": maskot yok", 8000);
      out[name] = await stable(() => read(page));
      if (mood) assert.equal(out[name].mood, mood, name);
      const { box, clock } = out[name];
      if (clock) assert.ok(box.x + box.w <= clock.x + 0.5 || clock.x + clock.w <= box.x, name + ": saat maskotla çakışıyor " + JSON.stringify({ box, clock }));
      await page.screenshot({ path: `kareler/maskot-${name}.png`, clip: { x: 340, y: 0, width: 600, height: 90 } });
      assert.deepEqual(page.errors, []);
    } finally { await page.close2(); }
  }
  console.log(JSON.stringify(out));
  const sizes = Object.values(out).map((s) => [s.box.w, s.box.h, s.hit.w, s.hit.h, s.box.y]);
  for (const s of sizes) assert.deepEqual(s, sizes[0], "maskot kutusu durumlar arasında değişti");
});
