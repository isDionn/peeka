// Peeka arayüzü uçtan uca akış testleri (headless Chromium, sahte köprü). Çalıştır: npm run e2e
// İlkeler: tıklayınca başka bir şey kaymaz; her karttan Modüller > Genel'e en çok 2 adımda gidilir; tutarlı ölçüler; çıkmaz sokak yok; çıkıntı üstündeyken kapanmaz; tek üst katman; 1366x768'de taşma yok.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { boxDiff, frame, layers, open, stable, start, tabRects, until } from "./lib.mjs";

let env;
before(async () => {
  env = await start();
  for (const u of ["/preview.html?durum=j", "/island.html?autostart=1", "/index.html"]) { const p = await open(env, u); await p.waitForTimeout(800); await p.close2(); } // Vite bağımlılıkları ısınsın
}, { timeout: 90000 });
after(async () => { await env?.stop(); });

const T = { timeout: 120000 };
const MOD = '[role="tablist"][aria-label="Modüller"]';
const P = (d, extra = "") => `/preview.html?durum=${d}${extra}`;
/** Sayfayı açıp `fn` çalıştırır, sayfa hatası olmadığını da doğrular. */
async function on(url, fn, size) {
  const page = await open(env, url, size);
  try { await fn(page); assert.deepEqual(page.errors, [], "sayfa hatası: " + page.errors.join(" | ")); } finally { await page.close2(); }
}
const goto = async (page, url) => { await page.goto(env.base + url); await page.waitForSelector("#root *"); };

/* ---------------- 1. Tıklayınca başka öğe kaymaz ---------------- */
describe("tıklayınca başka öğe kaymaz", () => {
  async function noShift(page, bar) {
    const n = (await tabRects(page, bar)).length;
    assert.ok(n > 1, `${bar}: sekme yok`);
    const bad = [];
    for (let i = 0; i < n; i++) {
      const before = await stable(() => tabRects(page, bar));
      const clicked = before[i].k;
      await page.locator(`[role="tablist"][aria-label="${bar}"] [role="tab"]`).nth(i).click();
      await frame(page);
      const now = await tabRects(page, bar);
      bad.push(...boxDiff(before, now, clicked).map((d) => `[${clicked} tıklanınca, hemen] ${d}`));
      await stable(() => tabRects(page, bar));
      bad.push(...boxDiff(before, await tabRects(page, bar), clicked).map((d) => `[${clicked} tıklanınca, oturunca] ${d}`));
    }
    assert.deepEqual(bad, []);
  }
  for (const [ad, url, bar] of [
    ["Modüller sekmeleri (preview)", P("j"), "Modüller"],
    ["şerit sabitleri (preview)", P("a"), "Sabitlenmiş uygulamalar ve açık pencereleri"],
    ["şerit sabitleri (index.html)", "/index.html", "Sabitlenmiş uygulamalar ve açık pencereleri"],
    ["şerit pencere sekmeleri (preview)", P("a"), "Bu ekrandaki pencereler"],
    ["şerit pencere sekmeleri (index.html)", "/index.html", "Bu ekrandaki pencereler"],
  ]) {
    it(ad, T, () => on(url, async (page) => { if (bar === "Modüller") await page.waitForSelector(MOD); else await page.waitForSelector(`[role="tablist"][aria-label="${bar}"] [role="tab"]`); await noShift(page, bar); }));
  }
  it("Modüller sekmeleri (island.html, kart tıklanarak açılır)", T, () => on("/island.html?autostart=1", async (page) => {
    await page.locator(".adaMerkez").click();
    await page.waitForSelector(MOD);
    await noShift(page, "Modüller");
  }));
  it("uygulama menüsü: kapanmayan 'Uygulamadan çık' (onay) basışı komşuları oynatmaz", T, () => on(P("a"), async (page) => {
    await page.locator('[role="tablist"][aria-label^="Sabitlenmiş"] [role="tab"]').first().click({ button: "right" });
    await page.waitForSelector('[role="menu"]');
    const rects = () => page.evaluate(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((e) => { const r = e.getBoundingClientRect(); return { k: e.textContent.trim(), x: r.x, y: r.y, w: r.width, h: r.height }; }));
    const before = await stable(rects);
    const arm = page.locator('[role="menuitem"]', { hasText: "Uygulamadan çık" });
    await arm.click();
    await frame(page);
    const now = await stable(rects);
    assert.ok(now.length === before.length, "menü öğe sayısı değişti");
    // genişlik hariç: onay yazısı uzun, menü genişleyebilir; sol-üst köşe ve yükseklik kaymamalı
    assert.deepEqual(boxDiff(before, now, "Uygulamadan çık", ["x", "y", "h"]), []);
  }));
});

