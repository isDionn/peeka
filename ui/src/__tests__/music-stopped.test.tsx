import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";

// Kulaklık ayrıldı, müzik durdu (Rust `music_stopped {name, app}`): çıkıntı + Devam.
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

describe("music_stopped (B)", () => {
  it("çıkıntı 'Müzik durdu — ad ayrıldı'; Devam play_pause çağırır ve çıkıntıyı kaldırır", { timeout: 20000 }, async () => {
    const spy = vi.spyOn(fakeBridge, "call");
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.emit("music_stopped", { name: "Buds Pro", app: "Spotify" }));
    await settle(300);
    expect(center().textContent).toContain("Müzik durdu — Buds Pro ayrıldı");
    fireEvent.click(screen.getByRole("button", { name: "Devam" }));
    expect(spy).toHaveBeenCalledWith("media_control", { action: "play_pause" });
    await settle(300);
    expect(center().textContent).not.toContain("Müzik durdu");
  });
  it("birkaç sn sonra kendiliğinden kalkar; Esc de kaldırır", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.emit("music_stopped", { name: "Buds Pro", app: null }));
    await settle(300);
    fireEvent.keyDown(document, { key: "Escape" });
    await settle(300);
    expect(center().textContent).not.toContain("Müzik durdu");
  });
  it("kilitliyken cihaz adı yok", { timeout: 20000 }, async () => {
    fakeBridge.setLocked(true);
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.emit("music_stopped", { name: "Buds Pro", app: null }));
    await settle(300);
    expect(center().textContent).toContain("Müzik durdu");
    expect(center().textContent).not.toContain("Buds");
  });
});
