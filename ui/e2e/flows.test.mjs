// Peeka UI end-to-end flow tests (headless Chromium, fake bridge). Run: pnpm e2e
// Principles: clicking never shifts anything else; every card reaches Modules > General in at most 2 steps; uniform sizes; no dead ends; a peek doesn't close under the cursor; one top layer; no overflow at 1366x768.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { boxDiff, frame, layers, open, stable, start, tabRects, until } from "./lib.mjs";

let env;
before(async () => {
  env = await start();
  for (const u of ["/preview.html?state=j", "/island.html?autostart=1", "/index.html"]) { const p = await open(env, u); await p.waitForTimeout(800); await p.close2(); } // warm up Vite's dependency pre-bundling
}, { timeout: 90000 });
after(async () => { await env?.stop(); });

const T = { timeout: 120000 };
const MOD = '[role="tablist"][aria-label="Modules"]';
const P = (d, extra = "") => `/preview.html?state=${d}${extra}`;
/** Opens the page, runs `fn`, and also checks there were no page errors. */
async function on(url, fn, size) {
  const page = await open(env, url, size);
  try { await fn(page); assert.deepEqual(page.errors, [], "page error: " + page.errors.join(" | ")); } finally { await page.close2(); }
}
const goto = async (page, url) => { await page.goto(env.base + url); await page.waitForSelector("#root *"); };

/* ---------------- 1. Clicking never shifts other items ---------------- */
describe("clicking never shifts other items", () => {
  async function noShift(page, bar) {
    const n = (await tabRects(page, bar)).length;
    assert.ok(n > 1, `${bar}: no tabs`);
    const bad = [];
    for (let i = 0; i < n; i++) {
      const before = await stable(() => tabRects(page, bar));
      const clicked = before[i].k;
      await page.locator(`[role="tablist"][aria-label="${bar}"] [role="tab"]`).nth(i).click();
      await frame(page);
      const now = await tabRects(page, bar);
      bad.push(...boxDiff(before, now, clicked).map((d) => `[after clicking ${clicked}, immediately] ${d}`));
      await stable(() => tabRects(page, bar));
      bad.push(...boxDiff(before, await tabRects(page, bar), clicked).map((d) => `[after clicking ${clicked}, settled] ${d}`));
    }
    assert.deepEqual(bad, []);
  }
  for (const [name, url, bar] of [
    ["Modules tabs (preview)", P("j"), "Modules"],
    ["strip pins (preview)", P("a"), "Pinned apps and their open windows"],
    ["strip pins (index.html)", "/index.html", "Pinned apps and their open windows"],
    ["strip window tabs (preview)", P("a"), "Windows on this display"],
    ["strip window tabs (index.html)", "/index.html", "Windows on this display"],
  ]) {
    it(name, T, () => on(url, async (page) => { if (bar === "Modules") await page.waitForSelector(MOD); else await page.waitForSelector(`[role="tablist"][aria-label="${bar}"] [role="tab"]`); await noShift(page, bar); }));
  }
  it("Modules tabs (island.html, card opened by clicking)", T, () => on("/island.html?autostart=1", async (page) => {
    await page.locator(".islandCenter").click();
    await page.waitForSelector(MOD);
    await noShift(page, "Modules");
  }));
  it("app menu: arming the non-closing 'Quit app' (confirm) press doesn't move its neighbours", T, () => on(P("a"), async (page) => {
    await page.locator('[role="tablist"][aria-label^="Pinned apps"] [role="tab"]').first().click({ button: "right" });
    await page.waitForSelector('[role="menu"]');
    const rects = () => page.evaluate(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((e) => { const r = e.getBoundingClientRect(); return { k: e.textContent.trim(), x: r.x, y: r.y, w: r.width, h: r.height }; }));
    const before = await stable(rects);
    const arm = page.locator('[role="menuitem"]', { hasText: "Quit app" });
    await arm.click();
    await frame(page);
    const now = await stable(rects);
    assert.ok(now.length === before.length, "menu item count changed");
    // width excluded: the confirm label is longer so the menu may widen; the top-left corner and height must not move
    assert.deepEqual(boxDiff(before, now, "Quit app", ["x", "y", "h"]), []);
  }));
});

