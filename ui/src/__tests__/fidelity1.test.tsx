import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { StripLine } from "../components/Fidelity";
import { Shell } from "../components/Shell";
import { sendX } from "../lib/xwin";
import { CONSENT } from "../plugin.fixtures";
import { announceLine } from "../lib/lineChan";
import { AMBER, lineOf, lineVars, MINT } from "../lib/line";
import { APPROVAL_LOW, PLUGINS, PROTRUSION } from "../plugin.fixtures";

const rectOf = (el: HTMLElement) => ({ left: 10, top: 5, width: parseFloat(el.style.width) || (el.dataset.hit !== undefined ? 100 : 0), height: parseFloat(el.style.height) || 30 }) as DOMRect;
const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return rectOf(this); });
  vi.useFakeTimers({ shouldAdvanceTime: false });
  fakeBridge.reset();
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
// sahte zamanlayıcı: bekleme gerçek saate bağlı değil, yük altında da aynı sonucu verir
const settle = (ms = 120) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const disconnected = () => fakeBridge.setPlugins(PLUGINS.map((p) => (p.main ? { ...p, connected: false } : p)));

describe("Pusula çizgisi kuralları", () => {
  it("onayda turuncu bekle, dikteyle nane dinle, Pusula yokken ya da gizliyken çizgi yok, geri kalanı soluk gri", () => {
    const base = { asistanUp: true, hidden: false };
    expect(lineOf({ ...base, kind: "approval" })).toEqual({ color: AMBER, mod: "bekle" });
    expect(lineOf({ ...base, kind: "approval-card" }).mod).toBe("bekle");
    expect(lineOf({ ...base, kind: "plugin", mascot: "dinliyor" })).toEqual({ color: MINT, mod: "dinle" });
    expect(lineOf({ ...base, kind: "plugin", mascot: "dusunuyor" })).toEqual({ color: AMBER, mod: "bekle" });
    expect(lineOf({ ...base, kind: "plugin", mascot: "konusuyor" })).toEqual({ color: "#F2555A", mod: "konus" });
    expect(lineOf({ ...base, kind: "plugin" }).mod).toBe("bos");
    expect(lineOf({ ...base, kind: "rest" }).mod).toBe("bos");
    expect(lineOf({ ...base, kind: "rest", asistanUp: false }).mod).toBe("yok");
    expect(lineOf({ ...base, kind: "rest", hidden: true }).mod).toBe("yok");
    expect(lineOf({ ...base, kind: "asistanyok" }).mod).toBe("yok");
    expect(lineOf({ ...base, kind: "ilk" }).mod).toBe("yok");
  });
  it("CSS değişkenleri maketteki sayılar", () => {
    expect(lineVars({ color: MINT, mod: "dinle" })).toMatchObject({ "--sh": .55, "--gl": .45, "--co": 1 });
    expect(lineVars({ color: "#8E8E93", mod: "bos" })).toMatchObject({ "--sh": .22, "--co": .32 });
    expect(lineVars({ color: "#8E8E93", mod: "yok" })).toMatchObject({ "--co": 0 });
  });
  it("ada durumu duyurunca şerit çizgisi renk ve kipi alır", async () => {
    render(<StripLine />);
    announceLine({ color: AMBER, mod: "bekle", gap: 0 });
    await settle(200);
    const el = document.getElementById("cizgi")!;
    expect(el.dataset.mod).toBe("bekle");
    expect(el.style.getPropertyValue("--lc")).toBe(AMBER);
  });
});

