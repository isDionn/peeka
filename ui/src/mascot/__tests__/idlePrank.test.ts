import { describe, expect, it } from "vitest";
import { createIdlePrank, PRANK_MAX_MS, PRANK_MIN_MS, PRANK_PER_DAY, type PrankEnv } from "../idlePrank";

const MIN = 60_000;
function rig(over: Partial<PrankEnv> = {}, rnd = 0) {
  let t = new Date(2026, 9, 16, 9, 0, 0).getTime();
  const fired: number[] = [];
  const env: PrankEnv = {
    now: () => t, random: () => rnd, enabled: () => true, lastInputAgoMs: () => 60_000,
    fullscreen: () => false, dnd: () => false, presentation: () => false, meeting: () => false, cardOpen: () => false, musicPlaying: () => false,
    ...over,
  };
  const p = createIdlePrank(env, () => fired.push(t));
  return { p, fired, advance: (ms: number) => { t += ms; }, set: (v: number) => { t = v; } };
}

describe("idlePrank", () => {
  it("doesn't fire before 45 min, fires once it elapses (random=0 -> 45 min)", () => {
    const r = rig();
    expect(r.p.poll()).toBe("wait");
    r.advance(PRANK_MIN_MS - 1000); expect(r.p.poll()).toBe("wait");
    r.advance(1000); expect(r.p.poll()).toBe("fired");
    expect(r.fired).toHaveLength(1);
  });
  it("the interval stays within 45-90 min (random=1 -> 90 min)", () => {
    const r = rig({}, 1);
    r.p.poll(); r.advance(PRANK_MAX_MS - 1); expect(r.p.poll()).toBe("wait");
    r.advance(1); expect(r.p.poll()).toBe("fired");
    r.advance(PRANK_MAX_MS - 1); expect(r.p.poll()).toBe("wait");
  });
  it("quiet for at least 45 min after firing", () => {
    const r = rig();
    r.p.poll(); r.advance(PRANK_MIN_MS); r.p.poll();
    r.advance(PRANK_MIN_MS - 1); expect(r.p.poll()).toBe("wait");
  });
  it("at most 6 a day; the counter resets the next day", () => {
    const r = rig();
    r.p.poll();
    for (let i = 0; i < 12; i++) { r.advance(PRANK_MIN_MS); r.p.poll(); }   // 9:00 + 9 hours: all on the same day
    expect(r.fired).toHaveLength(PRANK_PER_DAY);
    r.set(new Date(2026, 9, 17, 10, 0, 0).getTime());
    r.p.poll(); r.advance(PRANK_MIN_MS); r.p.poll();
    expect(r.fired.length).toBeGreaterThan(PRANK_PER_DAY);
  });
  it("doesn't fire while off; the timer restarts when turned on", () => {
    let on = false;
    const r = rig({ enabled: () => on });
    expect(r.p.poll()).toBe("off");
    r.advance(5 * 60 * MIN); on = true;
    expect(r.p.poll()).toBe("wait");   // no accumulated prank goes off
    expect(r.fired).toHaveLength(0);
  });
  it.each([
    ["input", { lastInputAgoMs: () => 2999 }],
    ["fullscreen", { fullscreen: () => true }],
    ["dnd", { dnd: () => true }],
    ["presentation", { presentation: () => true }],
    ["meeting", { meeting: () => true }],
    ["card", { cardOpen: () => true }],
    ["music", { musicPlaying: () => true }],
  ] as const)("doesn't fire while blocked by %s", (reason, over) => {
    const r = rig(over);
    r.p.poll(); r.advance(PRANK_MIN_MS);
    expect(r.p.poll()).toBe(reason);
    expect(r.fired).toHaveLength(0);
  });
  it("fires on the first poll once the block lifts; 3 s without input is enough", () => {
    let ago = 100;
    const r = rig({ lastInputAgoMs: () => ago });
    r.p.poll(); r.advance(PRANK_MIN_MS);
    expect(r.p.poll()).toBe("input");
    ago = 3000; expect(r.p.poll()).toBe("fired");
  });
});
