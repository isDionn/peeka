import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";

vi.mock("../lib/lineChan", async (orig) => ({ ...(await orig<typeof import("../lib/lineChan")>()), announceNotif: vi.fn() }));
import { announceNotif } from "../lib/lineChan";

// "Sen yokken" (satır 38): rahatsız etme kapanınca ya da 10 dk boşluktan dönünce tek özet çıkıntısı; tıklayınca bildirim listesi.
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

const live = () => { const r = document.body.cloneNode(true) as HTMLElement; r.querySelectorAll("[data-eski]").forEach((e) => e.remove()); return r; };
const text = () => live().querySelector(".adaMerkez")!.textContent ?? "";
const bump = () => live().querySelector(".cik")?.textContent ?? "";
const APPROVAL = { id: "ap1", plugin: { id: "claude", name: "Claude" }, title: "Dosya sil", detail: "", risk: "low", options: [], expiresAt: Date.now() + 600_000 } as never;

describe("sen yokken: rahatsız etme", () => {
  it("DND açıkken gelen bildirim, onay ve biten iş; kapanınca tek özet; tıklayınca bildirim listesi", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.setStatus({ dnd: true }));
    await settle();
    act(() => { fakeBridge.pushAlert({ id: "y1", title: "Bir", expand: false }); fakeBridge.pushAlert({ id: "y2", title: "Iki", expand: false }); });
    act(() => fakeBridge.setSurfaces({ approvals: [APPROVAL], approvalTop: null }));
    act(() => fakeBridge.emit("job_done", { title: "Rapor", took: "1 dk" }));
    await settle();
    expect(bump()).not.toContain("Sen yokken");
    act(() => fakeBridge.setStatus({ dnd: false }));
    await settle(300);
    expect(text()).toContain("Sen yokken");
    expect(bump()).toContain("Sen yokken: 2 bildirim, 1 onay, 1 iş bitti");
    fireEvent.click(document.querySelector(".cik button")!);
    expect(announceNotif).toHaveBeenCalledTimes(1);
    await settle(300);
    expect(bump()).not.toContain("Sen yokken");
  });
  it("hiçbir şey gelmediyse özet çıkmaz", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.setStatus({ dnd: true }));
    await settle();
    act(() => fakeBridge.setStatus({ dnd: false }));
    await settle(300);
    expect(text()).not.toContain("Sen yokken");
  });
  it("kilitliyken sayılar yazılmaz", async () => {
    render(<Island monitor="m1" init={{ view: null, away: { notif: 3, approval: 1, done: 2 } }} />);
    await settle();
    expect(bump()).toContain("3 bildirim");
    act(() => fakeBridge.setLocked(true, "manual"));
    await settle(300);
    expect(bump()).toContain("Sen yokken: yeni olaylar var");
    expect(bump()).not.toMatch(/\d bildirim/);
  });
});

describe("sen yokken: uzun boşluk", () => {
  afterEach(() => { vi.useRealTimers(); });
  it("10 dk girdi yoksa yokluk başlar; dönünce özet", { timeout: 25000 }, async () => {
    vi.useFakeTimers();
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await settle(5300); // boşluk 5 sn'de bir yoklanır
    act(() => fakeBridge.pushAlert({ id: "y9", title: "Gecen", expand: false }));
    await settle();
    fireEvent.pointerMove(window); // geri geldi
    await settle(5300);
    expect(bump()).toContain("Sen yokken: 1 bildirim");
  });
});
