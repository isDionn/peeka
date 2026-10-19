// M1 "mascot more often": mood selection (reactions, event moods, wink, night) and the one-mascot rule with its cross-fade.
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Mascot, type MascotHandle } from "../Mascot";
import { ambientMood } from "../ambient";
import { MOODS } from "../moods";
import { eventMood, FADE_MS, isNight, newIds, REACT_MS, WINK_MS, winkAfter, withReaction } from "../react";
import { resetMascotRegistry } from "../useSingleMascot";

afterEach(() => { resetMascotRegistry(); vi.useRealTimers(); });

describe("M1 mood selection", () => {
  it("reactions ride only on calm moods, never while locked or presenting", () => {
    expect(withReaction("idle", "hello", false)).toBe("hello");
    expect(withReaction("drowsy", "message", false)).toBe("message");
    for (const busy of ["approval", "question", "error", "ratelimit", "thinking", "music", "done"] as const) expect(withReaction(busy, "hello", false)).toBe(busy);
    expect(withReaction("idle", "hello", true)).toBe("idle");
    expect(withReaction("idle", null, false)).toBe("idle");
  });
  it("event moods: download cheers, a copy is spotted, a finished task cheers; neutral idle while private; others untouched", () => {
    expect(eventMood("download", false)).toBe("done");
    expect(eventMood("shot", false)).toBe("attention");
    expect(eventMood("jobdone", false)).toBe("done");
    for (const k of ["download", "shot", "jobdone"]) expect(eventMood(k, true)).toBe("idle");
    expect(eventMood("music", false)).toBeNull();
  });
  it("wink only when listening ends into a calm or working mood", () => {
    expect(winkAfter("listening", "idle")).toBe(true);
    expect(winkAfter("listening", "thinking")).toBe(true);
    expect(winkAfter("listening", "approval")).toBe(false);
    expect(winkAfter("listening", "listening")).toBe(false);
    expect(winkAfter("idle", "thinking")).toBe(false);
  });
  it("late at night a calm ghost is drowsy; the day and busy moods are untouched", () => {
    expect([23, 0, 3, 5].every(isNight)).toBe(true);
    expect([6, 12, 22].some(isNight)).toBe(false);
    const base = { base: "idle" as const, batteryPercent: null, powered: true, justPlugged: false, idleMs: 0 };
    expect(ambientMood({ ...base, hour: 23 })).toBe("drowsy");
    expect(ambientMood({ ...base, hour: 14 })).toBe("idle");
    expect(ambientMood({ ...base })).toBe("idle");
    expect(ambientMood({ ...base, base: "approval", hour: 2 })).toBe("approval");
    expect(ambientMood({ ...base, hour: 2, idleMs: 999_999 })).toBe("sleeping");
  });
  it("only new notification ids trigger a glance; the first list is silent", () => {
    expect(newIds(null, ["a", "b"])).toEqual([]);
    expect(newIds(new Set(["a"]), ["a", "b"])).toEqual(["b"]);
    expect(newIds(new Set(["a", "b"]), ["a"])).toEqual([]);
  });
  it("new reactions are short and only use real parts", () => {
    expect(REACT_MS).toBeLessThanOrEqual(1200);
    expect(WINK_MS).toBeLessThanOrEqual(1200);
    expect(MOODS.hello).toMatchObject({ eyes: "eye-happy", fx: ["wave"] });
    expect(MOODS.message.eyes).toBe("eye-brows-2");
  });
});

describe("one mascot on screen", () => {
  const live = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>(".mascot:not(.out)")].map((m) => m.dataset.size);
  it("a card ghost (56) and an empty-state ghost (96) each take over from the strip (40); never two live ghosts", () => {
    vi.useFakeTimers();
    const strip = <Mascot key="s" size={40} mood="idle" isMainAssistant still />;
    const { container, rerender } = render(<>{strip}</>);
    expect(live(container)).toEqual(["40"]);
    rerender(<>{strip}<Mascot key="c" size={56} mood="music" isMainAssistant still /></>);
    expect(live(container)).toEqual(["56"]);
    expect(container.querySelector(".mascot.out")?.getAttribute("data-size")).toBe("40");   // fading out, takes no clicks
    act(() => { vi.advanceTimersByTime(FADE_MS); });
    expect(container.querySelectorAll(".mascot")).toHaveLength(1);
    rerender(<>{strip}<Mascot key="e" size={96} mood="searching" isMainAssistant still /></>);
    expect(live(container)).toEqual(["96"]);
    rerender(<>{strip}</>);   // the card closes: the strip ghost comes back
    expect(live(container)).toEqual(["40"]);
  });
  it("hide (a panel in another window shows the ghost): fades out, then unmounts; comes back when shown again", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<Mascot size={40} mood="idle" isMainAssistant still />);
    rerender(<Mascot size={40} mood="idle" isMainAssistant still hide />);
    expect(container.querySelector(".mascot")?.classList.contains("out")).toBe(true);
    act(() => { vi.advanceTimersByTime(FADE_MS); });
    expect(container.querySelector(".mascot")).toBeNull();
    rerender(<Mascot size={40} mood="idle" isMainAssistant still />);
    expect(live(container)).toEqual(["40"]);
  });
});

describe("busy gate: the draw loop still stops after the new reactions", () => {
  it("after a glance, a greeting and a message face, the loop sleeps again", () => {
    vi.useFakeTimers();
    const ref = { current: null as MascotHandle | null };
    const { rerender } = render(<Mascot ref={ref} size={40} mood="idle" isMainAssistant single={false} />);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(ref.current!.running()).toBe(false);
    act(() => { ref.current!.glance(5000, 0, REACT_MS); });
    expect(ref.current!.running()).toBe(true);
    act(() => { vi.advanceTimersByTime(REACT_MS + 2000); });
    expect(ref.current!.running()).toBe(false);
    for (const m of ["hello", "message", "idle"] as const) rerender(<Mascot ref={ref} size={40} mood={m} isMainAssistant single={false} />);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(ref.current!.running()).toBe(false);
  });
});

describe("engine: wink after listening", () => {
  it("the eyes wink once, then the new mood's eyes return", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<Mascot size={56} mood="listening" isMainAssistant single={false} />);
    const eye = () => container.querySelector<HTMLImageElement>(".g-eye")!.dataset.d;
    expect(eye()).toBe("eye-brows");
    rerender(<Mascot size={56} mood="idle" isMainAssistant single={false} />);
    expect(eye()).toBe("eye-wink");
    act(() => { vi.advanceTimersByTime(WINK_MS + 200); });
    expect(eye()).toBe("eye-open");
  });
});