/* ---------------- 2. Her karttan her karta: Modüller > Genel en çok 2 adımda, kapanış Esc ya da × ---------------- */
describe("her karttan Modüller > Genel (en çok 2 adım) ve kapanış", () => {
  // Öğe yoksa hemen hata (adım geçersiz); varsa animasyon oturana dek bekleyip tıklar.
  const press = async (loc) => { if (!(await loc.count())) throw new Error("yok"); await loc.first().click({ timeout: 4000 }); };
  const ACT = {
    "Modüller düğmesi": (p) => press(p.locator("#ada [role=dialog] button.modGit")),
    "Genel sekmesi": (p) => press(p.locator(`${MOD} [role=tab][aria-label="Genel"]`)),
    "ada ortası": (p) => press(p.locator(".adaMerkez")),
  };
  const names = Object.keys(ACT);
  const genelOpen = async (p, ms) => { try { await p.locator(`${MOD} [role=tab][aria-label="Genel"][aria-selected=true]`).waitFor({ state: "visible", timeout: ms }); return true; } catch { return false; } };
  const tabCard = (tab) => ({ ad: `Modüller › ${tab}`, url: P("j"), pre: (p) => p.locator(`${MOD} [role=tab][aria-label="${tab}"]`).click() });
  const CARDS = [
    { ad: "müzik kartı", url: P("b2") },
    ...["Genel", "Müzik", "Pano", "Raf", "Takvim", "Zamanlayıcı", "Sistem", "Bildirimler", "Pusula", "Pusula › Claude Code", "Pusula › Ekip"].map(tabCard),
    { ad: "pano kartı", url: P("h") }, { ad: "raf kartı", url: P("g") }, { ad: "takvim (toplantı) kartı", url: P("f") },
    { ad: "sohbet (composer) kartı", url: P("s") }, { ad: "sohbet, yanıt gelmiş", url: P("d2") },
    { ad: "onay kartı (düşük risk)", url: P("c2") }, { ad: "onay kartı (yüksek risk)", url: P("c2r") }, { ad: "onay kartı (seçenekli)", url: P("c3") },
    { ad: "şerit paneli: Bildirimler", url: P("m") },
  ];
  /** 0, 1 ya da 2 adımda Genel'e giden dizi; yoksa null. Her denemede sayfa baştan yüklenir. */
  async function findPath(page, c) {
    const fresh = async () => { await goto(page, c.url); if (c.pre) { await page.waitForSelector(MOD); await c.pre(page); } await frame(page); };
    await fresh();
    if (await genelOpen(page, 400) && (await page.locator("#ada [role=dialog]").count())) return [];
    const seqs = [...names.map((a) => [a]), ...names.flatMap((a) => names.map((b) => [a, b]))];
    for (const s of seqs) {
      await fresh();
      try { for (const a of s) { await ACT[a](page); await frame(page); } } catch { continue; }
      if (await genelOpen(page, 1200)) return s;
    }
    return null;
  }
  const gone = async (p, ms) => { try { await until(async () => !(await layers(p)).length, "katman kapanmadı", ms); return true; } catch { return false; } };
  for (const c of CARDS) {
    it(c.ad, T, async () => {
      const page = await open(env, c.url);
      try {
        const path = await findPath(page, c);
        assert.ok(path, `${c.ad}: Modüller › Genel'e en çok 2 adımda gidilemedi (denenen adımlar: ${names.join(", ")})`);
        // kapanış: Esc (en çok 2 basış) ve ayrıca görünür ×
        await stable(() => layers(page));
        let esc = 0;
        for (; esc < 2; esc++) { await page.keyboard.press("Escape"); if (await gone(page, 1500)) { esc++; break; } }
        assert.ok(!(await layers(page)).length, `Genel açıkken ${esc} Esc sonrası katman açık: ${(await layers(page)).join()}`);
        await goto(page, c.url);
        if (c.pre) { await page.waitForSelector(MOD); await c.pre(page); }
        for (const a of path) await ACT[a](page);
        await genelOpen(page, 2000);
        const x = page.locator('#ada [role=dialog] button[aria-label="Kapat"]');
        assert.equal(await x.count(), 1, "Genel kartında görünür × yok");
        await x.click();
        assert.ok(await gone(page, 2000), "× katmanı kapatmadı");
        assert.deepEqual(page.errors, []);
      } finally { await page.close2(); }
    });
  }
});

