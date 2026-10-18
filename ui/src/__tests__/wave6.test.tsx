import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { MirrorCard, NotificationList } from "../components/Notifications";
import { Shell } from "../components/Shell";
import { clearPreviewCache } from "../components/WindowPreview";
import { onX, sendX } from "../lib/xwin";
import { Ghost } from "../mascot/ghost";
import { resetMascotRegistry } from "../mascot/useSingleMascot";

const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset(); clearPreviewCache(); localStorage.clear(); sessionStorage.clear();
});
afterEach(() => {
  cleanup(); resetMascotRegistry(); vi.useRealTimers(); vi.restoreAllMocks();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const settle = (ms = 60) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const logged = (cmd: string) => fakeBridge.log.filter((l) => l.cmd === cmd);
const notice = { id: "win.1", app: "Teams", title: "Ayşe yazdı", body: "Toplantı 15:00'e alındı" };

describe("zamanlayıcı başlat (Modüller)", () => {
  it("dakika ve ad timer_start'a saniye olarak gider; geçersiz dakikada düğme kapalı", async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    fireEvent.click(screen.getByRole("tab", { name: "Zamanlayıcı" })); // Zamanlayıcı kendi sekmesinde (maket j)
    const go = screen.getByRole("button", { name: "Başlat" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("Dakika"), { target: { value: "0" } });
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Dakika"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Zamanlayıcı adı"), { target: { value: " Çay " } });
    fireEvent.click(go);
    await settle();
    expect(logged("timer_start")[0].args).toEqual({ label: "Çay", seconds: 300 });
    expect((await fakeBridge.call("timer_get"))?.totalS).toBe(300);
  });
});

describe("sunum modu ve meşgul (input_tick)", { timeout: 30_000 }, () => {
  const run = async (tick: { presentation?: boolean; busy?: boolean }) => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.spyOn(Math, "random").mockReturnValue(0);
    const prank = vi.spyOn(Ghost.prototype, "prank").mockImplementation(() => undefined);
    fakeBridge.setMedia(null);
    render(<Island monitor="m1" init={{ view: null }} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    act(() => fakeBridge.emit("input_tick", { lastInputAgoMs: 60_000, cursor: null, ...tick }));
    await act(async () => { vi.advanceTimersByTime(47 * 60_000); });
    return prank;
  };
  it("sunum modunda muziplik oynamaz", async () => { expect((await run({ presentation: true })).mock.calls).toHaveLength(0); });
  it("meşgulde muziplik oynamaz", async () => { expect((await run({ busy: true })).mock.calls).toHaveLength(0); });
  it("ikisi de yokken oynar (kontrol)", async () => { expect((await run({})).mock.calls).toHaveLength(1); });
  it("sunum modunda Bluetooth çıkıntısı kendiliğinden açılmaz", async () => {
    render(<Island monitor="m1" init={{ view: null, pin: true }} />);
    await settle();
    act(() => fakeBridge.emit("input_tick", { lastInputAgoMs: 60_000, cursor: null, presentation: true }));
    act(() => fakeBridge.emit("bluetooth_connected", { name: "Buds Pro", battery: 80 }));
    await settle();
    expect(document.body.textContent).not.toContain("Buds Pro bağlandı");
  });
});