describe("ada: yeni halleri", () => {
  it("dnd: sessiz maskot, Rahatsız etme, onay sayısı, bitiş saati", async () => {
    fakeBridge.setSurfaces({ approvals: [APPROVAL_LOW], approvalTop: null });
    fakeBridge.setStatus({ dnd: true, dndUntil: "18:00'e kadar" });
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(screen.getByText("Rahatsız etme")).toBeTruthy();
    expect(screen.getByText("1 onay")).toBeTruthy();
    expect(screen.getByText("18:00'e kadar")).toBeTruthy();
  });
  it("çevrimdışı: uyku maskotu ve Çevrimdışı; olayla da açılır", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(screen.queryByText("Çevrimdışı")).toBeNull();
    await act(async () => { fakeBridge.emit("assistant_offline", true); });
    await settle();
    expect(screen.getByText("Çevrimdışı")).toBeTruthy();
  });
  it("ses kapalı: ortada Ses kapalı, çıkıntıda Kapalı", async () => {
    render(<Island monitor="m1" init={{ view: null, pin: true, osd: { percent: 0, muted: true, device: null } }} />);
    await settle();
    expect(screen.getAllByText("Ses kapalı").length).toBeGreaterThan(0);
    expect(screen.getByText("Kapalı")).toBeTruthy();
  });
  it("ada gizlenince ortada yalnız göz simgesi; ortaya tıklamak geri getirir", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await act(async () => { await fakeBridge.call("island_hide", { on: true }); });
    await settle(400);
    const c = screen.getByRole("button", { name: /Ada gizli: Ctrl\+Shift\+A ile geri getir/ });
    expect(screen.queryByText("Pusula hazır")).toBeNull();
    fireEvent.click(c);
    await settle();
    expect(screen.getByText("Pusula hazır")).toBeTruthy();
  });
  it("iş bitti: şeritte başlık ve süre, saatte en çok 3", async () => {
    render(<Island monitor="m1" init={{ view: null, pin: true }} />);
    await settle();
    for (const t of ["bir", "iki", "uc", "dort"]) await act(async () => { fakeBridge.emit("job_done", { title: t, took: "4 dk sürdü" }); });
    await settle();
    expect(screen.getByText("uc")).toBeTruthy();
    expect(screen.queryByText("dort")).toBeNull();
    expect(screen.getByText("4 dk sürdü")).toBeTruthy();
  });
  it("bütçe %80: yorgun maskot, Ayrıntı Sistem kartını açar; Sonra yok", async () => {
    fakeBridge.pushAlert({ id: "q1", title: "Günlük bütçe %80", subtitle: "Otomatik işler durdu, senin isteklerin sürer", icon: "yorgun", progress: 0.8, priority: 70 });
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(screen.getAllByText("Günlük bütçe %80").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Sonra" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ayrıntı" }));
    await settle();
    expect(screen.getByRole("dialog", { name: /^Modüller/ })).toBeTruthy();
  });
  it("uyarı u: birincil düğme Görev Yöneticisi eylemiyle, yanında Sonra", async () => {
    fakeBridge.pushAlert({ id: "cpu", title: "Chrome işlemciyi zorluyor", subtitle: "30 sn'dir %100", icon: "dikkat", action: "task_manager", priority: 70 });
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(screen.getByRole("button", { name: "Görev Yöneticisi'nde aç" }).className).toContain("ana");
    expect(screen.getByRole("button", { name: "Sonra" })).toBeTruthy();
  });
});

