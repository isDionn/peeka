import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { PluginExtras } from "../components/PluginExtras";

// Ayarlar › Eklentiler: Claude Code köprüsü Kur / Kaldır (Peeka'nın kendi kancası). Yalnız elle tıklanınca; demo kipinde kapalı; satır kaymaz.
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
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });
const calls = (cmd: string) => fakeBridge.log.filter((l) => l.cmd === cmd).length;
const btn = (n: string) => screen.getByRole("button", { name: n });

describe("Claude Code köprüsü: Kur / Kaldır", () => {
  it("kurulu değilken Kur; tıklayınca kurulur, durum ve düğme Kaldır olur; Kaldır geri alır", async () => {
    fakeBridge.setBridge({ installed: false, healthy: false, lastEventAgoS: null });
    render(<PluginExtras />);
    await screen.findByText("Claude Code köprüsü");
    expect(screen.getByText("Kurulu değil")).toBeTruthy();
    expect(calls("claude_bridge_install")).toBe(0); // kendiliğinden kurulmaz
    const w = btn("Kur").getAttribute("style");
    fireEvent.click(btn("Kur"));
    await settle();
    expect(calls("claude_bridge_install")).toBe(1);
    expect(screen.getByText(/Kurulu · bu Peeka'ya bağlı/)).toBeTruthy();
    expect(btn("Kaldır").getAttribute("style")).toBe(w); // sabit genişlik: satır kaymaz
    fireEvent.click(btn("Kaldır"));
    await settle();
    expect(calls("claude_bridge_remove")).toBe(1);
    expect(screen.getByText("Kurulu değil")).toBeTruthy();
  });
  it("başka bir kopyayı gösteriyorsa durum bunu söyler ve düğme Yeniden kur olur", async () => {
    fakeBridge.setBridge({ installed: true, healthy: false, lastEventAgoS: 30 });
    render(<PluginExtras />);
    expect(await screen.findByText(/Kurulu · başka bir kopyayı gösteriyor/)).toBeTruthy();
    fireEvent.click(btn("Yeniden kur"));
    await settle();
    expect(screen.getByText(/bu Peeka'ya bağlı/)).toBeTruthy();
  });
  it("demo kipinde düğme kapalı; Rust reddederse nedeni bildirimde yazar", async () => {
    fakeBridge.setBridge({ installed: false, healthy: false, lastEventAgoS: null });
    const real = fakeBridge.call.bind(fakeBridge) as (c: string, ...a: unknown[]) => Promise<unknown>;
    vi.spyOn(fakeBridge, "call").mockImplementation(((c: string, ...a: unknown[]) => (c === "claude_bridge_install" ? Promise.reject("refused") : real(c, ...a))) as never);
    render(<PluginExtras />);
    await screen.findByText("Claude Code köprüsü");
    fireEvent.click(btn("Kur"));
    await settle();
    expect(screen.getByText("Yapılamadı: nedeni bildirimde")).toBeTruthy();
    expect(screen.getByText("Kur")).toBeTruthy(); // durum değişmedi
  });
  it("demo ayarı açıkken Kur kapalıdır", async () => {
    fakeBridge.setBridge({ installed: false, healthy: false, lastEventAgoS: null });
    await fakeBridge.call("set_settings", { patch: { demo: true } });
    render(<PluginExtras />);
    await screen.findByText("Claude Code köprüsü");
    await settle();
    expect((btn("Kur") as HTMLButtonElement).disabled).toBe(true);
  });
});
