// Yan baloncuk (sahip kararı 2026-10-17): ana şeritte en öncelikli iş, ikincisi adanın sağında 30 px yuvarlak.
// Ölçülenler: ada merkezi baloncuk gelip gidince kaymaz; baloncuk kutusu ve Rust'a bildirilen dikdörtgen; tıklayınca öne alma; "+N" listesi; kilitliyken içerik yok.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { open, start, stable, until } from "./lib.mjs";

let env;
before(async () => { env = await start(); const p = await open(env, "/preview.html?durum=yb"); await p.waitForTimeout(800); await p.close2(); }, { timeout: 90000 });
after(async () => { await env?.stop(); });
const T = { timeout: 120000 };

/** Sayfayı açar; Rust'a giden `report_hit_rects` yükünü `window.__rects`e toplar. */
async function page(durum, size = { width: 1280, height: 400 }) {
  const p = await open(env, `/preview.html?durum=${durum}`, size);
  await p.evaluate(() => { const o = window.fakeBridge.call; window.fakeBridge.call = (c, a) => { if (c === "report_hit_rects") window.__rects = a.rects; return o.call(window.fakeBridge, c, a); }; });
  return p;
}
const box = (sel) => (p) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2, r: r.right }; }, sel);
const merkez = box(".adaMerkez"), bal = box(".yanBal"), dug = box(".yanDug");
const rects = (p) => p.evaluate(() => window.__rects ?? []);
const text = (p, sel) => p.evaluate((s) => document.querySelector(s)?.textContent ?? "", sel);
const fake = (p, js) => p.evaluate(`(async () => { const f = window.fakeBridge; ${js} })()`);

