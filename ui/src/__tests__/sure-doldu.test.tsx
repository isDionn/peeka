import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";

// Zamanlayıcı (satır 24): son 60 sn müziğin önüne geçer; bitince ses olmadan "Süre doldu" kartı (Kapat, +5 dk).
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
const settle = (ms = 80) => vi.isFakeTimers() ? fakeSettle(ms) : act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const timer = (remainingS: number, running = true) => act(() => fakeBridge.setTimer({ label: "Odak", totalS: 1500, remainingS, running }));
const calls = (cmd: string) => fakeBridge.log.filter((l) => l.cmd === cmd);
const btn = (name: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === name);

describe("zamanlayıcı sırası", () => {
  it("uzun süre müziğin altında (baloncukta); son 60 sn'de ana şeride çıkar, müzik baloncuğa iner", async () => {
    render(<Island monitor="m1" init={{ view: null, autoMusic: true, pin: true }} />);
    await settle();
    await timer(1500);
    await settle();
    expect(document.querySelector(".adaMerkez")!.textContent).toContain("Gece Treni");
    expect(document.querySelector(".yanDug")!.getAttribute("aria-label")).toMatch(/Zamanlayıcı/);
    await timer(45);
    await settle(300);
    expect(document.querySelector(".adaMerkez")!.textContent).toMatch(/0:4\d/);
    expect(document.querySelector(".yanDug")!.getAttribute("aria-label")).toMatch(/Çalıyor/);
  });
});

describe("süre doldu", () => {
  it("sayaç 0'a inince kart çıkar; ses yok; +5 dk eklenir ve kart kapanır", { timeout: 15000 }, async () => {
    vi.useFakeTimers();
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await timer(1);
    await settle(1500);
    expect(document.querySelector(".adaMerkez")!.textContent).toContain("Süre doldu");
    expect(btn("Kapat")).toBeTruthy();
    fireEvent.click(btn("+5 dk")!);
    await settle(300);
    expect(calls("timer_control").some((l) => (l.args as { action: string }).action === "add5")).toBe(true);
    expect(document.querySelector(".adaMerkez")!.textContent).not.toContain("Süre doldu");
  });
  it("Rust zamanlayıcıyı bitişte kaldırırsa da kart çıkar; Kapat durdurur", { timeout: 15000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await timer(1);
    await settle(100);
    act(() => fakeBridge.setTimer(null));
    await settle(200);
    expect(document.querySelector(".adaMerkez")!.textContent).toContain("Süre doldu");
    fireEvent.click(btn("Kapat")!);
    await settle(300);
    expect(document.querySelector(".adaMerkez")!.textContent).not.toContain("Süre doldu");
  });
  it("elle Bitir (uzun süre kala) kart açmaz; Esc kartı kapatır", { timeout: 15000 }, async () => {
    render(<Island monitor="m1" init={{ view: null, timerDone: "Odak" }} />);
    await settle();
    expect(document.querySelector(".adaMerkez")!.textContent).toContain("Süre doldu");
    fireEvent.keyDown(document, { key: "Escape" });
    await settle(300);
    expect(document.querySelector(".adaMerkez")!.textContent).not.toContain("Süre doldu");
    await timer(900);
    await settle();
    act(() => fakeBridge.setTimer(null));
    await settle(200);
    expect(document.querySelector(".adaMerkez")!.textContent).not.toContain("Süre doldu");
  });
});
