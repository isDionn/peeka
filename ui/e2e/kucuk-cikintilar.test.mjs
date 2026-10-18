// Küçük çıkıntılar (belge notch-50-senaryo.md 13, 33, 43): "N oturum" çipi, bildirim yağmuru, hata kartı + "Neden?".
// Ölçülenler: çip adanın solunda 8 px, merkez kaymaz, Rust'a bildirilir; yağmur metni; Neden? ayrıntıyı açar; kareler kareler/ altına.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { open, start, stable, until } from "./lib.mjs";

let env;
before(async () => { env = await start(); const p = await open(env, "/preview.html?durum=os"); await p.waitForTimeout(800); await p.close2(); }, { timeout: 90000 });
after(async () => { await env?.stop(); });
const T = { timeout: 120000 };
const SIZE = { width: 1280, height: 400 };

async function page(durum) {
  const p = await open(env, `/preview.html?durum=${durum}`, SIZE);
  await p.evaluate(() => { const o = window.fakeBridge.call; window.fakeBridge.call = (c, a) => { if (c === "report_hit_rects") window.__rects = a.rects; return o.call(window.fakeBridge, c, a); }; });
  return p;
}
const box = (sel) => (p) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, r: r.right }; }, sel);
const merkez = box(".adaMerkez"), chip = box(".oturumDug");
const text = (p, sel) => p.evaluate((s) => document.querySelector(s)?.textContent ?? "", sel);
const shot = async (p, ad, clip) => { mkdirSync("kareler", { recursive: true }); await p.screenshot({ path: `kareler/${ad}.png`, clip }); };

describe("küçük çıkıntılar", () => {
  it("iki oturum: çip adanın solunda, merkez kaymaz, Rust'a bildirilir, tıklayınca liste", T, async () => {
    const p = await page("os");
    try {
      await until(() => chip(p), "çip yok", 8000);
      const m = await stable(() => merkez(p));
      const c = await stable(() => chip(p));
      assert.ok(c.h <= 30, "çip 30 px'i aşıyor: " + c.h);
      assert.ok(Math.abs((m.x + 0) - c.r - 8) <= 14, `çip adanın solunda değil: merkez.x=${m.x} çip.sağ=${c.r}`); // merkez kutusu adadan 12 px dar/geniş olabilir
      assert.ok(c.r < m.cx, "çip merkezin sağında");
      assert.ok(Math.abs(m.cx - SIZE.width / 2) <= 0.5, "merkez yerinden oynadı: " + m.cx);
      assert.match(await text(p, ".oturumDug"), /^2 oturum$/);
      await until(async () => { const l = await p.evaluate(() => window.__rects ?? []); return l.find((r) => !r.paint && Math.abs(r.x - c.x) <= 1.5 && Math.abs(r.w - c.w) <= 1.5); }, "çip Rust'a bildirilmedi");
      await p.locator(".oturumDug").click();
      await until(async () => /2 Claude Code oturumu açık/.test(await text(p, ".oturumListe")), "liste açılmadı");
      const m2 = await stable(() => merkez(p));
      assert.ok(Math.abs(m2.cx - m.cx) <= 0.5 && Math.abs(m2.y - m.y) <= 0.5, "liste açılınca merkez kaydı");
      assert.equal(await p.evaluate(() => document.querySelectorAll(".mascot").length), 1, "ekranda tek maskot");
      await shot(p, "iki-oturum", { x: 240, y: 0, width: 800, height: 150 });
      assert.deepEqual(p.errors, []);
    } finally { await p.close2(); }
  });

  it("bildirim yağmuru: tek çıkıntı, 'N yeni bildirim: uygulamalar', Esc kaldırır", T, async () => {
    const p = await page("by");
    try {
      await until(async () => /6 yeni bildirim: Discord, Outlook…/.test(await text(p, ".adaMerkez")), "yağmur metni yok", 8000);
      await stable(() => merkez(p));
      assert.equal(await p.evaluate(() => document.querySelectorAll(".mascot").length <= 1), true);
      await shot(p, "bildirim-yagmuru", { x: 340, y: 0, width: 600, height: 110 });
      await p.keyboard.press("Escape");
      await until(async () => !/yeni bildirim/.test(await text(p, ".adaMerkez")), "Esc kaldırmadı");
      assert.deepEqual(p.errors, []);
    } finally { await p.close2(); }
  });

  it("hata kartı: üzgün yüz (56) ve 'Neden?' ayrıntıyı açar; düğmeler yerinde kalır", T, async () => {
    const p = await page("hn");
    try {
      await until(() => p.locator("button", { hasText: "Neden?" }).count(), "Neden? yok", 8000);
      await stable(() => box(".adaIc")(p));
      const dug = await stable(() => box(".dugmeler .btn.ana")(p));
      const mk = await box(".adaIc .mascot")(p);
      assert.equal(Math.round(mk.w), 56, "kartta maskot 56 px olmalı: " + mk.w);
      await p.locator("button", { hasText: "Neden?" }).click();
      await until(async () => /Bash başarısız oldu/.test(await text(p, ".hataAyrinti")), "ayrıntı açılmadı");
      const dug2 = await stable(() => box(".dugmeler .btn.ana")(p));
      assert.ok(Math.abs(dug.y - dug2.y) <= 0.5 && Math.abs(dug.x - dug2.x) <= 0.5, "düğme kaydı");
      await shot(p, "hata-neden", { x: 340, y: 0, width: 600, height: 330 });
      assert.deepEqual(p.errors, []);
    } finally { await p.close2(); }
  });
});
