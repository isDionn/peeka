import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { createBatteryTiers, createBurst, createCcSessions, burstLabel } from "../lib/notes";
import { VOICE_THINKING, PROTRUSION } from "../plugin.fixtures";
import type { Media } from "../bridge";

// 11 ses göstergesi / 13 iki oturum / 15 kota / 16 döküm + müzik / 26 pil / 33 bildirim yağmuru / 43 Neden?
const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset();
  localStorage.clear(); sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
// Sanal saat açıkken (testin başında vi.useFakeTimers) gerçek bekleme yok: yük altında da aynı sonuç; 16 ms adım = bir kare, her adım sonunda React işi (efektler, zamanlayıcılar) işlenir
const fakeSettle = async (ms: number) => { for (let t = 0; t < ms; t += 16) await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(16, ms - t)); }); };
const settle = (ms = 80) => vi.isFakeTimers() ? fakeSettle(ms) : act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const center = () => document.querySelector<HTMLElement>(".adaMerkez")!;
const MUSIC: Media = { title: "Şarkı", artist: "Sanatçı", album: "A", app: "Spotify", art: null, playing: true, positionMs: 10000, positionAt: Date.now(), durationMs: 200000, canNext: true, canPrevious: true, canSeek: true };
const LIVE = { ...PROTRUSION, title: "Claude · Düşünüyor…", icon: "code", actions: [] };
const batt = (percent: number, powered = false) => fakeBridge.setBattery({ percent, charging: powered, plugged: powered, remaining: null });

describe("saf mantık", () => {
  it("pil: %20'de bir kez, %10'da bir kez, prizde sıfırlanır, doğrudan %8'de yalnız 10", () => {
    const t = createBatteryTiers();
    expect([t.feed(30, false), t.feed(20, false), t.feed(19, false), t.feed(10, false), t.feed(9, false)]).toEqual([null, 20, null, 10, null]);
    expect(t.feed(50, true)).toBeNull();
    expect(t.feed(20, false)).toBe(20);
    const u = createBatteryTiers();
    expect([u.feed(8, false), u.feed(7, false), u.feed(null, false)]).toEqual([10, null, null]);
  });
  it("yağmur: ilk liste taban; 5 sn'de 6 yeni = bir çıkıntı; 5 sn'den yayılırsa yok", () => {
    const n = (i: number) => ({ id: "n" + i, app: i % 2 ? "Discord" : "Outlook" });
    const b = createBurst();
    expect(b.feed([n(100)], 0)).toBeNull();
    const six = [1, 2, 3, 4, 5, 6].map(n);
    expect(b.feed(six.slice(0, 5), 1000)).toBeNull();
    expect(b.feed(six, 2000)).toEqual({ n: 6, apps: ["Discord", "Outlook"] });
    expect(b.feed(six, 2500)).toBeNull();
    const c = createBurst(); c.feed([], 0);
    expect([1, 2, 3, 4, 5, 6].map((i) => c.feed([n(i)], i * 2000))).toEqual([null, null, null, null, null, null]);
  });
  it("etiket: iki ad ve üç nokta, gizliyken ad yok", () => {
    expect(burstLabel(6, ["Discord", "Outlook", "Teams"])).toBe("6 yeni bildirim: Discord, Outlook…");
    expect(burstLabel(6, ["Discord"], true)).not.toContain("Discord");
  });
  it("oturum sayısı: başlayanlar eksi bitenler; bayat olunca sıfırlanır", () => {
    const s = createCcSessions(1000);
    expect([s.feed({ kind: "session_start" }, 0), s.feed({ kind: "session_start" }, 10), s.feed({ kind: "pre_tool" }, 20), s.feed({ kind: "session_end" }, 30), s.feed({ kind: "session_end" }, 40), s.feed({ kind: "session_end" }, 50)]).toEqual([1, 2, 2, 1, 0, 0]);
    s.feed({ kind: "session_start" }, 100);
    expect(s.feed({ kind: "session_start" }, 5000)).toBe(1);
  });
  it("oturum etiketi (sid): kimliğe göre izlenir, son aracı tutar, session_end siler, sessiz kalan düşer", () => {
    const s = createCcSessions(1000, 5000);
    expect(s.feed({ kind: "session_start", sid: "aaaaaaaa" }, 0)).toBe(1);
    expect(s.feed({ kind: "session_start", sid: "bbbbbbbb" }, 10)).toBe(2);
    expect(s.feed({ kind: "pre_tool", tool: "Bash", sid: "aaaaaaaa" }, 20)).toBe(2);
    expect(s.feed({ kind: "post_tool", sid: "aaaaaaaa" }, 30)).toBe(2);
    expect(s.list(30)).toEqual([{ sid: "aaaaaaaa", tool: "Bash", at: 30 }, { sid: "bbbbbbbb", tool: null, at: 10 }]);
    expect(s.count(5020)).toBe(1); // b 5 sn sessiz kaldı, düştü
    expect(s.feed({ kind: "session_end", sid: "aaaaaaaa" }, 5100)).toBe(0);
    expect(s.feed({ kind: "stop", sid: "bbbbbbbb" }, 5200)).toBe(1); // düşen oturum yeni olayla geri gelir
    expect(s.feed({ kind: "session_start" }, 5300)).toBe(2); // sid'siz (ana asistan) sayaçla sayılır
  });
});

