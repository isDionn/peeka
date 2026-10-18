import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_SECRET, fakeBridge } from "../bridge.fake";
import { PanoView } from "../components/Pano";

// Karar 2026-10-17: parola satırı bulanık görünür, üstüne gelince/odakta bulanıklık açılır.
// Güvenlik: gezinmedeyken gerçek parola DOM'da yok (sabit bulanık yer tutucu); çıkınca anında silinir; en çok 5 sn; kilit ve sunumda gelmez.
const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const row = () => document.querySelector<HTMLElement>('[data-clip="c6"]')!;
const reveals = () => fakeBridge.log.filter((l) => l.cmd === "clip_reveal").length;
const hover = () => act(async () => { fireEvent.pointerEnter(row()); });
const leave = () => act(async () => { fireEvent.pointerLeave(row()); });
const mount = async () => { render(<PanoView />); await screen.findByText("ekran-kaydı.mp4"); };

describe("parola satırı: bulanık, üstüne gelince açılır", () => {
  it("gezinmedeyken düz metin DOM'da yok; bulanık yer tutucu var (aynı kutu, sabit uzunluk)", async () => {
    await mount();
    expect(row().className).toContain("gizli");
    expect(row().className).not.toContain("acik");
    expect(document.body.innerHTML).not.toContain(FAKE_SECRET);
    expect(row().querySelector(".metin")!.textContent).toMatch(/^\S{10,}$/);
    expect(reveals()).toBe(0);
  });
  it("üstüne gelince gösterir (bir giriş = bir çağrı, pointermove çağırmaz); çıkınca anında siler", async () => {
    await mount();
    await hover();
    expect(row().textContent).toContain(FAKE_SECRET);
    expect(row().className).toContain("acik");
    for (let i = 0; i < 10; i++) fireEvent.pointerMove(row());
    expect(reveals()).toBe(1);
    await leave();
    expect(document.body.innerHTML).not.toContain(FAKE_SECRET);
    expect(row().className).not.toContain("acik");
    await hover(); // yeniden giriş = yeni çağrı; hiçbir şey önbellekte kalmaz
    expect(reveals()).toBe(2);
    expect(row().textContent).toContain(FAKE_SECRET);
  });
  it("imleç dursa bile en çok 5 sn; sonra göz düğmesiyle yeniden gösterilir", async () => {
    await mount();
    vi.useFakeTimers();
    await hover();
    await act(async () => { vi.advanceTimersByTime(4900); });
    expect(row().textContent).toContain(FAKE_SECRET);
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(document.body.innerHTML).not.toContain(FAKE_SECRET);
    await act(async () => { fireEvent.click(row().querySelector('button[aria-label="Kısa süre göster"]')!); });
    expect(row().textContent).toContain(FAKE_SECRET);
  });
  it("klavye odağı (kb kipi) gösterir; odak gidince siler; fare odağı göstermez", async () => {
    await mount();
    fireEvent.focus(row());
    await settle();
    expect(reveals()).toBe(0); // data-kb yok: fare tıklaması odağı
    document.documentElement.setAttribute("data-kb", "");
    await act(async () => { fireEvent.focus(row()); });
    expect(row().textContent).toContain(FAKE_SECRET);
    await act(async () => { fireEvent.blur(row(), { relatedTarget: document.body }); });
    expect(document.body.innerHTML).not.toContain(FAKE_SECRET);
    document.documentElement.removeAttribute("data-kb");
  });
  it("kilit gelince metin silinir ve satır kalkar; kilitliyken Rust reddeder", async () => {
    await mount();
    await hover();
    expect(row().textContent).toContain(FAKE_SECRET);
    await act(async () => { fakeBridge.setLocked(true); });
    expect(document.body.innerHTML).not.toContain(FAKE_SECRET);
    expect(row()).toBeNull();
    await expect(fakeBridge.call("clip_reveal", { id: "c6" })).rejects.toBe("denied");
  });
  it("sunum modunda üstüne gelmek ve göz düğmesi hiçbir şey göstermez", async () => {
    await mount();
    await act(async () => { fakeBridge.emit("input_tick", { lastInputAgoMs: 0, cursor: null, presentation: true }); });
    await hover();
    expect(reveals()).toBe(0);
    expect(document.body.innerHTML).not.toContain(FAKE_SECRET);
    await act(async () => { fireEvent.click(row().querySelector('button[aria-label="Kısa süre göster"]')!); });
    expect(reveals()).toBe(0);
    expect(document.body.innerHTML).not.toContain(FAKE_SECRET);
  });
});
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });
