import { describe, expect, it } from "vitest";
import { ambientMood, type AmbientIn } from "../mascot/ambient";

const base: AmbientIn = { base: "idle", batteryPercent: 80, powered: false, justPlugged: false, idleMs: 0 };
const m = (o: Partial<AmbientIn>) => ambientMood({ ...base, ...o });

describe("ortam halleri", () => {
  it("sakin ve sağlıklıyken idle", () => expect(m({})).toBe("idle"));
  it("pil %20 altı ağır göz kapağı, %10 altı uyuklama", () => {
    expect(m({ batteryPercent: 19 })).toBe("tired");
    expect(m({ batteryPercent: 20 })).toBe("idle");
    expect(m({ batteryPercent: 9 })).toBe("drowsy");
  });
  it("prizdeyken düşük pil hali yok; pil bilinmiyorsa yok", () => {
    expect(m({ batteryPercent: 5, powered: true })).toBe("idle");
    expect(m({ batteryPercent: null })).toBe("idle");
  });
  it("prize takınca neşe; 2 dk girdi yoksa uyku", () => {
    expect(m({ justPlugged: true, batteryPercent: 5 })).toBe("done");
    expect(m({ idleMs: 119_999 })).toBe("idle");
    expect(m({ idleMs: 120_000 })).toBe("sleeping");
  });
  it("sakin olmayan hal (onay, düşünme) hiç örtülmez", () => {
    expect(m({ base: "approval", batteryPercent: 3, idleMs: 9e6, justPlugged: true })).toBe("approval");
    expect(m({ base: "thinking", idleMs: 9e6 })).toBe("thinking");
  });
});
