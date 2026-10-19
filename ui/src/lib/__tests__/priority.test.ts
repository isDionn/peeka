import { describe, expect, it } from "vitest";
import { pickPrimary, RANK, timerKind, type ActivityKind } from "../priority";

const A = (...k: ActivityKind[]) => k.map((kind) => ({ kind }));
const kinds = (l: { kind: ActivityKind }[]) => l.map((a) => a.kind);
/** Decision order, top to bottom. */
const ORDER: ActivityKind[] = ["approval", "clip", "batteryCrit", "live", "meeting", "net", "alert", "burst", "rateLimit", "battery", "cpu", "timerEnd", "done", "summary", "musicStopped", "download", "music", "timer", "other"];

describe("pickPrimary: order", () => {
  it("empty list: no primary, no secondary", () => {
    expect(pickPrimary([])).toEqual({ primary: null, secondary: [] });
  });
  it("a single job becomes the primary, no bubble", () => {
    const p = pickPrimary(A("music"));
    expect(p.primary?.kind).toBe("music");
    expect(p.secondary).toEqual([]);
  });
  it("RANK matches the owner's order exactly", () => {
    // "edit" (live diff, F4) shares "live"'s rank; the owner's order lists the distinct ranks
    expect(RANK.edit).toBe(RANK.live);
    expect(Object.keys(RANK).filter((k) => k !== "edit").sort((a, b) => RANK[a as ActivityKind] - RANK[b as ActivityKind])).toEqual(ORDER);
  });
  it("every adjacent pair: the upper one becomes primary, the lower one a bubble (independent of input order)", () => {
    for (let i = 0; i < ORDER.length - 1; i++) {
      const hi = ORDER[i], lo = ORDER[i + 1];
      for (const input of [A(hi, lo), A(lo, hi)]) {
        const p = pickPrimary(input);
        expect(p.primary?.kind, `${hi} > ${lo}`).toBe(hi);
        expect(kinds(p.secondary)).toEqual([lo]);
      }
    }
  });
  it("all together: full order, the first is primary, the rest sorted", () => {
    const p = pickPrimary(A(...[...ORDER].reverse()));
    expect(p.primary?.kind).toBe("approval");
    expect(kinds(p.secondary)).toEqual(ORDER.slice(1));
  });
  it("owner's examples: Claude + music; Claude + music + timer; an approval pushes Claude down to a bubble", () => {
    expect(pickPrimary(A("music", "live")).primary?.kind).toBe("live");
    const p = pickPrimary(A("timer", "music", "live"));
    expect([p.primary?.kind, ...kinds(p.secondary)]).toEqual(["live", "music", "timer"]);
    const q = pickPrimary(A("live", "approval"));
    expect([q.primary?.kind, ...kinds(q.secondary)]).toEqual(["approval", "live"]);
  });
  it("a plain alert doesn't outrank Claude, but outranks music and the timer", () => {
    expect(pickPrimary(A("alert", "live")).primary?.kind).toBe("live");
    expect(pickPrimary(A("music", "alert")).primary?.kind).toBe("alert");
    expect(pickPrimary(A("timer", "alert")).primary?.kind).toBe("alert");
  });
  it("doesn't mutate the input", () => {
    const l = A("other", "approval");
    pickPrimary(l, "other");
    expect(kinds(l)).toEqual(["other", "approval"]);
  });
});

describe("timerKind: last 60 s", () => {
  it("59, 60, 61 s", () => {
    expect(timerKind(true, 59)).toBe("timerEnd");
    expect(timerKind(true, 60)).toBe("timerEnd");
    expect(timerKind(true, 61)).toBe("timer");
  });
  it("a paused timer doesn't jump ahead even under 60 s; once expired (0) it does", () => {
    expect(timerKind(false, 30)).toBe("timer");
    expect(timerKind(false, 0)).toBe("timerEnd");
  });
  it("with music: 61 s ranks below music, 60 s above it", () => {
    expect(pickPrimary(A(timerKind(true, 61), "music")).primary?.kind).toBe("music");
    expect(pickPrimary(A(timerKind(true, 60), "music")).primary?.kind).toBe("timerEnd");
  });
});

describe("pickPrimary: when the user pins one", () => {
  it("the job in the bubble becomes primary, the old primary drops to a bubble", () => {
    const p = pickPrimary(A("live", "music", "timer"), "music");
    expect([p.primary?.kind, ...kinds(p.secondary)]).toEqual(["music", "live", "timer"]);
  });
  it("order is unchanged if the pinned kind is absent or already primary", () => {
    expect(kinds(pickPrimary(A("live", "music"), "timer").secondary)).toEqual(["music"]);
    expect(pickPrimary(A("live", "music"), "live").primary?.kind).toBe("live");
  });
  it("pinning is ignored while an approval exists: the approval is always primary", () => {
    const p = pickPrimary(A("approval", "live", "music"), "music");
    expect([p.primary?.kind, ...kinds(p.secondary)]).toEqual(["approval", "live", "music"]);
  });
});
