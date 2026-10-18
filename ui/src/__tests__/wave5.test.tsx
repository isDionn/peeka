import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_SECRET, fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { ShelfBump, ShelfCard } from "../components/Extras";
import { ContextMenu } from "../components/Menus";
import { NotificationList } from "../components/Notifications";
import { PanoView } from "../components/Pano";
import { ApprovalCenter, Lead, ProtrusionBump, ProtrusionCenter } from "../components/Plugin";
import { Shell } from "../components/Shell";
import { AppIcon } from "../components/common";
import { clearPreviewCache } from "../components/WindowPreview";
import { FIRST_KEY } from "../lib/firstRun";
import { moodOf } from "../lib/plugin";
import { onX, sendX, type XMsg } from "../lib/xwin";
import { resetMascotRegistry } from "../mascot/useSingleMascot";
import { MOODS } from "../mascot";
import { Ghost } from "../mascot/ghost";
import { APPROVAL_LOW, OTHER, PLUGINS, PROTRUSION, SURFACES_FULL, PUSULA } from "../plugin.fixtures";

const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset();
  clearPreviewCache();
  localStorage.clear(); sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  resetMascotRegistry();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("data-renkli");
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const settle = (ms = 60) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const logged = (cmd: string) => fakeBridge.log.filter((l) => l.cmd === cmd);
const center = () => document.querySelector<HTMLElement>(".adaMerkez")!;
/** Çapraz geçiş sırasında eski içerik 140 ms DOM'da kalır; güncel olan. */
const now = () => center().querySelector<HTMLElement>(".adaMk:not(.eski)")!;
const rowOf = (id: string) => document.querySelector<HTMLElement>(`[data-clip="${id}"]`);

describe("güvenlik: clip_visible başarısızsa parola satırı hiç çizilmez", () => {
  const mockVisible = (impl: () => Promise<boolean>) => {
    const orig = fakeBridge.call.bind(fakeBridge) as (c: string, a?: unknown) => Promise<unknown>;
    vi.spyOn(fakeBridge, "call").mockImplementation(((cmd: string, args?: { on?: boolean }) => (cmd === "clip_visible" && args?.on ? impl() : orig(cmd, args))) as never);
  };
  it("Rust false döner: parola satırı yok, diğerleri var, neden yazılır", async () => {
    mockVisible(async () => false);
    render(<PanoView />);
    await screen.findByText("ekran-kaydı.mp4");
    expect(rowOf("c6")).toBeNull();
    expect(document.body.textContent).not.toContain("Bitwarden");
    expect(document.body.textContent).toContain("Parolalar gizli");
  });
  it("komut reddedilir (hata): aynı şekilde parola yok", async () => {
    mockVisible(async () => { throw "denied"; });
    render(<PanoView />);
    await screen.findByText("ekran-kaydı.mp4");
    expect(rowOf("c6")).toBeNull();
  });
  it("cevap gelene dek hiçbir satır çizilmez (parola dahil)", async () => {
    mockVisible(() => new Promise(() => undefined));
    render(<PanoView />);
    await settle();
    expect(rowOf("c6")).toBeNull();
    expect(rowOf("c9")).toBeNull();
  });
  it("true döner: parola satırı maskeli çizilir, düz metin yok", async () => {
    render(<PanoView />);
    await screen.findByText("ekran-kaydı.mp4");
    expect(rowOf("c6")).not.toBeNull();
    expect(document.body.textContent).not.toContain(FAKE_SECRET);
  });
});

describe("canlı döküm: konuşan etiketi (karar 18)", () => {
  const item = { ...PROTRUSION, liveText: { streamId: "s9" }, icon: "mic" };
  it("speaker 'Sen' gelince satırın başında etiket olur; gelmezse etiket yok", async () => {
    const { container } = render(<ProtrusionBump item={item} />);
    await settle();
    act(() => fakeBridge.emit("plugin_stream", { streamId: "s9", text: "yarın sabah dokuzda ekiple" }));
    expect(container.querySelector(".canliYazi")!.textContent).toBe("yarın sabah dokuzda ekiple");
    expect(container.querySelector(".kim")).toBeNull();
    act(() => fakeBridge.emit("plugin_stream", { streamId: "s9", text: "yarın sabah dokuzda ekiple", speaker: "Sen" }));
    const live = container.querySelector(".canliYazi")!;
    expect(live.querySelector(".kim")!.textContent).toBe("Sen");
    expect(live.firstElementChild!.className).toBe("kim"); // metinden önce
    expect(live.textContent).toBe("Senyarın sabah dokuzda ekiple");
  });
  it("etiket düz metindir (HTML kaçışı) ve kısaltılır", async () => {
    const { container } = render(<ProtrusionBump item={item} />);
    await settle();
    act(() => fakeBridge.emit("plugin_stream", { streamId: "s9", text: "x", speaker: "<b>Sen</b>" + "a".repeat(80) }));
    expect(container.querySelector(".canliYazi b")).toBeNull();
    expect(container.querySelector(".kim")!.textContent!.length).toBeLessThanOrEqual(24);
  });
});