/* ---------------- 2. From every card: Modules > General in at most 2 steps; close with Esc or × ---------------- */
describe("every card reaches Modules > General (at most 2 steps) and closes", () => {
  // Missing element: fail at once (invalid step); otherwise wait for the animation to settle, then click.
  const press = async (loc) => { if (!(await loc.count())) throw new Error("missing"); await loc.first().click({ timeout: 4000 }); };
  const ACT = {
    "Modules button": (p) => press(p.locator("#island [role=dialog] button[aria-label=\"Modules\"]")),
    "General tab": (p) => press(p.locator(`${MOD} [role=tab][aria-label="General"]`)),
    "island center": (p) => press(p.locator(".islandCenter")),
  };
  const names = Object.keys(ACT);
  const generalOpen = async (p, ms) => { try { await p.locator(`${MOD} [role=tab][aria-label="General"][aria-selected=true]`).waitFor({ state: "visible", timeout: ms }); return true; } catch { return false; } };
  const tabCard = (tab) => ({ name: `Modules › ${tab}`, url: P("j"), pre: (p) => p.locator(`${MOD} [role=tab][aria-label="${tab}"]`).click() });
  const CARDS = [
    { name: "music card", url: P("b2") },
    ...["General", "Music", "Clipboard", "Shelf", "Calendar", "Timer", "System", "Notifications", "Compass", "Compass › Claude Code", "Compass › Team"].map(tabCard),
    { name: "clipboard card", url: P("h") }, { name: "shelf card", url: P("g") }, { name: "calendar (meeting) card", url: P("f") },
    { name: "chat (composer) card", url: P("s") }, { name: "chat, reply arrived", url: P("d2") },
    { name: "approval card (low risk)", url: P("c2") }, { name: "approval card (high risk)", url: P("c2r") }, { name: "approval card (with options)", url: P("c3") },
    { name: "strip panel: Notifications", url: P("m") },
  ];
  /** The sequence that reaches General in 0, 1 or 2 steps; null if none. The page is reloaded for every attempt. */
  async function findPath(page, c) {
    const fresh = async () => { await goto(page, c.url); if (c.pre) { await page.waitForSelector(MOD); await c.pre(page); } await ready(page); };
    await fresh();
    if (await generalOpen(page, 400) && (await page.locator("#island [role=dialog]").count())) return [];
    const seqs = [...names.map((a) => [a]), ...names.flatMap((a) => names.map((b) => [a, b]))];
    for (const s of seqs) {
      await fresh();
      try { for (const a of s) { await ACT[a](page); await frame(page); } } catch { continue; }
      if (await generalOpen(page, 1200)) return s;
    }
    return null;
  }
  // the starting card mounts after the fake media/surfaces arrive: acting before it is up tried steps against a half-built page (the flaky "music card")
  const ready = async (p) => { await until(async () => (await layers(p)).length > 0, "starting layer did not open", 5000); await stable(() => layers(p)); await frame(p); };
  const gone = async (p, ms) => { try { await until(async () => !(await layers(p)).length, "layer did not close", ms); return true; } catch { return false; } };
  for (const c of CARDS) {
    it(c.name, T, async () => {
      const page = await open(env, c.url);
      try {
        const path = await findPath(page, c);
        assert.ok(path, `${c.name}: could not reach Modules › General in at most 2 steps (steps tried: ${names.join(", ")})`);
        // closing: Esc (at most 2 presses) and also the visible ×
        await stable(() => layers(page));
        let esc = 0;
        for (; esc < 2; esc++) { await page.keyboard.press("Escape"); if (await gone(page, 1500)) { esc++; break; } }
        assert.ok(!(await layers(page)).length, `a layer is still open after ${esc} Esc with General open: ${(await layers(page)).join()}`);
        await goto(page, c.url);
        if (c.pre) { await page.waitForSelector(MOD); await c.pre(page); }
        await ready(page);
        for (const a of path) { await ACT[a](page); await frame(page); }
        await generalOpen(page, 2000);
        const x = page.locator('#island [role=dialog] button[aria-label="Close"]');
        assert.equal(await x.count(), 1, "no visible × on the General card");
        await x.click();
        assert.ok(await gone(page, 2000), "× did not close the layer");
        assert.deepEqual(page.errors, []);
      } finally { await page.close2(); }
    });
  }
});

