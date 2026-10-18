import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import type { ClipItem, ClipPlain } from "../bridge";
import { Island } from "../components/Island";
import { stripKind } from "../components/Pano";

// Kopya şeridi (karar 2026-10-17, satır 1 ve 6): her görsel, dosya ve bağlantı çıkıntı açar; düz metin ve parola açmaz;
// görselde imleç üstündeyken altta büyük önizleme belirir (üst satır yerinde kalır); kilitliyken hiçbir şey çıkmaz.
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
const THUMB = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3"/></svg>');
const clip = (id: string, p: Partial<ClipPlain>): ClipPlain => ({ id, createdAt: Date.now(), pinned: false, source: "Paint", kind: "image", text: null, sub: null, thumb: THUMB, screenshot: false, ...p });
const copy = async (c: ClipItem) => { act(() => fakeBridge.addClip(c)); await settle(); };
const bump = () => document.querySelector(".shotCik");
const calls = (cmd: string) => fakeBridge.log.filter((l) => l.cmd === cmd);

describe("stripKind", () => {
  it("görsel, dosya ve bağlantı çıkıntı açar; düz metin, renk ve parola açmaz", () => {
    expect(stripKind(clip("a", {}))).toBe("image");
    expect(stripKind(clip("b", { kind: "file", text: "rapor.pdf", thumb: null }))).toBe("file");
    expect(stripKind(clip("c", { kind: "text", text: "https://ornek.com", hint: "link", thumb: null }))).toBe("link");
    expect(stripKind(clip("d", { kind: "text", text: "merhaba", thumb: null }))).toBeNull();
    expect(stripKind(clip("e", { kind: "text", text: "#ff0000", hint: "color", thumb: null }))).toBeNull();
    expect(stripKind({ id: "p", createdAt: 1, pinned: false, source: null, kind: "password", expiresAt: 9 })).toBeNull();
  });
});

describe("kopya şeridi", () => {
  it("ekran alıntısı olmayan görsel de çıkıntı açar; büyük önizleme yalnız imleç üstündeyken", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(bump()).toBeNull();
    await copy(clip("g1", {}));
    expect(bump()).not.toBeNull();
    expect(bump()!.querySelector(".alintiKucuk")).not.toBeNull();
    expect(document.querySelector(".shotBuyuk")).toBeNull();
    fireEvent.pointerEnter(document.querySelector("#ada")!);
    await settle(250);
    expect(document.querySelector(".shotBuyuk")).not.toBeNull();
    // üst satır büyürken aynı düğümler: Pusula'ya sor/Düzenle yeri değişmez (aynı .shotUst, yeniden kurulmaz)
    expect(bump()!.querySelectorAll(".shotUst").length).toBe(1);
    const names = [...document.querySelectorAll(".shotBuyuk button")].map((b) => b.textContent);
    expect(names).toEqual(["Kopyala", "Tut", "Aç", "Rafa koy"]);
    fireEvent.click(document.querySelector(".shotBuyuk button")!);
    expect(calls("clip_copy")).toHaveLength(1);
    fireEvent.pointerLeave(document.querySelector("#ada")!);
    await settle(400);
    expect(document.querySelector(".shotBuyuk")).toBeNull();
  });

  it("dosya ve bağlantı çıkıntı açar, düz metin ve parola açmaz", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await copy(clip("t1", { kind: "text", text: "sıradan bir cümle", thumb: null }));
    expect(bump()).toBeNull();
    await copy({ id: "pw", createdAt: Date.now(), pinned: false, source: "Kasa", kind: "password", expiresAt: Date.now() + 60_000 });
    expect(bump()).toBeNull();
    await copy(clip("f1", { kind: "file", text: "rapor-q3.xlsx", sub: "1,2 MB", thumb: null }));
    expect(bump()!.textContent).toContain("rapor-q3.xlsx");
    expect(bump()!.querySelector(".alintiKucuk")).toBeNull();
    fireEvent.pointerEnter(document.querySelector("#ada")!);
    await settle(250);
    expect(document.querySelector(".shotBuyuk")).toBeNull(); // dosyada büyüme yok
    fireEvent.pointerLeave(document.querySelector("#ada")!);
    await copy(clip("l1", { kind: "text", text: "https://ornek.com/q3", hint: "link", thumb: null }));
    await settle(300); // eski katman 140 ms soluyor
    expect(bump()!.textContent).toContain("https://ornek.com/q3");
  });

  it("kilitliyken hiçbir kopya çıkıntı açmaz", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.setLocked(true, "manual"));
    await settle();
    await copy(clip("g2", {}));
    expect(bump()).toBeNull();
  });

  it("imleç üstünde değilse birkaç saniye sonra kendiliğinden kapanır", { timeout: 15000 }, async () => {
    vi.useFakeTimers();
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await copy(clip("g3", {}));
    expect(bump()).not.toBeNull();
    await settle(4600);
    await settle(400);
    expect(bump()).toBeNull();
  });
});