describe("maskot", () => {
  it("hal adı -> maskot hali; her hal tablosunda var", () => {
    expect(moodOf("dinliyor")).toBe("listening");
    expect(moodOf("dusunuyor")).toBe("thinking");
    expect(moodOf("konusuyor")).toBe("speaking");
    expect(moodOf("onay")).toBe("approval");
    expect(moodOf("bitti")).toBe("done");
    expect(moodOf("hata")).toBe("error");
    expect(moodOf("tanımsız")).toBe("idle");
    for (const h of ["hazir", "dinliyor", "dusunuyor", "konusuyor", "onay", "ciddi", "hata", "bitti", "muzik", "bosta", "uyku", "sessiz", "yorgun", "dikkat"]) expect(MOODS[moodOf(h)]).toBeDefined();
  });
  it("soru onayı 'question' maskotu, izin onayı 'approval' (gerçek kaynak: onayın türü)", () => {
    const q = render(<ApprovalCenter a={{ ...APPROVAL_LOW, kind: "question" }} />);
    expect(q.container.querySelector<HTMLElement>(".mascot")!.dataset.mood).toBe("question"); q.unmount(); resetMascotRegistry();
    const c = render(<ApprovalCenter a={{ ...APPROVAL_LOW, kind: "command" }} />);
    expect(c.container.querySelector<HTMLElement>(".mascot")!.dataset.mood).toBe("approval");
    expect([moodOf("arama"), moodOf("soru"), moodOf("kota"), moodOf("sersem")]).toEqual(["searching", "question", "ratelimit", "dizzy"]);
  });
  it("ilerleme çubuğu: ana asistanın maskotu çubukta ilerler (tek maskot, orta satırda ikincisi yok); ilerlemesizde çubuk eskisi gibi", () => {
    const item = { ...PROTRUSION, progress: 0.4, mascot: "dusunuyor" };
    const a = render(<><ProtrusionCenter item={item} /><ProtrusionBump item={item} /></>);
    expect(a.container.querySelectorAll(".mascot").length).toBe(1);
    expect(a.container.querySelector(".ilerleMk .binici .mascot")).not.toBeNull();
    expect(a.container.querySelector<HTMLElement>(".ilerleMk")!.style.getPropertyValue("--y")).toBe("0.4");
    a.unmount(); resetMascotRegistry();
    const b = render(<ProtrusionBump item={{ ...PROTRUSION, progress: 0.4, mascot: null }} />);
    expect(b.container.querySelector(".ilerleMk")).toBeNull(); expect(b.container.querySelector(".miniIlerle")).not.toBeNull();
  });
  it("Lead: ana asistanda maskot (boy ve hal ile), değilse baş harf karosu", () => {
    const main = render(<Lead plugin={PUSULA} mascot="dinliyor" size={56} />);
    const m = main.container.querySelector<HTMLElement>(".mascot")!;
    expect(m.dataset.mood).toBe("listening");
    expect(m.dataset.size).toBe("56");
    main.unmount();
    const other = render(<Lead plugin={OTHER} mascot="dinliyor" />);
    expect(other.container.querySelector(".mascot")).toBeNull();
    expect(other.container.querySelector(".basHarf")).not.toBeNull();
  });
  it("dinlenme: Pusula bağlıyken maskot + 'Pusula hazır' + onay ve bildirim sayısı; saat ortada yok", async () => {
    fakeBridge.setSurfaces({ approvals: [APPROVAL_LOW], approvalTop: null }); // dikkat bütçesi onayı çıkıntıya almadı: şeritte yalnız sayı
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const c = center();
    expect(c.querySelector(".mascot")!.getAttribute("data-size")).toBe("40");
    expect(c.querySelector<HTMLElement>(".mascot")!.dataset.mood).toBe("approval"); // bekleyen onay maskotun halini belirler
    expect(c.textContent).toContain("Pusula hazır");
    expect(c.textContent).toContain("1 onay");
    expect(c.textContent).toContain("4 bildirim");
    expect(c.querySelector(".num.b6:not(.onaySay)")).toBeNull();
  });
  it("üç durumda da aynı 40 px asılı maskot: Pusula yok (idle), bağlı değil (idle, uyku değil), bağlı (asıl hal)", async () => {
    const sig = () => { const m = center().querySelector<HTMLElement>(".mascot")!; return { mood: m.dataset.mood, size: m.dataset.size, hang: m.dataset.hang, w: m.style.width, h: m.style.height }; };
    fakeBridge.setPlugins([]);
    const a = render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const none = sig();
    expect(center().textContent).toMatch(/\d\d:\d\d/);
    expect(center().textContent).not.toContain("Pusula hazır");
    a.unmount(); resetMascotRegistry();
    fakeBridge.setPlugins(PLUGINS.map((p) => ({ ...p, connected: false })));
    const b = render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const asleep = sig();
    expect(center().querySelector(".soluk")).toBeNull();
    expect(center().textContent).not.toContain("Pusula hazır");
    b.unmount(); resetMascotRegistry();
    fakeBridge.setPlugins(PLUGINS);
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const up = sig();
    expect([none.mood, asleep.mood]).toEqual(["idle", "idle"]);
    for (const x of [none, asleep]) expect({ ...x, mood: 0 }).toEqual({ ...up, mood: 0 });
    expect(up).toMatchObject({ size: "40", hang: "1", w: "40px", h: "30px" });
  });
  it("Claude Code olayları (cc_event) sakin maskotu sürer: arama, soru, bitti; Pusula'nın onayı önde kalır", async () => {
    const real = fakeBridge.call.bind(fakeBridge) as (c: string, ...a: unknown[]) => Promise<unknown>;
    const spy = vi.spyOn(fakeBridge, "call").mockImplementation(((c: string, ...a: unknown[]) => (c === "assistant_counts" ? Promise.resolve({ jobs: 0, memory: 0, approvals: 0 }) : real(c, ...a))) as never);
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const mood = () => center().querySelector<HTMLElement>(".mascot")!.dataset.mood;
    expect(mood()).toBe("idle");
    await act(async () => { fakeBridge.emit("cc_event", { kind: "pre_tool", tool: "WebSearch" }); });
    expect(mood()).toBe("searching");
    await act(async () => { fakeBridge.emit("cc_event", { kind: "pre_tool", tool: "AskUserQuestion" }); });
    expect(mood()).toBe("question");
    await act(async () => { fakeBridge.emit("cc_event", { kind: "stop_failure", reason: "rate_limit" }); });
    expect(document.querySelector(".adaMerkez")!.textContent).toContain("Kota doldu"); // kota çıkıntısı ortayı alır (satır 15); Esc kaldırınca maskot yorgun kalır
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
    expect(mood()).toBe("ratelimit");
    await act(async () => { fakeBridge.emit("cc_event", { kind: "stop" }); });
    expect(mood()).toBe("done");
    await act(async () => { fakeBridge.emit("cc_event", { kind: "session_end" }); });
    expect(mood()).toBe("idle");
    spy.mockRestore();
  });
  it("cc_event: Pusula'nın bekleyen onayı varken Claude Code halinin önüne geçer", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await act(async () => { fakeBridge.emit("cc_event", { kind: "pre_tool", tool: "WebSearch" }); });
    expect(center().querySelector<HTMLElement>(".mascot")!.dataset.mood).toBe("approval");
  });
  it("sohbet sürerken maskotun hali değişir: düşünüyor -> konuşuyor", async () => {
    fakeBridge.setSurfaces({ composer: { ...PUSULA, voice: true } });
    render(<Island monitor="m1" init={{ view: null, ask: "merhaba" }} />);
    await settle(20);
    // ask kartı açık; kart kapanınca şeritteki maskot gerçek hali söyler
    fireEvent.keyDown(document, { key: "Escape" });
    await settle(30);
    expect(["thinking", "speaking", "done", "idle"]).toContain(center().querySelector<HTMLElement>(".mascot")?.dataset.mood);
  });
  it("tıklama: ortadaki maskot zıplar ve Modüller kartı açılır", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    fireEvent.click(center());
    await settle();
    expect(screen.getByRole("dialog", { name: /^Modüller/ })).toBeTruthy();
    expect(center().querySelector(".mascot")).toBeNull(); // kartta bir bilgi bir kez
  });
});

