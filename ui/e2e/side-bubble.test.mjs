// Side bubble (owner decision 2026-10-17): the highest-priority job on the main strip, the second one in a 30 px circle right of the island.
// Measured: the island center doesn't shift as the bubble comes and goes; the bubble box and the rectangle reported to Rust; bring-to-front on click; the "+N" list; no content while locked.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { open, start, stable, until } from "./lib.mjs";

let env;
before(async () => { env = await start(); const p = await open(env, "/preview.html?state=yb"); await p.waitForTimeout(800); await p.close2(); }, { timeout: 90000 });
after(async () => { await env?.stop(); });
const T = { timeout: 120000 };

/** Opens the page and collects the `report_hit_rects` payload sent to Rust into `window.__rects`. */
async function page(state, size = { width: 1280, height: 400 }) {
  const p = await open(env, `/preview.html?state=${state}`, size);
  await p.evaluate(() => { const o = window.fakeBridge.call; window.fakeBridge.call = (c, a) => { if (c === "report_hit_rects") window.__rects = a.rects; return o.call(window.fakeBridge, c, a); }; });
  return p;
}
const box = (sel) => (p) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2, r: r.right }; }, sel);
const center = box(".islandCenter"), bubble = box(".sideBubble"), sideBtn = box(".sideBtn");
const rects = (p) => p.evaluate(() => window.__rects ?? []);
const text = (p, sel) => p.evaluate((s) => document.querySelector(s)?.textContent ?? "", sel);
const fake = (p, js) => p.evaluate(`(async () => { const f = window.fakeBridge; ${js} })()`);

