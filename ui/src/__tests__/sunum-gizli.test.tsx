import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { NotificationList } from "../components/Notifications";

// Sunum (satır 37): kendiliğinden çıkıntı yok, içerikler kilitle aynı genel etiketle gizli; sayı kalır.
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
const settle = (ms = 80) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

const present = (on: boolean) => act(() => fakeBridge.emit("input_tick", { lastInputAgoMs: 0, cursor: null, presentation: on }));
// geçişte kısa süre kalan, inert + aria-hidden eski katman sayılmaz (kilit-serit.test.tsx ile aynı)
const live = () => { const r = document.body.cloneNode(true) as HTMLElement; r.querySelectorAll("[data-eski]").forEach((e) => e.remove()); return r; };
const text = () => live().querySelector(".adaMerkez")!.textContent ?? "";
const all = () => { const r = live(); return [r.textContent ?? "", ...[...r.querySelectorAll("[aria-label],[title],[alt]")].map((e) => `${e.getAttribute("aria-label")} ${e.getAttribute("title")} ${e.getAttribute("alt")}`)].join(" "); };

describe("sunum modu", () => {
  it("müzik: parça adı yok, 'Müzik çalıyor' var; sunum bitince geri gelir", async () => {
    render(<Island monitor="m1" init={{ view: null, autoMusic: true, pin: true }} />);
    await settle();
    expect(all()).toContain("Gece Treni");
    await present(true);
    await settle();
    expect(all()).not.toContain("Gece Treni");
        await present(false);
    await settle();
    expect(all()).toContain("Gece Treni");
  });
  it("uyarı çıkıntısı açmaz; sayı 'N bildirim' olarak şeritte kalır (Pusula bağlı)", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await present(true);
    act(() => fakeBridge.pushAlert({ id: "gizli", title: "Sakli Baslik 123", subtitle: "Sakli Alt" }));
    await settle();
    expect(all()).not.toContain("Sakli");
    expect(text()).toMatch(/\d+ bildirim/);
    await present(false);
    await settle(300);
    expect(all()).toContain("Sakli Baslik 123"); // sunum bitince çıkıntı geri gelir
  });
  it("kopya şeridi ve eklenti çıkıntısı çıkmaz", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await present(true);
    act(() => fakeBridge.addClip({ id: "s1", createdAt: Date.now(), pinned: false, source: null, kind: "file", text: "gizli-rapor.pdf", sub: null, thumb: null, screenshot: false }));
    act(() => fakeBridge.setSurfaces({ protrusion: { plugin: { id: "pusula", name: "Pusula", main: true }, title: "Musteri toplantisi", icon: "calendar", state: "info", mascot: "ciddi" } as never }));
    await settle(300);
    expect(all()).not.toContain("gizli-rapor");
    expect(all()).not.toContain("Musteri");
  });
});

describe("bildirim listesi", () => {
  it("sunumda Windows bildirimi yalnız uygulama adıyla görünür; başlık ve gövde yok", async () => {
    fakeBridge.pushNotice({ id: "w1", app: "Teams", title: "Maas Zammi", body: "Gizli govde" });
    render(<NotificationList onReview={() => undefined} />);
    await settle();
    expect(all()).toContain("Maas Zammi");
    await present(true);
    await settle();
    expect(all()).not.toContain("Maas Zammi");
    expect(all()).not.toContain("Gizli govde");
    expect(all()).toContain("Teams");
    expect(all()).toContain("Sunum sürüyor");
  });
});
