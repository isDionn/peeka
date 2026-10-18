import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";

// Timer (item 24): the last 60 s take precedence over music; when it ends, a silent "Time's up" card (Close, +5 min).
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
const timer = (remainingS: number, running = true) => act(() => fakeBridge.setTimer({ label: "Focus", totalS: 1500, remainingS, running }));
const calls = (cmd: string) => fakeBridge.log.filter((l) => l.cmd === cmd);
const btn = (name: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === name);

describe("timer ordering", () => {
  it("a long timer sits below the music (in the bubble); in the last 60 s it takes the main strip and the music drops to the bubble", async () => {
    render(<Island monitor="m1" init={{ view: null, autoMusic: true, pin: true }} />);
    await settle();
    await timer(1500);
    await settle();
    expect(document.querySelector(".islandCenter")!.textContent).toContain("Night Train");
    expect(document.querySelector(".sideBtn")!.getAttribute("aria-label")).toMatch(/Timer/);
    await timer(45);
    await settle(300);
    expect(document.querySelector(".islandCenter")!.textContent).toMatch(/0:4\d/);
    expect(document.querySelector(".sideBtn")!.getAttribute("aria-label")).toMatch(/Playing/);
  });
});

describe("time is up", () => {
  it("when the countdown reaches 0 the card shows; no sound; +5 min is added and the card closes", { timeout: 15000 }, async () => {
    vi.useFakeTimers();
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await timer(1);
    await settle(1500);
    expect(document.querySelector(".islandCenter")!.textContent).toContain("Time's up");
    expect(btn("Close")).toBeTruthy();
    fireEvent.click(btn("+5 min")!);
    await settle(300);
    expect(calls("timer_control").some((l) => (l.args as { action: string }).action === "add5")).toBe(true);
    expect(document.querySelector(".islandCenter")!.textContent).not.toContain("Time's up");
  });
  it("the card shows even if Rust removes the timer at the end; Close dismisses it", { timeout: 15000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await timer(1);
    await settle(100);
    act(() => fakeBridge.setTimer(null));
    await settle(200);
    expect(document.querySelector(".islandCenter")!.textContent).toContain("Time's up");
    fireEvent.click(btn("Close")!);
    await settle(300);
    expect(document.querySelector(".islandCenter")!.textContent).not.toContain("Time's up");
  });
  it("a manual Finish (with a long time left) opens no card; Esc closes the card", { timeout: 15000 }, async () => {
    render(<Island monitor="m1" init={{ view: null, timerDone: "Focus" }} />);
    await settle();
    expect(document.querySelector(".islandCenter")!.textContent).toContain("Time's up");
    fireEvent.keyDown(document, { key: "Escape" });
    await settle(300);
    expect(document.querySelector(".islandCenter")!.textContent).not.toContain("Time's up");
    await timer(900);
    await settle();
    act(() => fakeBridge.setTimer(null));
    await settle(200);
    expect(document.querySelector(".islandCenter")!.textContent).not.toContain("Time's up");
  });
});