describe("boştaki muziplik (Island yoklaması)", { timeout: 30_000 }, () => {
  const run = async (prep?: () => void, minutes = 47) => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.spyOn(Math, "random").mockReturnValue(0); // aralık = en kısa, 45 dk
    const prank = vi.spyOn(Ghost.prototype, "prank").mockImplementation(() => undefined);
    fakeBridge.setMedia(null); // çalan müzik muzipliği engeller (PrankEnv.musicPlaying)
    prep?.();
    render(<Island monitor="m1" init={{ view: null }} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(minutes * 60_000); });
    return prank;
  };
  it("45 dk sonra ve girdi yokken bir kez oynar", async () => { expect((await run()).mock.calls).toHaveLength(1); });
  it("süre dolmadan oynamaz", async () => { expect((await run(undefined, 30)).mock.calls).toHaveLength(0); });
  it("ayarlardan kapalıysa oynamaz", async () => { expect((await run(() => void fakeBridge.call("set_settings", { patch: { mascotPranks: false } }))).mock.calls).toHaveLength(0); });
  it("rahatsız etme açıkken oynamaz", async () => { expect((await run(() => void fakeBridge.call("set_dnd", { on: true }))).mock.calls).toHaveLength(0); });
  it("tam ekranda oynamaz", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.spyOn(Math, "random").mockReturnValue(0);
    const prank = vi.spyOn(Ghost.prototype, "prank").mockImplementation(() => undefined);
    fakeBridge.setMedia(null);
    render(<Island monitor="m1" init={{ view: null }} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    act(() => fakeBridge.emit("notch://fullscreen", true));
    await act(async () => { vi.advanceTimersByTime(47 * 60_000); });
    expect(prank).not.toHaveBeenCalled();
  });
  it("son 3 sn'de girdi varsa (input_tick) ertelenir, sessizlik gelince oynar", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.spyOn(Math, "random").mockReturnValue(0);
    const prank = vi.spyOn(Ghost.prototype, "prank").mockImplementation(() => undefined);
    fakeBridge.setMedia(null);
    render(<Island monitor="m1" init={{ view: null }} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(45 * 60_000 - 1000); });
    act(() => fakeBridge.emit("input_tick", { lastInputAgoMs: 500, cursor: null }));
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(prank).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(4000); });
    expect(prank).toHaveBeenCalledTimes(1);
  });
});

