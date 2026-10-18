// Robustness (100-scenario sweep): with long, empty and extreme data nothing overflows, overlaps or shifts. Headless Chromium, fake bridge.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { open, stable, start } from "./lib.mjs";

let env;
before(async () => { env = await start(); const p = await open(env, "/preview.html?state=b2"); await p.waitForTimeout(800); await p.close2(); }, { timeout: 90000 });
after(async () => { await env?.stop(); });

const T = { timeout: 60000 };
const L = "A Very Long Sample Text Prepared Especially For Our Valued User ".repeat(4);
const U = "A".repeat(120) + "https://example.com/" + "b".repeat(100);
const FAKE = `const f=(await import("/src/bridge.fake.ts")).fakeBridge; const fx=await import("/src/plugin.fixtures.ts");`;
const media = (title, artist, album, extra = {}) => `f.setMedia({app:"Spotify",title:${JSON.stringify(title)},artist:${JSON.stringify(artist)},album:${JSON.stringify(album)},art:null,playing:false,positionMs:1000,positionAt:Date.now(),durationMs:200000,canNext:true,canPrevious:true,canSeek:true,...${JSON.stringify(extra)}})`;
async function on(url, setup, fn, size) {
  const page = await open(env, url, size);
  try {
    if (setup) await page.evaluate(`(async()=>{${FAKE} ${setup}})()`);
    await page.waitForTimeout(900);
    await fn(page);
    assert.deepEqual(page.errors, [], "page error: " + page.errors.join(" | "));
  } finally { await page.close2(); }
}

