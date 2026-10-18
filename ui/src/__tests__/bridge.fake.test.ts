import { describe, expect, it, vi } from "vitest";
import { createFakeBridge } from "../bridge.fake";
import { clockParts } from "../lib/clock";
import { collectHitRects } from "../lib/hitRects";
import { formatCombo } from "../lib/shortcut";

describe("sahte köprü", () => {
  it("durumu değiştirince status_changed olayı yayar ve okuma yeni değeri verir", async () => {
    const b = createFakeBridge();
    const seen = vi.fn();
    await b.on("status_changed", seen);
    await b.call("set_radio", { kind: "wifi", on: false });
    expect(seen).toHaveBeenCalledOnce();
    expect(seen.mock.calls[0][0].wifi).toEqual({ on: false, name: null });
    expect((await b.call("get_status")).wifi?.on).toBe(false);
  });
  it("sabitleri kaydeder ve pins_changed yayar", async () => {
    const b = createFakeBridge();
    const seen = vi.fn();
    await b.on("pins_changed", seen);
    const pins = await b.call("set_pins", { appIds: ["vscode", "chrome"] });
    expect(pins.map((p) => p.appId)).toEqual(["vscode", "chrome"]);
    expect(seen).toHaveBeenCalled();
  });
  it("pili olmayan makinede battery null", async () => {
    expect((await createFakeBridge({ battery: false }).call("get_status")).battery).toBeNull();
  });
  it("arama Türkçe büyük/küçük harf duyarsız; boş sorgu karışık son kullanılanları verir", async () => {
    const b = createFakeBridge();
    const r = await b.call("search", { query: "DOSYA" });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => ["app", "window", "file", "setting", "plugin"].includes(x.kind))).toBe(true);
    expect(r.some((x) => x.title === "Dosya Gezgini")).toBe(true);
  });
  it("açılan sonuç pencereyi öne getirir", async () => {
    const b = createFakeBridge();
    await b.call("open_result", { id: "win:3" });
    const w = await b.call("list_windows", { monitor: "m1" });
    expect(w.find((x) => x.active)?.hwnd).toBe(3);
  });
  it("kısayol çakışması reddedilir", async () => {
    const b = createFakeBridge();
    const r = await b.call("set_settings", { patch: { shortcuts: { search: "Ctrl+Shift+A" } as never } });
    expect(r.ok).toBe(false);
  });
  it("Ctrl+K tarayıcıda shortcut olayına dönüşür (Rust yoluyla aynı)", async () => {
    const b = createFakeBridge();
    const seen = vi.fn();
    await b.on("shortcut", seen);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    expect(seen).toHaveBeenCalledWith({ name: "search", monitor: "m1" });
  });
  it("saat dondurulabilir", () => {
    expect(createFakeBridge({ now: new Date(2025, 9, 16, 14, 32) }).now().getHours()).toBe(14);
  });
});

describe("yardımcılar", () => {
  it("saat: Per 16 Eki / 14:32", () => {
    const c = clockParts(new Date(2025, 9, 16, 14, 32));
    expect(c.date).toBe("Per 16 Eki");
    expect(c.time).toBe("14:32");
    expect(c.label).toBe("Perşembe 16 Ekim, 14:32");
  });
  it("kısayol biçimi: değiştiricisiz harf ve yalnız değiştirici geçersiz", () => {
    const k = { shiftKey: false, altKey: false, metaKey: false, ctrlKey: false };
    expect(formatCombo({ ...k, key: "a" })).toBeNull();
    expect(formatCombo({ ...k, ctrlKey: true, key: "Control" })).toBeNull();
    expect(formatCombo({ ...k, ctrlKey: true, shiftKey: true, key: "a" })).toBe("Ctrl+Shift+A");
    expect(formatCombo({ ...k, ctrlKey: true, key: " " })).toBe("Ctrl+Space");
  });
  it("tıklanabilir dikdörtgenler yalnız [data-hit] ve boyutu olanlardan toplanır", () => {
    document.body.innerHTML = '<div id="a" data-hit></div><div id="b" data-hit></div><div id="c"></div>';
    const rect = (w: number) => () => ({ left: 5, top: 6, width: w, height: 30 }) as DOMRect;
    document.getElementById("a")!.getBoundingClientRect = rect(100);
    document.getElementById("b")!.getBoundingClientRect = rect(0);
    document.getElementById("c")!.getBoundingClientRect = rect(100);
    expect(collectHitRects()).toEqual([{ x: 5, y: 6, w: 100, h: 30 }]);
  });
});
