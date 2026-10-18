import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_SECRET, fakeBridge } from "../bridge.fake";
import type { SearchResult } from "../bridge";
import { Island } from "../components/Island";
import { PanoView } from "../components/Pano";
import { SummaryBoxes } from "../components/Plugin";
import { SearchPanel } from "../components/SearchPanel";
import { SettingsPanel } from "../components/SettingsPanel";
import { alive, ago, left, safeThumb } from "../lib/clip";
import { FILES_OFF, flatten, groupResults } from "../lib/search";
import { APPROVAL_HIGH, APPROVAL_LOW, PUSULA, EMPTY_SURFACES } from "../plugin.fixtures";

const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset();
  localStorage.clear(); sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });
const row = (id: string) => document.querySelector<HTMLElement>(`[data-clip="${id}"]`)!;
const logged = (cmd: string) => fakeBridge.log.filter((l) => l.cmd === cmd);

describe("pano: satır eylemleri yalnız üstüne gelince ya da seçiliyken (karar 15)", () => {
  it("seçili olmayan satırda eylem yok; üstüne gelince çıkar ve zamanın yerini alır; çekilince gider", async () => {
    render(<PanoView />);
    await screen.findByText("ekran-kaydı.mp4");
    const r = row("c9");
    expect(within(r).queryByRole("button", { name: "Sil" })).toBeNull();
    expect(r.className).not.toContain("etkin");
    fireEvent.pointerEnter(r);
    expect(within(r).getByRole("button", { name: "Sil" })).toBeTruthy();
    expect(within(r).getByRole("button", { name: "Geri kopyala" })).toBeTruthy();
    expect(within(r).getByRole("button", { name: "Sabitle" })).toBeTruthy();
    expect(r.className).toContain("etkin"); // CSS: .etkin .zaman söner, eylemler gelir
    fireEvent.pointerLeave(r);
    expect(within(r).queryByRole("button", { name: "Sil" })).toBeNull();
  });
  it("seçili olmak tek başına eylem göstermez (iki Sil birden görünmesin, O17); klavye odağı gösterir", async () => {
    render(<PanoView />);
    await screen.findByText("ekran-kaydı.mp4");
    expect(within(row("c1")).queryByRole("button", { name: "Sil" })).toBeNull();
    expect(within(row("c5")).queryByRole("button", { name: "Sil" })).toBeNull();
    document.documentElement.setAttribute("data-kb", "");
    act(() => row("c5").focus());
    document.documentElement.removeAttribute("data-kb");
    expect(within(row("c5")).getByRole("button", { name: "Sil" })).toBeTruthy();
    expect(within(row("c1")).queryByRole("button", { name: "Sil" })).toBeNull();
  });
  it("geri kopyala, sabitle, sil bridge'e gider; ok tuşları gezer, Enter geri kopyalar", async () => {
    render(<PanoView />);
    await screen.findByText("ekran-kaydı.mp4");
    fireEvent.pointerEnter(row("c9"));
    fireEvent.click(within(row("c9")).getByRole("button", { name: "Geri kopyala" }));
    fireEvent.click(within(row("c9")).getByRole("button", { name: "Sabitle" }));
    await settle();
    expect(logged("clip_copy")[0].args).toEqual({ id: "c9" });
    expect(logged("clip_pin")[0].args).toEqual({ id: "c9", on: true });
    act(() => row("c1").focus());
    fireEvent.keyDown(row("c1"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(row("c2"));
    fireEvent.keyDown(row("c2"), { key: "Enter" });
    expect(logged("clip_copy").at(-1)!.args).toEqual({ id: "c2" });
    fireEvent.pointerEnter(row("c7"));
    fireEvent.click(within(row("c7")).getByRole("button", { name: "Sil" }));
    await settle();
    expect(logged("clip_delete")[0].args).toEqual({ id: "c7" });
    expect(screen.queryByText("ornek.com/raporlar/q3-ozet")).toBeNull();
  });
  it("'Pusula'ya sor' ana asistan varken text satırında vardır, parola satırında hiç yoktur, asistan yokken kalkar", async () => {
    render(<PanoView />);
    await screen.findByText("ekran-kaydı.mp4");
    await settle();
    fireEvent.pointerEnter(row("c9"));
    expect(within(row("c9")).getByRole("button", { name: "Pusula'ya sor" })).toBeTruthy();
    fireEvent.pointerEnter(row("c6"));
    expect(within(row("c6")).queryByRole("button", { name: "Pusula'ya sor" })).toBeNull();
    expect(within(row("c6")).queryByRole("button", { name: "Sabitle" })).toBeNull(); // ADR-0063 §3: parolada sabitleme yok
    act(() => fakeBridge.setPlugins([]));
    await settle();
    expect(within(row("c9")).queryByRole("button", { name: "Pusula'ya sor" })).toBeNull();
  });
  it("Pano görünürken clip_visible açılır, kapanınca kapanır (yakalamadan hariç tutma)", async () => {
    const { unmount } = render(<PanoView />);
    await settle();
    expect(logged("clip_visible").map((l) => (l.args as { on: boolean }).on)).toEqual([true]);
    unmount();
    expect(logged("clip_visible").map((l) => (l.args as { on: boolean }).on)).toEqual([true, false]);
  });
});

describe("pano: parola satırı (ADR-0063)", () => {
  it("maskeli: ••••, 'Bitwarden · şifreli · N dk'; düz metin ne listede ne ekranda", async () => {
    render(<PanoView />);
    await screen.findByText("ekran-kaydı.mp4");
    const r = row("c6");
    expect(within(r).getByRole("img", { name: "Gizli parola" }).textContent).toMatch(/^\S{10,}$/); // bulanık sabit yer tutucu
    expect(r.textContent).toMatch(/Bitwarden · şifreli · 5\d dk/);
    expect(document.body.textContent).not.toContain(FAKE_SECRET);
    expect(JSON.stringify(await fakeBridge.call("clip_list"))).not.toContain(FAKE_SECRET); // liste düz metin taşımaz
  });
  it("göz düğmesi 5 sn gösterir, sonra state'ten ve ekrandan silinir; hiçbir yere yazılmaz", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k));
    render(<PanoView />);
    await screen.findByText("ekran-kaydı.mp4");
    vi.useFakeTimers();
    await act(async () => { fireEvent.pointerEnter(row("c6")); }); // üstüne gelmek düz metni getirir
    expect(row("c6").textContent).toContain(FAKE_SECRET);
    expect(row("c6").textContent).toContain("5 sn sonra yeniden gizlenir");
    // gösterilirken bile: depolama, adres, konsol, köprü günlüğü temiz
    expect(setItem).not.toHaveBeenCalled();
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(FAKE_SECRET);
    expect(location.href + location.search + location.hash).not.toContain(FAKE_SECRET);
    expect(JSON.stringify(fakeBridge.log)).not.toContain(FAKE_SECRET);
    await act(async () => { vi.advanceTimersByTime(4900); });
    expect(row("c6").textContent).toContain(FAKE_SECRET);
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(document.body.textContent).not.toContain(FAKE_SECRET);
    expect(within(row("c6")).getByRole("img", { name: "Gizli parola" })).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(FAKE_SECRET);
    expect(setItem).not.toHaveBeenCalled();
    for (const l of logs) expect(JSON.stringify(l.mock.calls)).not.toContain(FAKE_SECRET);
  });
  it("yeniden basınca, pencere odağı gidince hemen gizlenir", async () => {
    render(<PanoView />);
    await screen.findByText("ekran-kaydı.mp4");
    await act(async () => { fireEvent.pointerEnter(row("c6")); }); // üstüne gelmek düz metni getirir
    expect(row("c6").textContent).toContain(FAKE_SECRET);
    await act(async () => { fireEvent.click(within(row("c6")).getByRole("button", { name: "Gizle" })); });
    expect(document.body.textContent).not.toContain(FAKE_SECRET);
    await act(async () => { fireEvent.click(within(row("c6")).getByRole("button", { name: "Kısa süre göster" })); });
    expect(row("c6").textContent).toContain(FAKE_SECRET);
    act(() => { window.dispatchEvent(new Event("blur")); });
    expect(document.body.textContent).not.toContain(FAKE_SECRET);
  });
  it("kart sökülünce zamanlayıcı da gider (süre dolunca sökülmüş bileşene yazılmaz)", async () => {
    const err = vi.spyOn(console, "error");
    const { unmount } = render(<PanoView />);
    await screen.findByText("ekran-kaydı.mp4");
    vi.useFakeTimers();
    await act(async () => { fireEvent.pointerEnter(row("c6")); }); // üstüne gelmek düz metni getirir
    unmount();
    expect(document.body.textContent).not.toContain(FAKE_SECRET);
    await act(async () => { vi.advanceTimersByTime(6000); });
    expect(err).not.toHaveBeenCalled();
  });
  it("geri kopyala clip_reveal çağırmaz (yalnız üstüne gelme çağırır)", async () => {
    render(<PanoView />);
    await screen.findByText("ekran-kaydı.mp4");
    await act(async () => { fireEvent.pointerEnter(row("c6")); });
    expect(logged("clip_reveal")).toHaveLength(1); // yalnız üstüne gelme
    await act(async () => { fireEvent.click(within(row("c6")).getByRole("button", { name: "Göstermeden geri kopyala" })); });
    expect(logged("clip_copy")[0].args).toEqual({ id: "c6" });
    expect(logged("clip_reveal")).toHaveLength(1); // kopyalamak yeniden çözmez
    fireEvent.pointerLeave(row("c6"));
    expect(document.body.textContent).not.toContain(FAKE_SECRET);
  });
  it("Peeka kilitliyken parola satırı hiç çizilmez; Rust yanlışlıkla gönderse bile arayüz eler", async () => {
    fakeBridge.setLocked(true);
    render(<PanoView />);
    await screen.findByText("ekran-kaydı.mp4");
    expect(row("c6")).toBeNull();
    expect(screen.queryByText(/Bitwarden/)).toBeNull();
    // Rust listede parola gönderse de eleme
    const orig = fakeBridge.call.bind(fakeBridge) as (c: string, ...a: unknown[]) => Promise<unknown>;
    vi.spyOn(fakeBridge, "call").mockImplementation(((cmd: string, ...a: unknown[]) => (cmd === "clip_list" ? Promise.resolve(fakeBridge.rawClips()) : orig(cmd, ...a))) as never);
    cleanup();
    render(<PanoView />);
    await screen.findByText("ekran-kaydı.mp4");
    expect(row("c6")).toBeNull();
  });
  it("gösterilirken kilit gelirse metin anında silinir; kilitliyken göster ve geri kopyala reddedilir", async () => {
    render(<PanoView />);
    await screen.findByText("ekran-kaydı.mp4");
    await act(async () => { fireEvent.pointerEnter(row("c6")); }); // üstüne gelmek düz metni getirir
    expect(row("c6").textContent).toContain(FAKE_SECRET);
    await act(async () => { fakeBridge.setLocked(true); });
    await settle();
    expect(document.body.textContent).not.toContain(FAKE_SECRET);
    expect(row("c6")).toBeNull();
    await expect(fakeBridge.call("clip_reveal", { id: "c6" })).rejects.toBe("denied");
    await expect(fakeBridge.call("clip_copy", { id: "c6" })).rejects.toBe("denied");
    await expect(fakeBridge.call("clip_share", { id: "c6" })).rejects.toBe("denied");
  });
  it("süresi dolan parola listeden düşer", () => {
    const p = { id: "x", kind: "password", source: null, createdAt: 0, pinned: false, expiresAt: 1000 } as const;
    expect(alive(p, 999)).toBe(true);
    expect(alive(p, 1000)).toBe(false);
  });
});