/* ---------------- 3. Tutarlılık: sekme düğmesi ve kart genişliği ---------------- */
describe("tutarlılık (Modüller kartı)", () => {
  async function perTab(page) {
    await page.waitForSelector(MOD);
    const n = (await tabRects(page, "Modüller")).length;
    const rows = [];
    for (let i = 0; i < n; i++) {
      await page.locator(`${MOD} [role=tab]`).nth(i).click();
      const row = await stable(() => page.evaluate((m) => {
        const tabs = [...document.querySelectorAll(`${m} [role=tab]`)].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; });
        return { sel: document.querySelector(`${m} [role=tab][aria-selected=true]`)?.getAttribute("aria-label"), tabs, card: Math.round(document.querySelector('#ada [role="dialog"]').getBoundingClientRect().width * 10) / 10 };
      }, MOD));
      rows.push(row);
    }
    return rows;
  }
  it("düğme boyutu her sekmede (ve sekmeler arasında) aynı", T, () => on(P("j"), async (page) => {
    const rows = await perTab(page);
    const all = rows.flatMap((r) => r.tabs.map((t) => t.join("x")));
    assert.deepEqual([...new Set(all)], [all[0]], "sekme düğmesi boyutları: " + JSON.stringify([...new Set(all)]));
  }));
  it("Genel dışındaki her sekmede kart genişliği aynı", T, () => on(P("j"), async (page) => {
    const rows = await perTab(page);
    const w = rows.filter((r) => r.sel !== "Genel").map((r) => `${r.sel}=${r.card}`);
    const set = new Set(w.map((s) => s.split("=")[1]));
    assert.equal(set.size, 1, "kart genişlikleri: " + w.join(", "));
  }));
});

/* ---------------- 4. Çıkmaz sokak yok: çıkıntıya tıklayınca bir şey açılır ---------------- */
describe("çıkıntı varken adaya tıklayınca bir şey açılır", () => {
  const BUMPS = [["b1", "müzik"], ["e", "ses"], ["u", "uyarı"], ["sarj", "şarj"], ["pil", "düşük pil"], ["bt", "Bluetooth"], ["zam", "zamanlayıcı"], ["dik", "dikte"], ["tik", "ticket"], ["kay", "kayıt"], ["f0", "toplantı/eklenti çıkıntısı"], ["g0", "raf sürükleme"], ["h1", "ekran alıntısı"], ["c1", "onay (düşük)"], ["c1r", "onay (yüksek)"], ["q1", "bütçe uyarısı"], ["q2", "kota uyarısı"], ["d1", "ses: düşünüyor"], ["d3", "ses: konuşuyor"]];
  for (const [d, ad] of BUMPS) {
    it(`${d}: ${ad}`, T, () => on(P(d), async (page) => {
      await page.waitForSelector("#ada .mcik", { timeout: 8000 });
      assert.equal((await layers(page)).length, 0, "çıkıntıyken zaten bir katman açık");
      await page.locator(".adaMerkez").click();
      const got = await until(async () => { const l = await layers(page); return l.length ? l : null; }, `${d}: adaya tıklanınca hiçbir şey açılmadı (çıkmaz sokak)`, 2500);
      assert.ok(got.length >= 1);
    }));
  }
});