/* ---------------- 3. Consistency: tab button and card width ---------------- */
describe("consistency (Modules card)", () => {
  async function perTab(page) {
    await page.waitForSelector(MOD);
    const n = (await tabRects(page, "Modules")).length;
    const rows = [];
    for (let i = 0; i < n; i++) {
      await page.locator(`${MOD} [role=tab]`).nth(i).click();
      const row = await stable(() => page.evaluate((m) => {
        const tabs = [...document.querySelectorAll(`${m} [role=tab]`)].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; });
        return { sel: document.querySelector(`${m} [role=tab][aria-selected=true]`)?.getAttribute("aria-label"), tabs, card: Math.round(document.querySelector('#island [role="dialog"]').getBoundingClientRect().width * 10) / 10 };
      }, MOD));
      rows.push(row);
    }
    return rows;
  }
  it("button size is the same on every tab (and across tabs)", T, () => on(P("j"), async (page) => {
    const rows = await perTab(page);
    const all = rows.flatMap((r) => r.tabs.map((t) => t.join("x")));
    assert.deepEqual([...new Set(all)], [all[0]], "tab button sizes: " + JSON.stringify([...new Set(all)]));
  }));
  it("card width is the same on every tab except General", T, () => on(P("j"), async (page) => {
    const rows = await perTab(page);
    const w = rows.filter((r) => r.sel !== "General").map((r) => `${r.sel}=${r.card}`);
    const set = new Set(w.map((s) => s.split("=")[1]));
    assert.equal(set.size, 1, "card widths: " + w.join(", "));
  }));
});

/* ---------------- 4. No dead ends: clicking a peek opens something ---------------- */
describe("clicking the island while a peek shows opens something", () => {
  const BUMPS = [["b1", "music"], ["e", "volume"], ["u", "alert"], ["sarj", "charging"], ["pil", "low battery"], ["bt", "Bluetooth"], ["zam", "timer"], ["dik", "dictation"], ["tik", "ticket"], ["kay", "recording"], ["f0", "meeting/plugin peek"], ["g0", "shelf drag"], ["h1", "screenshot"], ["c1", "approval (low)"], ["c1r", "approval (high)"], ["q1", "budget alert"], ["q2", "quota alert"], ["d1", "voice: thinking"], ["d3", "voice: speaking"]];
  for (const [d, label] of BUMPS) {
    it(`${d}: ${label}`, T, () => on(P(d), async (page) => {
      await page.waitForSelector("#island .mbump", { timeout: 8000 });
      assert.equal((await layers(page)).length, 0, "a layer is already open while only the peek should show");
      await page.locator(".islandCenter").click();
      const got = await until(async () => { const l = await layers(page); return l.length ? l : null; }, `${d}: clicking the island opened nothing (dead end)`, 2500);
      assert.ok(got.length >= 1);
    }));
  }
});