describe("26 pil kademeleri (ada)", () => {
  it("%25 sessiz, %20 bir kez, Esc susturur, %10 yeniden, prize takınca sıfırlanır", { timeout: 20000 }, async () => {
    vi.useFakeTimers();
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => batt(25));
    await settle();
    expect(center().textContent).not.toContain("Pil %");
    act(() => batt(20));
    await settle();
    expect(center().textContent).toContain("Pil %20");
    fireEvent.keyDown(document, { key: "Escape" });
    await settle(220);
    expect(center().textContent).not.toContain("Pil %");
    act(() => batt(19));
    await settle();
    expect(center().textContent).not.toContain("Pil %"); // aynı kademe ikinci kez çıkmaz
    act(() => batt(10));
    await settle();
    expect(center().textContent).toContain("Pil %10");
    act(() => batt(12, true));
    await settle(220);
    expect(center().textContent).not.toContain("Pil %10");
    act(() => batt(19));
    await settle(3300); // şarj takma çıkıntısı (3 sn) önce kalkar
    expect(center().textContent).toContain("Pil %19"); // şarjdan sonra yeniden hak
  });
  it("%20 canlı işin altında baloncuğa iner, %10 canlı işin üstüne çıkar", { timeout: 20000 }, async () => {
    fakeBridge.setSurfaces({ protrusion: LIVE });
    fakeBridge.setMedia(null);
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => batt(20));
    await settle(300);
    expect(center().textContent).toContain("Claude");
    expect(document.querySelector(".yanDug")?.getAttribute("aria-label")).toContain("Pil %20");
    act(() => batt(10));
    await settle(300);
    expect(center().textContent).toContain("Pil %10");
  });
});

describe("33 bildirim yağmuru", () => {
  it("6 bildirim 5 sn içinde tek çıkıntı olur; tıklayınca çıkıntı kalkar", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => { for (let i = 1; i <= 6; i++) fakeBridge.pushNotice({ id: "y" + i, app: i % 2 ? "Discord" : "Outlook", title: "t" + i }); });
    await settle(300);
    expect(center().textContent).toContain("6 yeni bildirim: Discord, Outlook");
    fireEvent.click(screen.getByRole("button", { name: "Listeyi aç" }));
    await settle(300);
    expect(center().textContent).not.toContain("6 yeni bildirim");
  });
  it("5 bildirim yetmez; kilitliyken uygulama adı yok", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => { for (let i = 1; i <= 5; i++) fakeBridge.pushNotice({ id: "z" + i, app: "Discord", title: "t" }); });
    await settle(300);
    expect(center().textContent).not.toContain("yeni bildirim");
    act(() => fakeBridge.setLocked(true));
    act(() => fakeBridge.pushNotice({ id: "z6", app: "Discord", title: "t" }));
    await settle(300);
    expect(center().textContent).toContain("Yeni bildirimler var");
    expect(center().textContent).not.toContain("Discord");
  });
});

describe("15 kota doldu", () => {
  it("stop_failure + rate_limit: 'Kota doldu' (reset saati yok); Tamam kaldırır; başka sebep çıkmaz", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.emit("cc_event", { kind: "stop_failure", reason: "server_error" }));
    await settle(200);
    expect(center().textContent).not.toContain("Kota doldu");
    act(() => fakeBridge.emit("cc_event", { kind: "stop_failure", reason: "rate_limit" }));
    await settle(300);
    expect(center().textContent).toContain("Kota doldu");
    expect(center().textContent).not.toMatch(/sonra|sıfırlan/);
    fireEvent.click(screen.getByRole("button", { name: "Tamam" }));
    await settle(300);
    expect(center().textContent).not.toContain("Kota doldu");
  });
});

