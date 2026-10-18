import { describe, expect, it } from "vitest";
import { fmtTime, timeSlot, trackTitle } from "../media";
import { initial, plain } from "../plugin";
import { parseTimer } from "../search";
import { FIRST_KEY, firstRunDone, resetFirstRun } from "../firstRun";
import { SETUP_KEY, resetSetup, setupDone } from "../../components/SetupWizard";

// 100-scenario pass (docs/tasks/ada-yeni/notch-100-kullanim-senaryosu.md): edge values.
describe("duration text", () => {
  it("past an hour it writes h:mm:ss", () => {
    expect(fmtTime(0)).toBe("0:00");
    expect(fmtTime(3599)).toBe("59:59");
    expect(fmtTime(3600)).toBe("1:00:00");
    expect(fmtTime(3805)).toBe("1:03:25");
    expect(fmtTime(-5)).toBe("0:00");
  });
  it("slot width matches the track's longest text, 4 without a duration", () => {
    expect(timeSlot(null)).toBe(4);
    expect(timeSlot(200)).toBe(4);
    expect(timeSlot(700)).toBe(5);
    expect(timeSlot(7200)).toBe(7);
  });
});

describe("empty track title", () => {
  it("an empty title shows Unknown track", () => {
    expect(trackTitle({ title: "" })).toBe("Unknown track");
    expect(trackTitle({ title: "   " })).toBe("Unknown track");
    expect(trackTitle({ title: "Night Train" })).toBe("Night Train");
  });
});

describe("emoji and casing", () => {
  it("plain doesn't cut an emoji in half", () => {
    expect(plain("ab😀cd", 3)).toBe("ab");
    expect(plain("ab😀cd", 4)).toBe("ab😀");
    expect(plain(null, 5)).toBe("");
  });
  it("the initial doesn't split an emoji and is uppercased", () => {
    expect(initial("😀 Teams")).toBe("😀");
    expect(initial("light")).toBe("L");
    expect(initial("ice")).toBe("I");
    expect(initial("")).toBe("");
  });
  it("timer label is cut at 24 characters without splitting an emoji", () => {
    const t = parseTimer("5 min " + "😀".repeat(40));
    expect(Array.from(t!.label)).toHaveLength(24);
  });
});

describe("persisted flags from the Turkish-named keys", () => {
  it("an old key counts once, moves to the new key and reset clears it", () => {
    localStorage.clear();
    localStorage.setItem("notch.ilkAcilis", "1");
    localStorage.setItem("notch.kurulum", "1");
    expect([firstRunDone(), setupDone()]).toEqual([true, true]);
    expect([localStorage.getItem(FIRST_KEY), localStorage.getItem(SETUP_KEY)]).toEqual(["1", "1"]);
    expect([localStorage.getItem("notch.ilkAcilis"), localStorage.getItem("notch.kurulum")]).toEqual([null, null]);
    resetFirstRun(); resetSetup();
    expect([firstRunDone(), setupDone()]).toEqual([false, false]);
  });
});
