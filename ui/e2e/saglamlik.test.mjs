// Sağlamlık (100 senaryo turu): uzun, boş ve uç veride hiçbir şey taşmaz, üst üste binmez, kaymaz. Headless Chromium, sahte köprü.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { open, stable, start } from "./lib.mjs";

let env;
before(async () => { env = await start(); const p = await open(env, "/preview.html?durum=b2"); await p.waitForTimeout(800); await p.close2(); }, { timeout: 90000 });
after(async () => { await env?.stop(); });

const T = { timeout: 60000 };
const L = "Çok Uzun Bir Metin Örneği Değerli Kullanıcı Için Hazırlanmıştır ".repeat(4);
const U = "A".repeat(120) + "https://ornek.com/" + "b".repeat(100);
const FAKE = `const f=(await import("/src/bridge.fake.ts")).fakeBridge; const fx=await import("/src/plugin.fixtures.ts");`;
const media = (title, artist, album, extra = {}) => `f.setMedia({app:"Spotify",title:${JSON.stringify(title)},artist:${JSON.stringify(artist)},album:${JSON.stringify(album)},art:null,playing:false,positionMs:1000,positionAt:Date.now(),durationMs:200000,canNext:true,canPrevious:true,canSeek:true,...${JSON.stringify(extra)}})`;
async function on(url, setup, fn, size) {
  const page = await open(env, url, size);
  try {
    if (setup) await page.evaluate(`(async()=>{${FAKE} ${setup}})()`);
    await page.waitForTimeout(900);
    await fn(page);
    assert.deepEqual(page.errors, [], "sayfa hatası: " + page.errors.join(" | "));
  } finally { await page.close2(); }
}