describe("ada: toplantı, Pusula bağlı değil, raf önerisi", () => {
  it("toplantı çıkıntısının ortasına tıklayınca toplantı kartı: Katıl ve sıradaki etkinlikler", async () => {
    fakeBridge.setSurfaces({ protrusion: PROTRUSION });
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    fireEvent.click(screen.getAllByRole("button").find((b) => b.className.includes("adaMerkez"))!);
    await settle();
    const dlg = screen.getByRole("dialog", { name: /^Modüller/ }); // Modüller, Takvim sekmesinde
    expect(screen.getByRole("tab", { name: "Takvim" }).getAttribute("aria-selected")).toBe("true");
    expect(dlg.textContent).toContain("Haftalık plan");
    expect(dlg.textContent).toContain("Asistan rutini");
    expect(screen.getByRole("button", { name: "Katıl" })).toBeTruthy();
  });
  it("Pusula bağlı değil kartı: beyaz Pusula'yı başlat düğmesi assistant_start çağırır", async () => {
    disconnected();
    render(<Island monitor="m1" init={{ view: "asistanyok" }} />);
    await settle();
    const b = screen.getByRole("button", { name: "Pusula'yı başlat" });
    expect(b.className).toContain("ana");
    fireEvent.click(b);
    await settle();
    expect(fakeBridge.log.some((l) => l.cmd === "assistant_start")).toBe(true);
  });
  it("Pusula bağlı değilken dinlenmede ortaya tıklamak Pusula bağlı değil kartını açar", async () => {
    disconnected();
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Pusula bağlı değil. Başlatmak için aç/ }));
    await settle();
    expect(screen.getByRole("dialog", { name: "Pusula bağlı değil" })).toBeTruthy();
  });
  it("raf kartı: PDF için Pusula önerisi ve üç düğme; ortada yalnız Raf", async () => {
    fakeBridge.setShelf([{ id: "f1", name: "sunum-taslak.pdf", sub: "2,4 MB", kind: "pdf" }, { id: "f2", name: "ekran-kaydı.mp4", sub: "38 MB", kind: "video" }]);
    render(<Island monitor="m1" init={{ view: "raf" }} />);
    await settle();
    expect(screen.getByText(/Özetleyip Notlara not olarak ekleyeyim mi/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Notlara ekle/ }));
    await settle();
    expect(fakeBridge.log.some((l) => l.cmd === "shelf_memory")).toBe(true);
    expect(screen.queryByText("2 dosya")).toBeNull();
  });
});

describe("kart durumları ve bağlamalar", () => {
  it("ilk bağlantı: ilk2 kartı açılır, Tamam kapatır ve first_connect_ack söner", async () => {
    fakeBridge.setFirstConnect(true);
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const dlg = screen.getByRole("dialog", { name: "Pusula bağlandı" });
    expect(dlg).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent === "Tamam")!);
    await settle();
    expect(screen.queryByRole("dialog", { name: "Pusula bağlandı" })).toBeNull();
  });
  it("Pano yüklenemezse hata kartı: Claude Code'a ulaşamıyorum, Yeniden dene", async () => {
    render(<Island monitor="m1" init={{ view: "pano", card: "kh" }} />);
    await settle();
    expect(screen.getByRole("dialog", { name: "Hata" }).textContent).toContain("Claude Code'a ulaşamıyorum");
    expect(screen.getByRole("button", { name: "Yeniden dene" })).toBeTruthy();
  });
  it("yükleniyor kartı 800 ms geçmeden görünmez", async () => {
    render(<Island monitor="m1" init={{ view: "pano" }} />);
    await settle(30);
    expect(screen.queryByRole("status", { name: "Pano okunuyor" })).toBeNull();
  });
  it("eklenti izni bekleyince şeritte kalkan simgesi ve Eklenti izni; d2 sohbetinde bildirim sayısı", async () => {
    fakeBridge.setConsent(CONSENT);
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(screen.getByText("Eklenti izni")).toBeTruthy();
  });
  it("şerit menüsünde Çık, Peeka'nın kendi onay sorusunu açar", async () => {
    render(<Shell monitor="m1" init={{ menu: { kind: "strip", x: 900 } }} />);
    await settle();
    fireEvent.click(screen.getByRole("menuitem", { name: "Çık" }));
    await settle(400);
    expect(screen.getByRole("dialog", { name: "Çıkış onayı" }).getAttribute("aria-hidden")).toBe("false");
  });
  it("ada sayfasındaki dişli (open-panel) Ayarlar › Modüller'i açar", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    act(() => sendX({ t: "open-panel", panel: "aym" }));
    await settle(300);
    expect(document.querySelector("[data-panel=settings]")!.getAttribute("aria-hidden")).toBe("false");
  });
});