describe("yan baloncuk", () => {
  it("Claude ana şeritte, müzik baloncukta: kutu 30 px, adanın sağında 8 px, Rust'a bildirilir", T, async () => {
    const p = await page("yb");
    try {
      await until(() => bal(p), "baloncuk yok", 8000);
      const b = await stable(() => bal(p));
      assert.equal(Math.round(b.w), 30); assert.equal(Math.round(b.h), 30); assert.equal(Math.round(b.y), 0);
      const m = await stable(() => merkez(p));
      const ada = await box("#ada")(p);
      const kenar = Math.max(m.r, ada && ada.h > 1 ? ada.x + ada.w : 0);
      assert.ok(Math.abs(b.x - kenar - 8) <= 1.5, `baloncuk adanın ${b.x - kenar} px sağında (8 bekleniyordu)`);
      assert.match(await text(p, ".adaMerkez"), /Claude/); // ana şerit
      assert.match(await text(p, ".adaMerkez"), /0:0\d|0:1\d/); // sayaç
      assert.ok(await p.evaluate(() => document.querySelector(".yanDug img.yanKapak")?.getAttribute("src")?.startsWith("data:image")), "müzikte kapak");
      assert.equal(await p.evaluate(() => document.querySelectorAll(".yanBal .mascot").length), 0, "baloncukta maskot yok");
      assert.equal(await p.evaluate(() => document.querySelectorAll(".mascot").length), 1, "ekranda tek maskot");
      const r = await until(async () => { const l = await rects(p); const d = await dug(p); return l.find((x) => !x.paint && Math.abs(x.x - d.x) <= 1 && Math.abs(x.w - d.w) <= 1 && Math.abs(x.y - d.y) <= 1) ; }, "baloncuk dikdörtgeni Rust'a bildirilmedi");
      assert.ok(r.w >= 29 && r.h >= 29);
      mkdirSync("kareler", { recursive: true });
      await p.screenshot({ path: "kareler/yan-baloncuk-muzik.png", clip: { x: 340, y: 0, width: 600, height: 90 } });
      assert.deepEqual(p.errors, []);
    } finally { await p.close2(); }
  });

  it("baloncuk gelip giderken adanın merkezi kaymaz", T, async () => {
    const p = await page("yb");
    try {
      await until(() => bal(p), "baloncuk yok", 8000);
      const dolu = await stable(async () => [await merkez(p), await box("#ada")(p)]);
      await fake(p, "f.setMedia(null);");
      await until(async () => !(await bal(p)), "baloncuk kalkmadı", 5000);
      const bos = await stable(async () => [await merkez(p), await box("#ada")(p)]);
      assert.ok(Math.abs(dolu[0].cx - bos[0].cx) <= 0.5 && Math.abs(dolu[0].y - bos[0].y) <= 0.5, `merkez kaydı ${JSON.stringify([dolu[0], bos[0]])}`);
      assert.ok(Math.abs(dolu[1].cx - bos[1].cx) <= 0.5, "ada gövdesi kaydı");
      // geri gelirken kare kare: merkez hiç oynamaz
      await fake(p, "f.setMedia({ app: 'Spotify', title: 'Mavi Saat', artist: 'Deniz Ayaz', album: 'Liman', art: null, playing: true, positionMs: 0, positionAt: Date.now(), durationMs: 198000, canNext: true, canPrevious: true, canSeek: true });");
      let hep = [];
      for (let i = 0; i < 25; i++) { hep.push(Math.abs((await merkez(p)).cx - bos[0].cx)); await p.waitForTimeout(25); }
      assert.ok(Math.max(...hep) <= 0.5, "giriş yayı sırasında merkez oynadı: " + Math.max(...hep));
      await until(() => bal(p), "baloncuk geri gelmedi", 5000);
      const yine = await stable(() => merkez(p));
      assert.ok(Math.abs(yine.cx - dolu[0].cx) <= 0.5);
      assert.equal(await p.evaluate(() => !!document.querySelector(".yanDug svg.lucide")), true, "kapaksız müzikte nota simgesi");
    } finally { await p.close2(); }
  });

  it("baloncuğa tıklayınca iş öne geçer, Claude baloncuğa iner; merkez yerinde kalır; yeniden tıklayınca geri döner", T, async () => {
    const p = await page("yb");
    try {
      await until(() => bal(p), "baloncuk yok", 8000);
      const once = await stable(() => merkez(p));
      await p.locator(".yanDug").click();
      await until(async () => /Gece Treni/.test(await text(p, ".adaStage .sarkan")) || /Gece Treni/.test(await text(p, ".adaMerkez")), "müzik öne geçmedi", 4000);
      const sonra = await stable(() => merkez(p));
      assert.ok(Math.abs(once.cx - sonra.cx) <= 0.5 && Math.abs(once.y - sonra.y) <= 0.5, "tıklayınca merkez kaydı " + JSON.stringify([once, sonra]));
      assert.match(await p.locator(".yanDug").getAttribute("aria-label"), /Claude/);
      assert.equal(await p.evaluate(() => document.querySelectorAll(".yanBal .mascot").length), 0);
      await p.locator(".yanDug").click();
      await until(async () => /Claude/.test(await text(p, ".adaMerkez")), "Claude geri gelmedi", 4000);
      assert.match(await p.locator(".yanDug").getAttribute("aria-label"), /Çalıyor/);
    } finally { await p.close2(); }
  });

  it("üç iş: '+1' rozeti, tıklayınca kalan işler listelenir, satıra tıklayınca öne geçer", T, async () => {
    const p = await page("yb2", { width: 1280, height: 400 });
    try {
      await until(() => bal(p), "baloncuk yok", 8000);
      const arti = p.locator(".yanArti");
      assert.equal((await arti.textContent()).trim(), "+1");
      assert.equal(await p.locator(".yanListe").count(), 0, "liste kapalıyken yok");
      const once = await stable(() => merkez(p));
      await arti.click();
      await p.waitForSelector(".yanListe");
      const satirlar = await p.locator(".yanListe .yanSat").allTextContents();
      assert.equal(satirlar.length, 1); assert.match(satirlar[0], /Zamanlayıcı/);
      const l = await box(".yanListe")(p), b = await bal(p);
      assert.ok(l.x >= 0 && l.r <= 1280 && l.y > b.y + b.h, "liste pencerede ve baloncuğun altında");
      assert.ok((await rects(p)).some((x) => !x.paint && x.w >= l.w - 1 && Math.abs(x.x - l.x) <= 1), "liste Rust'a bildirilmedi");
      assert.ok(Math.abs((await merkez(p)).cx - once.cx) <= 0.5, "liste açılınca merkez kaydı " + JSON.stringify([once, await merkez(p)]));
      await p.screenshot({ path: "kareler/yan-baloncuk-arti.png", clip: { x: 340, y: 0, width: 600, height: 150 } });
      await p.keyboard.press("Escape");
      await until(async () => (await p.locator(".yanListe").count()) === 0, "Esc listeyi kapatmadı", 2000);
      await arti.click();
      await p.locator(".yanListe .yanSat").first().click();
      await until(async () => /Odak/.test(await text(p, ".adaMerkez")), "zamanlayıcı öne geçmedi", 4000);
      assert.equal(await p.locator(".yanListe").count(), 0, "seçimden sonra liste kapanır");
      assert.deepEqual(p.errors, []);
    } finally { await p.close2(); }
  });

  it("kilitliyken baloncukta içerik yok: kapak, parça adı ve sayaç gizli, genel simge ve etiket", T, async () => {
    const p = await page("yb2");
    try {
      await until(() => bal(p), "baloncuk yok", 8000);
      await fake(p, "f.setLocked(true, 'manual');");
      await until(async () => (await p.locator(".yanDug").getAttribute("aria-label")).includes("Müzik çalıyor"), "kilit etiketi gelmedi", 3000);
      const yuz = await p.evaluate(() => { const e = document.querySelector(".yanBal"); const parts = [e.textContent]; e.querySelectorAll("*").forEach((x) => ["title", "aria-label", "alt", "src"].forEach((a) => { const v = x.getAttribute(a); if (v) parts.push(v); })); return { s: parts.join("|"), img: e.querySelectorAll("img").length, svg: e.querySelectorAll("svg.lucide").length }; });
      for (const w of ["Gece Treni", "Lodos", "data:image", "Odak", "24:"]) assert.ok(!yuz.s.includes(w), `kilitliyken sızdı: ${w} -> ${yuz.s}`);
      assert.equal(yuz.img, 0); assert.ok(yuz.svg >= 1, "genel simge");
      await p.locator(".yanArti").click();
      const liste = await p.locator(".yanListe").textContent();
      assert.ok(!/Odak|\d:\d\d/.test(liste), "kilitli listede zamanlayıcı bilgisi: " + liste);
    } finally { await p.close2(); }
  });
});
