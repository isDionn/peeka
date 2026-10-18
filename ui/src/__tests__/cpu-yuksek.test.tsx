import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";

// Madde 31: Rust `cpu_high {app}` (60 sn kararı Rust'ta; sayfada zamanlayıcı yok) + sistem kartında `topCpu`.
const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset();
});
afterEach(() => {
  cleanup();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const settle = (ms = 80) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const center = () => document.querySelector<HTMLElement>(".adaMerkez")!;

describe("cpu_high (D)", () => {
  it("'<uygulama> çok yoruyor' ve Görev Yöneticisi düğmesi (open_task_manager)", { timeout: 20000 }, async () => {
    const spy = vi.spyOn(fakeBridge, "call");
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.emit("cpu_high", { app: "chrome" }));
    await settle(300);
    expect(center().textContent).toContain("chrome çok yoruyor");
    fireEvent.click(screen.getByRole("button", { name: "Görev Yöneticisi" }));
    expect(spy).toHaveBeenCalledWith("open_task_manager");
  });
  it("uygulama bilinmiyorsa ya da kilitliyken genel metin", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.emit("cpu_high", { app: null }));
    await settle(300);
    expect(center().textContent).toContain("İşlemci çok yoğun");
    fireEvent.keyDown(document, { key: "Escape" });
    await settle(300);
    act(() => fakeBridge.setLocked(true));
    act(() => fakeBridge.emit("cpu_high", { app: "chrome" }));
    await settle(300);
    expect(center().textContent).not.toContain("chrome");
  });
  it("sistem kartı en çok kullanan programı yazar", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle(1500);
    fireEvent.click(await screen.findByRole("tab", { name: "Sistem" }));
    await settle(1500);
    expect(document.body.textContent).toContain("En çok kullanan");
    expect(document.body.textContent).toContain("chrome");
  });
});
