import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";

vi.mock("../lib/lineChan", async (orig) => ({ ...(await orig<typeof import("../lib/lineChan")>()), announceNotif: vi.fn() }));
import { announceNotif } from "../lib/lineChan";

// "While you were away" (item 38): when do not disturb ends or you return from a 10 min gap, a single summary peek; clicking opens the notification list.
const rectOf = (el: HTMLElement) => ({ left: 10, top: 5, width: parseFloat(el.style.width) || (el.dataset.hit !== undefined ? 100 : 0), height: parseFloat(el.style.height) || 30 }) as DOMRect;
const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return rectOf(this); });
  fakeBridge.reset();
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
// Fake clock on (vi.useFakeTimers at the start of the test): no real waiting, same result under load; a 16 ms step = one frame, React work (effects, timers) is flushed after every step
const fakeSettle = async (ms: number) => { for (let t = 0; t < ms; t += 16) await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(16, ms - t)); }); };
const settle = (ms = 80) => vi.isFakeTimers() ? fakeSettle(ms) : act(async () => { await new Promise((r) => setTimeout(r, ms)); });

const live = () => { const r = document.body.cloneNode(true) as HTMLElement; r.querySelectorAll("[data-leaving]").forEach((e) => e.remove()); return r; };
const text = () => live().querySelector(".islandCenter")!.textContent ?? "";
const bump = () => live().querySelector(".peekBar")?.textContent ?? "";
const APPROVAL = { id: "ap1", plugin: { id: "claude", name: "Claude" }, title: "Delete file", detail: "", risk: "low", options: [], expiresAt: Date.now() + 600_000 } as never;

describe("while away: do not disturb", () => {
  it("notifications, approvals and finished jobs that arrive during DND; one summary when it ends; clicking opens the notification list", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.setStatus({ dnd: true }));
    await settle();
    act(() => { fakeBridge.pushAlert({ id: "y1", title: "One", expand: false }); fakeBridge.pushAlert({ id: "y2", title: "Two", expand: false }); });
    act(() => fakeBridge.setSurfaces({ approvals: [APPROVAL], approvalTop: null }));
    act(() => fakeBridge.emit("job_done", { title: "Report", took: "1 dk" }));
    await settle();
    expect(bump()).not.toContain("While you were away");
    act(() => fakeBridge.setStatus({ dnd: false }));
    await settle(300);
    expect(text()).toContain("While you were away");
    expect(bump()).toContain("While you were away: 2 notifications, 1 approval, 1 job done");
    fireEvent.click(document.querySelector(".peekBar button")!);
    expect(announceNotif).toHaveBeenCalledTimes(1);
    await settle(300);
    expect(bump()).not.toContain("While you were away");
  });
  it("no summary if nothing arrived", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.setStatus({ dnd: true }));
    await settle();
    act(() => fakeBridge.setStatus({ dnd: false }));
    await settle(300);
    expect(text()).not.toContain("While you were away");
  });
  it("counts are not written while locked", async () => {
    render(<Island monitor="m1" init={{ view: null, away: { notif: 3, approval: 1, done: 2 } }} />);
    await settle();
    expect(bump()).toContain("3 notifications");
    act(() => fakeBridge.setLocked(true, "manual"));
    await settle(300);
    expect(bump()).toContain("While you were away: new activity");
    expect(bump()).not.toMatch(/\d notification/);
  });
});

describe("while away: long gap", () => {
  afterEach(() => { vi.useRealTimers(); });
  it("with no input for 10 min the absence starts; a summary on return", { timeout: 25000 }, async () => {
    vi.useFakeTimers();
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await settle(5300); // the gap is polled every 5 s
    act(() => fakeBridge.pushAlert({ id: "y9", title: "Arrived", expand: false }));
    await settle();
    fireEvent.pointerMove(window); // came back
    await settle(5300);
    expect(bump()).toContain("While you were away: 1 notification");
  });
});
