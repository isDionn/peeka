import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";

// Kilitliyken şeritte içerik yerine genel etiket (karar 2026-10-17): parça adı, sanatçı, kapak ve uyarı metni
// ne metinde, ne title/aria/alt özniteliklerinde, ne de img kaynağında bulunur.
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
const ATTRS = ["title", "aria-label", "aria-valuetext", "aria-description", "alt", "src", "placeholder"];
/** Metin + her öğenin okunabilir öznitelikleri tek dizgede (sızıntı taraması). */
const surface = () => {
  // `[data-eski]`: geçiş sırasında kısa süre kalan, inert + aria-hidden eski katman (tıklanamaz, okunmaz); sayılmaz.
  const root = document.body.cloneNode(true) as HTMLElement;
  root.querySelectorAll("[data-eski]").forEach((e) => e.remove());
  const parts = [root.textContent ?? ""];
  root.querySelectorAll("*").forEach((el) => ATTRS.forEach((a) => { const v = el.getAttribute(a); if (v) parts.push(v); }));
  return parts.join("\n");
};
const SONG = ["Gece Treni", "Lodos"];

describe("kilitli şerit: içerik yerine genel etiket", () => {
  it("müzik çıkıntısı: parça, sanatçı ve kapak yok; 'Müzik çalıyor' var; çalma düğmeleri çalışır", async () => {
    render(<Island monitor="m1" init={{ view: null, autoMusic: true, pin: true }} />);
    await settle();
    expect(surface()).toContain("Gece Treni");
    act(() => fakeBridge.setLocked(true, "manual"));
    await settle();
    const s = surface();
    SONG.forEach((w) => expect(s).not.toContain(w));
    expect(s).not.toContain("data:image");
    expect(s).toContain("Müzik çalıyor");
    expect(document.querySelector("button.adaMerkez")!.getAttribute("aria-label")).toContain("Müzik çalıyor");
    expect(document.querySelector('[aria-label="Duraklat"]')).toBeTruthy();
    act(() => fakeBridge.setLocked(false));
    await settle();
    expect(surface()).toContain("Gece Treni");
  });

  it("dinlenme ortasındaki müzik satırı ve düğme adı da genel etiket", async () => {
    fakeBridge.setPlugins([]); // Pusula yokken şerit ortası saat + müzik satırı
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(surface()).toContain("Gece Treni");
    act(() => fakeBridge.setLocked(true, "windows"));
    await settle();
    const s = surface();
    SONG.forEach((w) => expect(s).not.toContain(w));
    expect(s).not.toContain("data:image");
    expect(s).toContain("Müzik çalıyor");
  });

  it("uyarı çıkıntısı: başlık ve alt metin yok, 'Uyarı var' var; Aç ve Sonra düğmeleri çalışır", async () => {
    fakeBridge.pushAlert({ id: "gizli", title: "SIRRI-BASLIK", subtitle: "SIRRI-ALT", action: "https://example.test/x", expand: true });
    render(<Island monitor="m1" init={{ view: null, pin: true }} />);
    await settle();
    expect(surface()).toContain("SIRRI-BASLIK");
    act(() => fakeBridge.setLocked(true, "manual"));
    await settle();
    const s = surface();
    expect(s).not.toContain("SIRRI");
    expect(s).toContain("Uyarı var");
    const names = [...document.querySelectorAll("button")].map((b) => b.textContent);
    expect(names).toEqual(expect.arrayContaining(["Aç", "Sonra"]));
    act(() => fakeBridge.setLocked(false));
    await settle();
    expect(surface()).toContain("SIRRI-BASLIK");
  });

  it("kilit, açık müzik kartını kilit kartına çevirir (parça adı kartta kalmaz)", async () => {
    render(<Island monitor="m1" init={{ view: "music-card", pin: true }} />);
    await settle();
    expect(surface()).toContain("Gece Treni");
    act(() => fakeBridge.setLocked(true, "manual"));
    await settle();
    SONG.forEach((w) => expect(surface()).not.toContain(w));
  });
});