describe("Ayarlar › Maskot (ays)", () => {
  it("muziplik anahtarı ayara yazılır; 'İlk açılışı tekrar göster' işareti siler ve ada sayfasına haber verir", async () => {
    render(<Shell monitor="m1" init={{ panel: "ays" }} />);
    const sw = await screen.findByRole("switch", { name: "Maskot muziplikleri" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    await settle();
    expect((await fakeBridge.call("get_settings")).mascotPranks).toBe(false);
    localStorage.setItem(FIRST_KEY, "1");
    const got: XMsg[] = [];
    const off = onX((m) => got.push(m));
    fireEvent.click(screen.getByRole("button", { name: "Göster" }));
    await settle(80);
    off();
    expect(localStorage.getItem(FIRST_KEY)).toBeNull();
    expect(got).toContainEqual({ t: "firstrun" });
  });
  it("ada: 'firstrun' iletisi hoş geldin kartını açar", async () => {
    localStorage.setItem(FIRST_KEY, "1");
    render(<Island monitor="m1" />);
    await settle();
    expect(screen.queryByRole("dialog", { name: /hoş geldin/ })).toBeNull();
    sendX({ t: "firstrun" });
    await settle(80);
    expect(screen.getByRole("dialog", { name: /hoş geldin/ })).toBeTruthy();
  });
});

describe("küçük çıkıntılar (karar 12)", () => {
  it("şarj: fişe takılınca 'Şarj oluyor %78' ve 'yaklaşık' dolum süresi", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.setBattery({ percent: 78, charging: true, plugged: true, remaining: "1 sa" }));
    await settle();
    expect(center().textContent).toContain("Şarj oluyor");
    expect(screen.getByRole("group", { name: "Şarj oluyor" }).textContent).toContain("Tam dolmasına yaklaşık 1 sa");
  });
  it("açılışta zaten şarjdaysa çıkıntı açılmaz (yalnız takma anı)", async () => {
    fakeBridge.setBattery({ percent: 78, charging: true, plugged: true, remaining: "1 sa" });
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(center().textContent).not.toContain("Şarj oluyor");
  });
  it("düşük pil: %12 prizde değilken çıkıntı; 'Pil tasarrufu' Ayarlar sayfasını açar; Esc susturur", async () => {
    const spy = vi.spyOn(fakeBridge, "call");
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.setBattery({ percent: 12, charging: false, plugged: false, remaining: "25 dk" }));
    await settle();
    expect(center().textContent).toContain("Pil %12");
    expect(screen.getByText("Yaklaşık 25 dk kaldı")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pil tasarrufu ayarları" }));
    expect(spy).toHaveBeenCalledWith("open_windows_settings", { uri: "ms-settings:batterysaver" });
    fireEvent.keyDown(document, { key: "Escape" });
    await settle(220);
    expect(center().textContent).not.toContain("Pil %12");
  });
  it("prizdeyken ya da %21'de düşük pil çıkıntısı yok", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.setBattery({ percent: 21, charging: false, plugged: false, remaining: null }));
    await settle();
    expect(center().textContent).not.toContain("Pil %");
    act(() => fakeBridge.setBattery({ percent: 9, charging: false, plugged: true, remaining: null }));
    await settle();
    expect(center().textContent).not.toContain("Pil %9");
  });
  it("Bluetooth kulaklık: pil varsa 'Pil %80'; pil bildirmeyen cihazda yalnız şeritte 'bağlandı'", async () => {
    render(<Island monitor="m1" init={{ view: null, pin: true }} />);
    await settle();
    act(() => fakeBridge.emit("bluetooth_connected", { name: "Buds Pro", battery: 80 }));
    await settle();
    expect(center().textContent).toContain("Buds Pro bağlandı");
    expect(screen.getByText("Pil %80")).toBeTruthy();
    act(() => fakeBridge.emit("bluetooth_connected", { name: "Hoparlör", battery: null }));
    await settle(220);
    expect(center().textContent).toContain("Hoparlör bağlandı");
    expect(screen.queryByText(/Pil %/)).toBeNull();
  });
  it("zamanlayıcı: kalan süre şeritte, duraklat / +5 dk / bitir Rust'a gider", async () => {
    fakeBridge.setTimer({ label: "Odak", totalS: 1500, remainingS: 1452, running: true });
    fakeBridge.setMedia(null); // çalan müzik zamanlayıcının önünde durur (yan baloncuk kararı 2026-10-17); burada zamanlayıcı tek iş
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(center().textContent).toMatch(/24:1[12]/);
    expect(center().textContent).toContain("Odak");
    fireEvent.click(screen.getByRole("button", { name: "Duraklat" }));
    fireEvent.click(screen.getByRole("button", { name: "+5 dk" }));
    await settle();
    expect(logged("timer_control").map((l) => (l.args as { action: string }).action)).toEqual(["pause", "add5"]);
    fireEvent.click(center()); // zamanlayıcı çalarken de ortaya tıklamak Modüller'i açar
    await settle();
    expect(screen.getByRole("dialog", { name: /^Modüller/ })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await settle(220);
    fireEvent.click(screen.getByRole("button", { name: "Bitir" }));
    await settle(220);
    expect(center().textContent).not.toContain("Odak");
  });
  it("dikte: dalga ve canlı metin; ticket: bilet simgesi; kayıt: kırmızı nokta + sayaç şeritte, Durdur kırmızı dolu", () => {
    const dik = render(<ProtrusionCenter item={{ ...PROTRUSION, title: "Dikte", icon: null, state: "info", mascot: "dinliyor", liveText: { streamId: "s" } }} />);
    expect(dik.container.querySelector(".dalga")).not.toBeNull();
    dik.unmount(); resetMascotRegistry();
    const tik = render(<ProtrusionCenter item={{ ...PROTRUSION, title: "Yeni ticket", icon: "ticket", mascot: null }} />);
    expect(tik.container.querySelector(".ikK svg")).not.toBeNull();
    tik.unmount();
    const kayit = { ...PROTRUSION, title: "Kayıt", icon: null, state: "danger" as const, mascot: null, timer: { startedAt: new Date(Date.now() - 134_000).toISOString() }, actions: [{ id: "duraklat", label: "Duraklat" }, { id: "durdur", label: "Durdur", style: "destructive" as const }] };
    const rec = render(<><ProtrusionCenter item={kayit} /><ProtrusionBump item={kayit} /></>);
    expect(rec.container.querySelector(".kayNokta")).not.toBeNull();
    expect(rec.container.querySelector(".ms .sayac")!.textContent).toMatch(/^02:1\d$/);
    expect(rec.container.querySelectorAll(".sayac, .cik .num")).toHaveLength(1); // bir bilgi bir kez
    expect(within(rec.container).getByRole("button", { name: "Durdur" }).className).toContain("yikiciDolu");
  });
  it("takvim/toplantı: 'Katıl' birincil (mavi) düğme kamera simgesiyle, eklentiye gider; kamera aynası yok", () => {
    const { container } = render(<ProtrusionBump item={PROTRUSION} />);
    const b = within(container).getByRole("button", { name: "Katıl" });
    expect(b.className).toContain("mavi");
    expect(b.querySelector("svg")).not.toBeNull();
    fireEvent.click(b);
    expect(container.textContent).not.toMatch(/ayna/i);
  });
  it("raf: 'Paylaş' share_open'a kimlikle gider; asistan varken 'Pusula'ya sor'; sürüklerken iki bırakma hedefi", async () => {
    fakeBridge.setShelf([{ id: "f1", name: "sunum-taslak.pdf", sub: "2,4 MB, az önce", kind: "pdf" }, { id: "f2", name: "ekran-kaydı.mp4", sub: "38 MB", kind: "video" }]);
    const main = PLUGINS[0];
    const { container } = render(<ShelfCard items={await fakeBridge.call("shelf_list")} main={main} />);
    fireEvent.click(within(container).getByRole("button", { name: "sunum-taslak.pdf, paylaş" }));
    fireEvent.click(within(container).getByRole("button", { name: "ekran-kaydı.mp4, Pusula'ya sor" }));
    await settle();
    expect(logged("share_open")[0].args).toEqual({ id: "f1" });
    expect(logged("shelf_ask")[0].args).toEqual({ id: "f2" });
    expect(container.textContent).not.toMatch(/Yakın paylaşım/i);
    const bump = render(<ShelfBump main={main} />);
    expect(bump.container.querySelectorAll(".birakKucuk")).toHaveLength(2);
  });
  it("raf: share_open olmayan dosyada reddedilir (sahte köprü)", async () => {
    await expect(fakeBridge.call("share_open", { id: "yok" })).rejects.toBe("denied");
  });
  it("mikrofon/kamera gizlilik noktası: kullanan uygulama adı etikette; kimse kullanmıyorsa yok", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    expect(document.querySelector(".gizlilikNokta")).toBeNull();
    act(() => fakeBridge.setPrivacy({ mic: ["Chrome"], camera: [] }));
    await settle();
    expect(screen.getByRole("img", { name: "Mikrofon: Chrome" })).toBeTruthy();
    act(() => fakeBridge.setPrivacy({ mic: [], camera: ["Teams"] }));
    await settle();
    expect(document.querySelector(".gizlilikNokta")!.getAttribute("data-yalniz")).toBe("kamera");
    act(() => fakeBridge.setPrivacy({ mic: [], camera: [] }));
    await settle();
    expect(document.querySelector(".gizlilikNokta")).toBeNull();
  });
});

