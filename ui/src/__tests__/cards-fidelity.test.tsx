// Sadakat denetimi 2 (kartlar): saf kurallar, onay/kompoz/modül kartları, yeni kartlar ve Pusula çizgisi.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { SURFACES_J, VOICE_ASISTAN, VOICE_SEN, VOICE_SPEAKING, VOICE_THINKING, withRecommended } from "../plugin.fixtures";
import { EmptyBoard, ErrorCard, FirstConnectCard, LoadingCard, makeErrorBudget } from "../components/CardsExtra";
import { Island } from "../components/Island";
import { FirstRunCard, modulesKw } from "../components/IslandCards";
import { ApprovalCard, ApprovalCenter, ComposerCard, ProtrusionBump, ProtrusionCenter } from "../components/Plugin";
import { accusative, dative, shortApprovalTitle } from "../lib/cardsText";
import { resetMascotRegistry } from "../mascot/useSingleMascot";
import { APPROVAL_CHOICE, APPROVAL_HIGH, APPROVAL_LOW, PUSULA, OTHER } from "../plugin.fixtures";

const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset(); resetMascotRegistry(); localStorage.clear();
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 80)); });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe("saf kurallar", () => {
  it("belirtme eki ünlü uyumuna uyar", () => {
    expect([accusative("Pusula"), accusative("Ece"), accusative("Kuzu"), accusative("Göl"), accusative("Örnek Asistan")]).toEqual(["Pusula'yı", "Ece'yi", "Kuzu'yu", "Göl'ü", "Örnek Asistan'ı"]);
  });
  it("yönelme eki ünlü uyumuna uyar", () => {
    expect(dative("Pusula")).toBe("Pusula'ya");
    expect(dative("Örnek Asistan")).toBe("Örnek Asistan'a");
    expect(dative("Ece")).toBe("Ece'ye");
    expect(dative("")).toBe("Eklenti'ye");
  });
  it("çıkıntı başlığı: yüksek riskte tekrar eden riskli ifade kısalır, shortTitle önceliklidir, ayraç düzleşir", () => {
    expect(shortApprovalTitle(APPROVAL_HIGH)).toBe("api-sunucu izin istiyor");
    expect(shortApprovalTitle(APPROVAL_LOW)).toBe("api-sunucu izin istiyor");
    expect(shortApprovalTitle({ ...APPROVAL_HIGH, shortTitle: "Kısa › Başlık" })).toBe("Kısa - Başlık");
  });
  it("aynı hata 10 dk içinde ikinci kez tepki vermez", () => {
    let t = 0;
    const ok = makeErrorBudget(() => t);
    expect(ok("claude")).toBe(true);
    t += 5 * 60_000; expect(ok("claude")).toBe(false);
    expect(ok("başka")).toBe(true);
    t += 6 * 60_000; expect(ok("claude")).toBe(true);
  });
});