/* ---------------- 5. Üstüne gelince kendiliğinden kapanan çıkıntı kapanmaz ---------------- */
describe("imleç çıkıntıdayken çıkıntı kapanmaz", () => {
  // her olay: kendiliğinden kapanan bir çıkıntı (ses göstergesi 1,8 sn, müzik 6 sn)
  const CASES = [["ses (OSD), preview", P("a"), "osd"], ["ses (OSD), island.html", "/island.html?autostart=1", "osd"], ["müzik (parça değişti), island.html", "/island.html?autostart=1", "music"]];
  const fire = (page, kind) => page.evaluate(async (k) => {
    const f = (await import("/src/bridge.fake.ts")).fakeBridge;
    if (k === "osd") f.emit("volume_osd", { percent: 40, muted: false, device: "Hoparlör" });
    else f.setMedia({ ...(await f.call("get_media")), title: "Yeni parça " + Date.now(), playing: true });
  }, kind);
  for (const [ad, url, osd] of CASES) {
    it(ad, T, async () => {
      const bump = (page) => page.locator("#ada .mcik:not(.eski)");
      // kontrol: imleç yokken çıkıntı kendiliğinden kapanır (yoksa test bir şey kanıtlamaz)
      await on(url, async (page) => {
        await page.locator(".adaMerkez").waitFor();
        await fire(page, osd);
        await bump(page).waitFor({ state: "visible", timeout: 5000 });
        await bump(page).waitFor({ state: "detached", timeout: 9000 });
      });
      // asıl: imleç ada ortasındayken kapanmaz; çekilince kapanır
      await on(url, async (page) => {
        await page.locator(".adaMerkez").waitFor();
        await fire(page, osd);
        await bump(page).waitFor({ state: "visible", timeout: 5000 });
        const b = await page.locator(".adaMerkez").boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        let closed = true;
        try { await bump(page).waitFor({ state: "detached", timeout: 5200 }); } catch { closed = false; }
        assert.equal(closed, false, `${ad}: imleç üstündeyken çıkıntı kapandı`);
        await page.mouse.move(b.x + b.width / 2, 600);
        await bump(page).waitFor({ state: "detached", timeout: 9000 });
      });
    });
  }
});

/* ---------------- 6. Panel açılınca tek üst katman, tek Esc ---------------- */
describe("kart açıkken panel açınca tek katman kalır", () => {
  const CARDS = [["modüller", "j"], ["pano", "h"], ["raf", "g"], ["sohbet", "s"], ["müzik", "b2"], ["onay", "c2"]];
  const PANELS = ["start", "search", "status", "notif", "tray"];
  for (const [ad, d] of CARDS) {
    for (const k of PANELS) {
      it(`${ad} kartı açıkken ${k} paneli`, T, () => on(P(d), async (page) => {
        await page.waitForSelector("#ada [role=dialog]");
        await stable(() => layers(page));
        await page.locator(`[data-panel-trigger="${k}"]`).click();
        await until(async () => (await layers(page)).some((l) => l === "panel:" + k), `${k} paneli açılmadı`);
        const l = await until(async () => { const x = await layers(page); return x.length === 1 ? x : null; }, "tek katman kalmadı: " + "kart paneli ile birlikte açık", 2500).catch(async (e) => { throw new Error(e.message + " -> " + (await layers(page)).join(" + ")); });
        assert.equal(l[0], "panel:" + k);
        await page.keyboard.press("Escape");
        await until(async () => !(await layers(page)).length, "tek Esc hepsini kapatmadı: " + (await layers(page)).join(" + "), 2500);
      }));
    }
  }
});