describe("pencere önizlemesi", () => {
  const chrome = () => document.querySelector<HTMLElement>('.sabit[data-app="chrome"]')!;
  it("üstüne gelince niyet gecikmesiyle açılır; yüklenirken yer tutucu, gelince görüntü; sonra önbellekten anında", async () => {
    fakeBridge.setPreviewDelay(150);
    render(<Shell monitor="m1" />);
    await settle();
    fireEvent.pointerEnter(chrome());
    expect(document.querySelector(".onizleme")).toBeNull(); // ~250 ms niyet
    await settle(300);
    const box = document.querySelector(".onizleme")!;
    expect(box.querySelectorAll(".kucuk")).toHaveLength(2); // Chrome'un iki penceresi
    expect(box.querySelector(".resim.yukleniyor")).not.toBeNull();
    await settle(250);
    expect(box.querySelector(".resim.yukleniyor")).toBeNull();
    expect(box.querySelectorAll("img")).toHaveLength(2);
    expect(logged("window_preview").map((l) => (l.args as { hwnd: number }).hwnd).sort()).toEqual([2, 3]);
    // çekilince kapanır, yeniden gelince önbellekteki görüntü hemen görünür
    fireEvent.pointerLeave(chrome());
    await settle(300);
    expect(document.querySelector(".onizleme")).toBeNull();
    fireEvent.pointerEnter(chrome());
    await settle(300);
    expect(document.querySelectorAll(".onizleme img")).toHaveLength(2);
  });
  it("kapalı sabitte önizleme açılmaz; önizlemeye tıklamak pencereyi öne getirir", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    fireEvent.pointerEnter(document.querySelector<HTMLElement>('.sabit[data-app="steam"]')!);
    await settle(300);
    expect(document.querySelector(".onizleme")).toBeNull();
    fireEvent.pointerEnter(chrome());
    await settle(300);
    fireEvent.click(document.querySelector<HTMLElement>('.onizleme .kucuk[data-hwnd="3"]')!);
    await settle();
    expect(document.querySelector(".onizleme")).toBeNull();
    expect((await fakeBridge.call("list_windows", { monitor: "m1" })).find((w) => w.hwnd === 3)!.active).toBe(true);
  });
  it("önizleme isteği başarısız olursa yer tutucu kalır, hata yayılmaz", async () => {
    const orig = fakeBridge.call.bind(fakeBridge) as (c: string, a?: unknown) => Promise<unknown>;
    vi.spyOn(fakeBridge, "call").mockImplementation(((cmd: string, a?: unknown) => (cmd === "window_preview" ? Promise.reject("io") : orig(cmd, a))) as never);
    render(<Shell monitor="m1" />);
    await settle();
    fireEvent.pointerEnter(chrome());
    await settle(350);
    expect(document.querySelectorAll(".onizleme .resim.yukleniyor")).toHaveLength(2);
  });
});

