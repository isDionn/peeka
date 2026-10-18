import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { Shell } from "../components/Shell";

// İndirme bitti (Rust `download_done {id, name, size}`): "İndi: ad", Aç, Klasörde göster; kilitliyken ve sunumda genel metin.
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

describe("download_done (C)", () => {
  it("'İndi: ad'; Aç ve Klasörde göster komutları gider; Aç sonrası çıkıntı Esc ile kalkar", { timeout: 20000 }, async () => {
    const spy = vi.spyOn(fakeBridge, "call");
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.pushDownload({ id: "d1", name: "rapor-q3.pdf", size: 1234 }));
    await settle(300);
    expect(center().textContent).toContain("İndi: rapor-q3.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Aç" }));
    fireEvent.click(screen.getByRole("button", { name: "Klasörde göster" }));
    expect(spy).toHaveBeenCalledWith("download_open", { id: "d1" });
    expect(spy).toHaveBeenCalledWith("download_show_in_folder", { id: "d1" });
    fireEvent.keyDown(document, { key: "Escape" });
    await settle(300);
    expect(center().textContent).not.toContain("İndi:");
  });
  it("uzun ad kırpılır (40 karakter)", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.pushDownload({ id: "d2", name: "x".repeat(200) + ".zip", size: 1 }));
    await settle(300);
    expect(center().textContent!.length).toBeLessThan(80);
  });
  it("kilitliyken ad ve düğme yok, genel 'İndirme bitti'", { timeout: 20000 }, async () => {
    fakeBridge.setLocked(true);
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.pushDownload({ id: "d3", name: "gizli-belge.pdf", size: 1 }));
    await settle(300);
    expect(center().textContent).toContain("İndirme bitti");
    expect(document.body.textContent).not.toContain("gizli-belge");
    expect(screen.queryByRole("button", { name: "Aç" })).toBeNull();
  });
  it("sunumda ad yok", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.emit("input_tick", { lastInputAgoMs: 0, cursor: null, presentation: true }));
    act(() => fakeBridge.pushDownload({ id: "d4", name: "gizli-belge.pdf", size: 1 }));
    await settle(300);
    expect(document.body.textContent).not.toContain("gizli-belge");
  });
  it("Ayarlar: indirme anahtarı watchDownloads yazar", { timeout: 20000 }, async () => {
    render(<Shell monitor="m1" init={{ panel: "ayg" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Diğer ayarlar" }));
    const sw = await screen.findByRole("switch", { name: "İndirme bitti bildirimi" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    await settle();
    expect((await fakeBridge.call("get_settings")).watchDownloads).toBe(false);
  });
});
