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
const notice = { id: "win.1", app: "Teams", title: "Alex wrote", body: "Meeting moved to 3 PM" };

describe("start a timer (Modules)", () => {
  it("minutes and name go to timer_start as seconds; the button is disabled on invalid minutes", async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    fireEvent.click(screen.getByRole("tab", { name: "Timer" })); // the Timer is on its own tab (mockup j)
    const go = screen.getByRole("button", { name: "Start" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("Minutes"), { target: { value: "0" } });
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Minutes"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Timer name"), { target: { value: " Tea " } });
    fireEvent.click(go);
    await settle();
    expect(logged("timer_start")[0].args).toEqual({ label: "Tea", seconds: 300 });
    expect((await fakeBridge.call("timer_get"))?.totalS).toBe(300);
  });
});

describe("presentation mode and busy (input_tick)", { timeout: 30_000 }, () => {
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
  it("the prank does not play in presentation mode", async () => { expect((await run({ presentation: true })).mock.calls).toHaveLength(0); });
  it("the prank does not play while busy", async () => { expect((await run({ busy: true })).mock.calls).toHaveLength(0); });
  it("plays when neither applies (control)", async () => { expect((await run({})).mock.calls).toHaveLength(1); });
  it("in presentation mode the Bluetooth peek does not open on its own", async () => {
    render(<Island monitor="m1" init={{ view: null, pin: true }} />);
    await settle();
    act(() => fakeBridge.emit("input_tick", { lastInputAgoMs: 60_000, cursor: null, presentation: true }));
    act(() => fakeBridge.emit("bluetooth_connected", { name: "Buds Pro", battery: 80 }));
    await settle();
    expect(document.body.textContent).not.toContain("Buds Pro connected");
  });
});