/* ---------------- 5. A self-closing peek doesn't close under the cursor ---------------- */
describe("the peek stays open while the cursor is on it", () => {
  // each case is a self-closing peek (volume indicator 1.8 s, music 6 s)
  const CASES = [["volume (OSD), preview", P("a"), "osd"], ["volume (OSD), island.html", "/island.html?autostart=1", "osd"], ["music (track changed), island.html", "/island.html?autostart=1", "music"]];
  const fire = (page, kind) => page.evaluate(async (k) => {
    const f = (await import("/src/bridge.fake.ts")).fakeBridge;
    if (k === "osd") f.emit("volume_osd", { percent: 40, muted: false, device: "Speakers" });
    else f.setMedia({ ...(await f.call("get_media")), title: "New track " + Date.now(), playing: true });
  }, kind);
  for (const [name, url, kind] of CASES) {
    it(name, T, async () => {
      const bump = (page) => page.locator("#island .mbump:not(.leaving)");
      // control: without the cursor the peek closes by itself (otherwise the test proves nothing)
      await on(url, async (page) => {
        await page.locator(".islandCenter").waitFor();
        await fire(page, kind);
        await bump(page).waitFor({ state: "visible", timeout: 5000 });
        await bump(page).waitFor({ state: "detached", timeout: 9000 });
      });
      // the point: it stays open while the cursor is on the island center and closes once the cursor leaves
      await on(url, async (page) => {
        await page.locator(".islandCenter").waitFor();
        await fire(page, kind);
        await bump(page).waitFor({ state: "visible", timeout: 5000 });
        const b = await page.locator(".islandCenter").boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        let closed = true;
        try { await bump(page).waitFor({ state: "detached", timeout: 5200 }); } catch { closed = false; }
        assert.equal(closed, false, `${name}: the peek closed while the cursor was on it`);
        await page.mouse.move(b.x + b.width / 2, 600);
        await bump(page).waitFor({ state: "detached", timeout: 9000 });
      });
    });
  }
});

/* ---------------- 6. Opening a panel leaves one top layer; one Esc closes it ---------------- */
describe("opening a panel while a card is open leaves a single layer", () => {
  const CARDS = [["modules", "j"], ["clipboard", "h"], ["shelf", "g"], ["chat", "s"], ["music", "b2"], ["approval", "c2"]];
  const PANELS = ["start", "search", "status", "tray", "calendar"]; // the clock opens Peeka's month calendar (RC4)
  for (const [name, d] of CARDS) {
    for (const k of PANELS) {
      it(`${k} panel while the ${name} card is open`, T, () => on(P(d), async (page) => {
        await page.waitForSelector("#island [role=dialog]");
        await stable(() => layers(page));
        await page.locator(`[data-panel-trigger="${k}"]`).click();
        await until(async () => (await layers(page)).some((l) => l === "panel:" + k), `${k} panel did not open`);
        const l = await until(async () => { const x = await layers(page); return x.length === 1 ? x : null; }, "not a single layer: the card is open together with the panel", 2500).catch(async (e) => { throw new Error(e.message + " -> " + (await layers(page)).join(" + ")); });
        assert.equal(l[0], "panel:" + k);
        await page.keyboard.press("Escape");
        await until(async () => !(await layers(page)).length, "one Esc did not close everything: " + (await layers(page)).join(" + "), 2500);
      }));
    }
  }
});