describe("long data doesn't overflow", () => {
  it("notification list: long rows don't overlap, the title takes at most 2 lines", T, () => on("/preview.html?state=m",
    `for(let i=0;i<12;i++) f.pushNotice({id:'x'+i,app:'😀A Very Long Application Name '.repeat(3),title:${JSON.stringify(L)},body:${JSON.stringify(L)}})`, async (page) => {
      const rows = await page.evaluate(() => [...document.querySelectorAll(".notifs > .notif")].map((e) => { const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom, title: e.querySelector(".mBody > .b6")?.getBoundingClientRect().height ?? 0 }; }));
      assert.ok(rows.length >= 10, "no rows");
      for (let i = 1; i < rows.length; i++) assert.ok(rows[i].t >= rows[i - 1].b - 0.5, `row ${i} overlaps the previous one`);
      for (const r of rows) assert.ok(r.title <= 40, "the title exceeds 2 lines: " + r.title);
    }));

  it("music card: title 2 lines, artist 1 line, full text in the title tooltip, height bounded", T, () => on("/preview.html?state=b2", media(L, L, L), async (page) => {
    const m = await page.evaluate(() => { const t = document.querySelector(".player .t20"), s = document.querySelector(".player .queue"); return { th: t.getBoundingClientRect().height, sh: s.getBoundingClientRect().height, ttl: t.getAttribute("title"), stl: s.getAttribute("title"), card: document.querySelector(".player").getBoundingClientRect().height }; });
    assert.ok(m.th <= 51, "title " + m.th);
    assert.ok(m.sh <= 21, "artist line " + m.sh);
    assert.equal(m.ttl, L.trim());
    assert.ok(m.stl.includes(", "), "album missing from the tooltip");
    assert.ok(m.card <= 140, "card height " + m.card);
  }));

  it("music card: a very long name without spaces doesn't overflow sideways", T, () => on("/preview.html?state=b2", media(U, U, U), async (page) => {
    const o = await page.evaluate(() => { const c = document.querySelector(".player"); return c.scrollWidth - c.clientWidth; });
    assert.ok(o <= 1, "sideways overflow " + o);
  }));

  it("music card: for a track over an hour the time is written h:mm:ss and fits its slot", T, () => on("/preview.html?state=b2", media("Podcast", "Someone", "", { durationMs: 3_805_000, positionMs: 3_661_000 }), async (page) => {
    const r = await page.evaluate(() => { const g = document.querySelector(".progress"); const sp = [...g.querySelectorAll("span")]; return { t: sp.map((e) => e.textContent), over: g.scrollWidth - g.clientWidth }; });
    assert.equal(r.t[0], "1:01:01");
    assert.equal(r.t[1], "-2:24");
    assert.ok(r.over <= 1);
  }));

  it("the center content never exceeds 424 px (a long song name is cut with an ellipsis)", T, () => on("/preview.html?state=b1", media(L, L, L, { playing: true }), async (page) => {
    const w = await page.evaluate(() => Math.round(document.querySelector(".islandMascot:not(.leaving)").getBoundingClientRect().width));
    assert.ok(w <= 424, "center width " + w);
  }));

  it("alert peek: with a long unbroken subtitle the buttons stay on screen", T, () => on("/preview.html?state=a", `f.pushAlert({id:"u2",title:${JSON.stringify(U)},subtitle:${JSON.stringify(U)},icon:"attention",priority:90,action:"https://x.com"})`, async (page) => {
    const r = await page.evaluate(() => { const c = document.querySelector(".peekBar"); const b = [...c.querySelectorAll("button")].map((e) => e.getBoundingClientRect().right); return { w: c.getBoundingClientRect().width, maxBtn: Math.max(...b), vw: innerWidth, tip: c.querySelector(".t12.l2")?.getAttribute("title")?.length }; });
    assert.ok(r.w <= 621, "peek width " + r.w);
    assert.ok(r.maxBtn <= r.vw, "button off screen");
    assert.equal(r.tip, U.length);
  }));

  it("approval card: an unbroken command and a long title don't overflow", T, () => on("/preview.html?state=c2", `f.setSurfaces({approvals:[{...fx.APPROVAL_LOW,title:${JSON.stringify(L)},command:${JSON.stringify(U)},cwd:${JSON.stringify(U)},detail:${JSON.stringify(L)}}],approvalTop:"ap-1"})`, async (page) => {
    const r = await page.evaluate(() => { const k = document.querySelector(".code"), t = document.querySelector(".mkHead .t17"); return { over: k.scrollWidth - k.clientWidth, th: t.getBoundingClientRect().height }; });
    assert.ok(r.over <= 1, "the command overflows sideways " + r.over);
    assert.ok(r.th <= 2 * 22 + 1, "title " + r.th);
  }));

  it("approval peek: with a long source the title doesn't collapse to zero", T, () => on("/preview.html?state=c1", `f.setSurfaces({approvals:[{...fx.APPROVAL_LOW,title:"api-server needs approval",source:${JSON.stringify(L)}}],approvalTop:"ap-1"})`, async (page) => {
    const w = await page.evaluate(() => document.querySelector(".islandMascot:not(.leaving) .b6").getBoundingClientRect().width);
    assert.ok(w > 100, "title width " + w);
  }));

  it("the row under Start doesn't overflow the panel (a long account name gets an ellipsis)", T, () => on("/preview.html?state=w2", null, async (page) => {
    const r = await page.evaluate(() => { const row = document.querySelector(".headSub"); const last = [...row.querySelectorAll(".power > *")].pop(); return { row: row.getBoundingClientRect().right, btn: last.getBoundingClientRect().right }; });
    assert.ok(r.btn <= r.row + 0.5, `the Close button overflows by ${r.btn - r.row} px`);
  }));

  it("the timer shows h:mm:ss once it exceeds an hour", T, () => on("/preview.html?state=zam", `f.setTimer({label:"Movie",totalS:7200,remainingS:7199,running:false})`, async (page) => {
    const t = await page.evaluate(() => document.querySelector(".islandMascot:not(.leaving) .counter")?.textContent);
    assert.equal(t, "1:59:59");
  }));

  it("if the playing media goes away while the player card is open, Paused doesn't stay stuck on the strip", T, () => on("/preview.html?state=b2", "f.setMedia(null)", async (page) => {
    await page.waitForTimeout(700);
    const c = await page.evaluate(() => document.querySelector(".islandMascot:not(.leaving)")?.textContent ?? "");
    assert.ok(!c.includes("Paused") && !c.includes("Playing"), "stale player text on the strip: " + c);
  }));

  it("an app with 120 windows shows the counter as 99+", T, () => on("/preview.html?state=a",
    `f.setWindows(Array.from({length:120},(_,i)=>({appId:"chrome",name:"Chrome",icon:"",hwnd:100+i,title:"Tab "+i,active:i==0,monitor:"m1"})))`, async (page) => {
      const t = await page.evaluate(() => [...document.querySelectorAll(".count")].map((e) => e.textContent));
      assert.ok(t.includes("99+"), JSON.stringify(t));
    }));

  it("in the music peek the neighbours don't shift as elapsed time goes 9:59 -> 10:00", T, () => on("/preview.html?state=b1", media("Long", "Track", "", { durationMs: 700_000, positionMs: 599_000 }), async (page) => {
    const rect = () => page.evaluate(() => Math.round(document.querySelector(".peekBar .miniProgress").getBoundingClientRect().left * 10));
    const a = await stable(rect);
    await page.evaluate(`(async()=>{${FAKE} ${media("Long", "Track", "", { durationMs: 700_000, positionMs: 601_000 })}})()`);
    await page.waitForTimeout(300);
    assert.equal(await stable(rect), a);
  }));
});

describe("narrow screens", () => {
  for (const [w, h] of [[1280, 720], [1366, 768], [1536, 864]]) {
    it(`the Modules card fits the screen at ${w} px`, T, () => on("/preview.html?state=j", null, async (page) => {
      const r = await page.evaluate(() => { const c = document.querySelector('#island [role="dialog"]').getBoundingClientRect(); return { l: c.left, r: c.right, b: c.bottom, vw: innerWidth, vh: innerHeight }; });
      assert.ok(r.l >= 0 && r.r <= r.vw && r.b <= r.vh, JSON.stringify(r));
    }, { width: w, height: h }));
  }
});