describe("modül yönetimi ve renkli simgeler", () => {
  it("kapalı modüller kartta gizlenir, eklenti sekmeleri kaydedilen sıraya girer", async () => {
    fakeBridge.setSurfaces(SURFACES_FULL);
    await fakeBridge.call("modules_set", { order: ["genel", "müzik", "pano", "raf", "takvim", "zamanlayıcı", "sistem", "bildirimler", "claude code", "pusula", "ekip"], off: ["sistem", "raf", "zamanlayıcı"] });
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    const tabs = within(screen.getByRole("tablist", { name: "Modüller" })).getAllByRole("tab").map((t) => t.getAttribute("aria-label") ?? t.textContent);
    expect(tabs).toEqual(["Genel", "Müzik", "Pano", "Takvim", "Bildirimler", "Pusula › Claude Code", "Pusula"]);
    expect(screen.queryByRole("heading", { name: "Sistem" })).toBeNull();
    expect(screen.queryByText("İşlemci")).toBeNull();
  });
  it("hepsi açıkken Raf sekmesi ve Sistem kutusu vardır", async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    expect(screen.getByRole("tab", { name: "Raf" })).toBeTruthy();
    expect(screen.getByText("İşlemci")).toBeTruthy();
  });
  it("Ayarlar › Görünüm'de renkli simgeler anahtarı ayarı yazar ve sayfaya işaret koyar; kapalıyken işaret yok", async () => {
    render(<Shell monitor="m1" init={{ panel: "ayg" }} />);
    const sw = await screen.findByRole("switch", { name: "Renkli uygulama simgeleri" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(document.documentElement.hasAttribute("data-renkli")).toBe(false);
    fireEvent.click(sw);
    await settle();
    expect((await fakeBridge.call("get_settings")).colorIcons).toBe(true);
    expect(document.documentElement.hasAttribute("data-renkli")).toBe(true);
  });
  it("AppIcon: renkli simge yalnız güvenli data URL ile stile girer", () => {
    const ok = render(<AppIcon src="data:image/svg+xml,mono" color="data:image/png;base64,AAAA" />);
    expect(ok.container.firstElementChild!.getAttribute("style")).toContain("--ikon-renk");
    ok.unmount();
    const bad = render(<AppIcon src="data:image/svg+xml,mono" color={'https://evil/x.png");background:url(x'} />);
    expect(bad.container.firstElementChild!.getAttribute("style") ?? "").not.toContain("--ikon-renk");
  });
});

describe("kilit boşlukları", () => {
  it("kilitliyken bildirim içerikleri gizli (yalnız sayı); açılınca geri gelir", async () => {
    render(<NotificationList onReview={() => undefined} />);
    await settle();
    expect(screen.getByText("Rapor hazır")).toBeTruthy();
    act(() => fakeBridge.setLocked(true, "manual"));
    await settle();
    expect(screen.queryByText("Rapor hazır")).toBeNull();
    expect(document.body.textContent).not.toContain("Disk %91");
    expect(screen.getByRole("status").textContent).toContain("Peeka kilitli");
    act(() => fakeBridge.setLocked(false));
    await settle();
    expect(screen.getByText("Rapor hazır")).toBeTruthy();
  });
  it("şerit sağ tık menüsünde 'Peeka'yı kilitle' var, kilitliyken yok", () => {
    const props = { menu: { kind: "strip", x: 10 } as const, pins: [], windows: [], onClose: () => undefined, onPins: () => undefined, onSettings: () => undefined, onQuit: () => undefined };
    const a = render(<ContextMenu {...props} />);
    expect(within(a.container).getByRole("menuitem", { name: "Peeka'yı kilitle" })).toBeTruthy();
    a.unmount();
    const b = render(<ContextMenu {...props} locked />);
    expect(within(b.container).queryByRole("menuitem", { name: "Peeka'yı kilitle" })).toBeNull();
  });
  it("menüdeki 'Peeka'yı kilitle' kilit_now çağırır", async () => {
    const props = { menu: { kind: "strip", x: 10 } as const, pins: [], windows: [], onClose: () => undefined, onPins: () => undefined, onSettings: () => undefined, onQuit: () => undefined };
    render(<ContextMenu {...props} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Peeka'yı kilitle" }));
    await settle();
    expect((await fakeBridge.call("lock_state")).locked).toBe(true);
  });
});

describe("ortadaki kısa etiket: Ara, Ayarlar, Pano (bir bilgi bir kez)", () => {
  it("şerit sayfası panel açınca ada ortasında 'Ara' / 'Peeka ayarları' yazar, kapanınca saat/Pusula hazır döner", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(center().textContent).toContain("Pusula hazır");
    sendX({ t: "panel", panel: "search" });
    await settle(80);
    expect(now().textContent).toContain("Ara");
    expect(now().textContent).not.toContain("Pusula hazır");
    sendX({ t: "panel", panel: "settings" });
    await settle(220);
    expect(now().textContent).toContain("Peeka ayarları");
    sendX({ t: "panel", panel: null });
    await settle(220);
    expect(now().textContent).toContain("Pusula hazır");
  });
  it("Shell panel açıp kapatınca iletiyi gönderir (ana ekran)", async () => {
    const got: XMsg[] = [];
    const off = onX((m) => got.push(m));
    render(<Shell monitor="m1" init={{ panel: "search" }} />);
    await settle(80);
    expect(got).toContainEqual({ t: "panel", panel: "search" });
    off();
  });
  it("Pano kartı açıkken ortada 'Pano' etiketi var", async () => {
    render(<Island monitor="m1" init={{ view: "pano" }} />);
    await settle();
    expect(center().textContent).toContain("Pano");
  });
});

describe("Dalga 4 sözleşme düzeltmeleri", () => {
  it("clip_clear({passwords:true}) yalnız parolaları siler; alansız her şeyi siler", async () => {
    await fakeBridge.call("clip_clear", { passwords: true });
    const left = await fakeBridge.call("clip_list");
    expect(left.some((c) => c.kind === "password")).toBe(false);
    expect(left.length).toBeGreaterThan(5);
    await fakeBridge.call("clip_clear", {});
    expect(await fakeBridge.call("clip_list")).toEqual([]);
  });
  it("Ayarlar › Pano: tek 'Hepsini sil' satırı (maket ayp); parolaya özel satır yok", async () => {
    render(<Shell monitor="m1" init={{ panel: "ayp" }} />);
    expect(await screen.findByText("Geri alınamaz")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hepsini sil: basılı tut" })).toBeTruthy();
    expect(screen.queryByText("Parolaları hepsini sil")).toBeNull();
  });
  it("search_ask {turn} döner", async () => {
    expect(await fakeBridge.call("search_ask", { query: "merhaba" })).toEqual({ turn: expect.any(Number) });
  });
});

describe("Dalga 5 sözleşmesi", () => {
  it("window_preview PNG/SVG data URL döner", async () => {
    expect(await fakeBridge.call("window_preview", { hwnd: 2 })).toMatch(/^data:image\//);
  });
  it("input_tick imleç ve son girdiyi besler: maskot kendi pointermove'unu bırakır", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.emit("input_tick", { lastInputAgoMs: 5000, cursor: { x: 300, y: 40 } }));
    await settle();
    expect(center().querySelector(".mascot")).not.toBeNull();
  });
});