describe("side bubble", () => {
  it("Claude on the main strip, music in the bubble: 30 px box, 8 px right of the island, reported to Rust", T, async () => {
    const p = await page("yb");
    try {
      await until(() => bubble(p), "no bubble", 8000);
      const b = await stable(() => bubble(p));
      assert.equal(Math.round(b.w), 30); assert.equal(Math.round(b.h), 30); assert.equal(Math.round(b.y), 0);
      const m = await stable(() => center(p));
      const isl = await box("#island")(p);
      const edge = Math.max(m.r, isl && isl.h > 1 ? isl.x + isl.w : 0);
      assert.ok(Math.abs(b.x - edge - 8) <= 1.5, `the bubble is ${b.x - edge} px right of the island (8 expected)`);
      assert.match(await text(p, ".islandCenter"), /Claude/); // main strip
      assert.match(await text(p, ".islandCenter"), /0:0\d|0:1\d/); // counter
      assert.ok(await p.evaluate(() => document.querySelector(".sideBtn img.sideCover")?.getAttribute("src")?.startsWith("data:image")), "cover art for music");
      assert.equal(await p.evaluate(() => document.querySelectorAll(".sideBubble .mascot").length), 0, "no mascot in the bubble");
      assert.equal(await p.evaluate(() => document.querySelectorAll(".mascot").length), 1, "a single mascot on screen");
      const r = await until(async () => { const l = await rects(p); const d = await sideBtn(p); return l.find((x) => !x.paint && Math.abs(x.x - d.x) <= 1 && Math.abs(x.w - d.w) <= 1 && Math.abs(x.y - d.y) <= 1) ; }, "the bubble rectangle was not reported to Rust");
      assert.ok(r.w >= 29 && r.h >= 29);
      mkdirSync("screenshots", { recursive: true });
      await p.screenshot({ path: "screenshots/side-bubble-music.png", clip: { x: 340, y: 0, width: 600, height: 90 } });
      assert.deepEqual(p.errors, []);
    } finally { await p.close2(); }
  });

  it("the island center doesn't shift as the bubble comes and goes", T, async () => {
    const p = await page("yb");
    try {
      await until(() => bubble(p), "no bubble", 8000);
      const full = await stable(async () => [await center(p), await box("#island")(p)]);
      await fake(p, "f.setMedia(null);");
      await until(async () => !(await bubble(p)), "the bubble did not go away", 5000);
      const bare = await stable(async () => [await center(p), await box("#island")(p)]);
      assert.ok(Math.abs(full[0].cx - bare[0].cx) <= 0.5 && Math.abs(full[0].y - bare[0].y) <= 0.5, `center shift ${JSON.stringify([full[0], bare[0]])}`);
      assert.ok(Math.abs(full[1].cx - bare[1].cx) <= 0.5, "island body shift");
      // frame by frame on the way back: the center never moves
      await fake(p, "f.setMedia({ app: 'Spotify', title: 'Blue Hour', artist: 'Sea Rider', album: 'Harbor', art: null, playing: true, positionMs: 0, positionAt: Date.now(), durationMs: 198000, canNext: true, canPrevious: true, canSeek: true });");
      let drift = [];
      for (let i = 0; i < 25; i++) { drift.push(Math.abs((await center(p)).cx - bare[0].cx)); await p.waitForTimeout(25); }
      assert.ok(Math.max(...drift) <= 0.5, "the center moved during the entry spring: " + Math.max(...drift));
      await until(() => bubble(p), "the bubble did not come back", 5000);
      const again = await stable(() => center(p));
      assert.ok(Math.abs(again.cx - full[0].cx) <= 0.5);
      assert.equal(await p.evaluate(() => !!document.querySelector(".sideBtn svg.lucide")), true, "music note icon for music without cover art");
    } finally { await p.close2(); }
  });

  it("clicking the bubble brings that job to the front and Claude drops into the bubble; the center stays put; clicking again swaps back", T, async () => {
    const p = await page("yb");
    try {
      await until(() => bubble(p), "no bubble", 8000);
      const prev = await stable(() => center(p));
      await p.locator(".sideBtn").click();
      await until(async () => /Night Train/.test(await text(p, ".islandStage .dangling")) || /Night Train/.test(await text(p, ".islandCenter")), "music did not come to the front", 4000);
      const next = await stable(() => center(p));
      assert.ok(Math.abs(prev.cx - next.cx) <= 0.5 && Math.abs(prev.y - next.y) <= 0.5, "the center shifted on click " + JSON.stringify([prev, next]));
      assert.match(await p.locator(".sideBtn").getAttribute("aria-label"), /Claude/);
      assert.equal(await p.evaluate(() => document.querySelectorAll(".sideBubble .mascot").length), 0);
      await p.locator(".sideBtn").click();
      await until(async () => /Claude/.test(await text(p, ".islandCenter")), "Claude did not come back", 4000);
      assert.match(await p.locator(".sideBtn").getAttribute("aria-label"), /Playing/);
    } finally { await p.close2(); }
  });

  it("three jobs: '+1' badge, clicking lists the remaining jobs, clicking a row brings it to the front", T, async () => {
    const p = await page("yb2", { width: 1280, height: 400 });
    try {
      await until(() => bubble(p), "no bubble", 8000);
      const plus = p.locator(".sidePlus");
      assert.equal((await plus.textContent()).trim(), "+1");
      assert.equal(await p.locator(".sideList").count(), 0, "no list while closed");
      const prev = await stable(() => center(p));
      await plus.click();
      await p.waitForSelector(".sideList");
      const rows = await p.locator(".sideList .sideRow").allTextContents();
      assert.equal(rows.length, 1); assert.match(rows[0], /Timer/);
      const l = await box(".sideList")(p), b = await bubble(p);
      assert.ok(l.x >= 0 && l.r <= 1280 && l.y > b.y + b.h, "the list is inside the window and below the bubble");
      assert.ok((await rects(p)).some((x) => !x.paint && x.w >= l.w - 1 && Math.abs(x.x - l.x) <= 1), "the list was not reported to Rust");
      assert.ok(Math.abs((await center(p)).cx - prev.cx) <= 0.5, "the center shifted when the list opened " + JSON.stringify([prev, await center(p)]));
      await p.screenshot({ path: "screenshots/side-bubble-plus.png", clip: { x: 340, y: 0, width: 600, height: 150 } });
      await p.keyboard.press("Escape");
      await until(async () => (await p.locator(".sideList").count()) === 0, "Esc did not close the list", 2000);
      await plus.click();
      await p.locator(".sideList .sideRow").first().click();
      await until(async () => /Focus/.test(await text(p, ".islandCenter")), "the timer did not come to the front", 4000);
      assert.equal(await p.locator(".sideList").count(), 0, "the list closes after a selection");
      assert.deepEqual(p.errors, []);
    } finally { await p.close2(); }
  });

  it("no content in the bubble while locked: cover, track name and counter hidden, generic icon and label", T, async () => {
    const p = await page("yb2");
    try {
      await until(() => bubble(p), "no bubble", 8000);
      await fake(p, "f.setLocked(true, 'manual');");
      await until(async () => (await p.locator(".sideBtn").getAttribute("aria-label")).includes("Music playing"), "the lock label did not appear", 3000);
      const surface = await p.evaluate(() => { const e = document.querySelector(".sideBubble"); const parts = [e.textContent]; e.querySelectorAll("*").forEach((x) => ["title", "aria-label", "alt", "src"].forEach((a) => { const v = x.getAttribute(a); if (v) parts.push(v); })); return { s: parts.join("|"), img: e.querySelectorAll("img").length, svg: e.querySelectorAll("svg.lucide").length }; });
      for (const w of ["Night Train", "Lowtide", "data:image", "Focus", "24:"]) assert.ok(!surface.s.includes(w), `leaked while locked: ${w} -> ${surface.s}`);
      assert.equal(surface.img, 0); assert.ok(surface.svg >= 1, "generic icon");
      await p.locator(".sidePlus").click();
      const list = await p.locator(".sideList").textContent();
      assert.ok(!/Focus|\d:\d\d/.test(list), "timer info in the locked list: " + list);
    } finally { await p.close2(); }
  });
});
