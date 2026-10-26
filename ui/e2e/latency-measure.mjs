// Panel latency (headless, preview page, Vite dev build): input -> first frame the panel is visible (shape engine
// started) and -> settled height, for the Start click, a lone Win tap (Rust `shortcut` start, faked) and the Hidden
// icons arrow. The fake bridge answers at once; [delayMs] makes the data calls (tray_icons, list_apps...) that slow.
// Not a test: `node e2e/latency-measure.mjs [delayMs]`. Rust hook -> emit: crates/notch-win/examples/winkey_timing.rs.
// 2026-10-26, delay 200: Start ~52 ms (dev React; ~15 ms of it is the panel's forced layout), Win tap ~55-60 ms,
// tray ~26 ms full size (before the warm cache: 152 px header first, full 234 px at ~260 ms).
import { start, open } from "./lib.mjs";
const env = await start();
const delay = process.argv[2] ?? "0";
const out = {};
try {
  for (const [name, kind, how] of [["start-click", "start", "click"], ["start-winkey", "start", "key"], ["tray-click", "tray", "click"]]) {
    const runs = [];
    for (let i = 0; i < 6; i++) {
      const page = await open(env, `/preview.html`);
      await page.waitForSelector(`[data-panel-trigger="${kind}"]`);
      await page.waitForTimeout(400);
      // a Rust that takes `delay` ms per data call from now on (the strip already loaded at mount)
      if (+delay) await page.evaluate((d) => { const fb = window.fakeBridge, c = fb.call.bind(fb); fb.call = async (n, a) => { if (["tray_icons", "list_apps", "recent_files", "start_pins"].includes(n)) await new Promise((r) => setTimeout(r, d)); return c(n, a); }; }, +delay);
      const r = await page.evaluate(([kind, how]) => new Promise((done) => {
        const host = document.querySelector(`[data-panel="${kind}"]`);
        const hit = () => host.querySelector("[data-hit]")?.getBoundingClientRect().height ?? 0;
        let t0 = 0, first = 0, lastH = -1, same = 0, firstH = 0;
        const loop = () => {
          const t = performance.now();
          const vis = getComputedStyle(host).visibility === "visible" && host.querySelector(".cut").style.clipPath !== "";
          if (vis && !first) { first = t - t0; firstH = hit(); }
          const h = hit();
          same = h === lastH && first ? same + 1 : 0; lastH = h;
          if (same > 20 || t - t0 > 3000) return done({ first: +first.toFixed(1), settled: +(t - t0 - 20 * 16.7).toFixed(0), firstH: Math.round(firstH), finalH: Math.round(h) });
          requestAnimationFrame(loop);
        };
        t0 = performance.now();
        if (how === "click") document.querySelector(`[data-panel-trigger="${kind}"]`).click();
        else window.fakeBridge.emit("shortcut", { name: "start", monitor: "m1" });
        requestAnimationFrame(loop);
      }), [kind, how]);
      runs.push(r);
      await page.close2();
    }
    out[name] = runs;
  }
} finally { await env.stop(); }
console.log(JSON.stringify(out, null, 1));