describe("pano: saf kurallar", () => {
  it("süre biçimleri", () => {
    expect(ago(0, 30_000)).toBe("şimdi");
    expect(ago(0, 5 * 60_000)).toBe("5 dk");
    expect(ago(0, 3 * 3_600_000)).toBe("3 sa");
    expect(left(60 * 60_000, 0)).toBe("1 sa");
    expect(left(40 * 60_000 - 1, 0)).toBe("40 dk");
    expect(left(10_000, 0)).toBe("1 dk'dan az");
  });
  it("küçük resim yalnız raster/SVG data URL; dosya yolu ve bağlantı reddedilir", () => {
    expect(safeThumb("data:image/png;base64,AAAA")).toBeTruthy();
    for (const bad of ["file:///C:/x.png", "https://x/y.png", "javascript:alert(1)", "data:text/html,<script>", "x", null, 5]) expect(safeThumb(bad)).toBeNull();
  });
});

describe("Peeka kilidi (kl)", () => {
  it("kilitliyken Pano ve Modüller kartı yerine kilit kartı çıkar; saat durur", async () => {
    fakeBridge.setLocked(true, "windows");
    render(<Island monitor="m1" init={{ view: "pano" }} />);
    await settle();
    expect(screen.getByRole("dialog", { name: "Peeka kilitli" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Pano" })).toBeNull();
    expect(screen.getByText("Windows kilidini açınca kendiliğinden kalkar.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Kilidi aç/ })).toBeNull(); // Windows kilidi Windows açınca kalkar: düğme yok
    cleanup();
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    expect(screen.getByRole("dialog", { name: "Peeka kilitli" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Sistem" })).toBeNull();
  });
  it("Kilitle düğmesiyle kilitlenince 'Kilidi aç' gelir ve lock_release çağırır; Pano kartı döner", async () => {
    fakeBridge.setLocked(true, "manual");
    render(<Island monitor="m1" init={{ view: "pano" }} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Kilidi aç/ }));
    await settle();
    expect(logged("lock_release")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Pano" })).toBeTruthy();
  });
  it("Pano kartı yüklendikten sonra 800 ms'lik 'yavaş yükleme' iskeletine dönmez (yük altında oynak test)", async () => {
    render(<Island monitor="m1" init={{ view: "pano" }} />);
    await settle();
    await act(async () => { await new Promise((r) => setTimeout(r, 850)); });
    expect(screen.getByRole("dialog", { name: "Pano" })).toBeTruthy();
  });
  it("kilit açılınca (Windows kilidi kalkınca) Pano kartı geri gelir", async () => {
    fakeBridge.setLocked(true);
    render(<Island monitor="m1" init={{ view: "pano" }} />);
    await settle();
    await act(async () => { fakeBridge.setLocked(false); });
    await settle();
    expect(screen.getByRole("dialog", { name: "Pano" })).toBeTruthy();
    expect(document.querySelector('[data-clip="c6"]')).not.toBeNull();
  });
  it("kilitliyken ekran alıntısı çıkıntısı çıkmaz; kilitsizken çıkar ve 'Pusula'ya sor' + 'Düzenle' taşır", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const shot = fakeBridge.rawClips()[0];
    await act(async () => { fakeBridge.addClip({ ...shot, id: "yeni" } as never); });
    await settle();
    const g = screen.getByRole("group", { name: "Ekran alıntısı" });
    expect(within(g).getByRole("button", { name: "Pusula'ya sor" })).toBeTruthy();
    expect(within(g).getByRole("button", { name: "Düzenle" })).toBeTruthy();
    fireEvent.click(within(g).getByRole("button", { name: "Düzenle" }));
    expect(logged("clip_edit")[0].args).toEqual({ id: "yeni" });
    cleanup();
    fakeBridge.setLocked(true);
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await act(async () => { fakeBridge.addClip({ ...shot, id: "yeni2" } as never); });
    await settle();
    expect(screen.queryByRole("group", { name: "Ekran alıntısı" })).toBeNull();
  });
});

describe("Ctrl+K arama", () => {
  const r = (kind: SearchResult["kind"], title: string, extra: Partial<SearchResult> = {}): SearchResult => ({ id: kind + title, kind, title, subtitle: null, appId: "", icon: "", hwnd: null, ...extra });
  it("grup sırası: uygulamalar, açık pencereler, dosyalar, ayarlar, eklenti grupları (Rust hangi sırada verirse versin)", () => {
    const groups = groupResults([
      r("plugin", "Ekim hedefleri", { plugin: PUSULA, group: "Notlar" }), r("setting", "Ekran koruyucu"), r("file", "a.pdf"), r("window", "Pencere"), r("app", "Uygulama"),
    ], "ekran", false);
    expect(groups.map((g) => g.title)).toEqual(["Uygulamalar", "Açık pencereler", "Dosyalar", "Ayarlar", "Pusula › Notlar"]);
    expect(flatten(groups).map((x) => x.kind)).toEqual(["app", "window", "file", "setting", "plugin"]);
  });
  it("boş sorgu tek 'Son kullanılanlar' grubu; boş gruplar çizilmez; dizin kapalıyken Dosyalar tek satır uyarıyla durur", () => {
    expect(groupResults([r("app", "A"), r("file", "b")], "", false).map((g) => g.title)).toEqual(["Son kullanılanlar"]);
    expect(groupResults([r("app", "A")], "a", false).map((g) => g.title)).toEqual(["Uygulamalar"]);
    const off = groupResults([r("app", "A")], "a", true);
    expect(off.map((g) => g.title)).toEqual(["Uygulamalar", "Dosyalar"]);
    expect(off[1].note).toBe(FILES_OFF);
    expect(off[1].rows).toEqual([]);
  });
  it("iki eklentinin grupları ayrı; başlığın ön ekini Peeka basar", () => {
    const g = groupResults([r("plugin", "x", { plugin: { id: "b", name: "Örnek", main: false }, group: "Pusula › Sahte" })], "x", false);
    expect(g[0].title).toBe("Örnek › Pusula - Sahte"); // eklenti ayraç taklidiyle ön ek kuramaz
  });
  it("panel: gruplar sırayla çizilir; ok tuşları gruplar arası gezer; 'Pusula'ya sor' en altta ve Enter ile sorgu gider", async () => {
    render(<SearchPanel onClose={() => undefined} />);
    await settle();
    const input = screen.getByRole("combobox", { name: "Ara" });
    fireEvent.change(input, { target: { value: "ekran" } });
    await settle();
    const heads = [...document.querySelectorAll(".grupBas")].map((e) => e.textContent).filter(Boolean);
    expect(heads).toEqual(["Uygulamalar", "Açık pencereler", "Dosyalar", "Ayarlar", "Pusula › Notlar"]);
    const opts = screen.getAllByRole("option");
    expect(opts.at(-1)!.textContent).toContain("Pusula'ya sor");
    expect(opts[0].getAttribute("aria-selected")).toBe("true");
    for (let i = 0; i < opts.length + 3; i++) fireEvent.keyDown(input, { key: "ArrowDown" }); // sona yapışır
    expect(opts.at(-1)!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(logged("search_ask")[0].args).toEqual({ query: "ekran" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(logged("search_open")).toHaveLength(1); // son gruptaki eklenti (not) sonucu
  });
  it("ana asistan yokken 'Pusula'ya sor' satırı ve kısayol ipucu hiç yok", async () => {
    fakeBridge.setPlugins([]);
    render(<SearchPanel onClose={() => undefined} />);
    await settle();
    fireEvent.change(screen.getByRole("combobox", { name: "Ara" }), { target: { value: "ekran" } });
    await settle();
    expect(screen.queryByText(/Pusula'ya sor/)).toBeNull();
    expect(screen.queryByText(/Notlar/)).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Ara" }), { target: { value: "xqz" } });
    await settle();
    expect(screen.getByText(/için sonuç yok\.$/)).toBeTruthy();
    expect(screen.queryByText(/sorabilirsin/)).toBeNull();
  });
  it("Windows Arama dizini kapalıyken Dosyalar'da tek satır uyarı çıkar", async () => {
    fakeBridge.setFilesIndex(false);
    render(<SearchPanel onClose={() => undefined} />);
    await settle();
    fireEvent.change(screen.getByRole("combobox", { name: "Ara" }), { target: { value: "ekran" } });
    await settle();
    expect(screen.getByText(FILES_OFF)).toBeTruthy();
    expect(screen.queryByText("ekran-kaydı.mp4")).toBeNull();
  });
  it("boş halde 'Son kullanılanlar' ve Pusula'ya sor satırı var", async () => {
    render(<SearchPanel onClose={() => undefined} />);
    await settle();
    expect(screen.getByRole("group", { name: "Son kullanılanlar" })).toBeTruthy();
    expect(screen.getAllByRole("option").at(-1)!.textContent).toContain("Pusula'ya sor…");
  });
});

describe("onay satırı (Modüller › Genel)", () => {
  const surf = (a: typeof APPROVAL_LOW) => ({ ...EMPTY_SURFACES, approvals: [a], approvalTop: a.id });
  it("doğrudan 'İzin ver' surface: protrusion gönderir (yüksek risk kuralı Rust'ta bunu bilir)", () => {
    vi.useFakeTimers();
    render(<SummaryBoxes surf={surf(APPROVAL_LOW)} onDetail={() => undefined} />);
    act(() => { vi.advanceTimersByTime(700); });
    fireEvent.click(screen.getByRole("button", { name: "İzin ver" }));
    const a = logged("approval_answer")[0].args as { decision: string; surface: string };
    expect(a.decision).toBe("allow");
    expect(a.surface).toBe("protrusion");
  });
  it("yalnız 'Ayrıntı' sunan satırda doğrudan cevap yok", () => {
    render(<SummaryBoxes surf={surf(APPROVAL_HIGH)} onDetail={() => undefined} />);
    expect(screen.getByRole("button", { name: "Ayrıntı" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "İzin ver" })).toBeNull();
  });
});

describe("Ayarlar › Görünüm: Windows ile başlat ve görev çubuğu kipi", () => {
  it("'Windows ile başlat' anahtarı set_settings({autostart}) yazar", async () => {
    render(<SettingsPanel page="ayg" onPage={() => undefined} settings={await fakeBridge.call("get_settings")} />);
    fireEvent.click(screen.getByRole("button", { name: "Diğer ayarlar" }));
    const sw = screen.getByRole("switch", { name: "Windows ile başlat" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    await settle();
    expect((await fakeBridge.call("get_settings")).autostart).toBe(false);
  });
  it("üç seçenekli görev çubuğu kipi taskbarHide'dan okunur, taskbar_set_mode ile yazılır; 'deneysel' yazısı yok", async () => {
    const settings = await fakeBridge.call("get_settings");
    const { container } = render(<SettingsPanel page="ayg" onPage={() => undefined} settings={settings} />);
    fireEvent.click(screen.getByRole("button", { name: "Diğer ayarlar" }));
    const group = screen.getByRole("radiogroup", { name: "Windows görev çubuğu" });
    expect(within(group).getAllByRole("radio").map((b) => b.textContent)).toEqual(["Tamamen gizle", "Otomatik gizle", "Windows görev çubuğu kalsın"]);
    expect(within(group).getByRole("radio", { name: "Tamamen gizle" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(group).getByRole("radio", { name: "Windows görev çubuğu kalsın" }));
    await settle();
    expect((await fakeBridge.call("get_settings")).taskbarHide).toBe("off");
    expect(within(group).getByRole("radio", { name: "Windows görev çubuğu kalsın" }).getAttribute("aria-checked")).toBe("true");
    expect(container.textContent?.toLocaleLowerCase("tr")).not.toContain("deneysel");
  });
  it("taskbarHide dışarıdan değişince seçim izler", async () => {
    const settings = await fakeBridge.call("get_settings");
    const { rerender } = render(<SettingsPanel page="ayg" onPage={() => undefined} settings={settings} />);
    fireEvent.click(screen.getByRole("button", { name: "Diğer ayarlar" }));
    rerender(<SettingsPanel page="ayg" onPage={() => undefined} settings={{ ...settings, taskbarHide: "auto" }} />);
    expect(screen.getByRole("radio", { name: "Otomatik gizle" }).getAttribute("aria-checked")).toBe("true");
  });
  it("hoş geldin kartı '?autostart=1' ile çıkmaz, elle başlatınca çıkar", async () => {
    window.history.replaceState({}, "", "/?autostart=1");
    render(<Island monitor="m1" />);
    await settle();
    expect(screen.queryByRole("dialog", { name: "Peeka'ya hoş geldin" })).toBeNull();
    cleanup();
    window.history.replaceState({}, "", "/");
    render(<Island monitor="m1" />);
    await settle();
    expect(screen.getByRole("dialog", { name: "Peeka'ya hoş geldin" })).toBeTruthy();
  });
});

describe("Ayarlar › Pano (ayp)", () => {
  it("parola ömrü 5/15/30/60; seçili olan işaretli, değişince set_settings yazar", async () => {
    render(<SettingsPanel page="ayp" onPage={() => undefined} settings={await fakeBridge.call("get_settings")} />);
    const g = screen.getByRole("radiogroup", { name: "Parola ömrü" });
    expect(within(g).getAllByRole("radio").map((b) => b.textContent)).toEqual(["5 dk", "15 dk", "30 dk", "60 dk"]);
    expect(within(g).getByRole("radio", { name: "60 dk" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(g).getByRole("radio", { name: "15 dk" }));
    await settle();
    expect((await fakeBridge.call("get_settings")).clipPasswordMin).toBe(15);
  });
  it("'Hepsini sil' yalnız basılı tutunca çalışır", async () => {
    vi.useFakeTimers();
    render(<SettingsPanel page="ayp" onPage={() => undefined} settings={await fakeBridge.call("get_settings")} />);
    const b = screen.getByRole("button", { name: "Hepsini sil: basılı tut" });
    fireEvent.pointerDown(b, { button: 0 });
    act(() => { vi.advanceTimersByTime(600); });
    fireEvent.pointerUp(b);
    act(() => { vi.advanceTimersByTime(1500); });
    expect(logged("clip_clear")).toHaveLength(0);
    fireEvent.pointerDown(b, { button: 0 });
    act(() => { vi.advanceTimersByTime(1250); });
    expect(logged("clip_clear")).toHaveLength(1);
  });
});
