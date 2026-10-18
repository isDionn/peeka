// Senaryo 1, 6, 24, 28, 38 ve parola bulanıklığı: gerçek tarayıcıda ölçüm + kareler (kareler/). Üstüne gelince hiçbir şey kaymaz.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { open, start, stable, until } from "./lib.mjs";

let env;
before(async () => { env = await start(); const p = await open(env, "/preview.html?durum=k1"); await p.waitForTimeout(800); await p.close2(); mkdirSync("kareler", { recursive: true }); }, { timeout: 90000 });
after(async () => { await env?.stop(); });
const T = { timeout: 120000 };
const SIZE = { width: 1280, height: 520 };
const box = (sel) => (p) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
const ada = box("#ada"), ust = box(".shotUst");
/** Ada + merkez çevresini keser (kenar boşluğuyla). */
async function kare(p, ad) {
  const a = await stable(() => ada(p));
  await p.screenshot({ path: `kareler/${ad}.png`, clip: { x: Math.max(0, a.x - 40), y: 0, width: Math.min(SIZE.width, a.w + 80), height: Math.ceil(a.y + a.h + 30) } });
}

describe("kopya şeridi", () => {
  it("görsel: küçük çıkıntı, imleç üstüne gelince yalnız aşağı büyür; üst satır yerinde kalır", T, async () => {
    const p = await open(env, "/preview.html?durum=k1", SIZE);
    try {
      await until(() => ust(p), "şerit yok", 8000);
      const a0 = await stable(() => ada(p)), u0 = await stable(() => ust(p));
      assert.equal(await p.evaluate(() => document.querySelectorAll(".shotBuyuk").length), 0);
      await kare(p, "kopya-serit");
      await p.mouse.move(a0.x + a0.w / 2, a0.y + a0.h / 2);
      await until(() => p.evaluate(() => document.querySelectorAll(".shotBuyuk").length), "büyük önizleme gelmedi", 4000);
      const a1 = await stable(() => ada(p)), u1 = await stable(() => ust(p));
      assert.ok(a1.h > a0.h + 100, `aşağı büyümedi: ${a0.h} -> ${a1.h}`);
      assert.ok(Math.abs(a1.y - a0.y) <= 0.5 && Math.abs(a1.x - a0.x) <= 0.5 && Math.abs(a1.w - a0.w) <= 0.5, "ada üstten/yandan kaydı");
      assert.ok(Math.abs(u1.x - u0.x) <= 0.5 && Math.abs(u1.y - u0.y) <= 0.5, `üst satır kaydı ${JSON.stringify([u0, u1])}`);
      assert.equal(await p.evaluate(() => document.querySelectorAll(".mascot").length), 1, "ekranda tek maskot");
      await kare(p, "kopya-serit-buyuk");
      await p.mouse.move(5, 480); // çekilince küçülür
      await until(async () => !(await p.evaluate(() => document.querySelectorAll(".shotBuyuk").length)), "küçülmedi", 4000);
      assert.deepEqual(p.errors, []);
    } finally { await p.close2(); }
  });
  it("dosya ve bağlantı: aynı çıkıntı, büyümez", T, async () => {
    for (const d of ["k2", "k3"]) {
      const p = await open(env, `/preview.html?durum=${d}`, SIZE);
      try {
        await until(() => ust(p), d + " şerit yok", 8000);
        const a0 = await stable(() => ada(p));
        await p.mouse.move(a0.x + a0.w / 2, a0.y + a0.h / 2);
        await p.waitForTimeout(500);
        const a1 = await stable(() => ada(p));
        assert.ok(Math.abs(a1.h - a0.h) <= 0.5 && a1.w === a0.w, d + " büyüdü");
        assert.equal(await p.evaluate(() => document.querySelectorAll(".shotBuyuk").length), 0);
      } finally { await p.close2(); }
    }
  });
});

describe("zamanlayıcı, ağ, özet", () => {
  it("Süre doldu kartı: Kapat ve +5 dk, ses yok", T, async () => {
    const p = await open(env, "/preview.html?durum=sd", SIZE);
    try {
      await until(() => p.evaluate(() => /Süre doldu/.test(document.querySelector(".adaMerkez")?.textContent ?? "")), "kart yok", 8000);
      const t = await p.evaluate(() => [...document.querySelectorAll(".cik button")].map((b) => b.textContent));
      assert.deepEqual(t, ["+5 dk", "Kapat"]);
      assert.equal(await p.evaluate(() => document.querySelectorAll("audio").length), 0);
      await kare(p, "sure-doldu");
    } finally { await p.close2(); }
  });
  it("son 60 sn: sayaç ana şeritte, müzik baloncukta", T, async () => {
    const p = await open(env, "/preview.html?durum=zs", SIZE);
    try {
      await until(() => p.evaluate(() => /0:[34]\d/.test(document.querySelector(".adaMerkez")?.textContent ?? "")), "sayaç ana şeritte değil", 8000);
      assert.match(await p.evaluate(() => document.querySelector(".yanDug")?.getAttribute("aria-label") ?? ""), /Çalıyor/);
    } finally { await p.close2(); }
  });
  it("Bağlantı koptu çıkıntısı", T, async () => {
    const p = await open(env, "/preview.html?durum=ag", SIZE);
    try {
      await until(() => p.evaluate(() => /Bağlantı koptu/.test(document.querySelector(".adaMerkez")?.textContent ?? "")), "çıkıntı yok", 8000);
      await kare(p, "ag-koptu");
    } finally { await p.close2(); }
  });
  it("Sen yokken özeti", T, async () => {
    const p = await open(env, "/preview.html?durum=sy", SIZE);
    try {
      await until(() => p.evaluate(() => /Sen yokken: 3 bildirim, 1 onay, 2 iş bitti/.test(document.querySelector(".cik")?.textContent ?? "")), "özet yok", 8000);
      await kare(p, "sen-yokken");
    } finally { await p.close2(); }
  });
});

describe("parola satırı", () => {
  it("bulanık yer tutucu; üstüne gelince satır kutusu aynı kalır", T, async () => {
    const p = await open(env, "/preview.html?durum=h3", SIZE);
    try {
      await until(() => p.evaluate(() => !!document.querySelector('[data-clip="c6"]')), "parola satırı yok", 10000);
      const row = box('[data-clip="c6"]');
      const r0 = await stable(() => row(p));
      assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('[data-clip="c6"] .metin')).filter), "blur(5px)");
      assert.ok(!(await p.evaluate(() => document.body.innerHTML.includes("Kd9!mPq2-zR7v"))), "gezinmedeyken düz metin DOM'da");
      const card = box('#ada [role="dialog"]');
      const c = await stable(() => card(p));
      await p.screenshot({ path: "kareler/parola-bulanik.png", clip: { x: c.x, y: c.y, width: c.w, height: Math.min(c.h, SIZE.height - c.y) } });
      await p.mouse.move(r0.x + r0.w / 2, r0.y + r0.h / 2);
      await until(() => p.evaluate(() => document.body.innerHTML.includes("Kd9!mPq2-zR7v")), "üstüne gelince açılmadı", 4000);
      const r1 = await stable(() => row(p));
      assert.ok(["x", "y", "w", "h"].every((k) => Math.abs(r0[k] - r1[k]) <= 0.5), `satır kutusu kaydı ${JSON.stringify([r0, r1])}`);
      await p.mouse.move(5, 5);
      await until(async () => !(await p.evaluate(() => document.body.innerHTML.includes("Kd9!mPq2-zR7v"))), "çekilince silinmedi", 3000);
    } finally { await p.close2(); }
  });
});
