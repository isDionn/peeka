// Fidelity check 3 (settings, clipboard, search, launcher, status card, menus, tray, wizard, hiding).
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { ContextMenu } from "../components/Menus";
import { ClipboardView, LockCard, setClipboardDrag } from "../components/Pano";
import { PluginExtras } from "../components/PluginExtras";
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
  fakeBridge.reset(); localStorage.clear(); setClipboardDrag(null);
});
afterEach(() => { cleanup(); resetMascotRegistry(); vi.restoreAllMocks(); Reflect.deleteProperty(proto, "offsetHeight"); Reflect.deleteProperty(proto, "offsetWidth"); });
const settle = (ms = 60) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const flog = (cmd: string) => fakeBridge.log.filter((l: { cmd: string }) => l.cmd === cmd);
const logged = (cmd: string) => fakeBridge.log.filter((l) => l.cmd === cmd);
const settings = () => fakeBridge.call("get_settings");

describe("status card (o)", () => {
  const card = async () => {
    const [monitor, status] = [await fakeBridge.call("get_monitor", { monitor: "m1" }), await fakeBridge.call("get_status")];
    render(<StatusCard monitor={monitor} status={status} setStatus={() => undefined} />);
    await settle();
  };
  it("Microphone and Camera row: 'not in use' when idle, 'in use' without app names (owner: privacy)", async () => {
    await card();
    expect(screen.getByText("Microphone").parentElement!.textContent).toContain("Not in use");
    expect(screen.getByText("Camera").parentElement!.textContent).toContain("Not in use");
    act(() => fakeBridge.setPrivacy({ mic: ["Compass"], camera: ["Chrome"] }));
    await settle();
    expect(screen.getByText("Microphone").parentElement!.textContent).toContain("In use");
    expect(screen.getByText("Camera").parentElement!.textContent).toContain("In use");
    expect(document.body.textContent).not.toContain("Chrome"); // no app name anywhere in the card
  });
  it("no network row while online, shown when there is a problem; first focus on the Wi-Fi tile", async () => {
    await card();
    expect(screen.queryByText("Connected to the internet")).toBeNull();
    expect(screen.getByText("Battery 78%")).toBeTruthy();
    expect(document.querySelector("[data-autofocus]")!.getAttribute("aria-label")).toContain("Wi-Fi");
    cleanup();
    const monitor = await fakeBridge.call("get_monitor", { monitor: "m1" });
    render(<StatusCard monitor={monitor} status={{ ...(await fakeBridge.call("get_status")), network: "none" }} setStatus={() => undefined} />);
    expect(screen.getByText("No network connection")).toBeTruthy();
  });
  it("Compass section: numbers while the main assistant is connected; Open on the approval row; zero rows are not drawn", async () => {
    fakeBridge.setSurfaces({ approvals: [APPROVAL_LOW], approvalTop: null });
    await card();
    expect(screen.getByText("1 awaiting approval")).toBeTruthy();
    expect(screen.getByText("2 running")).toBeTruthy();
    expect(screen.getByText("3 suggested notes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await settle();
    expect(flog("assistant_open")[0].args).toEqual({ kind: "approval" });
  });
  it("approval count: Compass's own if it sends one, otherwise from the card list", async () => {
    fakeBridge.setSurfaces({ approvals: [], approvalTop: null });
    await card();
    expect(screen.getByText("1 awaiting approval")).toBeTruthy(); // assistant_counts().approvals = 1, list empty
    cleanup();
    { const real = fakeBridge.call.bind(fakeBridge) as (c: string, ...a: unknown[]) => Promise<unknown>; vi.spyOn(fakeBridge, "call").mockImplementation(((c: string, ...a: unknown[]) => (c === "assistant_counts" ? Promise.resolve({ jobs: 0, memory: 0 }) : real(c, ...a))) as never); }
    fakeBridge.setSurfaces({ approvals: [APPROVAL_LOW, { ...APPROVAL_LOW, id: "b" }], approvalTop: null });
    await card();
    expect(screen.getByText("2 awaiting approval")).toBeTruthy();
  });
  it("audio switcher: one row naming the default output, opens in place, a click sets the default and rows keep their order", async () => {
    await card();
    const head = screen.getByRole("button", { expanded: false });
    expect(head.textContent).toContain("Speakers (Realtek Audio)");
    expect(screen.queryByRole("button", { name: "Buds Pro" })).toBeNull(); // collapsed: only the header row
    fireEvent.click(head);
    await settle();
    const names = () => [...document.querySelectorAll(".audioOut [aria-pressed]")].map((b) => b.textContent);
    expect(names()).toEqual(["Speakers (Realtek Audio)", "Buds Pro", "LG Monitor (HDMI)"]);
    fireEvent.click(screen.getByRole("button", { name: "Buds Pro" }));
    await settle();
    expect(flog("set_audio_output")[0].args).toEqual({ id: "bt" });
    expect(screen.getByRole("button", { name: "Buds Pro" }).getAttribute("aria-pressed")).toBe("true");
    expect(names()).toEqual(["Speakers (Realtek Audio)", "Buds Pro", "LG Monitor (HDMI)"]); // nothing jumped
    expect(head.textContent).toContain("Buds Pro");
  });
  it("audio switcher: a refused switch shows a short notice in the header, no new row, no crash", async () => {
    fakeBridge.setAudioRefuse(true);
    await card();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await settle();
    const rows = document.querySelectorAll(".audioOut .row").length;
    fireEvent.click(screen.getByRole("button", { name: "LG Monitor (HDMI)" }));
    await settle();
    expect(screen.getByRole("alert").textContent).toBe("Couldn't switch");
    expect(document.querySelectorAll(".audioOut .row").length).toBe(rows);
    expect(screen.getByRole("button", { name: "Speakers (Realtek Audio)" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("microphone mute toggle on the Microphone row", async () => {
    await card();
    const mute = screen.getByRole("button", { name: "Mute microphone" });
    expect(mute.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(mute);
    await settle();
    expect(flog("set_mic_muted")[0].args).toEqual({ muted: true });
    expect(screen.getByRole("button", { name: "Mute microphone" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("no Compass section if the main assistant is not connected", async () => {
    fakeBridge.setPlugins([]);
    await card();
    expect(screen.queryByText("suggested notes", { exact: false })).toBeNull();
  });
});

describe("Start panel (w2)", () => {
  const start = async () => {
    const monitor = await fakeBridge.call("get_monitor", { monitor: "m1" });
    const onClose = vi.fn();
    render(<StartPanel monitor={monitor} pins={await fakeBridge.call("get_pins")} onClose={onClose} />);
    await settle();
    return onClose;
  };
  it("the mockup's search text, 12 pins, Recommended and the Windows Start link", async () => {
    const onClose = await start();
    expect(screen.getByPlaceholderText("Search apps, windows, files and settings")).toBeTruthy();
    expect(document.querySelectorAll(".appGrid .appCell")).toHaveLength(12);
    expect(screen.getByText("Recommended")).toBeTruthy();
    expect(screen.getByText("presentation-draft.pdf")).toBeTruthy();
    expect(screen.queryByText("cover-draft.png")).toBeNull(); // anything beyond four goes behind "Show more"
    fireEvent.click(screen.getByRole("button", { name: /Show more/ }));
    expect(screen.getByText("cover-draft.png")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open Windows Start/ }));
    await settle();
    expect(flog("open_start_menu")).toHaveLength(1);
    expect(onClose).toHaveBeenCalled();
  });
  it("the 'All apps' button opens the full list instead of the grid and goes back", async () => {
    await start();
    fireEvent.click(screen.getByRole("button", { name: /All apps/ }));
    expect(document.querySelector(".appGrid")).toBeNull();
    expect(document.querySelector(".allApps")!.querySelectorAll("button").length).toBeGreaterThan(8);
    fireEvent.click(screen.getByRole("button", { name: /Pinned/ }));
    expect(document.querySelector(".appGrid")).not.toBeNull();
  });
  it("search looks up apps, windows, files and settings; Enter opens the first result", async () => {
    const onClose = await start();
    fireEvent.change(screen.getByPlaceholderText("Search apps, windows, files and settings"), { target: { value: "display" } });
    await settle();
    const list = screen.getByRole("group", { name: "Search results" });
    expect(within(list).getByText("Display: scale and layout")).toBeTruthy();
    expect(document.querySelector(".appGrid")).toBeNull();
    fireEvent.keyDown(screen.getByPlaceholderText("Search apps, windows, files and settings"), { key: "Enter" });
    await settle();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("menus (p1, sr)", () => {
  const menu = (m: Parameters<typeof ContextMenu>[0]["menu"]) => render(<ContextMenu menu={m} pins={[]} windows={[{ hwnd: 7, appId: "discord", name: "Discord", icon: "", title: "General", active: true, monitor: "m1" }]} onClose={() => undefined} onPins={() => undefined} />);
  it("app menu: Close window and Quit app are separate", async () => {
    menu({ kind: "app", appId: "discord", x: 100 });
    const names = screen.getAllByRole("menuitem").map((b) => b.textContent);
    expect(names).toEqual(["Pin", "New window", "Close window", "Quit app"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Quit app" }));
    expect(flog("quit_app")).toHaveLength(0); // the first click only asks for confirmation (O10)
    fireEvent.click(screen.getByRole("menuitem", { name: /Click again/ }));
    await settle();
    expect(flog("quit_app")[0].args).toEqual({ appId: "discord" });
  });
  it("strip menu in the mockup's order; 'Hide island for now' shows its shortcut, hides on click, and brings it back when reopened", async () => {
    menu({ kind: "strip", x: 10 });
    expect(screen.getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["Restore taskbar", "Hide island for nowCtrl+Shift+A", "Lock Peeka", "Quit"]);
    fireEvent.click(screen.getByRole("menuitem", { name: /Hide island for now/ }));
    await settle();
    expect(flog("island_hide")[0].args).toEqual({ on: true });
    cleanup();
    menu({ kind: "strip", x: 10 });
    await settle();
    expect(screen.getByRole("menuitem", { name: /Show island/ })).toBeTruthy();
  });
  it("the eye icon brings the island back", async () => {
    await fakeBridge.call("island_hide", { on: true });
    render(<IslandHiddenGlyph />);
    fireEvent.click(screen.getByRole("button", { name: /Island hidden/ }));
    await settle();
    expect(await fakeBridge.call("island_hidden")).toBe(false);
  });
});

describe("tray (y1, y2)", () => {
  it("grid: badge, name tooltip; clicking sends tray_open and closes; falls back to open_tray without tray_icons", async () => {
    const onClose = vi.fn();
    render(<TrayList monitor="m1" onClose={onClose} />);
    await settle();
    const discord = screen.getByRole("button", { name: "Discord, 3 new" });
    expect(discord.querySelector(".badge")!.textContent).toBe("3");
    expect(screen.getByRole("group", { name: "Hidden icons" }).querySelectorAll("button")).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: "Steam" }));
    await settle();
    expect(logged("tray_open")[0].args).toEqual({ id: "exe:c:/apps/steam.exe" });
    expect(onClose).toHaveBeenCalled();
  });
  it("frequent icons on the strip are only the 'always visible' ones, with badges", async () => {
    render(<PromotedTray monitor="m1" />);
    await settle();
    const g = screen.getByRole("group", { name: "Pinned tray icons" });
    expect(within(g).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Discord, 3 new", "OneDrive"]);
  });
});

describe("Settings", () => {
  const panel = async (page: "appearance" | "shortcuts" | "plugins" | "mascot" | "clipboard") => { render(<SettingsPanel page={page} onPage={() => undefined} settings={await settings()} />); await settle(); };
  it("navigation has 7 items, About opens a local page", async () => {
    await panel("appearance");
    expect(screen.getByRole("navigation").querySelectorAll("button")).toHaveLength(7);
    fireEvent.click(screen.getByRole("button", { name: "About" }));
    expect(screen.getByText("Emergency shortcut")).toBeTruthy();
  });
  it("Mascot: 'Celebrate when a task is done' is on by default, turning it off sends set_settings({celebrate:false})", async () => {
    await panel("mascot");
    const sw = screen.getByRole("switch", { name: "Celebrate finished tasks" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Up to 3 an hour")).toBeTruthy();
    expect(screen.getByText("Introduces Peeka and the main assistant")).toBeTruthy();
    fireEvent.click(sw);
    await settle();
    expect((await settings() as unknown as { celebrate: boolean }).celebrate).toBe(false);
  });
  it("Shortcuts: the mockup's labels; in exceptions the first three one by one, the rest on a single row that opens on click", async () => {
    await panel("shortcuts");
    for (const t of ["Search", "Ask the assistant", "Go to approval", "Hide island for now"]) expect(screen.getByText(t)).toBeTruthy();
    const list = document.querySelector<HTMLElement>(".exceptions")!;
    expect(list.querySelectorAll(".row")).toHaveLength(4);
    fireEvent.click(list.querySelector(".exceptionGroup")!);
    expect(list.querySelectorAll(".row").length).toBeGreaterThan(8);
    expect(within(list).getByRole("button", { name: "Remove Firefox exception" })).toBeTruthy();
  });
  it("Appearance: two cards; extra settings under 'More settings'", async () => {
    await panel("appearance");
    expect(document.querySelectorAll(".settingsInner > .list")).toHaveLength(2);
    expect(screen.getByText("Show the real color icon on hover")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Handle volume keys" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More settings" }));
    expect(screen.getByRole("switch", { name: "Handle volume keys" })).toBeTruthy();
  });
  it("Plugins: Claude Code bridge row (status + Remove button), permission history and the global revoke button", async () => {
    await panel("plugins");
    expect(await screen.findByText("Claude Code bridge")).toBeTruthy();
    expect(screen.getByText(/Installed · connected to this Peeka · last event 2m ago/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Permission history" }));
    await settle();
    expect(within(screen.getByLabelText("Permission history", { selector: ".permissionHistory" })).getAllByText(/Compass:/)).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Revoke Compass's access: press and hold" }).length).toBeGreaterThan(0);
  });
  it("if Rust does not know the bridge command the bridge row is not drawn (no made-up status)", async () => {
    { const real = fakeBridge.call.bind(fakeBridge) as (c: string, ...a: unknown[]) => Promise<unknown>; vi.spyOn(fakeBridge, "call").mockImplementation(((c: string, ...a: unknown[]) => (c === "claude_bridge_state" ? Promise.reject("unknown") : real(c, ...a))) as never); }
    render(<PluginExtras />);
    await settle();
    expect(screen.queryByText("Claude Code bridge")).toBeNull();
  });
});

describe("Clipboard (h2, kl)", () => {
  it("a dragged thumbnail fades and comes back when done", async () => {
    render(<ClipboardView />);
    await settle();
    const thumb = document.querySelector<HTMLElement>('[data-clip="c2"]')!;
    expect(thumb.className).not.toContain("dragging");
    act(() => setClipboardDrag("c2"));
    expect(document.querySelector('[data-clip="c2"]')!.className).toContain("dragging");
    act(() => { fakeBridge.emit("clip_drag_end", null); });
    await settle();
    expect(document.querySelector('[data-clip="c2"]')!.className).not.toContain("dragging");
  });
  it("the lock card writes no extra reason row on a manual lock", () => {
    render(<LockCard lock={{ locked: true, reason: "manual" }} />);
    expect(screen.queryByText("You locked Peeka.")).toBeNull();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeTruthy();
  });
});

describe("Search (ara0)", () => {
  it("Ask Compass tile has the mascot, Enter hint '↵', setting icon by title", async () => {
    render(<SearchPanel onClose={() => undefined} />);
    await settle();
    const ask = document.querySelector(".assistantAsk")!;
    expect(ask.querySelector(".tile .mascot, .tile .mascot-neutral")).not.toBeNull();
    expect(ask.querySelector(".enter kbd")!.textContent).toBe("↵");
    expect(document.querySelector(".result .tile svg.lucide-monitor")).not.toBeNull();
  });
});

describe("setup wizard (kur)", () => {
  it("three steps; step 2 has the mockup's three rows; Done marks and closes", async () => {
    const done = vi.fn();
    render(<SetupWizard onDone={done} />);
    await settle();
    expect(screen.getByRole("img", { name: "Step 1 of 3" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Hide the Windows taskbar")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Done" })).toBeTruthy();
    const sw = screen.getByRole("switch", { name: "Show Windows notifications at top right" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    await settle();
    expect(logged("mirror_enable")).toHaveLength(1);
    const spy = vi.spyOn(fakeBridge, "call");
    fireEvent.click(screen.getByRole("button", { name: /Open settings/ }));
    expect(spy).toHaveBeenCalledWith("open_windows_settings", { uri: "ms-settings:notifications" });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(setupDone()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Done" })); // a double click right on arriving at the last step does not finish (R1-8)
    expect(setupDone()).toBe(false);
    await settle(350);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(setupDone()).toBe(true);
    expect(localStorage.getItem(SETUP_KEY)).toBe("1");
    expect(done).toHaveBeenCalled();
  });
  it("if the taskbar is not hidden, the Hide button on step 2 writes taskbar_set_mode", async () => {
    await fakeBridge.call("taskbar_set_mode", { mode: "off" });
    render(<SetupWizard onDone={() => undefined} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    await settle();
    expect((await settings()).taskbarHide).toBe("full");
    markSetup();
  });
});
