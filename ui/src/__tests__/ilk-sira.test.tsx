import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { Shell } from "../components/Shell";

// İlk açılış: önce ada sayfasının hoş geldin kartı, o kapanınca şeridin kurulum sihirbazı (aynı anda ikisi değil).
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
// Sanal saat açıkken (testin başında vi.useFakeTimers) gerçek bekleme yok: yük altında da aynı sonuç; 16 ms adım = bir kare, her adım sonunda React işi (efektler, zamanlayıcılar) işlenir
const fakeSettle = async (ms: number) => { for (let t = 0; t < ms; t += 16) await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(16, ms - t)); }); };
const settle = (ms = 150) => vi.isFakeTimers() ? fakeSettle(ms) : act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const setupOpen = () => document.querySelector('[data-panel="setup"]')?.getAttribute("aria-hidden") === "false";

describe("ilk açılış sırası", () => {
  it("hoş geldin açıkken kurulum açılmaz; 'Geç' ile kapanınca kurulum açılır", async () => {
    render(<><Island monitor="m1" /><Shell monitor="m1" init={{ setup: true }} /></>);
    await settle();
    expect(screen.getByRole("dialog", { name: /hoş geldin/ })).toBeTruthy();
    expect(setupOpen()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Geç" }));
    await settle();
    expect(screen.queryByRole("dialog", { name: /hoş geldin/ })).toBeNull();
    expect(setupOpen()).toBe(true);
  });

  it("hoş geldin görülmüşse (ya da hiç açılmıyorsa) kurulum hemen açılır", async () => {
    localStorage.setItem("notch.ilkAcilis", "1");
    render(<><Island monitor="m1" /><Shell monitor="m1" init={{ setup: true }} /></>);
    await settle();
    expect(setupOpen()).toBe(true);
  });

  it("ada hiç cevap vermezse kurulum 2 sn sonra yine açılır", async () => {
    vi.useFakeTimers();
    render(<Shell monitor="m1" init={{ setup: true }} />);
    await settle(500);
    expect(setupOpen()).toBe(false);
    await settle(2000);
    expect(setupOpen()).toBe(true);
  });
});
