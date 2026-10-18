import { act, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { netUp, useNetNotice } from "../lib/netNotice";
import type { NetworkLevel } from "../bridge";

// Ağ (satır 28): bağlantı koptu / geri geldi çıkıntısı; 3 sn oturma süresiyle sallanmada tekrar etmez.
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

describe("netUp", () => {
  it("internet yok sayılanlar: none, local; unknown karar vermez", () => {
    expect([netUp("internet"), netUp("constrained"), netUp("none"), netUp("local"), netUp("unknown"), netUp(undefined)]).toEqual([true, true, false, false, null, null]);
  });
});

describe("useNetNotice (sahte saat)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const run = (first: NetworkLevel) => renderHook(({ n, hold }: { n: NetworkLevel; hold?: boolean }) => useNetNotice(n, hold), { initialProps: { n: first, hold: false } as { n: NetworkLevel; hold?: boolean } });
  it("ilk okuma sessiz; 3 sn oturunca 'lost', 4 sn sonra kalkar; dönünce 'back'", () => {
    const h = run("internet");
    act(() => { vi.advanceTimersByTime(10); });
    expect(h.result.current[0]).toBeNull();
    h.rerender({ n: "none" });
    act(() => { vi.advanceTimersByTime(2900); });
    expect(h.result.current[0]).toBeNull();
    act(() => { vi.advanceTimersByTime(200); });
    expect(h.result.current[0]).toBe("lost");
    act(() => { vi.advanceTimersByTime(4100); });
    expect(h.result.current[0]).toBeNull();
    h.rerender({ n: "internet" });
    act(() => { vi.advanceTimersByTime(3100); });
    expect(h.result.current[0]).toBe("back");
  });
  it("sallanma: 3 sn dolmadan dönerse hiçbir bildirim açılmaz", () => {
    const h = run("internet");
    act(() => { vi.advanceTimersByTime(10); });
    for (let i = 0; i < 4; i++) {
      h.rerender({ n: "none" }); act(() => { vi.advanceTimersByTime(1500); });
      h.rerender({ n: "internet" }); act(() => { vi.advanceTimersByTime(1500); });
    }
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(h.result.current[0]).toBeNull();
  });
  it("imleç üstündeyken (hold) kalkmaz", () => {
    const h = run("internet");
    act(() => { vi.advanceTimersByTime(10); });
    h.rerender({ n: "none", hold: true });
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(h.result.current[0]).toBe("lost");
    h.rerender({ n: "none", hold: false });
    act(() => { vi.advanceTimersByTime(4100); });
    expect(h.result.current[0]).toBeNull();
  });
});

describe("ada: bağlantı koptu", () => {
  it("kopunca 3 sn sonra çıkıntı çıkar, dönünce 'geri geldi'", { timeout: 20000 }, async () => {
    vi.useFakeTimers();
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.setStatus({ network: "none" }));
    await settle(1000);
    expect(document.querySelector(".adaMerkez")!.textContent).not.toContain("Bağlantı koptu");
    await settle(2400);
    expect(document.querySelector(".adaMerkez")!.textContent).toContain("Bağlantı koptu");
    expect(document.querySelector(".cik")!.textContent).toContain("Ağ ayarları");
    act(() => fakeBridge.setStatus({ network: "internet" }));
    await settle(3400);
    expect(document.querySelector(".adaMerkez")!.textContent).toContain("Bağlantı geri geldi");
  });
  it("sunum modunda çıkmaz", { timeout: 20000 }, async () => {
    vi.useFakeTimers();
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.emit("input_tick", { lastInputAgoMs: 0, cursor: null, presentation: true }));
    act(() => fakeBridge.setStatus({ network: "none" }));
    await settle(3600);
    expect(document.querySelector(".adaMerkez")!.textContent).not.toContain("Bağlantı koptu");
  });
});
