import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { ProtrusionBump } from "../components/Plugin";
import { useMeetingReminder } from "../hooks";
import { meetingReminder, openJoinLink, REMINDER_GENERIC, setOpenJoinLink } from "../lib/meetingReminder";
import { pickPrimary } from "../lib/priority";

// Plan satır 22: Pusula takviminden toplantıya 5 dk kala "5 dk sonra: <başlık>" + "Katıl" (bağlantı varsa), 1 dk kala "toplantı" sırasında ana şeride çıkar.
const T0 = Date.parse("2026-10-18T12:00:00+03:00");
const LINK = "https://teams.microsoft.com/l/meetup-join/x";
const cal = (startMs: number, link?: string) => ({ detail: null, next: [{ time: "12:30", title: "Haftalık plan", source: "Takvim", start: new Date(startMs).toISOString(), ...(link ? { link } : {}) }] });
const saved = openJoinLink;
afterEach(() => { setOpenJoinLink(saved); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("meetingReminder (saf)", () => {
  it("5 dk penceresi: 6 dk önce yok; 5 dk kala 'dk sonra'; 1 dk kala 'toplantı' sırası; başlayınca 1 dk 'Başladı'; sonra yok", () => {
    const at = (leftS: number) => meetingReminder(cal(T0 + leftS * 1000, LINK), T0, false);
    expect(at(360)).toBeNull();
    expect(at(300)).toMatchObject({ title: "5 dk sonra: Haftalık plan", icon: "clock", link: LINK, actions: [{ id: "katil" }] });
    expect(at(121)?.title).toBe("3 dk sonra: Haftalık plan");
    expect(at(61)?.icon).toBe("clock");
    expect(at(60)).toMatchObject({ title: "1 dk sonra: Haftalık plan", icon: "calendar" });
    expect(at(-30)?.title).toBe("Başladı: Haftalık plan");
    expect(at(-61)).toBeNull();
  });
  it("kilit ya da sunum: genel metin, başlık ve bağlantı ve düğme yok", () => {
    const r = meetingReminder(cal(T0 + 200_000, LINK), T0, true)!;
    expect(r.title).toBe(REMINDER_GENERIC);
    expect(JSON.stringify(r)).not.toMatch(/Haftalık|teams/);
    expect(r.actions).toEqual([]);
  });
  it("bağlantı yoksa düğme yok; başlangıcı bozuk ya da gün boyu (start yok) satır geri saymaz", () => {
    expect(meetingReminder(cal(T0 + 200_000), T0, false)?.actions).toEqual([]);
    expect(meetingReminder({ detail: null, next: [{ time: "gün boyu", title: "x", source: "" }, { time: "1", title: "y", source: "", start: "yarın" }] }, T0, false)).toBeNull();
  });
  it("1 dk kala 'toplantı' sırası canlı işin altında ama bildirimin üstünde; 5 dk'da sıradan çıkıntı en alta düşer", () => {
    expect(pickPrimary([{ kind: "music" }, { kind: "meeting" }, { kind: "alert" }]).primary?.kind).toBe("meeting");
    expect(pickPrimary([{ kind: "music" }, { kind: "other" }]).primary?.kind).toBe("music");
  });
});

describe("useMeetingReminder (sahte saat)", () => {
  beforeEach(() => { fakeBridge.reset(); vi.useFakeTimers({ now: T0 }); });
  it("zamanla 5 dk'da çıkar, 1 dk'da yükselir, başladıktan 1 dk sonra söner; takvim değişince tazelenir", async () => {
    fakeBridge.setCalendar(cal(T0 + 330_000, LINK)); // 5 dk 30 sn sonra
    const { result } = renderHook(() => useMeetingReminder(false));
    const run = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    await run(0);
    expect(result.current).toBeNull();
    await run(45_000);
    expect(result.current?.title).toBe("5 dk sonra: Haftalık plan");
    await run(240_000); // 45 sn kala
    expect(result.current).toMatchObject({ title: "1 dk sonra: Haftalık plan", icon: "calendar" });
    await run(120_000); // başlayalı 75 sn
    expect(result.current).toBeNull();
    fakeBridge.setCalendar(cal(Date.now() + 200_000)); // Pusula yeni takvim yolladı
    await run(60_000);
    expect(result.current?.title).toMatch(/^[23] dk sonra/);
  });
  it("kilit/sunum bayrağı değişince genel metne döner", async () => {
    fakeBridge.setCalendar(cal(T0 + 200_000, LINK));
    const { result, rerender } = renderHook(({ g }) => useMeetingReminder(g), { initialProps: { g: false } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current?.title).toContain("Haftalık plan");
    rerender({ g: true });
    expect(result.current?.title).toBe(REMINDER_GENERIC);
  });
});

describe("Katıl düğmesi", () => {
  const item = () => meetingReminder(cal(T0 + 200_000, LINK), T0, false)!;
  beforeEach(() => { fakeBridge.reset(); vi.useFakeTimers({ now: T0 }); });
  it("bağlantıyı açar; eklentiye plugin_action gitmez", async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    setOpenJoinLink(open);
    render(<ProtrusionBump item={item()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    fireEvent.click(screen.getByRole("button", { name: "Katıl" }));
    expect(open).toHaveBeenCalledWith(LINK);
    expect(fakeBridge.log.filter((l) => l.cmd === "plugin_action")).toHaveLength(0);
  });
  it("açma komutu yoksa ya da reddederse düğme 'Açılamadı' der", async () => {
    render(<ProtrusionBump item={item()} />); // varsayılan: komut yok
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Katıl" })); });
    expect(screen.getByRole("button", { name: "Açılamadı" })).toBeTruthy();
  });
  it("bağlantı yoksa düğme hiç çıkmaz", () => {
    render(<ProtrusionBump item={meetingReminder(cal(T0 + 200_000), T0, false)!} />);
    expect(screen.queryByRole("button", { name: "Katıl" })).toBeNull();
  });
});

describe("adada", () => {
  const rectOf = (el: HTMLElement) => ({ left: 10, top: 5, width: parseFloat(el.style.width) || (el.dataset.hit !== undefined ? 100 : 0), height: parseFloat(el.style.height) || 30 }) as DOMRect;
  const settle = (ms = 80) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
  const all = () => { const r = document.body.cloneNode(true) as HTMLElement; r.querySelectorAll("[data-eski]").forEach((e) => e.remove()); return [r.textContent ?? "", ...[...r.querySelectorAll("[aria-label],[title]")].map((e) => `${e.getAttribute("aria-label")} ${e.getAttribute("title")}`)].join(" "); };
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return rectOf(this); });
    fakeBridge.reset(); localStorage.clear();
  });
  const center = () => document.body.querySelector(".adaMerkez")?.textContent ?? "";
  it("5 dk kala müziğin arkasında yan baloncukta durur", async () => {
    fakeBridge.setCalendar(cal(Date.now() + 240_000, LINK));
    render(<Island monitor="m1" init={{ view: null, pin: true, autoMusic: true }} />);
    await settle();
    expect(all()).toContain("4 dk sonra: Haftalık plan");
    expect(center()).not.toContain("Haftalık plan");
  });
  it("1 dk kala 'toplantı' sırasıyla müziğin önüne geçip ana şeride çıkar", async () => {
    fakeBridge.setCalendar(cal(Date.now() + 40_000, LINK));
    render(<Island monitor="m1" init={{ view: null, pin: true, autoMusic: true }} />);
    await settle();
    expect(center()).toContain("1 dk sonra: Haftalık plan");
  });
  it("sunum: ana şeritte yalnız genel metin, başlık hiçbir yerde yok", async () => {
    fakeBridge.setCalendar(cal(Date.now() + 40_000, LINK));
    render(<Island monitor="m1" init={{ view: null, pin: true }} />);
    await settle();
    act(() => fakeBridge.emit("input_tick", { lastInputAgoMs: 0, cursor: null, presentation: true }));
    await settle(200);
    expect(center()).toContain(REMINDER_GENERIC);
    expect(all()).not.toContain("Haftalık plan");
  });
});
