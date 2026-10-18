import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { Shell } from "../components/Shell";

// jsdom ölçü vermez: [data-hit] öğelerine satır içi stilden (yoksa 100x30) boyut veren getBoundingClientRect
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
  vi.restoreAllMocks();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 80)); });

describe("ada: tıklanabilir dikdörtgenler", () => {
  it("şekil değişince report_hit_rects yeni dikdörtgenlerle çağrılır", async () => {
    const spy = vi.spyOn(fakeBridge, "call");
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const first = spy.mock.calls.filter((c) => c[0] === "report_hit_rects").length;
    expect(first).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Kartı aç/ }));
    await settle();
    const calls = spy.mock.calls.filter((c) => c[0] === "report_hit_rects");
    expect(calls.length).toBeGreaterThan(first);
    const last = calls.at(-1)![1] as { page: string; rects: unknown[] };
    expect(last.page).toBe("island");
    expect(last.rects.length).toBeGreaterThanOrEqual(2); // ortadaki düğme + şekil kutusu
    expect(last.rects.some((r) => (r as { paint?: boolean }).paint)).toBe(true); // gölge payı: pencere bölgesi kartın gölgesini kesmez
  });
  it("kart yokken gölge dikdörtgeni raporlanmaz, düğme tıklanabilir kalır", async () => {
    const spy = vi.spyOn(fakeBridge, "call");
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const rects = spy.mock.calls.filter((c) => c[0] === "report_hit_rects").at(-1)![1] as { rects: { paint?: boolean }[] };
    expect(rects.rects.some((r) => r.paint)).toBe(false);
    expect(rects.rects.length).toBeGreaterThanOrEqual(1);
  });
});

describe("ada: klavye ve odak", () => {
  it("kart açılınca odak karta girer; Esc kapatır ve odak ortadaki düğmeye döner", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const opener = screen.getByRole("button", { name: /Kartı aç/ });
    opener.focus();
    fireEvent.click(opener);
    await settle();
    const dlg = screen.getByRole("dialog", { name: /^Modüller/ });
    expect(dlg.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dlg, { key: "Escape" });
    await settle();
    expect(screen.queryByRole("dialog", { name: /^Modüller/ })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
  it("Esc bir adım geri: çalar, müzik çıkıntısı, dinlenme", async () => {
    render(<Island monitor="m1" init={{ view: "music-card" }} />);
    await settle();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Müzik" }), { key: "Escape" });
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("group", { name: "Müzik" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await settle();
    expect(screen.queryByRole("group", { name: "Müzik" })).toBeNull();
  });
  it("müzik çalarken ortaya tıklamak Modüller'i Müzik sekmesinde açar; Genel'e geçilir; Esc kapatır", async () => {
    render(<Island monitor="m1" init={{ view: null, autoMusic: true, pin: true }} />);
    await settle();
    fireEvent.click(document.querySelector("button.adaMerkez") as HTMLElement);
    await settle();
    expect(screen.getByRole("dialog", { name: /^Modüller/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Müzik" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Genel" }));
    await settle();
    expect(screen.getByRole("tab", { name: "Genel" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("dialog", { name: /^Modüller/ }), { key: "Escape" });
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("Ctrl+Shift+Enter kendiliğinden çıkan çıkıntıya odak verir; Ctrl+Space Pusula bağlı değil kartını açar", async () => {
    render(<Island monitor="m1" init={{ view: null, pin: true, osd: { percent: 40, muted: false, device: null } }} />);
    await settle();
    expect(document.activeElement === document.body).toBe(true); // çıkıntı odağı çalmaz
    await act(async () => { fakeBridge.emit("shortcut", { name: "focus_island", monitor: "m1" }); });
    expect(screen.getByRole("group", { name: "Ses" }).contains(document.activeElement) || document.activeElement?.className === "adaMerkez").toBe(true);
    await act(async () => { fakeBridge.emit("shortcut", { name: "ask", monitor: "m1" }); });
    await settle();
    expect(screen.getByRole("dialog", { name: "Pusula bağlı değil" })).toBeTruthy();
  });
  it("Sistem kartı açılınca sysmon başlar, kapanınca durur", async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    expect(fakeBridge.sysmonOn).toBe(true);
    fireEvent.keyDown(screen.getByRole("dialog", { name: /^Modüller/ }), { key: "Escape" });
    await settle();
    expect(fakeBridge.sysmonOn).toBe(false);
  });
});

describe("bildirim listesi", () => {
  it("saate tıklayınca açılır, odak karta girer; Esc ile odak saat düğmesine döner", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    const clock = await screen.findByRole("button", { name: /Bildirimler$/ });
    clock.focus();
    fireEvent.click(clock);
    await settle();
    const dlg = screen.getByRole("dialog", { name: "Bildirimler" });
    expect(dlg.contains(document.activeElement)).toBe(true);
    expect(screen.getByText("Disk %91 dolu")).toBeTruthy();
    fireEvent.keyDown(dlg, { key: "Escape" });
    await settle();
    expect(document.activeElement).toBe(clock);
  });
  it("Gözden geçir onay kartını açar", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    fireEvent.click(await screen.findByRole("button", { name: /Bildirimler$/ }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Gözden geçir" }));
    await settle();
    expect(screen.getByRole("dialog", { name: "Temizlik onayı" })).toBeTruthy();
    expect(screen.getByText("Geçici dosyaları sileyim mi?")).toBeTruthy();
  });
});