/* ---------------- 7. 1366x768'de taşma yok ---------------- */
describe("1366x768: panelin alt kenarı ekranda ya da kaydırılabilir", () => {
  const VIEW = { width: 1366, height: 768 };
  const SURF = [["Başlat", "w2"], ["Durum", "o"], ["Bildirimler", "m"], ["Gizli simgeler", "tepsi"], ["Ara", "ara0"], ["Ara (sonuçlu)", "ara1"], ["Temizlik onayı", "mt"], ["Ayarlar Genel", "ayg"], ["Ayarlar Kısayol", "ayk"], ["Ayarlar Eklenti", "aye"], ["Ayarlar Modüller", "aym"], ["Ayarlar Gizlilik", "ayp"], ["Ayarlar Sistem", "ays"], ["Çıkış onayı", "y"], ["Kurulum", "kur"],
    ["kart: Modüller", "j"], ["kart: pano", "h"], ["kart: raf", "g"], ["kart: sohbet", "s"], ["kart: sohbet yanıtlı", "d2"], ["kart: müzik", "b2"], ["kart: onay", "c2"], ["kart: onay seçenekli", "c3"], ["kart: toplantı", "f"], ["kart: hoş geldin", "ilk"]];
  const measure = (page) => page.evaluate(() => {
    const el = document.querySelector('[data-panel]:not([aria-hidden="true"])') ?? document.querySelector('#ada [role="dialog"]');
    if (!el) return null;
    const vh = innerHeight, r = el.getBoundingClientRect();
    const scrollers = [el, ...el.querySelectorAll("*")].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1 && e.getBoundingClientRect().bottom <= vh + 1);
    return { name: el.getAttribute("aria-label"), bottom: Math.round(r.bottom), vh, scrollable: scrollers.length > 0 };
  });
  for (const [ad, d] of SURF) {
    it(`${ad}`, T, () => on(P(d), async (page) => {
      await until(measure.bind(null, page), "açık panel/kart yok", 8000);
      const m = await stable(() => measure(page));
      assert.ok(m, "açık panel yok");
      assert.ok(m.bottom <= m.vh + 1 || m.scrollable, `${m.name}: alt kenar ${m.bottom} > ${m.vh} ve kaydırılamıyor`);
    }, VIEW));
  }
});

/* ---------------- 8. Gerçek sayfalar: duman testi ---------------- */
describe("gerçek sayfalar (sahte köprü)", () => {
  it("island.html: ada ortası Modüller'i açar, Esc kapatır", T, () => on("/island.html?autostart=1", async (page) => {
    await page.locator(".adaMerkez").click();
    await page.waitForSelector(`${MOD} [role=tab][aria-selected=true]`);
    await page.keyboard.press("Escape");
    await until(async () => !(await layers(page)).length, "Esc kartı kapatmadı", 2500);
  }));
  it("index.html: Başlat paneli açılır, Esc kapatır", T, () => on("/index.html", async (page) => {
    await page.locator('[data-panel-trigger="start"]').click();
    await until(async () => (await layers(page)).includes("panel:start"), "Başlat açılmadı");
    await page.keyboard.press("Escape");
    await until(async () => !(await layers(page)).length, "Esc paneli kapatmadı", 2500);
  }));
});

/* ---------------- Durum panelinde "Peeka'yı kapat" (sahip kararı 2026-10-17): çıkış onayını açar ---------------- */
describe("Durum paneli: Peeka'yı kapat", () => {
  it("satır komşu satırlarla aynı boyda, üstüne gelince kaymaz, tıklayınca çıkış onayı açılır", T, () => on(P("o"), async (page) => {
    const btn = page.getByRole("button", { name: "Peeka'yı kapat" });
    await btn.waitFor();
    const rows = () => page.evaluate(() => {
      const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
      const own = document.querySelector('[aria-label="Peeka\'yı kapat"]').closest(".sat");
      const sibs = [...document.querySelectorAll('[data-panel="status"] .liste .sat')].filter((e) => e !== own);
      return { own: box(own), sibs: sibs.map(box), btn: box(document.querySelector('[aria-label="Peeka\'yı kapat"]')) };
    });
    const before = await stable(rows);
    assert.ok(before.sibs.length > 0, "komşu satır yok");
    assert.ok(before.sibs.every((s) => Math.abs(s.h - before.own.h) <= 1 && Math.abs(s.w - before.own.w) <= 1), `satır boyu komşularla aynı değil: ${JSON.stringify(before)}`);
    const panelBottom = await page.evaluate(() => document.querySelector('[data-panel="status"]').getBoundingClientRect().bottom);
    assert.ok(before.own.y + before.own.h <= panelBottom + 1 && before.sibs.every((s) => s.y < before.own.y), "satır panelin en altında olmalı");
    await btn.hover();
    await frame(page);
    assert.deepEqual((await stable(rows)).btn, before.btn, "imleç üstüne gelince düğme kaydı");
    await btn.click();
    await until(async () => (await layers(page)).includes("panel:quit"), "çıkış onayı açılmadı");
    await page.getByText("Peeka'dan çıkılsın mı?").waitFor();
  }));
});
