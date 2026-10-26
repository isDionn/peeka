import { describe, expect, it } from "vitest";
import { createFlight } from "../flight";
import { bodyPath, createShape, type Shape, type ShapeState } from "../shape";
import { advance, Spring, SPRINGS } from "../spring";

const run = (s: Spring, sec: number, dt = 1 / 60) => { for (let t = 0; t < sec; t += dt) advance(s, dt); };

describe("Spring", () => {
  it("converges on the target and settles", () => {
    const s = new Spring(0, SPRINGS.card);
    s.retarget(100);
    run(s, 3);
    expect(s.settled).toBe(true);
    s.snap();
    expect(s.x).toBe(100);
    expect(s.v).toBe(0);
  });

  it("overshoots slightly at damping 0.78, doesn't at damping 1", () => {
    const a = new Spring(0, SPRINGS.card), b = new Spring(0, { response: 0.44, damping: 1 });
    a.retarget(100); b.retarget(100);
    let ma = 0, mb = 0;
    for (let t = 0; t < 2; t += 1 / 120) { advance(a, 1 / 120); advance(b, 1 / 120); ma = Math.max(ma, a.x); mb = Math.max(mb, b.x); }
    expect(ma).toBeGreaterThan(100.5);
    expect(mb).toBeLessThanOrEqual(100.01);
  });

  it("position and velocity are kept when the target changes mid-motion (no jump)", () => {
    const s = new Spring(0, SPRINGS.card);
    s.retarget(100);
    run(s, 0.15);
    const x = s.x, v = s.v;
    expect(v).toBeGreaterThan(50);
    s.retarget(0);
    expect(s.x).toBe(x);
    expect(s.v).toBe(v);
    advance(s, 1 / 240);
    expect(Math.abs(s.x - x)).toBeLessThan(v / 240 + 1); // carries on with its velocity, doesn't skip
    run(s, 3);
    expect(s.settled).toBe(true);
    expect(Math.abs(s.x)).toBeLessThan(0.05);
  });

  it("on reversal the velocity isn't zeroed at once: it first carries forward, then turns back", () => {
    const s = new Spring(0, SPRINGS.card);
    s.retarget(100);
    run(s, 0.1);
    const x0 = s.x;
    s.retarget(0);
    run(s, 0.03);
    expect(s.x).toBeGreaterThan(x0); // momentum
  });
});

const boxAt = (left: number, top: number, w: number, h: number) =>
  ({ left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON() {} }) as DOMRect;

describe("createShape", () => {
  const setup = (anchor?: "center" | "left" | "right") => {
    const host = document.createElement("div"), body = document.createElement("div");
    const boxes: [number, number, boolean][] = [], states: ShapeState[] = [];
    const sh = createShape(host, body, { anchor, onBox: (w, h, m) => boxes.push([w, h, m]), layers: [(st) => states.push(st)] });
    return { host, body, sh, boxes, states };
  };
  const run = (sh: Shape) => { let n = 0; while (sh.advance(1 / 60) && n++ < 600); return n; };

  it("at rest: the width follows without motion, the host is hidden, no clip", () => {
    const { host, body, sh, boxes } = setup();
    sh.to(200, 0);
    expect(sh.moving).toBe(false);
    expect(host.style.width).toBe("200px");
    expect(host.style.visibility).toBe("hidden");
    expect(body.style.clipPath).toBe("");
    expect(boxes.at(-1)).toEqual([200, 0, false]);
  });

  it("growing: the box jumps to the target at once (one layout), every frame only moves the clip; at the end the clip stays the same path (no corner snap) and the corner var is set", () => {
    const { host, body, sh, boxes, states } = setup();
    sh.to(200, 0);
    sh.to(520, 120);
    expect(host.style.width).toBe("520px");
    expect(host.style.height).toBe("120px");
    expect(host.style.getPropertyValue("--r")).toBe("34px");
    expect(host.style.getPropertyValue("--f")).toBe("12px"); // fillet = min(12, 0.6 r)
    const n0 = boxes.length;
    sh.advance(1 / 60);
    expect(body.style.clipPath).toMatch(/^path\("M/);
    run(sh);
    expect(boxes.length - n0).toBe(1); // only the "stopped" notice, not one per frame
    expect(boxes.at(-1)).toEqual([520, 120, false]);
    expect(body.style.clipPath).toBe(bodyPath(0, 520, 120, 34));
    // centered: every frame's body sits in the middle of the box
    for (const st of states) if (st.w) expect(Math.abs(st.offsetX + st.w / 2 - st.bw / 2)).toBeLessThan(0.01);
    expect(states.at(-1)).toMatchObject({ w: 520, h: 120, moving: false });
  });

  it("shrinking: the box keeps the old size until the spring ends (clicks aren't lost), then takes the target; no overshoot on the way down", () => {
    const { host, sh } = setup();
    sh.snap(520, 300);
    sh.to(300, 44);
    let min = Infinity;
    for (let i = 0; i < 10; i++) sh.advance(1 / 60);
    expect(host.style.height).toBe("300px");
    while (sh.moving) { sh.advance(1 / 60); min = Math.min(min, parseFloat(host.style.height)); }
    expect(host.style.width).toBe("300px");
    expect(host.style.height).toBe("44px");
    expect(min).toBe(44);
  });

  it("new target midway: the card → peek return doesn't jump", () => {
    const { sh, states } = setup();
    sh.snap(300, 44);
    sh.to(560, 260);
    for (let i = 0; i < 8; i++) sh.advance(1 / 60);
    const mid = states.at(-1)!.h;
    sh.to(300, 44);
    sh.advance(1 / 240);
    expect(Math.abs(states.at(-1)!.h - mid)).toBeLessThan(10);
    run(sh);
    expect(states.at(-1)!.h).toBe(44);
  });

  it("right anchor: the body's right edge sits on the host's right edge", () => {
    const { sh, states } = setup("right");
    sh.snap(340, 100);
    expect(states.at(-1)).toMatchObject({ offsetX: 0, bw: 340 });
    sh.to(300, 100);
    sh.advance(1 / 60);
    const st = states.at(-1)!;
    expect(st.offsetX + st.w).toBeCloseTo(st.bw);
  });

  it("bodyPath: straight top, both bottom corners rounded with the radius", () => {
    expect(bodyPath(10, 100, 50, 20)).toBe('path("M10 0H110V30C110 52 112 50 90 50H30C8 50 10 52 10 30Z")');
  });
});

describe("createFlight", () => {
  it("flies the element from the old position to the new one, clears the transform when done", () => {
    document.body.innerHTML = `<div id="a" data-share="t"></div>`;
    const el = document.getElementById("a")!;
    let pos = { left: 10, top: 5, height: 20 };
    el.getBoundingClientRect = () => {
      const hasT = el.style.transform !== "";
      return boxAt(hasT ? pos.left + 30 : pos.left, pos.top, 50, pos.height);
    };
    const fl = createFlight(document);
    fl.capture();
    pos = { left: 200, top: 100, height: 40 };
    fl.play();
    expect(el.style.transform).toContain("translate(-190px,-95px) scale(0.5)");
    let n = 0;
    while (fl.advance(1 / 60) && n++ < 600);
    fl.advance(1 / 60);
    expect(el.style.transform).toBe("");
    fl.destroy();
  });
});
