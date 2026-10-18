import { describe, expect, it } from "vitest";
import { ambientMood, type AmbientIn } from "../mascot/ambient";

const base: AmbientIn = { base: "idle", batteryPercent: 80, powered: false, justPlugged: false, idleMs: 0 };
const m = (o: Partial<AmbientIn>) => ambientMood({ ...base, ...o });

describe("ambient moods", () => {
  it("idle when calm and healthy", () => expect(m({})).toBe("idle"));
  it("battery under 20% = heavy eyelids, under 10% = drowsy", () => {
    expect(m({ batteryPercent: 19 })).toBe("tired");
    expect(m({ batteryPercent: 20 })).toBe("idle");
    expect(m({ batteryPercent: 9 })).toBe("drowsy");
  });
  it("no low-battery mood while plugged in or when the battery is unknown", () => {
    expect(m({ batteryPercent: 5, powered: true })).toBe("idle");
    expect(m({ batteryPercent: null })).toBe("idle");
  });
  it("joy on plugging in; sleep after 2 min without input", () => {
    expect(m({ justPlugged: true, batteryPercent: 5 })).toBe("done");
    expect(m({ idleMs: 119_999 })).toBe("idle");
    expect(m({ idleMs: 120_000 })).toBe("sleeping");
  });
  it("a non-calm mood (approval, thinking) is never overridden", () => {
    expect(m({ base: "approval", batteryPercent: 3, idleMs: 9e6, justPlugged: true })).toBe("approval");
    expect(m({ base: "thinking", idleMs: 9e6 })).toBe("thinking");
  });
});