/* ---------------- 7. No overflow at 1366x768 ---------------- */
describe("1366x768: the panel bottom edge is on screen or scrollable", () => {
  const VIEW = { width: 1366, height: 768 };
  const SURF = [["Start", "w2"], ["Status", "o"], ["Notifications", "m"], ["Hidden icons", "tepsi"], ["Calendar", "takvim"], ["Search", "ara0"], ["Search (with results)", "ara1"], ["Cleanup approval", "mt"], ["Settings Appearance", "ayg"], ["Settings Shortcuts", "ayk"], ["Settings Plugins", "aye"], ["Settings Modules", "aym"], ["Settings Clipboard", "ayp"], ["Settings Mascot", "ays"], ["Quit Peeka", "y"], ["Setup", "kur"],
    ["card: Modules", "j"], ["card: clipboard", "h"], ["card: shelf", "g"], ["card: chat", "s"], ["card: chat with reply", "d2"], ["card: music", "b2"], ["card: approval", "c2"], ["card: approval with options", "c3"], ["card: meeting", "f"], ["card: welcome", "ilk"]];
  const measure = (page) => page.evaluate(() => {
    const el = document.querySelector('[data-panel]:not([aria-hidden="true"])') ?? document.querySelector('#island [role="dialog"]');
    if (!el) return null;
    const vh = innerHeight, r = el.getBoundingClientRect();
    const scrollers = [el, ...el.querySelectorAll("*")].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1 && e.getBoundingClientRect().bottom <= vh + 1);
    return { name: el.getAttribute("aria-label"), bottom: Math.round(r.bottom), vh, scrollable: scrollers.length > 0 };
  });
  for (const [name, d] of SURF) {
    it(`${name}`, T, () => on(P(d), async (page) => {
      await until(measure.bind(null, page), "no open panel/card", 8000);
      const m = await stable(() => measure(page));
      assert.ok(m, "no open panel");
      assert.ok(m.bottom <= m.vh + 1 || m.scrollable, `${m.name}: bottom edge ${m.bottom} > ${m.vh} and not scrollable`);
    }, VIEW));
  }
});

/* ---------------- 8. Real pages: smoke test ---------------- */
describe("real pages (fake bridge)", () => {
  it("island.html: the island center opens Modules, Esc closes it", T, () => on("/island.html?autostart=1", async (page) => {
    await page.locator(".islandCenter").click();
    await page.waitForSelector(`${MOD} [role=tab][aria-selected=true]`);
    await page.keyboard.press("Escape");
    await until(async () => !(await layers(page)).length, "Esc did not close the card", 2500);
  }));
  it("index.html: the Start panel opens, Esc closes it", T, () => on("/index.html", async (page) => {
    await page.locator('[data-panel-trigger="start"]').click();
    await until(async () => (await layers(page)).includes("panel:start"), "Start did not open");
    await page.keyboard.press("Escape");
    await until(async () => !(await layers(page)).length, "Esc did not close the panel", 2500);
  }));
});

/* ---------------- "Quit Peeka" in the Status panel (owner decision 2026-10-17): opens the quit confirmation ---------------- */
describe("Status panel: Quit Peeka", () => {
  it("the row is the same size as its neighbours, doesn't shift on hover, and opens the quit confirmation on click", T, () => on(P("o"), async (page) => {
    const btn = page.getByRole("button", { name: "Quit Peeka" });
    await btn.waitFor();
    const rows = () => page.evaluate(() => {
      const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
      const own = document.querySelector('[aria-label="Quit Peeka"]').closest(".row");
      const sibs = [...document.querySelectorAll('[data-panel="status"] .list .row')].filter((e) => e !== own);
      return { own: box(own), sibs: sibs.map(box), btn: box(document.querySelector('[aria-label="Quit Peeka"]')) };
    });
    const before = await stable(rows);
    assert.ok(before.sibs.length > 0, "no neighbouring rows");
    assert.ok(before.sibs.every((s) => Math.abs(s.h - before.own.h) <= 1 && Math.abs(s.w - before.own.w) <= 1), `row size differs from its neighbours: ${JSON.stringify(before)}`);
    const panelBottom = await page.evaluate(() => document.querySelector('[data-panel="status"]').getBoundingClientRect().bottom);
    assert.ok(before.own.y + before.own.h <= panelBottom + 1 && before.sibs.every((s) => s.y < before.own.y), "the row must be at the bottom of the panel");
    await btn.hover();
    await frame(page);
    assert.deepEqual((await stable(rows)).btn, before.btn, "the button shifted on hover");
    await btn.click();
    await until(async () => (await layers(page)).includes("panel:quit"), "the quit confirmation did not open");
    await page.getByText("Quit Peeka?").waitFor();
  }));
});
