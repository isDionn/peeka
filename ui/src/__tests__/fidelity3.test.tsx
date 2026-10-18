// Sadakat denetimi 3 (ayarlar, pano, arama, başlat, durum kartı, menüler, tepsi, sihirbaz, gizleme).
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { ContextMenu } from "../components/Menus";
import { PanoView, LockCard, setPanoDrag } from "../components/Pano";
import { genitive, PluginExtras } from "../components/PluginExtras";
import { SearchPanel } from "../components/SearchPanel";
import { SettingsPanel } from "../components/SettingsPanel";
import { SetupWizard, markSetup, setupDone, SETUP_KEY } from "../components/SetupWizard";
import { StartPanel } from "../components/StartPanel";
import { StatusCard } from "../components/StatusCard";
import { PromotedTray, TrayList } from "../components/TrayList";
import { IslandHiddenGlyph } from "../components/IslandHidden";
import { resetMascotRegistry } from "../mascot/useSingleMascot";
import { APPROVAL_LOW } from "../plugin.fixtures";

const proto = HTMLElement.prototype;
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset(); localStorage.clear(); setPanoDrag(null);
});
afterEach(() => { cleanup(); resetMascotRegistry(); vi.restoreAllMocks(); Reflect.deleteProperty(proto, "offsetHeight"); Reflect.deleteProperty(proto, "offsetWidth"); });
const settle = (ms = 60) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const flog = (cmd: string) => fakeBridge.log.filter((l: { cmd: string }) => l.cmd === cmd);
const logged = (cmd: string) => fakeBridge.log.filter((l) => l.cmd === cmd);
const settings = () => fakeBridge.call("get_settings");