describe("onay kartı", () => {
  it("c1: kaynak adı soluk (yazı 3), yüksek riskte kısa başlık", () => {
    const { container, unmount } = render(<ApprovalCenter a={APPROVAL_LOW} />);
    expect(container.querySelector(".onEk .l3:last-child")?.textContent).toBe("Claude Code");
    unmount();
    render(<ApprovalCenter a={APPROVAL_HIGH} />);
    expect(screen.getByText("api-sunucu izin istiyor")).toBeTruthy();
    expect(screen.getByText("yüksek risk")).toBeTruthy();
  });
  it("c3: önerilen seçenek önceden seçili ve etiketli; Planı onayla hemen açık; 'Başka cevap yaz' düğmesi kutuyu açar", () => {
    vi.useFakeTimers();
    render(<ApprovalCard a={withRecommended(APPROVAL_CHOICE)} />);
    expect(screen.getByRole("radio", { name: /Var olan/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("önerilen")).toBeTruthy();
    expect(screen.queryByLabelText("Başka cevap yaz")).toBeNull();
    advance(600);
    fireEvent.click(screen.getByRole("button", { name: "Planı onayla" }));
    expect(fakeBridge.log.at(-1)?.args).toMatchObject({ decision: "choice", choiceId: "genislet" });
    fireEvent.click(screen.getByRole("button", { name: "Başka cevap yaz" }));
    expect(screen.getByLabelText("Başka cevap yaz")).toBeTruthy();
  });
  it("öneri yoksa hiçbir seçenek önceden seçili değildir; 300 ms koruması ve yüksek riskte 'Her zaman' yokluğu korunur", () => {
    vi.useFakeTimers();
    const { unmount } = render(<ApprovalCard a={APPROVAL_CHOICE} />);
    expect(screen.getAllByRole("radio").every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
    expect(screen.queryByText("önerilen")).toBeNull();
    unmount();
    render(<ApprovalCard a={APPROVAL_HIGH} />);
    expect(screen.queryByText("Her zaman izin ver")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "İzin ver: basılı tut" }));
    expect(fakeBridge.log.filter((l) => l.cmd === "approval_answer")).toHaveLength(0); // basılı tutmadan izin yok
  });
});

describe("ses kartları", () => {
  it("şerit: faz yazısı Peeka'nın tablosundan ve faz rengiyle dalga; dikte kendi başlığını korur", () => {
    const { container, unmount } = render(<ProtrusionCenter item={VOICE_THINKING} />);
    expect(screen.getByText("Düşünüyorum")).toBeTruthy();
    expect((container.querySelector(".dalga") as HTMLElement).style.getPropertyValue("--faz")).toBe("var(--turuncu)");
    unmount();
    render(<ProtrusionCenter item={{ ...VOICE_SPEAKING, title: "uydurma metin" }} />);
    expect(screen.getByText("Konuşuyorum")).toBeTruthy();
    expect(screen.queryByText("uydurma metin")).toBeNull();
    cleanup();
    render(<ProtrusionCenter item={{ plugin: PUSULA, title: "Dikte", state: "info", mascot: "dinliyor" }} />);
    expect(screen.getByText("Dikte")).toBeTruthy();
  });
  it("faz tablosu yalnız ana asistana ve prototip anahtarlara kapalıdır", () => {
    const first = render(<ProtrusionCenter item={{ ...VOICE_THINKING, plugin: OTHER }} />);
    expect(first.container.querySelector(".dalga")).toBeNull(); // başka eklentide faz görünümü yok
    first.unmount();
    const { container } = render(<ProtrusionCenter item={{ plugin: PUSULA, title: "x", state: "info", mascot: "constructor" }} />);
    expect(container.querySelector(".dalga")).toBeNull();
  });
  it("çıkıntı: 'Sen' ve eklenti satırları, sürekli dinleme ipucu", async () => {
    render(<ProtrusionBump item={VOICE_SPEAKING} />);
    await act(async () => { fakeBridge.emit("plugin_stream", { streamId: "ses", text: VOICE_SEN, speaker: "Sen" }); });
    expect(screen.getByText("Sen")).toBeTruthy();
    expect(screen.queryByText("Pusula")).toBeNull();
    await act(async () => { fakeBridge.emit("plugin_stream", { streamId: "ses", text: VOICE_ASISTAN, speaker: "Pusula" }); });
    expect(screen.getByText("Pusula")).toBeTruthy();
    expect(screen.getByText(VOICE_ASISTAN)).toBeTruthy();
    expect(screen.getByText(/Sürekli dinleme açık/)).toBeTruthy();
  });
});

describe("Ctrl+Space kutusu", () => {
  const owner = { ...PUSULA, voice: true };
  it("yer tutucu 'Pusula'ya sor: …', tarama + ataş + vurgulu mikrofon, çipler ve ek", async () => {
    fakeBridge.setShelf([{ id: "a", name: "a.pdf", sub: "", kind: "pdf" }, { id: "b", name: "b.pdf", sub: "", kind: "pdf" }]);
    fakeBridge.addClip({ id: "k1", createdAt: Date.now(), pinned: false, source: "Chrome", kind: "text", text: "https://example.com/x", hint: "link", sub: null, thumb: null, screenshot: false });
    const send = vi.fn();
    const { container } = render(<ComposerCard owner={owner} turns={[]} send={send} suggestions={[{ id: "window_image", label: "Bu pencere: Chrome" }]} />);
    await settle();
    expect(screen.getByPlaceholderText("Pusula'ya sor: bir soru, bir iş, bir hatırlatma")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ekran görüntüsü ekle" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dosya ekle" })).toBeTruthy();
    expect(container.querySelector(".yuv.vurgu")).toBeTruthy();
    expect(screen.getByText("Bu pencere: Chrome")).toBeTruthy();
    expect(screen.getByText("Panodaki bağlantı")).toBeTruthy();
    expect(screen.getByText("Raftaki 2 dosya")).toBeTruthy();
    fireEvent.click(screen.getByText("Panodaki bağlantı"));
    fireEvent.click(screen.getByRole("button", { name: "Ekran görüntüsü ekle" }));
    await settle();
    fireEvent.change(screen.getByPlaceholderText(/Pusula'ya sor/), { target: { value: "özetle" } });
    fireEvent.keyDown(screen.getByPlaceholderText(/Pusula'ya sor/), { key: "Enter" });
    expect(send).toHaveBeenCalledWith("özetle", [{ kind: "clipboard_link" }, { kind: "screen_image" }]);
  });
  it("Rust ek türlerini bildirmeyince yalnız pencere çipi vardır (sözleşme dışı tür gönderilmez)", async () => {
    { const real = fakeBridge.call.bind(fakeBridge) as (c: string, ...a: unknown[]) => Promise<unknown>; vi.spyOn(fakeBridge, "call").mockImplementation(((c: string, ...a: unknown[]) => (c === "composer_kinds" ? Promise.reject("unknown") : real(c, ...a))) as never); }
    fakeBridge.setShelf([{ id: "a", name: "a.pdf", sub: "", kind: "pdf" }]);
    render(<ComposerCard owner={owner} turns={[]} send={() => undefined} suggestions={[{ id: "window_image", label: "Bu pencere: Chrome" }]} />);
    await settle();
    expect(screen.queryByText(/Raftaki/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Dosya ekle" })).toBeNull();
    expect(screen.getByText("Bu pencere: Chrome")).toBeTruthy();
  });
  it("başka eklentinin adı ön ek olarak kalır", async () => {
    render(<ComposerCard owner={{ ...OTHER, voice: false }} turns={[]} send={() => undefined} suggestions={[]} />);
    expect(screen.getByPlaceholderText("Örnek Asistan'a sor: bir soru, bir iş, bir hatırlatma")).toBeTruthy();
  });
});

describe("Modüller (j)", () => {
  it("11 sekme ve dişli; Genel üç kutu: Pusula, Claude Code, Sistem; kota çubukları, oturum durumları, Durdur", async () => {
    fakeBridge.setSurfaces(SURFACES_J);
    const { container } = render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    const tabs = within(screen.getByRole("tablist", { name: "Modüller" })).getAllByRole("tab").map((t) => t.getAttribute("aria-label") ?? t.textContent);
    expect(tabs).toEqual(["Genel", "Müzik", "Pano", "Raf", "Takvim", "Zamanlayıcı", "Sistem", "Bildirimler", "Pusula", "Pusula › Claude Code", "Pusula › Ekip"]);
    expect(screen.getByRole("button", { name: "Modül ayarları" })).toBeTruthy();
    expect(container.querySelectorAll(".izgara.genel3 > .kutu")).toHaveLength(3);
    expect(container.querySelectorAll(".kota .olc")).toHaveLength(2);
    expect(container.querySelector(".kota .esik")).toBeTruthy();
    expect(screen.getByText("2 sa 14 dk sonra sıfırlanır")).toBeTruthy();
    expect(container.querySelector(".oturumlar .nab")).toBeTruthy();
    expect(container.querySelector(".oturumlar .halka")).toBeTruthy();
    expect(container.querySelector(".oturumlar .tikYesil")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Durdur" })).toBeTruthy();
    expect(screen.getByText("3 not önerisi")).toBeTruthy();
    expect(container.querySelector(".kutu h4 .mascot")?.getAttribute("data-size")).toBe("24");
  });
  it("Müzik ve Zamanlayıcı kendi sekmelerinde", async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    expect(screen.queryByLabelText("Dakika")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Zamanlayıcı" }));
    expect(screen.getByLabelText("Dakika")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Müzik" }));
    expect(screen.getByRole("button", { name: "Önceki parça" })).toBeTruthy();
  });
});

describe("Modüller kart genişliği sekmeye uyar", () => {
  it("Genel geniş, diğerleri kendi kartı kadar dar", () => {
    const w = (p: string) => modulesKw(p, 1920);
    expect(w("genel")).toBe(1056);
    const dar = ["müzik", "pano", "raf", "takvim", "zamanlayıcı", "sistem", "bildirimler", "eklenti"].map(w);
    expect(new Set(dar)).toEqual(new Set([620])); // Genel dışında her sekme aynı genişlikte
    expect(modulesKw("genel", 1366)).toBe(751);
  });
  it("sekme değişince kart genişliği değişir; dar kartta etkin olmayan sekme yalnız simge", async () => {
    fakeBridge.setSurfaces(SURFACES_J); // eklenti kutuları varken Genel geniş (3 sütun); kutusuz Genel 620
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    const kart = () => (document.querySelector(".adaIc.mkart, .adaIc") as HTMLElement).style.width;
    const genel = kart();
    fireEvent.click(screen.getByRole("tab", { name: "Takvim" }));
    expect(kart()).toBe("620px");
    expect(kart()).not.toBe(genel);
    expect(screen.getByRole("tab", { name: "Pano" }).textContent).toBe("");
    expect(screen.getByRole("tab", { name: "Takvim" }).textContent).toBe("");
  });
  it("sekmeler hep yalnız simge; tıklayınca sıra, sayı ve boyut sınıfı değişmez, ad 400 ms sonra ipucunda", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fakeBridge.setSurfaces(SURFACES_J);
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    const snap = () => within(screen.getByRole("tablist", { name: "Modüller" })).getAllByRole("tab").map((t) => [t.getAttribute("aria-label"), t.textContent, t.offsetLeft]);
    const once = snap();
    expect(once.every(([, text]) => text === "")).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Zamanlayıcı" }));
    expect(snap()).toEqual(once); // offsetLeft: jsdom'da 0; gerçek konum Playwright karesinde ölçüldü
    fireEvent.mouseEnter(screen.getByRole("tab", { name: "Pusula › Claude Code" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
    await act(async () => { vi.advanceTimersByTime(450); });
    expect(screen.getByRole("tooltip").textContent).toBe("Pusula › Claude Code");
    vi.useRealTimers();
  });
});

describe("yeni kartlar", () => {
  it("ilk2: metin, Geç ve Tamam aynı işi yapar", async () => {
    const done = vi.fn();
    render(<FirstConnectCard onDone={done} />);
    expect(await screen.findByText("Merhaba, ben Pusula")).toBeTruthy();
    expect(screen.getByText(/Ctrl\+Space ile bana sor/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Geç" }));
    fireEvent.click(screen.getByRole("button", { name: "Tamam" }));
    expect(done).toHaveBeenCalledTimes(2);
  });
  it("ky: 800 ms'den kısa yüklemede iskelet hiç görünmez, uzunsa görünür", () => {
    vi.useFakeTimers();
    const { container } = render(<LoadingCard />);
    advance(799); expect(container.querySelector(".iskelet")).toBeNull();
    advance(2); expect(container.querySelectorAll(".iskelet")).toHaveLength(3);
    expect(screen.getByText("Pano okunuyor")).toBeTruthy();
  });
  it("kh: Yeniden dene çağırır, Neden? teknik metni açar", () => {
    const retry = vi.fn();
    render(<ErrorCard title="Claude Code'a ulaşamıyorum" detail="hook köprüsü yanıt vermiyor" onRetry={retry} />);
    expect(screen.queryByText("hook köprüsü yanıt vermiyor")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Neden?" }));
    expect(screen.getByText("hook köprüsü yanıt vermiyor")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yeniden dene" }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("kb: uyuyan maskot 96 ve boş Pano metni", () => {
    const { container } = render(<EmptyBoard />);
    expect(screen.getByText("Pano boş")).toBeTruthy();
    expect(container.querySelector(".mascot")?.getAttribute("data-size")).toBe("96");
    expect(container.querySelector(".mascot")?.getAttribute("data-mood")).toBe("drowsy");
  });
});

describe("ilk açılış (ilk)", () => {
  it("üç sayfa: ilk ikisinde Geç, son sayfada maketin tam metni ve dönüş yolu; Pusula bağlıyken el sallayan 96 px maskot", () => {
    const done = vi.fn();
    const { container } = render(<FirstRunCard onDone={done} mascot />);
    expect(container.querySelector(".mascot")?.getAttribute("data-size")).toBe("96");
    fireEvent.click(screen.getByRole("button", { name: "İleri" }));
    fireEvent.click(screen.getByRole("button", { name: "İleri" }));
    expect(screen.getByText(/Ctrl\+K ile uygulama, pencere, dosya ve ayar ara\./)).toBeTruthy();
    expect(screen.getByText(/Görev çubuğunu geri getir/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Geç" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Başla" }));
    expect(done).toHaveBeenCalledOnce();
  });
  it("Geç ilk sayfadan bitirir; Pusula yokken nötr simge", () => {
    const done = vi.fn();
    const { container } = render(<FirstRunCard onDone={done} />);
    expect(container.querySelector(".mascot")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Geç" }));
    expect(done).toHaveBeenCalledOnce();
  });
});

describe("dikte, ticket ve sayaç (şerit)", () => {
  it("dikte: tırnaklı canlı satır ve 'Esc iptal'; ticket: 'taslak hazır' notu; Pusula'nın maskotsuz çıkıntısında 'A' karosu yok, ad ön eki kalır", async () => {
    const dik = { plugin: PUSULA, title: "Dikte", state: "info" as const, mascot: "dinliyor", liveText: { streamId: "d9" }, actions: [{ id: "bitir", label: "Bitir" }] };
    const { container, unmount } = render(<ProtrusionBump item={dik} />);
    await settle();
    act(() => fakeBridge.emit("plugin_stream", { streamId: "d9", text: "yarın sabah dokuzda" }));
    expect(container.querySelector(".canliYazi")!.textContent).toBe("“yarın sabah dokuzda”");
    expect(screen.getByText("iptal")).toBeTruthy();
    unmount();
    const tik = { plugin: PUSULA, title: "Yeni ticket", icon: "ticket", state: "attention" as const };
    const c = render(<ProtrusionCenter item={tik} />);
    expect(screen.getByText("taslak hazır")).toBeTruthy();
    expect(c.container.querySelector(".basHarf")).toBeNull();
    expect(c.container.textContent).toContain("Pusula ›");
  });
  it("sayaç iki haneli dakika", async () => {
    const { elapsed } = await import("../lib/plugin");
    expect(elapsed("2026-10-16T14:00:00Z", Date.parse("2026-10-16T14:02:14Z"))).toBe("02:14");
    expect(elapsed("2026-10-16T14:00:00Z", Date.parse("2026-10-16T15:02:03Z"))).toBe("1:02:03");
  });
});
