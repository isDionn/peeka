// Small peeks (document notch-50-senaryo.md 13, 33, 43): the "N sessions" chip, the notification burst, the error card + "Why?".
// Measured: the chip sits 8 px left of the island, the center doesn't shift, it is reported to Rust; the burst text; "Why?" opens the detail; screenshots go to screenshots/.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { open, start, stable, until } from "./lib.mjs";

let env;
before(async () => { env = await start(); const p = await open(env, "/preview.html?state=os"); await p.waitForTimeout(800); await p.close2(); }, { timeout: 90000 });
after(async () => { await env?.stop(); });
const T = { timeout: 120000 };
const SIZE = { width: 1280, height: 400 };

async function page(state) {
  const p = await open(env, `/preview.html?state=${state}`, SIZE);
  await p.evaluate(() => { const o = window.fakeBridge.call; window.fakeBridge.call = (c, a) => { if (c === "report_hit_rects") window.__rects = a.rects; return o.call(window.fakeBridge, c, a); }; });
  return p;
}
const box = (sel) => (p) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, r: r.right }; }, sel);
const center = box(".islandCenter"), chip = box(".sessionBtn");
const text = (p, sel) => p.evaluate((s) => document.querySelector(s)?.textContent ?? "", sel);
const shot = async (p, name, clip) => { mkdirSync("screenshots", { recursive: true }); await p.screenshot({ path: `screenshots/${name}.png`, clip }); };

describe("small peeks", () => {
  it("two sessions: the chip is left of the island, the center doesn't shift, it is reported to Rust, clicking lists them", T, async () => {
    const p = await page("os");
    try {
      await until(() => chip(p), "no chip", 8000);
      const m = await stable(() => center(p));
      const c = await stable(() => chip(p));
      assert.ok(c.h <= 30, "chip exceeds 30 px: " + c.h);
      assert.ok(Math.abs((m.x + 0) - c.r - 8) <= 14, `the chip is not left of the island: center.x=${m.x} chip.right=${c.r}`); // the center box may be 12 px narrower/wider than the island
      assert.ok(c.r < m.cx, "the chip is right of the center");
      assert.ok(Math.abs(m.cx - SIZE.width / 2) <= 0.5, "the center moved: " + m.cx);
      assert.match(await text(p, ".sessionBtn"), /^2 sessions$/);
      await until(async () => { const l = await p.evaluate(() => window.__rects ?? []); return l.find((r) => !r.paint && Math.abs(r.x - c.x) <= 1.5 && Math.abs(r.w - c.w) <= 1.5); }, "the chip was not reported to Rust");
      await p.locator(".sessionBtn").click();
      await until(async () => /2 Claude Code sessions open/.test(await text(p, ".sessionList")), "the list did not open");
      const m2 = await stable(() => center(p));
      assert.ok(Math.abs(m2.cx - m.cx) <= 0.5 && Math.abs(m2.y - m.y) <= 0.5, "the center shifted when the list opened");
      assert.equal(await p.evaluate(() => document.querySelectorAll(".mascot").length), 1, "a single mascot on screen");
      await shot(p, "two-sessions", { x: 240, y: 0, width: 800, height: 150 });
      assert.deepEqual(p.errors, []);
    } finally { await p.close2(); }
  });

  it("notification burst: a single peek, 'N new notifications: apps', Esc removes it", T, async () => {
    const p = await page("by");
    try {
      await until(async () => /6 new notifications: Discord, Outlook…/.test(await text(p, ".islandCenter")), "no burst text", 8000);
      await stable(() => center(p));
      assert.equal(await p.evaluate(() => document.querySelectorAll(".mascot").length <= 1), true);
      await shot(p, "notification-burst", { x: 340, y: 0, width: 600, height: 110 });
      await p.keyboard.press("Escape");
      await until(async () => !/new notifications/.test(await text(p, ".islandCenter")), "Esc did not remove it");
      assert.deepEqual(p.errors, []);
    } finally { await p.close2(); }
  });

  it("error card: sad face (56) and 'Why?' opens the detail; the buttons stay in place", T, async () => {
    const p = await page("hn");
    try {
      await until(() => p.locator("button", { hasText: "Why?" }).count(), "no Why? button", 8000);
      await stable(() => box(".islandInner")(p));
      const btn = await stable(() => box(".buttons .btn.primary")(p));
      const mascot = await box(".islandInner .mascot")(p);
      assert.equal(Math.round(mascot.w), 56, "the mascot in the card must be 56 px: " + mascot.w);
      await p.locator("button", { hasText: "Why?" }).click();
      await until(async () => /Bash failed/.test(await text(p, ".errorDetail")), "the detail did not open");
      const btn2 = await stable(() => box(".buttons .btn.primary")(p));
      assert.ok(Math.abs(btn.y - btn2.y) <= 0.5 && Math.abs(btn.x - btn2.x) <= 0.5, "the button shifted");
      await shot(p, "error-why", { x: 340, y: 0, width: 600, height: 330 });
      assert.deepEqual(p.errors, []);
    } finally { await p.close2(); }
  });
});
