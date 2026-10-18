import { describe, expect, it } from "vitest";
import { createFlight } from "../flight";
import { createShape } from "../shape";
import { advance, Spring, SPRINGS } from "../spring";

const DTS = [1 / 60, 1 / 144, 1 / 240];
const boxAt = (left: number, top: number, w: number, h: number) =>
  ({ left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON() {} }) as DOMRect;

/** Advance frame by frame; returns the settle time (s) and a sample of the intermediate value. */
function settle(step: (dt: number) => boolean, dt: number, probeAt = 0.25, probe: () => number = () => 0) {
  let t = 0, at = 0, n = 0;
  const probeN = Math.round(probeAt / dt); // 0.25 s: frame 15 / 36 / 60, the same instant at all three Hz
  while (t < 5) {
    const moving = step(dt);
    t += dt;
    if (++n === probeN) at = probe();
    if (!moving) break;
  }
  return { t, at };
}
const within = (times: number[]) => Math.max(...times) - Math.min(...times);

describe("high Hz: the same motion", () => {
  it("Spring: settle time is the same within ~1 frame at 1/60, 1/144, 1/240, and the end value is the same", () => {
    for (const p of [SPRINGS.card, SPRINGS.pill, SPRINGS.press, SPRINGS.line]) {
      const r = DTS.map((dt) => {
        const s = new Spring(0, p);
        s.retarget(100);
        const o = settle((d) => (advance(s, d), !s.settled), dt, 0.25, () => s.x);
        return { ...o, end: s.x };
      });
      expect(within(r.map((x) => x.t))).toBeLessThanOrEqual(1 / 60 + 0.02);
      r.forEach((x) => expect(x.end).toBe(100));
      expect(within(r.map((x) => x.at))).toBeLessThan(1.5); // position at 0.25 s (0..100) is sampled at the same instant, ≤1.5% difference
    }
  });

  it("Spring: a frame longer than 1/30 is clamped, 1/240 is stable (doesn't blow up)", () => {
    for (const dt of [1 / 30, 1 / 240, 0.2]) {
      const s = new Spring(0, SPRINGS.press);
      s.retarget(100);
      for (let i = 0; i < 600; i++) advance(s, dt);
      expect(s.x).toBe(100);
    }
  });

  it("Shape: same settle time, same final rectangle", () => {
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
    expect(within(r.map((x) => x.at))).toBeLessThan(3.6); // height at 0.25 s (0..240), ≤1.5% difference
  });

  it("Flight: same settle time, the transform is cleared", () => {
    const r = DTS.map((dt) => {
      document.body.innerHTML = `<div id="a" data-share="t"></div>`;
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