describe("durum kartı (o)", () => {
  const card = async () => {
    const [monitor, status] = [await fakeBridge.call("get_monitor", { monitor: "m1" }), await fakeBridge.call("get_status")];
    render(<StatusCard monitor={monitor} status={status} setStatus={() => undefined} />);
    await settle();
  };
  it("Mikrofon ve Kamera satırı: boştayken 'kullanılmıyor', kullanımda uygulama adı", async () => {
    await card();
    expect(screen.getByText("Mikrofon").parentElement!.textContent).toContain("kullanılmıyor");
    expect(screen.getByText("Kamera").parentElement!.textContent).toContain("kullanılmıyor");
    act(() => fakeBridge.setPrivacy({ mic: ["Pusula"], camera: ["Chrome"] }));
    await settle();
    expect(screen.getByText("Mikrofon").parentElement!.textContent).toContain("Pusula dinliyor");
    expect(screen.getByText("Kamera").parentElement!.textContent).toContain("Chrome kullanıyor");
  });
  it("internet varken ağ satırı yok, sorun varsa var; ilk odak Wi-Fi karosunda", async () => {
    await card();
    expect(screen.queryByText("İnternete bağlı")).toBeNull();
    expect(screen.getByText("Pil %78")).toBeTruthy();
    expect(document.querySelector("[data-autofocus]")!.getAttribute("aria-label")).toContain("Wi-Fi");
    cleanup();
    const monitor = await fakeBridge.call("get_monitor", { monitor: "m1" });
    render(<StatusCard monitor={monitor} status={{ ...(await fakeBridge.call("get_status")), network: "none" }} setStatus={() => undefined} />);
    expect(screen.getByText("Ağ bağlantısı yok")).toBeTruthy();
  });
  it("Pusula bölümü: ana asistan bağlıyken sayılar; onay satırında Aç; sıfır satır çizilmez", async () => {
    fakeBridge.setSurfaces({ approvals: [APPROVAL_LOW], approvalTop: null });
    await card();
    expect(screen.getByText("1 onay bekliyor")).toBeTruthy();
    expect(screen.getByText("2 iş çalışıyor")).toBeTruthy();
    expect(screen.getByText("3 not önerisi")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Aç" }));
    await settle();
    expect(flog("assistant_open")[0].args).toEqual({ kind: "approval" });
  });
  it("onay sayısı: Pusula gönderiyorsa onunki, göndermiyorsa kart listesinden", async () => {
    fakeBridge.setSurfaces({ approvals: [], approvalTop: null });
    await card();
    expect(screen.getByText("1 onay bekliyor")).toBeTruthy(); // assistant_counts().approvals = 1, liste boş
    cleanup();
    { const real = fakeBridge.call.bind(fakeBridge) as (c: string, ...a: unknown[]) => Promise<unknown>; vi.spyOn(fakeBridge, "call").mockImplementation(((c: string, ...a: unknown[]) => (c === "assistant_counts" ? Promise.resolve({ jobs: 0, memory: 0 }) : real(c, ...a))) as never); }
    fakeBridge.setSurfaces({ approvals: [APPROVAL_LOW, { ...APPROVAL_LOW, id: "b" }], approvalTop: null });
    await card();
    expect(screen.getByText("2 onay bekliyor")).toBeTruthy();
  });
  it("ana asistan bağlı değilse Pusula bölümü yok", async () => {
    fakeBridge.setPlugins([]);
    await card();
    expect(screen.queryByText("not önerisi", { exact: false })).toBeNull();
  });
});

describe("Başlat paneli (w2)", () => {
  const start = async () => {
    const monitor = await fakeBridge.call("get_monitor", { monitor: "m1" });
    const onClose = vi.fn();
    render(<StartPanel monitor={monitor} pins={await fakeBridge.call("get_pins")} onClose={onClose} />);
    await settle();
    return onClose;
  };
  it("maketteki arama yazısı, 12 sabit, Önerilenler ve Windows Başlat bağlantısı", async () => {
    const onClose = await start();
    expect(screen.getByPlaceholderText("Uygulama, pencere, dosya ya da ayar ara")).toBeTruthy();
    expect(document.querySelectorAll(".uygIzgara .uygHucre")).toHaveLength(12);
    expect(screen.getByText("Önerilenler")).toBeTruthy();
    expect(screen.getByText("sunum-taslak.pdf")).toBeTruthy();
    expect(screen.queryByText("kapak-taslak.png")).toBeNull(); // dördün ötesi "Daha fazla" ile
    fireEvent.click(screen.getByRole("button", { name: /Daha fazla/ }));
    expect(screen.getByText("kapak-taslak.png")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Windows Başlat'ı aç/ }));
    await settle();
    expect(flog("open_start_menu")).toHaveLength(1);
    expect(onClose).toHaveBeenCalled();
  });
  it("'Tüm uygulamalar' düğmesi ızgara yerine tam listeyi açar ve geri döner", async () => {
    await start();
    fireEvent.click(screen.getByRole("button", { name: /Tüm uygulamalar/ }));
    expect(document.querySelector(".uygIzgara")).toBeNull();
    expect(document.querySelector(".tumUyg")!.querySelectorAll("button").length).toBeGreaterThan(8);
    fireEvent.click(screen.getByRole("button", { name: /Sabitlenmiş/ }));
    expect(document.querySelector(".uygIzgara")).not.toBeNull();
  });
  it("arama uygulama, pencere, dosya ve ayar arar; Enter ilk sonucu açar", async () => {
    const onClose = await start();
    fireEvent.change(screen.getByPlaceholderText("Uygulama, pencere, dosya ya da ayar ara"), { target: { value: "ekran" } });
    await settle();
    const list = screen.getByRole("group", { name: "Arama sonuçları" });
    expect(within(list).getByText("Ekran: ölçek ve düzen")).toBeTruthy();
    expect(document.querySelector(".uygIzgara")).toBeNull();
    fireEvent.keyDown(screen.getByPlaceholderText("Uygulama, pencere, dosya ya da ayar ara"), { key: "Enter" });
    await settle();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("menüler (p1, sr)", () => {
  const menu = (m: Parameters<typeof ContextMenu>[0]["menu"]) => render(<ContextMenu menu={m} pins={[]} windows={[{ hwnd: 7, appId: "discord", name: "Discord", icon: "", title: "Genel", active: true, monitor: "m1" }]} onClose={() => undefined} onPins={() => undefined} onSettings={() => undefined} />);
  it("uygulama menüsü: Pencereyi kapat ve Uygulamadan çık ayrı", async () => {
    menu({ kind: "app", appId: "discord", x: 100 });
    const names = screen.getAllByRole("menuitem").map((b) => b.textContent);
    expect(names).toEqual(["Sabitle", "Yeni pencere", "Pencereyi kapat", "Uygulamadan çık"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Uygulamadan çık" }));
    expect(flog("quit_app")).toHaveLength(0); // ilk tık yalnız onay ister (O10)
    fireEvent.click(screen.getByRole("menuitem", { name: /Tekrar tıkla/ }));
    await settle();
    expect(flog("quit_app")[0].args).toEqual({ appId: "discord" });
  });
  it("şerit menüsü maketin sırasında; 'Adayı geçici gizle' kısayolu yazar, tıklayınca gizler, tekrar açılınca geri getirir", async () => {
    menu({ kind: "strip", x: 10 });
    expect(screen.getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["Peeka ayarları", "Görev çubuğunu geri getir", "Adayı geçici gizleCtrl+Shift+A", "Peeka'yı kilitle", "Çık"]);
    fireEvent.click(screen.getByRole("menuitem", { name: /Adayı geçici gizle/ }));
    await settle();
    expect(flog("island_hide")[0].args).toEqual({ on: true });
    cleanup();
    menu({ kind: "strip", x: 10 });
    await settle();
    expect(screen.getByRole("menuitem", { name: /Adayı geri getir/ })).toBeTruthy();
  });
  it("göz simgesi adayı geri getirir", async () => {
    await fakeBridge.call("island_hide", { on: true });
    render(<IslandHiddenGlyph />);
    fireEvent.click(screen.getByRole("button", { name: /Ada gizli/ }));
    await settle();
    expect(await fakeBridge.call("island_hidden")).toBe(false);
  });
});

describe("tepsi (y1, y2)", () => {
  it("ızgara: rozet, ad ipucu; tıklama tray_open ve kapatma; tray_icons yoksa open_tray'e düşer", async () => {
    const onClose = vi.fn();
    render(<TrayList monitor="m1" onClose={onClose} />);
    await settle();
    const discord = screen.getByRole("button", { name: "Discord, 3 yeni" });
    expect(discord.querySelector(".rozet")!.textContent).toBe("3");
    expect(screen.getByRole("group", { name: "Gizli simgeler" }).querySelectorAll("button")).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: "Steam" }));
    await settle();
    expect(logged("tray_open")[0].args).toEqual({ id: "exe:c:/apps/steam.exe" });
    expect(onClose).toHaveBeenCalled();
  });
  it("şeritteki sık simgeler yalnız 'hep görünür' olanlar ve rozetli", async () => {
    render(<PromotedTray monitor="m1" />);
    await settle();
    const g = screen.getByRole("group", { name: "Sık tepsi simgeleri" });
    expect(within(g).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Discord, 3 yeni", "OneDrive"]);
  });
});

describe("Ayarlar", () => {
  const panel = async (page: "ayg" | "ayk" | "aye" | "ays" | "ayp") => { render(<SettingsPanel page={page} onPage={() => undefined} settings={await settings()} />); await settle(); };
  it("gezinme 7 öğe, Hakkında yerel sayfa açar", async () => {
    await panel("ayg");
    expect(screen.getByRole("navigation").querySelectorAll("button")).toHaveLength(7);
    fireEvent.click(screen.getByRole("button", { name: "Hakkında" }));
    expect(screen.getByText("Acil kısayol")).toBeTruthy();
  });
  it("Maskot: 'İş bitince kutlama' varsayılan açık, kapatınca set_settings({celebrate:false})", async () => {
    await panel("ays");
    const sw = screen.getByRole("switch", { name: "İş bitince kutlama" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Saatte en çok 3")).toBeTruthy();
    expect(screen.getByText("Peeka ve ana asistan tanıtımı")).toBeTruthy();
    fireEvent.click(sw);
    await settle();
    expect((await settings() as unknown as { celebrate: boolean }).celebrate).toBe(false);
  });
  it("Kısayollar: maketin etiketleri; istisnada ilk üçü tek tek, gerisi tek satırda, tıklayınca açılır", async () => {
    await panel("ayk");
    for (const t of ["Ara", "Asistana sor", "Onaya git", "Adayı geçici gizle"]) expect(screen.getByText(t)).toBeTruthy();
    const list = document.querySelector<HTMLElement>(".istisnalar")!;
    expect(list.querySelectorAll(".sat")).toHaveLength(4);
    fireEvent.click(list.querySelector(".istisnaGrup")!);
    expect(list.querySelectorAll(".sat").length).toBeGreaterThan(8);
    expect(within(list).getByRole("button", { name: "Firefox istisnasını kaldır" })).toBeTruthy();
  });
  it("Görünüm: iki kart; ek ayarlar 'Diğer ayarlar' altında", async () => {
    await panel("ayg");
    expect(document.querySelectorAll(".ayarIc > .liste")).toHaveLength(2);
    expect(screen.getByText("Üstüne gelince gerçek renkli simge")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Ses tuşlarını yakala" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Diğer ayarlar" }));
    expect(screen.getByRole("switch", { name: "Ses tuşlarını yakala" })).toBeTruthy();
  });
  it("Eklentiler: Claude Code köprüsü satırı (durum + Kaldır düğmesi), İzinlerin geçmişi ve genel geri alma düğmesi", async () => {
    await panel("aye");
    expect(await screen.findByText("Claude Code köprüsü")).toBeTruthy();
    expect(screen.getByText(/Kurulu · bu Peeka'ya bağlı · son olay 2 dk önce/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kaldır" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "İzinlerin geçmişi" }));
    await settle();
    expect(within(screen.getByLabelText("İzinlerin geçmişi", { selector: ".izinGecmis" })).getAllByText(/Pusula:/)).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Pusula'nın erişimini geri al: basılı tut" }).length).toBeGreaterThan(0);
  });
  it("Rust köprü komutunu bilmiyorsa köprü satırı çizilmez (uydurma durum yok)", async () => {
    { const real = fakeBridge.call.bind(fakeBridge) as (c: string, ...a: unknown[]) => Promise<unknown>; vi.spyOn(fakeBridge, "call").mockImplementation(((c: string, ...a: unknown[]) => (c === "claude_bridge_state" ? Promise.reject("unknown") : real(c, ...a))) as never); }
    render(<PluginExtras />);
    await settle();
    expect(screen.queryByText("Claude Code köprüsü")).toBeNull();
  });
  it("tamlayan eki ünlü uyumuna uyar", () => {
    expect([genitive("Pusula"), genitive("Claude"), genitive("Hermes"), genitive("Obsidian")]).toEqual(["Pusula'nın", "Claude'nin", "Hermes'in", "Obsidian'ın"]);
  });
});

describe("Pano (h2, kl)", () => {
  it("sürüklenen küçük resim soluklaşır, bitince geri gelir", async () => {
    render(<PanoView />);
    await settle();
    const thumb = document.querySelector<HTMLElement>('[data-clip="c2"]')!;
    expect(thumb.className).not.toContain("surukleniyor");
    act(() => setPanoDrag("c2"));
    expect(document.querySelector('[data-clip="c2"]')!.className).toContain("surukleniyor");
    act(() => { fakeBridge.emit("clip_drag_end", null); });
    await settle();
    expect(document.querySelector('[data-clip="c2"]')!.className).not.toContain("surukleniyor");
  });
  it("kilit kartı elle kilitte ek sebep satırı yazmaz", () => {
    render(<LockCard lock={{ locked: true, reason: "manual" }} />);
    expect(screen.queryByText("Peeka'yı kilitledin.")).toBeNull();
    expect(screen.getByRole("button", { name: "Kilidi aç" })).toBeTruthy();
  });
});

describe("Arama (ara0)", () => {
  it("Pusula'ya sor karosunda maskot, Enter ipucu '↵', ayar simgesi başlığa göre", async () => {
    render(<SearchPanel onClose={() => undefined} />);
    await settle();
    const ask = document.querySelector(".asistanSor")!;
    expect(ask.querySelector(".tile .mascot, .tile .mascot-neutral")).not.toBeNull();
    expect(ask.querySelector(".enter kbd")!.textContent).toBe("↵");
    expect(document.querySelector(".sonuc .tile svg.lucide-monitor")).not.toBeNull();
  });
});

describe("kurulum sihirbazı (kur)", () => {
  it("üç adım; adım 2 maketteki üç satır; Bitti işaretler ve kapatır", async () => {
    const done = vi.fn();
    render(<SetupWizard onDone={done} />);
    await settle();
    expect(screen.getByRole("img", { name: "Adım 1 / 3" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Geri" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "İleri" }));
    expect(screen.getByText("Windows görev çubuğunu gizle")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Yapıldı" })).toBeTruthy();
    const sw = screen.getByRole("switch", { name: "Windows bildirimlerini sağ üstte göster" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    await settle();
    expect(logged("mirror_enable")).toHaveLength(1);
    const spy = vi.spyOn(fakeBridge, "call");
    fireEvent.click(screen.getByRole("button", { name: /Ayarları aç/ }));
    expect(spy).toHaveBeenCalledWith("open_windows_settings", { uri: "ms-settings:notifications" });
    fireEvent.click(screen.getByRole("button", { name: "İleri" }));
    expect(setupDone()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Bitti" })); // son adıma gelir gelmez çift tık bitirmez (R1-8)
    expect(setupDone()).toBe(false);
    await settle(350);
    fireEvent.click(screen.getByRole("button", { name: "Bitti" }));
    expect(setupDone()).toBe(true);
    expect(localStorage.getItem(SETUP_KEY)).toBe("1");
    expect(done).toHaveBeenCalled();
  });
  it("görev çubuğu gizli değilse adım 2'de Gizle düğmesi taskbar_set_mode yazar", async () => {
    await fakeBridge.call("taskbar_set_mode", { mode: "off" });
    render(<SetupWizard onDone={() => undefined} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "İleri" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Gizle" }));
    await settle();
    expect((await settings()).taskbarHide).toBe("full");
    markSetup();
  });
});
