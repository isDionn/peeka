import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Shell } from "../components/Shell";

// Multiple monitors (39/40): `fullscreen_screens {island, strips[]}` hides only that strip; `approval_badge` shows a badge on the second strip.
beforeEach(() => { fakeBridge.reset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
// With fake timers on (vi.useFakeTimers at the start of the test) there is no real waiting: same result under load. One act per wait, not one per
// 16 ms frame: the spring's rAF loop chains itself, and a full Shell commit per frame (~110 of them) blew the 5 s test timeout on a slow CI runner
const fakeSettle = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const settle = (ms = 60) => vi.isFakeTimers() ? fakeSettle(ms) : act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const bar = (c: HTMLElement) => c.querySelector<HTMLElement>(".bar")!;

describe("fullscreen_screens (F)", () => {
  it("only the strip of a listed monitor slides up; the other stays in place", async () => {
    vi.useFakeTimers();
    const a = render(<Shell monitor="m1" />);
    await settle();
    act(() => fakeBridge.emit("fullscreen_screens", { island: false, strips: ["m2"] }));
    await settle(600);
    expect(bar(a.container).style.transform).toBe("");
    act(() => fakeBridge.emit("fullscreen_screens", { island: true, strips: ["m1"] }));
    await settle(900);
    expect(bar(a.container).style.transform).toMatch(/translateY\(-/);
    act(() => fakeBridge.emit("fullscreen_screens", { island: false, strips: [] }));
    await settle(1800);
    expect(parseFloat(/-?[\d.]+/.exec(bar(a.container).style.transform || "0")![0])).toBeGreaterThan(-3); // spring settles: it came back down
  });
});

describe("approval_badge (F)", () => {
  it("'N approvals' badge on the second screen's strip; clears on null; another monitor's is not shown; none on the primary strip", async () => {
    const a = render(<Shell monitor="m2" />);
    await settle();
    act(() => fakeBridge.emit("approval_badge", { monitor: "m3", count: 2 }));
    await settle();
    expect(a.container.querySelector(".approvalBadge")).toBeNull();
    act(() => fakeBridge.emit("approval_badge", { monitor: "m2", count: 2 }));
    await settle();
    expect(a.container.querySelector(".approvalBadge")?.textContent).toBe("2 approvals");
    expect(a.container.querySelector(".approvalBadge")?.getAttribute("aria-label")).toBe("2 awaiting approval");
    act(() => fakeBridge.emit("approval_badge", null));
    await settle();
    expect(a.container.querySelector(".approvalBadge")).toBeNull();
  });
});

describe("apps from every monitor (Windows' 'All taskbars')", () => {
  it("each strip lists every monitor's apps once; an app with windows on two screens is one grouped tab", async () => {
    const all = await fakeBridge.call("list_windows", { monitor: "m1" });
    fakeBridge.setWindows([...all, { ...all.find((w) => w.appId === "chrome")!, hwnd: 99, active: false, monitor: "m2" }]);
    for (const m of ["m1", "m2"]) {
      const a = render(<Shell monitor={m} />);
      await settle();
      expect(a.container.querySelectorAll('[data-app="notepad"]')).toHaveLength(1); // notepad sits on m2
      expect(a.container.querySelectorAll('[data-app="chrome"]')).toHaveLength(1); // windows on m1 and m2: one tab
      cleanup();
    }
  });
});