describe("uzun veri taşmaz", () => {
  it("bildirim listesi: uzun satırlar üst üste binmez, başlık en çok 2 satır", T, () => on("/preview.html?durum=m",
    `for(let i=0;i<12;i++) f.pushNotice({id:'x'+i,app:'😀Çok Uzun Uygulama Adı '.repeat(3),title:${JSON.stringify(L)},body:${JSON.stringify(L)}})`, async (page) => {
      const rows = await page.evaluate(() => [...document.querySelectorAll(".bilds > .bild")].map((e) => { const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom, title: e.querySelector(".mGovde > .b6")?.getBoundingClientRect().height ?? 0 }; }));
      assert.ok(rows.length >= 10, "satırlar yok");
      for (let i = 1; i < rows.length; i++) assert.ok(rows[i].t >= rows[i - 1].b - 0.5, `satır ${i} öncekinin üstüne biniyor`);
      for (const r of rows) assert.ok(r.title <= 40, "başlık 2 satırı aşıyor: " + r.title);
    }));

  it("müzik kartı: başlık 2 satır, sanatçı tek satır, tam metin başlık ipucunda, yükseklik sınırlı", T, () => on("/preview.html?durum=b2", media(L, L, L), async (page) => {
    const m = await page.evaluate(() => { const t = document.querySelector(".calar .t20"), s = document.querySelector(".calar .sira"); return { th: t.getBoundingClientRect().height, sh: s.getBoundingClientRect().height, ttl: t.getAttribute("title"), stl: s.getAttribute("title"), card: document.querySelector(".calar").getBoundingClientRect().height }; });
    assert.ok(m.th <= 51, "başlık " + m.th);
    assert.ok(m.sh <= 21, "sanatçı satırı " + m.sh);
    assert.equal(m.ttl, L.trim());
    assert.ok(m.stl.includes(", "), "albüm ipucunda yok");
    assert.ok(m.card <= 140, "kart yüksekliği " + m.card);
  }));

  it("müzik kartı: boşluksuz çok uzun ad yana taşmaz", T, () => on("/preview.html?durum=b2", media(U, U, U), async (page) => {
    const o = await page.evaluate(() => { const c = document.querySelector(".calar"); return c.scrollWidth - c.clientWidth; });
    assert.ok(o <= 1, "yana taşma " + o);
  }));

  it("müzik kartı: bir saati aşan parçada süre saat:dk:sn yazılır ve yuvadan taşmaz", T, () => on("/preview.html?durum=b2", media("Podcast", "Biri", "", { durationMs: 3_805_000, positionMs: 3_661_000 }), async (page) => {
    const r = await page.evaluate(() => { const g = document.querySelector(".ilerle"); const sp = [...g.querySelectorAll("span")]; return { t: sp.map((e) => e.textContent), over: g.scrollWidth - g.clientWidth }; });
    assert.equal(r.t[0], "1:01:01");
    assert.equal(r.t[1], "-2:24");
    assert.ok(r.over <= 1);
  }));

  it("ortadaki içerik 424 px'i aşmaz (uzun şarkı adı üç noktayla kısalır)", T, () => on("/preview.html?durum=b1", media(L, L, L, { playing: true }), async (page) => {
    const w = await page.evaluate(() => Math.round(document.querySelector(".adaMk:not(.eski)").getBoundingClientRect().width));
    assert.ok(w <= 424, "orta genişlik " + w);
  }));

  it("uyarı çıkıntısı: boşluksuz uzun alt başlıkta düğmeler ekranda kalır", T, () => on("/preview.html?durum=a", `f.pushAlert({id:"u2",title:${JSON.stringify(U)},subtitle:${JSON.stringify(U)},icon:"dikkat",priority:90,action:"https://x.com"})`, async (page) => {
    const r = await page.evaluate(() => { const c = document.querySelector(".cik"); const b = [...c.querySelectorAll("button")].map((e) => e.getBoundingClientRect().right); return { w: c.getBoundingClientRect().width, maxBtn: Math.max(...b), vw: innerWidth, tip: c.querySelector(".t12.l2")?.getAttribute("title")?.length }; });
    assert.ok(r.w <= 621, "çıkıntı genişliği " + r.w);
    assert.ok(r.maxBtn <= r.vw, "düğme ekran dışı");
    assert.equal(r.tip, U.length);
  }));

  it("onay kartı: boşluksuz komut ve uzun başlık taşmaz", T, () => on("/preview.html?durum=c2", `f.setSurfaces({approvals:[{...fx.APPROVAL_LOW,title:${JSON.stringify(L)},command:${JSON.stringify(U)},cwd:${JSON.stringify(U)},detail:${JSON.stringify(L)}}],approvalTop:"ap-1"})`, async (page) => {
    const r = await page.evaluate(() => { const k = document.querySelector(".kod"), t = document.querySelector(".mkBas .t17"); return { over: k.scrollWidth - k.clientWidth, th: t.getBoundingClientRect().height }; });
    assert.ok(r.over <= 1, "komut yana taşıyor " + r.over);
    assert.ok(r.th <= 2 * 22 + 1, "başlık " + r.th);
  }));

  it("onay çıkıntısı: uzun kaynakta başlık sıfıra çökmez", T, () => on("/preview.html?durum=c1", `f.setSurfaces({approvals:[{...fx.APPROVAL_LOW,title:"api-sunucu izin istiyor",source:${JSON.stringify(L)}}],approvalTop:"ap-1"})`, async (page) => {
    const w = await page.evaluate(() => document.querySelector(".adaMk:not(.eski) .b6").getBoundingClientRect().width);
    assert.ok(w > 100, "başlık genişliği " + w);
  }));

  it("Başlat altındaki satır panelden taşmaz (uzun hesap adı üç nokta)", T, () => on("/preview.html?durum=w2", null, async (page) => {
    const r = await page.evaluate(() => { const row = document.querySelector(".basAlt"); const last = [...row.querySelectorAll(".guc > *")].pop(); return { row: row.getBoundingClientRect().right, btn: last.getBoundingClientRect().right }; });
    assert.ok(r.btn <= r.row + 0.5, `Kapat düğmesi ${r.btn - r.row} px taşıyor`);
  }));

  it("zamanlayıcı süresi bir saati aşınca saat:dk:sn yazılır", T, () => on("/preview.html?durum=zam", `f.setTimer({label:"Film",totalS:7200,remainingS:7199,running:false})`, async (page) => {
    const t = await page.evaluate(() => document.querySelector(".adaMk:not(.eski) .sayac")?.textContent);
    assert.equal(t, "1:59:59");
  }));

  it("çalar kartı açıkken çalan kalkarsa şeritte Duraklatıldı takılı kalmaz", T, () => on("/preview.html?durum=b2", "f.setMedia(null)", async (page) => {
    await page.waitForTimeout(700);
    const c = await page.evaluate(() => document.querySelector(".adaMk:not(.eski)")?.textContent ?? "");
    assert.ok(!c.includes("Duraklatıldı") && !c.includes("Çalıyor"), "şeritte eski çalar yazısı: " + c);
  }));

  it("120 pencereli uygulamada sayaç 99+ yazar", T, () => on("/preview.html?durum=a",
    `f.setWindows(Array.from({length:120},(_,i)=>({appId:"chrome",name:"Chrome",icon:"",hwnd:100+i,title:"Sekme "+i,active:i==0,monitor:"m1"})))`, async (page) => {
      const t = await page.evaluate(() => [...document.querySelectorAll(".say")].map((e) => e.textContent));
      assert.ok(t.includes("99+"), JSON.stringify(t));
    }));

  it("müzik çıkıntısında geçen süre 9:59 -> 10:00 olurken komşular kaymaz", T, () => on("/preview.html?durum=b1", media("Uzun", "Parça", "", { durationMs: 700_000, positionMs: 599_000 }), async (page) => {
    const rect = () => page.evaluate(() => Math.round(document.querySelector(".cik .miniIlerle").getBoundingClientRect().left * 10));
    const a = await stable(rect);
    await page.evaluate(`(async()=>{${FAKE} ${media("Uzun", "Parça", "", { durationMs: 700_000, positionMs: 601_000 })}})()`);
    await page.waitForTimeout(300);
    assert.equal(await stable(rect), a);
  }));
});

describe("dar ekranlar", () => {
  for (const [w, h] of [[1280, 720], [1366, 768], [1536, 864]]) {
    it(`Modüller kartı ${w} px'te ekrana sığar`, T, () => on("/preview.html?durum=j", null, async (page) => {
      const r = await page.evaluate(() => { const c = document.querySelector('#ada [role="dialog"]').getBoundingClientRect(); return { l: c.left, r: c.right, b: c.bottom, vw: innerWidth, vh: innerHeight }; });
      assert.ok(r.l >= 0 && r.r <= r.vw && r.b <= r.vh, JSON.stringify(r));
    }, { width: w, height: h }));
  }
});