describe("tray list (arrow button)", () => {
  it("the arrow shows the list from open_tray; a row calls tray_open and closes the panel", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Hidden icons" }));
    await settle();
    const d = screen.getByRole("dialog", { name: "Hidden icons", hidden: true });
    expect([...within(d).getByRole("group", { name: "Hidden icons" }).querySelectorAll("button")].slice(0, 3).map((x) => x.getAttribute("aria-label"))).toEqual(["Discord, 3 new", "Steam", "OneDrive"]);
    fireEvent.click(within(d).getByRole("group", { name: "Hidden icons" }).querySelectorAll("button")[1]);
    await settle();
    expect(logged("tray_open")[0].args).toEqual({ id: "exe:c:/apps/steam.exe" });
    expect(d.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Windows notification mirror (Notifications)", () => {
  it("the card draws the app, title, body and two buttons; the tile is single-color (alpha mask), no strip ripple", async () => {
    fakeBridge.pushNotice({ ...notice, tile: "data:image/png;base64,AAAA" });
    render(<NotificationList onReview={() => undefined} />);
    await settle();
    const card = document.querySelector<HTMLElement>("[data-mirror='win.1']")!;
    expect(card.textContent).toContain("Teams");
    expect(card.textContent).toContain("Meeting moved to 3 PM");
    expect(within(card).getByRole("button", { name: "Open app" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Reply with Compass" })).toBeTruthy();
    expect(card.querySelector(".appIcon.mono")!.getAttribute("style")).toContain("mask-image");
  });
  it("the tile stays single-color even with the color icon setting on; a malformed icon URL does not enter the mask", async () => {
    await fakeBridge.call("set_settings", { patch: { colorIcons: true } });
    fakeBridge.pushNotice({ ...notice, tile: 'https://evil/x.png");background:url(x' });
    render(<NotificationList onReview={() => undefined} />);
    await settle();
    const card = document.querySelector<HTMLElement>("[data-mirror='win.1']")!;
    expect(card.querySelector(".appIcon")).toBeNull();
    expect(card.querySelector(".app b")!.textContent).toBe("T");
    expect(card.innerHTML).not.toContain("evil");
  });
  it("without canOpen there is no 'Open app'; with it, mirror_open_app is sent", async () => {
    const a = render(<MirrorCard n={{ id: "x", app: "A", title: "t", body: null, tile: "", tileMono: true, ripple: false, openLabel: "Open app", canOpen: false, at: 0 }} />);
    expect(within(a.container).queryByRole("button", { name: "Open app" })).toBeNull();
    a.unmount();
    fakeBridge.pushNotice({ ...notice, id: "win.2" });
    render(<NotificationList onReview={() => undefined} />);
    await settle();
    fireEvent.click(within(document.querySelector<HTMLElement>("[data-mirror='win.2']")!).getByRole("button", { name: "Open app" }));
    await settle();
    expect(logged("mirror_open_app")[0].args).toEqual({ id: "win.2" });
  });
  it("'Reply with Compass' calls mirror_ask and makes the island page open the reply view", async () => {
    const got: string[] = [];
    const off = onX((m) => got.push(m.t));
    fakeBridge.pushNotice(notice);
    const onClose = vi.fn();
    render(<NotificationList onReview={() => undefined} onClose={onClose} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Reply with Compass" }));
    await settle(120);
    off();
    expect(logged("mirror_ask")[0].args).toEqual({ id: "win.1" });
    expect(got).toContain("ask");
    expect(onClose).toHaveBeenCalled();
  });
  it("with no main assistant 'Reply with Compass' is disabled", async () => {
    fakeBridge.setPlugins([]);
    fakeBridge.pushNotice(notice);
    render(<NotificationList onReview={() => undefined} />);
    await settle();
    expect((screen.getByRole("button", { name: "Reply with assistant" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("the island page opens the chat box on the 'ask' message", async () => {
    fakeBridge.setSurfaces({ composer: { id: "dev.example.compass", name: "Compass", main: true, voice: false } });
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    sendX({ t: "ask" });
    await settle(80);
    expect(screen.getByRole("dialog", { name: "Ask" })).toBeTruthy();
  });
  it("when not quiet a new Windows notification becomes a card at the top right; when quiet it does not; the first list does not; the list never opens by itself", async () => {
    fakeBridge.pushNotice({ ...notice, id: "old" });
    render(<Shell monitor="m1" />);
    await settle();
    const toast = () => document.querySelector<HTMLElement>('[aria-label="Windows notification"]');
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
  it("Reply with Compass: the draft view opens, Send is disabled and the reason is written", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    act(() => fakeBridge.pushNotice({ ...notice, id: "n3" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Reply with Compass/ }));
    await settle(30); // let the draft view subscribe (it renders at the end of act)
    await settle(400);
    expect(screen.getByText("Sure, 8 works. See you then.")).toBeTruthy();
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(send.title).toMatch(/isn't available yet/);
  });
  it("while locked the body and title are not in the DOM: only the app name and 'Locked'", async () => {
    fakeBridge.pushNotice({ ...notice, body: "Salary raise secret" });
    render(<NotificationList onReview={() => undefined} />);
    await settle();
    expect(document.body.textContent).toContain("Salary raise secret");
    act(() => fakeBridge.setLocked(true, "manual"));
    await settle();
    const t = document.body.textContent!;
    expect(t).not.toContain("Salary raise secret");
    expect(t).not.toContain("Alex wrote");
    expect(t).toContain("Teams");
    expect(t).toContain("Locked");
    expect(screen.queryByRole("button", { name: "Reply with Compass" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("(5)");
  });
});

describe("Settings › Windows notifications", () => {
  const open = async () => {
    render(<Shell monitor="m1" init={{ panel: "appearance" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "More settings" }));
    return screen.findByRole("switch", { name: "Windows notifications" });
  };
  it("no blocker row while off; turning on sends mirror_enable, and with no blocker no row appears", async () => {
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
    [{ devMode: false }, "dev_mode_off", "Developer Mode is off", "ms-settings:developers"],
    [{ registered: false }, "not_registered", "Run register.ps1, then restart Peeka", null],
    [{ access: "denied" }, "access_denied", "Windows didn't allow it", "ms-settings:privacy-notifications"],
  ] as const)("blocker %j: reason row and the right Windows settings link", async (patch, blocker, text, uri) => {
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
  it("if the Windows setting cannot be opened (the Rust allow-list refuses) the manual path is written out", async () => {
    fakeBridge.setMirror({ devMode: false });
    const sw = await open();
    fireEvent.click(sw);
    await settle();
    const real = fakeBridge.call.bind(fakeBridge) as (...x: unknown[]) => unknown;
    vi.spyOn(fakeBridge, "call").mockImplementation(((cmd: string, ...a: unknown[]) => (cmd === "open_windows_settings" ? Promise.reject("invalid") : real(cmd, ...a))) as never);
    fireEvent.click(document.querySelector("[data-blocker] button")!);
    await settle();
    expect(document.querySelector("[data-blocker]")!.textContent).toContain("For developers");
  });
});
