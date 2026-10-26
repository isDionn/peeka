// RC4 real-PC bugs, page side (headless, fake clock, frame by frame):
// - no light line in rows 28..33 beside the card while the island opens / closes (guards the CSS layers only: the real-PC line came from the strip's window region, which is gone);
// - the corner of the last moving frame equals the resting corner (no snap when the motion ends), island card and Start panel, DPR 1 and 1.5;
// - the whole hover peek opens the card; a tab clicked while the card is still opening switches; 10 fast toggles leave one whole ghost in place;
// - the strip just outside the card's top corners matches the card's top edge, with the default colour and with a red / blue screen tint.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { start } from "./lib.mjs";

let env;
before(async () => { env = await start(); }, { timeout: 90000 });
after(async () => { await env?.stop(); });
const T = { timeout: 180000 };

async function page(url, size, dpr = 1, round = false) {
  const ctx = await env.browser.newContext({ viewport: size, deviceScaleFactor: dpr });
  const p = await ctx.newPage();
  // a WebView without `corner-shape` (round corners): CSS says no, and every corner-shape is forced back to round
  if (round) await p.addInitScript(() => { const s = CSS.supports.bind(CSS); CSS.supports = (...a) => (String(a[0]).includes("corner-shape") ? false : s(...a)); });
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(String(e)));
  await p.clock.install();
  await p.goto(env.base + url);
  await p.clock.runFor(3000);
  const dec = await ctx.newPage();
  /** RGBA bytes of a screenshot (decoded in a blank page: no image library needed). */
  p.pixels = async (clip, omitBackground = false) => {
    const buf = await p.screenshot({ clip, omitBackground });
    return dec.evaluate(async (b64) => { const im = new Image(); im.src = "data:image/png;base64," + b64; await im.decode(); const c = new OffscreenCanvas(im.width, im.height); const g = c.getContext("2d"); g.drawImage(im, 0, 0); return { w: im.width, h: im.height, d: [...g.getImageData(0, 0, im.width, im.height).data] }; }, buf.toString("base64"));
  };
  p.close2 = () => ctx.close();
  return p;
}
const FULL = { width: 1920, height: 700 };
const tabs = (p) => p.evaluate(() => [...document.querySelectorAll('#island [role="tab"]')].map((e) => { const r = e.getBoundingClientRect(); return { k: e.getAttribute("aria-label"), on: e.getAttribute("aria-selected") === "true", x: r.left + r.width / 2, y: r.top + r.height / 2 }; }));
const islandBox = (p) => p.evaluate(() => { const r = document.querySelector("#island").getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; });