describe("13 iki oturum", () => {
  it("iki session_start: 'N oturum' çipi; tıklayınca liste; bir session_end çipi kaldırır", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.emit("cc_event", { kind: "session_start" }));
    await settle(100);
    expect(document.querySelector(".oturumChip")).toBeNull();
    act(() => fakeBridge.emit("cc_event", { kind: "session_start" }));
    await settle(100);
    fireEvent.click(screen.getByRole("button", { name: /2 oturum/ }));
    expect(screen.getByRole("group", { name: "Claude Code oturumları" }).textContent).toContain("2 Claude Code oturumu açık");
    act(() => fakeBridge.emit("cc_event", { kind: "session_end" }));
    await settle(100);
    expect(document.querySelector(".oturumChip")).toBeNull();
  });
  it("oturumlar 'Oturum 1', 'Oturum 2' diye son araçlarıyla listelenir", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => { fakeBridge.emit("cc_event", { kind: "session_start", sid: "1a2b3c4d" }); fakeBridge.emit("cc_event", { kind: "pre_tool", tool: "Grep", sid: "5e6f7a8b" }); });
    await settle(100);
    fireEvent.click(screen.getByRole("button", { name: /2 oturum/ }));
    const list = screen.getByRole("group", { name: "Claude Code oturumları" }).textContent!;
    expect(list).toContain("Oturum 1: olay");
    expect(list).toContain("Oturum 2: Grep");
    expect(list).not.toContain("ayırt edilemiyor");
    expect(list).not.toContain("1a2b3c4d");
  });
  it("çip ada merkezinin kutusunu değiştirmez", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const before = center().style.width;
    act(() => { fakeBridge.emit("cc_event", { kind: "session_start" }); fakeBridge.emit("cc_event", { kind: "session_start" }); });
    await settle(100);
    expect(document.querySelector(".oturumChip")).not.toBeNull();
    expect(center().style.width).toBe(before);
  });
});

describe("43 Neden?", () => {
  it("hata kartı: Neden? ayrıntıyı açar; kilitliyken ayrıntı gizli", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: "hata", err: "Bash" }} />);
    await settle(300);
    fireEvent.click(screen.getByRole("button", { name: "Neden?" }));
    expect(screen.getByRole("note").textContent).toContain("Bash başarısız oldu");
  });
  it("kilitliyken yol ya da araç adı görünmez", { timeout: 20000 }, async () => {
    fakeBridge.setLocked(true);
    render(<Island monitor="m1" init={{ view: "hata", err: "C:\\gizli\\yol.txt" }} />);
    await settle(300);
    fireEvent.click(screen.getByRole("button", { name: "Neden?" }));
    expect(screen.getByRole("note").textContent).toBe("Kilitliyken ayrıntı gizli.");
    expect(document.body.textContent).not.toContain("gizli\\yol");
  });
});

describe("11 ses göstergesi Claude canlıyken", () => {
  it("OSD ortayı 1,8 sn ödünç alır, Claude geri döner; baloncuk yerinde kalır", { timeout: 20000 }, async () => {
    fakeBridge.setSurfaces({ protrusion: LIVE });
    fakeBridge.setMedia(MUSIC);
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle(300);
    expect(center().textContent).toContain("Claude");
    const bal = document.querySelector(".yanDug")?.getAttribute("aria-label");
    expect(bal).toBeTruthy();
    act(() => fakeBridge.volumeOsd({ percent: 40, muted: false, device: null }));
    await settle(200);
    expect(center().textContent).toContain("Ses");
    expect(document.querySelector(".yanDug")?.getAttribute("aria-label")).toBe(bal);
    for (let i = 0; i < 20 && center().textContent!.includes("Ses"); i++) await settle(250); // yükte zamanlayıcılar geç kalabilir
    expect(center().textContent).toContain("Claude");
    expect(center().textContent).not.toContain("Ses");
  });
});

describe("16 Hey Pusula dökümü", () => {
  it("döküm ana şeritteyken müzik yan baloncukta", { timeout: 20000 }, async () => {
    fakeBridge.setSurfaces({ protrusion: VOICE_THINKING });
    fakeBridge.setMedia(MUSIC);
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle(300);
    expect(document.querySelector(".yanDug")?.getAttribute("aria-label")).toContain("Çalıyor");
    expect(center().textContent).not.toContain("Çalıyor");
  });
});
