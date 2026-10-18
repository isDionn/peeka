import { describe, expect, it } from "vitest";
import { DAZE, REACT, SHAKE, SWALLOW_X, SWALLOW_Y, createClickCounter, createReactionGate, dizzyTrack, gazeStep, gazeTarget, sample, shakeTrack, swayTrack, trackMs } from "../motion";
import { HANG, sizePlan } from "../moods";

describe("tracks", () => {
  it("jitter: +4, -4, +2.5, 0 px; 50/70/70/90 ms (280 total)", () => {
    expect(SHAKE.map(([, d]) => d)).toEqual([50, 70, 70, 90]);
    expect(trackMs(SHAKE)).toBe(280);
    const at = (t: number) => sample(SHAKE, 0, t);
    expect([at(50), at(120), at(190), at(280)]).toEqual([4, -4, 2.5, 0]);
    expect(at(25)).toBeGreaterThan(0); expect(at(25)).toBeLessThan(4);
    expect(at(1000)).toBe(0);
  });
  it("jitter scales as size/56 on a large card, unchanged at 56", () => {
    expect(shakeTrack(56)).toEqual(SHAKE);
    expect(shakeTrack(112)[0][0]).toBe(8);
  });
  it("swallow: sy 0.78 -> 1.18 -> 1 (80/130/220), sx 1.28 -> 0.92 -> 1", () => {
    expect(SWALLOW_Y.map(([v, d]) => [v, d])).toEqual([[.78, 80], [1.18, 130], [1, 220]]);
    expect(sample(SWALLOW_Y, 1, 80)).toBeCloseTo(.78); expect(sample(SWALLOW_Y, 1, 210)).toBeCloseTo(1.18); expect(sample(SWALLOW_Y, 1, 430)).toBeCloseTo(1);
    expect(sample(SWALLOW_X, 1, 80)).toBeCloseTo(1.28); expect(sample(SWALLOW_X, 1, 210)).toBeCloseTo(.92);
  });
  it("the dizzy sway returns to 0 when the duration ends", () => {
    const tr = swayTrack(3300);
    expect(sample(tr, 0, trackMs(tr))).toBe(0);
  });
});

describe("daze thresholds", () => {
  it("single click 800 ms; a 3rd click within 1.7 s gives 3.3 s", () => {
    let t = 0; const click = createClickCounter(() => t);
    expect(click()).toBe(DAZE.one); t = 800; expect(click()).toBe(DAZE.one); t = 1700; expect(click()).toBe(DAZE.triple);
    expect(DAZE.triple).toBe(3300); expect(DAZE.one).toBe(800);
  });
  it("a 3rd click beyond 1.7 s doesn't count; the counter resets after a triple", () => {
    let t = 0; const click = createClickCounter(() => t);
    click(); t = 900; click(); t = 1701; expect(click()).toBe(DAZE.one);   // the first click fell out of the window, 2 left
    t = 2000; expect(click()).toBe(DAZE.triple);                         // 900, 1701, 2000 are all within 1.7 s
    t = 2100; expect(click()).toBe(DAZE.one);                            // reset
  });
});

describe("gaze math", () => {
  it("target tanh(dx/260), tanh(dy/200)", () => {
    const [x, y] = gazeTarget(260, 200);
    expect(x).toBeCloseTo(Math.tanh(1)); expect(y).toBeCloseTo(Math.tanh(1));
    expect(gazeTarget(0, 0)).toEqual([0, 0]);
    expect(gazeTarget(-5000, 5000)).toEqual([-1, 1]);
  });
  it("smoothing 1 - 0.0025^dt: dt 0 -> 0, 1 s -> 0.9975, grows with dt", () => {
    expect(gazeStep(0)).toBe(0);
    expect(gazeStep(1)).toBeCloseTo(.9975);
    expect(gazeStep(.016)).toBeGreaterThan(0); expect(gazeStep(.016)).toBeLessThan(gazeStep(.033));
  });
});

describe("size plan", () => {
  it("badge, jitter, sparkle only at ≥56 px", () => {
    for (const s of [20, 24, 28, 40, 55]) expect(sizePlan(s)).toMatchObject({ badge: false, shake: false, sparkle: false });
    for (const s of [56, 96]) expect(sizePlan(s)).toMatchObject({ badge: true, shake: true, sparkle: true });
  });
  it("40 px hanging pose; eye tracking, no silhouette; the hit box hangs ~12 px below the strip", () => {
    expect(sizePlan(40)).toMatchObject({ hang: true, silhouette: false, eyeTracking: true });
    expect(sizePlan(24).hang).toBe(false);
    const bottom = HANG.hit.y + HANG.hit.h - HANG.box.h;
    expect(bottom).toBeGreaterThanOrEqual(10); expect(bottom).toBeLessThanOrEqual(14);
  });
});

describe("reaction gate", () => {
  it("slap: clicks faster than 350 ms don't count, then it's free again", () => {
    let t = 0; const g = createReactionGate(() => t);
    expect(g.tap()).toBe("slap");
    t = 100; expect(g.tap()).toBe("none");
    t = 349; expect(g.tap()).toBe("none");
    t = 350; expect(g.tap()).toBe("slap");
  });
  it("flood: 100 clicks in 3 s give at most 9 slaps", () => {
    let t = 0; const g = createReactionGate(() => t); let n = 0;
    for (; t < 3000; t += 30) if (g.tap() === "slap") n++;
    expect(n).toBeLessThanOrEqual(9);
  });
  it("dizzy: the 5th click within 3 s gives 'dizzy'; no reaction during it; then the counter restarts from zero", () => {
    let t = 0; const g = createReactionGate(() => t);
    const r: string[] = [];
    for (let i = 0; i < 5; i++) { r.push(g.tap()); t += 200; }
    expect(r).toEqual(["slap", "none", "slap", "none", "dizzy"]);
    t += 500; expect(g.tap()).toBe("none");                       // the daze is still on
    t += REACT.dizzyMs; expect(g.tap()).toBe("slap");              // over, the first click is a slap again
    for (let i = 0; i < 3; i++) { t += 400; expect(g.tap()).not.toBe("dizzy"); }
  });
  it("dizzy: slow clicks (outside the window) never cause dizziness", () => {
    let t = 0; const g = createReactionGate(() => t);
    for (let i = 0; i < 20; i++) { expect(g.tap()).toBe("slap"); t += 900; }
  });
  it("daze track: one turn (360) in the first 900 ms, ends at 360", () => {
    const tr = dizzyTrack(REACT.dizzyMs);
    expect(sample(tr, 0, 900)).toBeCloseTo(360); expect(sample(tr, 0, trackMs(tr))).toBeCloseTo(360);
  });
  it("affection: once per 8 s", () => {
    let t = 0; const g = createReactionGate(() => t);
    expect(g.love()).toBe(true); t = REACT.loveGap - 1; expect(g.love()).toBe(false); t = REACT.loveGap; expect(g.love()).toBe(true);
  });
});