describe("island motion (RC4 real-PC bugs)", () => {
  it("no light line beside the card in rows 28..33 while it opens and closes (DPR 1, 1.25, 1.5)", T, async () => {
    for (const dpr of [1, 1.25, 1.5]) {
      const p = await page("/island.html", { width: 760, height: 620 }, dpr);
      try {
        for (const step of ["open", "close"]) {
          await p.mouse.click(380, 15);
          for (let f = 0; f < 40; f++) {
            await p.clock.runFor(16);
            const card = await islandBox(p);
            const px = await p.pixels({ x: 0, y: 28, width: 760, height: 6 }, true);
            for (let y = 0; y < px.h; y++) {
              let n = 0;
              for (let x = 0; x < px.w; x++) {
                if (x / dpr > card.l - 16 && x / dpr < card.r + 16) continue;
                const o = (y * px.w + x) * 4, a = px.d[o + 3];
                if (a > 24 && ((px.d[o] + px.d[o + 1] + px.d[o + 2]) / 3) * a / 255 > 40) n++;
              }
              assert.ok(n <= 20, `DPR ${dpr} ${step} frame ${f}: ${n} light pixels at y=${(28 + y / dpr).toFixed(2)}`);
            }
          }
          await p.clock.runFor(2000);
        }
        assert.deepEqual(p.errors, []);
      } finally { await p.close2(); }
    }
  });

  it("the last moving frame's corner equals the resting corner (island card, Start panel; DPR 1 and 1.5; with and without corner-shape)", T, async () => {
    for (const round of [false, true]) for (const dpr of [1, 1.5]) for (const [which, x] of [["#island > .cut", 960], ['[data-panel="start"] > .cut', 20]]) {
      const p = await page("/preview.html?state=a", FULL, dpr, round);
      try {
        // the glow drifts between frames; only the shape is compared
        await p.addStyleTag({ content: ".glowHost, .glowSlice { display: none }" + (round ? " * { corner-shape: round !important }" : "") });
        await p.mouse.click(x, 15);
        let prev = null, last = null, same = 0, clip = null;
        for (let f = 0; f < 200 && same < 3; f++) {
          await p.clock.runFor(16);
          const s = await p.evaluate((sel) => { const c = document.querySelector(sel); const r = c.closest(".dangling").getBoundingClientRect(); return { clip: c.style.clipPath, r: [r.left, r.top, r.width, r.height] }; }, which);
          if (s.clip === prev) { same++; continue; }
          same = 0; prev = s.clip;
          clip = { x: Math.floor(s.r[0]), y: Math.floor(s.r[1] + s.r[3] - 40), width: 44, height: 44 };
          if (s.clip) last = await p.pixels(clip); // the latest frame whose shape still moved (an empty clip = the old code's resting frame)
        }
        await p.clock.runFor(1500);
        const rest = await p.pixels(clip);
        assert.ok(last, `${which}: never moved`);
        let max = 0;
        // only the 16 px padding band along the left and bottom edges (where the corner curve is), not the card's content
        for (let i = 0; i < rest.d.length; i += 4) { const x = (i / 4) % rest.w / dpr, y = Math.floor(i / 4 / rest.w) / dpr; if (x >= 16 && y < 28) continue; for (let k = 0; k < 3; k++) max = Math.max(max, Math.abs(rest.d[i + k] - last.d[i + k])); }
        // 3 levels: the last moving frame is still a fraction of a px from the target (measured 2); the old code (clip dropped at rest) gave 4 on round corners over this dark backdrop
        assert.ok(max <= 3, `${which} DPR ${dpr}${round ? " round corners" : ""}: the corner changed by ${max} levels when the motion ended`);
      } finally { await p.close2(); }
    }
  });

  it("the whole hover peek opens the card, not only its handle; the peek is in a clickable rect", T, async () => {
    const p = await page("/preview.html?state=a", FULL);
    try {
      // no music: since RC7 a hover with music playing shows the music controls (a 38 px bump), not this plain hover peek
      await p.evaluate(() => window.fakeBridge.setMedia(null));
      await p.mouse.move(960, 15);
      await p.clock.runFor(800);
      const b = await islandBox(p);
      assert.ok(b.h > 10 && b.h < 20, "no hover peek: " + JSON.stringify(b));
      const at = { x: b.l + 30, y: b.t + b.h / 2 }; // far from the 44 px handle in the middle
      const inHit = await p.evaluate(({ x, y }) => [...document.querySelectorAll("[data-hit]")].some((e) => { const r = e.getBoundingClientRect(); return x >= r.left && x < r.right && y >= r.top && y < r.bottom; }), at);
      assert.ok(inHit, "the hover peek is not in a clickable rect");
      await p.mouse.move(at.x, at.y);
      await p.clock.runFor(50);
      await p.mouse.click(at.x, at.y);
      await p.clock.runFor(1500);
      assert.ok((await tabs(p)).length > 0, "clicking the peek's side did not open the card");
    } finally { await p.close2(); }
  });

  it("a tab clicked while the card is still opening switches, and the card ends at that tab's size", T, async () => {
    const p = await page("/preview.html?state=a", FULL);
    try {
      await p.mouse.click(960, 15);
      await p.clock.runFor(64);
      const t = (await tabs(p)).find((x) => x.k === "Music");
      assert.ok(t, "no Music tab 64 ms into the open");
      await p.mouse.click(t.x, t.y);
      await p.clock.runFor(16);
      assert.ok((await tabs(p)).find((x) => x.k === "Music").on, "the tab did not switch during the open animation");
      await p.clock.runFor(2500);
      const end = await islandBox(p);
      const settled = await p.evaluate(() => { const i = document.querySelector('#island [role="dialog"]').getBoundingClientRect(); return { w: i.width }; });
      assert.ok(Math.abs(end.w - settled.w) <= 1, `the card did not end at the Music tab's width: box ${end.w}, content ${settled.w}`);
    } finally { await p.close2(); }
  });

  it("10 fast toggles: one ghost, whole, back in its place", T, async () => {
    const p = await page("/preview.html?state=a", FULL);
    const ghosts = () => p.evaluate(() => [...document.querySelectorAll(".islandWindow .mascot")].map((m) => { const r = (m.querySelector(".g") ?? m).getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), vis: getComputedStyle(m).visibility }; }));
    try {
      await p.evaluate(() => window.fakeBridge.setMedia(null)); // with music, the pointer left on the island would show the music hover peek (its 24 px ghost)
      await p.clock.runFor(1000);
      const before = await ghosts();
      assert.equal(before.length, 1);
      for (let i = 0; i < 10; i++) { await p.mouse.click(960, 15); await p.clock.runFor(50); }
      await p.clock.runFor(4000);
      assert.deepEqual(await ghosts(), before);
      assert.deepEqual(p.errors, []);
    } finally { await p.close2(); }
  });

  it("the strip beside the card's top corners matches the card's top edge (default colour, red / blue tint)", T, async () => {
    for (const tint of [null, ["#c81e1e", "#c81e1e", "#c81e1e"], ["#1e3cc8", "#1e3cc8", "#1e3cc8"]]) {
      const p = await page("/preview.html?state=a", FULL);
      try {
        if (tint) await p.evaluate((c) => { for (const monitor of ["m1", "island"]) window.fakeBridge.emit("screen_tint", { monitor, colors: c }); }, tint);
        await p.mouse.click(960, 15);
        await p.clock.runFor(4000); // the tint cross-fade is 2.5 s
        const b = await islandBox(p);
        const px = await p.pixels({ x: 0, y: 0, width: 1920, height: 60 });
        const at = (x, y) => { const o = (y * px.w + Math.round(x)) * 4; return [px.d[o], px.d[o + 1], px.d[o + 2]]; };
        for (const [strip, card] of [[at(b.l - 24, 22), at(b.l + 24, 33)], [at(b.r + 24, 22), at(b.r - 24, 33)]]) {
          const d = Math.max(...strip.map((v, k) => Math.abs(v - card[k])));
          assert.ok(d <= 14, `tint ${tint?.[0] ?? "default"}: strip ${strip} vs card top ${card} differ by ${d}`);
        }
      } finally { await p.close2(); }
    }
  });
  it("RC7: the opening card's clickable rect reaches Rust from its first frames, tab bar included (not only after the spring ends)", T, async () => {
    const p = await page("/preview.html?state=a", FULL);
    try {
      await p.evaluate(() => { const o = window.fakeBridge.call; window.fakeBridge.call = (c, a) => { if (c === "report_hit_rects") window.__rects = a.rects; return o.call(window.fakeBridge, c, a); }; });
      await p.mouse.click(960, 15);
      for (let f = 0; f < 50; f++) {
        await p.clock.runFor(16);
        if (f < 2) continue; // one frame for the card to mount, one for the report
        const out = await p.evaluate(() => {
          const rects = (window.__rects ?? []).filter((r) => !r.paint);
          return [...document.querySelectorAll('#island [role="tab"]')].filter((e) => {
            const b = e.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
            return !rects.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
          }).map((e) => e.getAttribute("aria-label"));
        });
        assert.deepEqual(out, [], `frame ${f}: tabs outside every clickable rect sent to Rust`);
      }
    } finally { await p.close2(); }
  });

  it("RC7: a strip panel's glow has the screen colour in its first frames (no purple fallback that fades over)", T, async () => {
    const p = await page("/preview.html?state=a", FULL);
    try {
      await p.addStyleTag({ content: '[data-panel="start"] .inner { visibility: hidden }' }); // only the surface and the glow are sampled
      await p.evaluate(() => { for (const monitor of ["m1", "island"]) window.fakeBridge.emit("screen_tint", { monitor, colors: ["#e01010", "#e01010", "#e01010"] }); });
      await p.clock.runFor(100);
      /** Mean red minus blue inside the Start panel, under the strip. */
      const redness = async () => { const px = await p.pixels({ x: 40, y: 34, width: 240, height: 14 }); let s = 0; for (let i = 0; i < px.d.length; i += 4) s += px.d[i] - px.d[i + 2]; return s / (px.d.length / 4); };
      await p.mouse.click(20, 15);
      await p.clock.runFor(48);
      const first = await redness();
      await p.clock.runFor(4000); // past any cross-fade (2.5 s)
      const settled = await redness();
      assert.ok(settled > 4, `settled panel is not red-tinted (${settled.toFixed(1)})`);
      assert.ok(first > settled * 0.5, `first frames ${first.toFixed(1)} vs settled ${settled.toFixed(1)}: the panel opened in another colour`);
    } finally { await p.close2(); }
  });
});
