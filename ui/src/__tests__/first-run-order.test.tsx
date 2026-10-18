import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { Shell } from "../components/Shell";

// First run: the island page's welcome card first, then the strip's setup wizard once it closes (never both at once).
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
// With fake timers on (vi.useFakeTimers at the start of the test) there is no real waiting: same result under load; 16 ms step = one frame, React work (effects, timers) is flushed after each step
const fakeSettle = async (ms: number) => { for (let t = 0; t < ms; t += 16) await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(16, ms - t)); }); };
const settle = (ms = 150) => vi.isFakeTimers() ? fakeSettle(ms) : act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const setupOpen = () => document.querySelector('[data-panel="setup"]')?.getAttribute("aria-hidden") === "false";

describe("first-run order", () => {
  it("setup does not open while welcome is open; it opens once welcome is closed with 'Skip'", async () => {
    render(<><Island monitor="m1" /><Shell monitor="m1" init={{ setup: true }} /></>);
    await settle();
    expect(screen.getByRole("dialog", { name: /Welcome/ })).toBeTruthy();
    expect(setupOpen()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await settle();
    expect(screen.queryByRole("dialog", { name: /Welcome/ })).toBeNull();
    expect(setupOpen()).toBe(true);
  });

  it("setup opens right away if welcome was already seen (or never opens)", async () => {
    // old key (notch.ilkAcilis) kept on purpose: the app still reads it once for migration
    localStorage.setItem("notch.ilkAcilis", "1");
    render(<><Island monitor="m1" /><Shell monitor="m1" init={{ setup: true }} /></>);
    await settle();
    expect(setupOpen()).toBe(true);
  });

  it("if the island never answers, setup still opens after 2 s", async () => {
    vi.useFakeTimers();
    render(<Shell monitor="m1" init={{ setup: true }} />);
    await settle(500);
    expect(setupOpen()).toBe(false);
    await settle(2000);
    expect(setupOpen()).toBe(true);
  });
});
