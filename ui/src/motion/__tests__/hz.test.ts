import { describe, expect, it } from "vitest";
import { createFlight } from "../flight";
import { createShape } from "../shape";
import { advance, Spring, SPRINGS } from "../spring";

const DTS = [1 / 60, 1 / 144, 1 / 240];
const boxAt = (left: number, top: number, w: number, h: number) =>
  ({ left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON() {} }) as DOMRect;

/** Kare kare ilerlet; durgunlaşma süresini (sn) ve ara değer örneğini döndürür. */
function settle(step: (dt: number) => boolean, dt: number, probeAt = 0.25, probe: () => number = () => 0) {
  let t = 0, at = 0, n = 0;
  const probeN = Math.round(probeAt / dt); // 0,25 sn: 15 / 36 / 60 kare, üç Hz'de aynı an
  while (t < 5) {
    const moving = step(dt);
    t += dt;
    if (++n === probeN) at = probe();
    if (!moving) break;
  }
  return { t, at };
}
const within = (times: number[]) => Math.max(...times) - Math.min(...times);

describe("yüksek Hz: aynı hareket", () => {
  it("Spring: durgunlaşma süresi 1/60, 1/144, 1/240'ta ~1 kare içinde aynı ve uç değer aynı", () => {
    for (const p of [SPRINGS.card, SPRINGS.pill, SPRINGS.press, SPRINGS.line]) {
      const r = DTS.map((dt) => {
        const s = new Spring(0, p);
        s.retarget(100);
        const o = settle((d) => (advance(s, d), !s.settled), dt, 0.25, () => s.x);
        return { ...o, end: s.x };
      });
      expect(within(r.map((x) => x.t))).toBeLessThanOrEqual(1 / 60 + 0.02);
      r.forEach((x) => expect(x.end).toBe(100));
      expect(within(r.map((x) => x.at))).toBeLessThan(1.5); // 0,25 sn'deki konum (0..100) aynı an örneklenir, ≤%1,5 fark
    }
  });

  it("Spring: 1/30'dan uzun kare kırpılır, 1/240 kararlı (patlamaz)", () => {
    for (const dt of [1 / 30, 1 / 240, 0.2]) {
      const s = new Spring(0, SPRINGS.press);
      s.retarget(100);
      for (let i = 0; i < 600; i++) advance(s, dt);
      expect(s.x).toBe(100);
    }
  });

  it("Shape: aynı durgunlaşma süresi, aynı son dikdörtgen", () => {
    const r = DTS.map((dt) => {
      const host = document.createElement("div"), body = document.createElement("div");
      host.getBoundingClientRect = () => boxAt(0, 0, 600, 300);
      const sh = createShape(host, body, { maxW: 600, maxH: 300 });
      sh.to(560, 240);
      const o = settle((d) => sh.advance(d), dt, 0.25, () => sh.rect().h);
      return { ...o, rect: sh.rect() };
    });
    expect(within(r.map((x) => x.t))).toBeLessThanOrEqual(1 / 60 + 0.02);
    r.forEach((x) => expect(x.rect).toEqual({ x: 20, y: 0, w: 560, h: 240 }));
    expect(within(r.map((x) => x.at))).toBeLessThan(3.6); // 0,25 sn'de yükseklik (0..240), ≤%1,5 fark
  });

  it("Flight: aynı durgunlaşma süresi, dönüşüm temizlenir", () => {
    const r = DTS.map((dt) => {
      document.body.innerHTML = `<div id="a" data-paylas="t"></div>`;
      const el = document.getElementById("a")!;
      let pos = { left: 10, top: 5, height: 20 };
      el.getBoundingClientRect = () => boxAt(pos.left, pos.top, 50, pos.height);
      const fl = createFlight(document);
      fl.capture();
      pos = { left: 200, top: 100, height: 40 };
      fl.play();
      const o = settle((d) => fl.advance(d), dt);
      fl.advance(dt);
      return { ...o, tr: el.style.transform };
    });
    expect(within(r.map((x) => x.t))).toBeLessThanOrEqual(1 / 60 + 0.02);
    r.forEach((x) => expect(x.tr).toBe(""));
  });
});