describe("tepsi listesi (ok düğmesi)", () => {
  it("ok open_tray'den listeyi gösterir; satır tray_open çağırır ve paneli kapatır", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Gizli simgeler" }));
    await settle();
    const d = screen.getByRole("dialog", { name: "Gizli simgeler", hidden: true });
    expect([...within(d).getByRole("group", { name: "Gizli simgeler" }).querySelectorAll("button")].slice(0, 3).map((x) => x.getAttribute("aria-label"))).toEqual(["Discord, 3 yeni", "Steam", "OneDrive"]);
    fireEvent.click(within(d).getByRole("group", { name: "Gizli simgeler" }).querySelectorAll("button")[1]);
    await settle();
    expect(logged("tray_open")[0].args).toEqual({ id: "exe:c:/apps/steam.exe" });
    expect(d.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Windows bildirim aynası (Bildirimler)", () => {
  it("kart uygulama, başlık, gövde ve iki düğmeyi çizer; kare tek renk (alfa maskesi), şerit dalgası yok", async () => {
    fakeBridge.pushNotice({ ...notice, tile: "data:image/png;base64,AAAA" });
    render(<NotificationList onReview={() => undefined} />);
    await settle();
    const card = document.querySelector<HTMLElement>("[data-mirror='win.1']")!;
    expect(card.textContent).toContain("Teams");
    expect(card.textContent).toContain("Toplantı 15:00'e alındı");
    expect(within(card).getByRole("button", { name: "Uygulamayı aç" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Pusula yanıtlasın" })).toBeTruthy();
    expect(card.querySelector(".uygIk.mono")!.getAttribute("style")).toContain("mask-image");
  });
  it("renkli simge ayarı açıkken de kare tek renk kalır; bozuk simge adresi maskeye girmez", async () => {
    await fakeBridge.call("set_settings", { patch: { colorIcons: true } });
    fakeBridge.pushNotice({ ...notice, tile: 'https://evil/x.png");background:url(x' });
    render(<NotificationList onReview={() => undefined} />);
    await settle();
    const card = document.querySelector<HTMLElement>("[data-mirror='win.1']")!;
    expect(card.querySelector(".uygIk")).toBeNull();
    expect(card.querySelector(".uyg b")!.textContent).toBe("T");
    expect(card.innerHTML).not.toContain("evil");
  });
  it("canOpen yoksa 'Uygulamayı aç' yok; varsa mirror_open_app gider", async () => {
    const a = render(<MirrorCard n={{ id: "x", app: "A", title: "t", body: null, tile: "", tileMono: true, ripple: false, openLabel: "Uygulamayı aç", canOpen: false, at: 0 }} />);
    expect(within(a.container).queryByRole("button", { name: "Uygulamayı aç" })).toBeNull();
    a.unmount();
    fakeBridge.pushNotice({ ...notice, id: "win.2" });
    render(<NotificationList onReview={() => undefined} />);
    await settle();
    fireEvent.click(within(document.querySelector<HTMLElement>("[data-mirror='win.2']")!).getByRole("button", { name: "Uygulamayı aç" }));
    await settle();
    expect(logged("mirror_open_app")[0].args).toEqual({ id: "win.2" });
  });
  it("'Pusula yanıtlasın' mirror_ask çağırır ve ada sayfasına yanıt görünümünü açtırır", async () => {
    const got: string[] = [];
    const off = onX((m) => got.push(m.t));
    fakeBridge.pushNotice(notice);
    const onClose = vi.fn();
    render(<NotificationList onReview={() => undefined} onClose={onClose} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Pusula yanıtlasın" }));
    await settle(120);
    off();
    expect(logged("mirror_ask")[0].args).toEqual({ id: "win.1" });
    expect(got).toContain("ask");
    expect(onClose).toHaveBeenCalled();
  });
  it("ana asistan yokken 'Pusula yanıtlasın' kapalı", async () => {
    fakeBridge.setPlugins([]);
    fakeBridge.pushNotice(notice);
    render(<NotificationList onReview={() => undefined} />);
    await settle();
    expect((screen.getByRole("button", { name: "Asistan yanıtlasın" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("ada sayfası 'ask' mesajıyla sohbet kutusunu açar", async () => {
    fakeBridge.setSurfaces({ composer: { id: "dev.example.pusula", name: "Pusula", main: true, voice: false } });
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    sendX({ t: "ask" });
    await settle(80);
    expect(screen.getByRole("dialog", { name: "Sor" })).toBeTruthy();
  });
  it("sessiz değilken yeni Windows bildirimi sağ üstte kart olur; sessizken açmaz; ilk liste açmaz; liste kendiliğinden açılmaz", async () => {
    fakeBridge.pushNotice({ ...notice, id: "old" });
    render(<Shell monitor="m1" />);
    await settle();
    const toast = () => document.querySelector<HTMLElement>('[aria-label="Windows bildirimi"]');
    expect(toast()).toBeNull();
    act(() => fakeBridge.setMirrorQuiet(true));
    act(() => fakeBridge.pushNotice({ ...notice, id: "q1" }));
    await settle();
    expect(toast()).toBeNull();
    act(() => fakeBridge.setMirrorQuiet(false));
    act(() => fakeBridge.pushNotice({ ...notice, id: "n2" }));
    await settle();
    expect(toast()).not.toBeNull();
    expect(document.querySelector<HTMLElement>("[data-panel=notif]")!.getAttribute("aria-hidden")).toBe("true");
  });
  it("Pusula yanıtlasın: taslak görünümü açılır, Gönder kapalı ve nedeni yazılı", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    act(() => fakeBridge.pushNotice({ ...notice, id: "n3" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Pusula yanıtlasın/ }));
    await settle(30); // taslak görünümü abone olsun (act sonunda render olur)
    await settle(400);
    expect(screen.getByText("Olur, 8 uygun. Görüşürüz.")).toBeTruthy();
    const send = screen.getByRole("button", { name: "Gönder" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(send.title).toMatch(/henüz yok/);
  });
  it("kilitliyken gövde ve başlık DOM'da yok: yalnız uygulama adı ve 'Kilitli'", async () => {
    fakeBridge.pushNotice({ ...notice, body: "Maaş zammı gizli" });
    render(<NotificationList onReview={() => undefined} />);
    await settle();
    expect(document.body.textContent).toContain("Maaş zammı gizli");
    act(() => fakeBridge.setLocked(true, "manual"));
    await settle();
    const t = document.body.textContent!;
    expect(t).not.toContain("Maaş zammı gizli");
    expect(t).not.toContain("Ayşe yazdı");
    expect(t).toContain("Teams");
    expect(t).toContain("Kilitli");
    expect(screen.queryByRole("button", { name: "Pusula yanıtlasın" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("(5 bildirim)");
  });
});

describe("Ayarlar › Windows bildirimleri", () => {
  const open = async () => {
    render(<Shell monitor="m1" init={{ panel: "ayg" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Diğer ayarlar" }));
    return screen.findByRole("switch", { name: "Windows bildirimleri" });
  };
  it("kapalıyken engel satırı yok; açınca mirror_enable gider, engelsizse satır çıkmaz", async () => {
    const sw = await open();
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(document.querySelector("[data-blocker]")).toBeNull();
    fireEvent.click(sw);
    await settle();
    expect(logged("mirror_enable")).toHaveLength(1);
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector("[data-blocker]")).toBeNull();
    fireEvent.click(sw);
    await settle();
    expect(logged("mirror_disable")).toHaveLength(1);
  });
  it.each([
    [{ devMode: false }, "dev_mode_off", "Geliştirici Modu kapalı", "ms-settings:developers"],
    [{ registered: false }, "not_registered", "register.ps1 çalıştırılıp Peeka yeniden başlatılmalı", null],
    [{ access: "denied" }, "access_denied", "Windows izin vermedi", "ms-settings:privacy-notifications"],
  ] as const)("engel %j: neden satırı ve doğru Windows ayarı bağlantısı", async (patch, blocker, text, uri) => {
    fakeBridge.setMirror(patch);
    const sw = await open();
    fireEvent.click(sw);
    await settle();
    const row = document.querySelector<HTMLElement>(`[data-blocker='${blocker}']`)!;
    expect(row.textContent).toContain(text);
    const btn = row.querySelector("button");
    if (!uri) { expect(btn).toBeNull(); return; }
    const spy = vi.spyOn(fakeBridge, "call");
    fireEvent.click(btn!);
    await settle();
    expect(spy).toHaveBeenCalledWith("open_windows_settings", { uri });
  });
  it("Windows ayarı açılamazsa (Rust izin listesi reddeder) elle yol yazılır", async () => {
    fakeBridge.setMirror({ devMode: false });
    const sw = await open();
    fireEvent.click(sw);
    await settle();
    const real = fakeBridge.call.bind(fakeBridge) as (...x: unknown[]) => unknown;
    vi.spyOn(fakeBridge, "call").mockImplementation(((cmd: string, ...a: unknown[]) => (cmd === "open_windows_settings" ? Promise.reject("invalid") : real(cmd, ...a))) as never);
    fireEvent.click(document.querySelector("[data-blocker] button")!);
    await settle();
    expect(document.querySelector("[data-blocker]")!.textContent).toContain("Geliştiriciler için");
  });
});
