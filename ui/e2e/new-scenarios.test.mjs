// Scenarios 1, 6, 24, 28, 38 and the blurred password: measured in a real browser + screenshots (screenshots/). Nothing shifts on hover.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { open, start, stable, until } from "./lib.mjs";

let env;
before(async () => { env = await start(); const p = await open(env, "/preview.html?state=k1"); await p.waitForTimeout(800); await p.close2(); mkdirSync("screenshots", { recursive: true }); }, { timeout: 90000 });
after(async () => { await env?.stop(); });
const T = { timeout: 120000 };
const SIZE = { width: 1280, height: 520 };
const box = (sel) => (p) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
const island = box("#island"), top = box(".shotTop");
/** Crops around the island + center (with a margin). */
async function snap(p, name) {
  const a = await stable(() => island(p));
  await p.screenshot({ path: `screenshots/${name}.png`, clip: { x: Math.max(0, a.x - 40), y: 0, width: Math.min(SIZE.width, a.w + 80), height: Math.ceil(a.y + a.h + 30) } });
}

describe("copy strip", () => {
  it("image: small peek; on hover it grows downward only; the top row stays in place", T, async () => {
    const p = await open(env, "/preview.html?state=k1", SIZE);
    try {
      await until(() => top(p), "no strip", 8000);
      const a0 = await stable(() => island(p)), u0 = await stable(() => top(p));
      assert.equal(await p.evaluate(() => document.querySelectorAll(".shotLarge").length), 0);
      await snap(p, "copy-strip");
      await p.mouse.move(a0.x + a0.w / 2, a0.y + a0.h / 2);
      await until(() => p.evaluate(() => document.querySelectorAll(".shotLarge").length), "the large preview did not appear", 4000);
      const a1 = await stable(() => island(p)), u1 = await stable(() => top(p));
      assert.ok(a1.h > a0.h + 100, `did not grow downward: ${a0.h} -> ${a1.h}`);
      assert.ok(Math.abs(a1.y - a0.y) <= 0.5 && Math.abs(a1.x - a0.x) <= 0.5 && Math.abs(a1.w - a0.w) <= 0.5, "the island shifted from the top/side");
      assert.ok(Math.abs(u1.x - u0.x) <= 0.5 && Math.abs(u1.y - u0.y) <= 0.5, `the top row shifted ${JSON.stringify([u0, u1])}`);
      assert.equal(await p.evaluate(() => document.querySelectorAll(".mascot").length), 1, "ekranda tek maskot");
      await snap(p, "copy-strip-large");
      await p.mouse.move(5, 480); // shrinks when the cursor leaves
      await until(async () => !(await p.evaluate(() => document.querySelectorAll(".shotLarge").length)), "did not shrink", 4000);
      assert.deepEqual(p.errors, []);
    } finally { await p.close2(); }
  });
  it("file and link: same peek, doesn't grow", T, async () => {
    for (const d of ["k2", "k3"]) {
      const p = await open(env, `/preview.html?state=${d}`, SIZE);
      try {
        await until(() => top(p), d + " no strip", 8000);
        const a0 = await stable(() => island(p));
        await p.mouse.move(a0.x + a0.w / 2, a0.y + a0.h / 2);
        await p.waitForTimeout(500);
        const a1 = await stable(() => island(p));
        assert.ok(Math.abs(a1.h - a0.h) <= 0.5 && a1.w === a0.w, d + " grew");
        assert.equal(await p.evaluate(() => document.querySelectorAll(".shotLarge").length), 0);
      } finally { await p.close2(); }
    }
  });
});

describe("timer, network, summary", () => {
  it("Time's up card: Close and +5 min, no sound", T, async () => {
    const p = await open(env, "/preview.html?state=sd", SIZE);
    try {
      await until(() => p.evaluate(() => /Time's up/.test(document.querySelector(".islandCenter")?.textContent ?? "")), "no card", 8000);
      const t = await p.evaluate(() => [...document.querySelectorAll(".peekBar button")].map((b) => b.textContent));
      assert.deepEqual(t, ["+5 min", "Close"]);
      assert.equal(await p.evaluate(() => document.querySelectorAll("audio").length), 0);
      await snap(p, "time-up");
    } finally { await p.close2(); }
  });
  it("last 60 s: the counter on the main strip, music in the bubble", T, async () => {
    const p = await open(env, "/preview.html?state=zs", SIZE);
    try {
      await until(() => p.evaluate(() => /0:[34]\d/.test(document.querySelector(".islandCenter")?.textContent ?? "")), "the counter is not on the main strip", 8000);
      assert.match(await p.evaluate(() => document.querySelector(".sideBtn")?.getAttribute("aria-label") ?? ""), /Playing/);
    } finally { await p.close2(); }
  });
  it("Connection lost peek", T, async () => {
    const p = await open(env, "/preview.html?state=ag", SIZE);
    try {
      await until(() => p.evaluate(() => /Connection lost/.test(document.querySelector(".islandCenter")?.textContent ?? "")), "no peek", 8000);
      await snap(p, "connection-lost");
    } finally { await p.close2(); }
  });
  it("While-you-were-away summary", T, async () => {
    const p = await open(env, "/preview.html?state=sy", SIZE);
    try {
      await until(() => p.evaluate(() => /While you were away: 3 notifications, 1 approval, 2 jobs done/.test(document.querySelector(".peekBar")?.textContent ?? "")), "no summary", 8000);
      await snap(p, "while-away");
    } finally { await p.close2(); }
  });
});

describe("password row", () => {
  it("blurred placeholder; the row box stays the same on hover", T, async () => {
    const p = await open(env, "/preview.html?state=h3", SIZE);
    try {
      await until(() => p.evaluate(() => !!document.querySelector('[data-clip="c6"]')), "no password row", 10000);
      const row = box('[data-clip="c6"]');
      const r0 = await stable(() => row(p));
      assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('[data-clip="c6"] .text')).filter), "blur(5px)");
      assert.ok(!(await p.evaluate(() => document.body.innerHTML.includes("Kd9!mPq2-zR7v"))), "plain text in the DOM while not hovering");
      const card = box('#island [role="dialog"]');
      const c = await stable(() => card(p));
      await p.screenshot({ path: "screenshots/password-blurred.png", clip: { x: c.x, y: c.y, width: c.w, height: Math.min(c.h, SIZE.height - c.y) } });
      await p.mouse.move(r0.x + r0.w / 2, r0.y + r0.h / 2);
      await until(() => p.evaluate(() => document.body.innerHTML.includes("Kd9!mPq2-zR7v")), "did not reveal on hover", 4000);
      const r1 = await stable(() => row(p));
      assert.ok(["x", "y", "w", "h"].every((k) => Math.abs(r0[k] - r1[k]) <= 0.5), `row box shifted ${JSON.stringify([r0, r1])}`);
      await p.mouse.move(5, 5);
      await until(async () => !(await p.evaluate(() => document.body.innerHTML.includes("Kd9!mPq2-zR7v"))), "not wiped when the cursor left", 3000);
    } finally { await p.close2(); }
  });
});
