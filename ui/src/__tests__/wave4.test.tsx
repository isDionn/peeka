import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_SECRET, fakeBridge } from "../bridge.fake";
import type { SearchResult } from "../bridge";
import { Island } from "../components/Island";
import { ClipboardView } from "../components/Pano";
import { SummaryBoxes } from "../components/Plugin";
import { SearchPanel } from "../components/SearchPanel";
import { SettingsPanel } from "../components/SettingsPanel";
import { alive, ago, left, safeThumb } from "../lib/clip";
import { FILES_OFF, flatten, groupResults } from "../lib/search";
import { APPROVAL_HIGH, APPROVAL_LOW, COMPASS, EMPTY_SURFACES } from "../plugin.fixtures";

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

describe("clipboard: row actions only on hover or while selected (decision 15)", () => {
  it("no actions on an unselected row; they appear on hover and replace the time; they go away when the pointer leaves", async () => {
    render(<ClipboardView />);
    await screen.findByText("screen-recording.mp4");
    const r = row("c9");
    expect(within(r).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(r.className).not.toContain("current");
    fireEvent.pointerEnter(r);
    expect(within(r).getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(within(r).getByRole("button", { name: "Copy again" })).toBeTruthy();
    expect(within(r).getByRole("button", { name: "Pin" })).toBeTruthy();
    expect(r.className).toContain("current"); // CSS: .current .time fades, the actions appear
    fireEvent.pointerLeave(r);
    expect(within(r).queryByRole("button", { name: "Delete" })).toBeNull();
  });
  it("being selected alone does not show actions (so two Deletes are not visible at once, O17); keyboard focus does", async () => {
    render(<ClipboardView />);
    await screen.findByText("screen-recording.mp4");
    expect(within(row("c1")).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(within(row("c5")).queryByRole("button", { name: "Delete" })).toBeNull();
    document.documentElement.setAttribute("data-kb", "");
    act(() => row("c5").focus());
    document.documentElement.removeAttribute("data-kb");
    expect(within(row("c5")).getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(within(row("c1")).queryByRole("button", { name: "Delete" })).toBeNull();
  });
  it("copy again, pin and delete go to the bridge; arrow keys move, Enter copies again", async () => {
    render(<ClipboardView />);
    await screen.findByText("screen-recording.mp4");
    fireEvent.pointerEnter(row("c9"));
    fireEvent.click(within(row("c9")).getByRole("button", { name: "Copy again" }));
    fireEvent.click(within(row("c9")).getByRole("button", { name: "Pin" }));
    await settle();
    expect(logged("clip_copy")[0].args).toEqual({ id: "c9" });
    expect(logged("clip_pin")[0].args).toEqual({ id: "c9", on: true });
    act(() => row("c1").focus());
    fireEvent.keyDown(row("c1"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(row("c2"));
    fireEvent.keyDown(row("c2"), { key: "Enter" });
    expect(logged("clip_copy").at(-1)!.args).toEqual({ id: "c2" });
    fireEvent.pointerEnter(row("c7"));
    fireEvent.click(within(row("c7")).getByRole("button", { name: "Delete" }));
    await settle();
    expect(logged("clip_delete")[0].args).toEqual({ id: "c7" });
    expect(screen.queryByText("example.com/reports/q3-summary")).toBeNull();
  });
  it("offers plain-text paste only for text rows, never a password", async () => {
    render(<ClipboardView />);
    await screen.findByText("screen-recording.mp4");
    fireEvent.pointerEnter(row("c7"));
    fireEvent.click(within(row("c7")).getByRole("button", { name: "Paste as plain text" }));
    await settle();
    expect(logged("clip_paste_plain")[0].args).toEqual({ id: "c7" });
    fireEvent.pointerEnter(row("c6"));
    expect(within(row("c6")).queryByRole("button", { name: "Paste as plain text" })).toBeNull();
  });
  it("'Ask Compass' is on a text row when there is a main assistant, never on a password row, and goes away without an assistant", async () => {
    render(<ClipboardView />);
    await screen.findByText("screen-recording.mp4");
    await settle();
    fireEvent.pointerEnter(row("c9"));
    expect(within(row("c9")).getByRole("button", { name: "Ask Compass" })).toBeTruthy();
    fireEvent.pointerEnter(row("c6"));
    expect(within(row("c6")).queryByRole("button", { name: "Ask Compass" })).toBeNull();
    expect(within(row("c6")).queryByRole("button", { name: "Pin" })).toBeNull(); // ADR-0063 §3: no pinning on a password
    act(() => fakeBridge.setPlugins([]));
    await settle();
    expect(within(row("c9")).queryByRole("button", { name: "Ask Compass" })).toBeNull();
  });
  it("clip_visible turns on while Clipboard is visible and off when it closes (exclusion from capture)", async () => {
    const { unmount } = render(<ClipboardView />);
    await settle();
    expect(logged("clip_visible").map((l) => (l.args as { on: boolean }).on)).toEqual([true]);
    unmount();
    expect(logged("clip_visible").map((l) => (l.args as { on: boolean }).on)).toEqual([true, false]);
  });
});

describe("clipboard: password row (ADR-0063)", () => {
  it("masked: ••••, 'Bitwarden · encrypted · N min'; plain text is neither in the list nor on screen", async () => {
    render(<ClipboardView />);
    await screen.findByText("screen-recording.mp4");
    const r = row("c6");
    expect(within(r).getByRole("img", { name: "Hidden password" }).textContent).toMatch(/^\S{10,}$/); // fixed blurred placeholder
    expect(r.textContent).toMatch(/Bitwarden · encrypted · 5\dm/);
    expect(document.body.textContent).not.toContain(FAKE_SECRET);
    expect(JSON.stringify(await fakeBridge.call("clip_list"))).not.toContain(FAKE_SECRET); // the list carries no plain text
  });
  it("the eye button shows for 5 s, then it is wiped from state and screen; it is written nowhere", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k));
    render(<ClipboardView />);
    await screen.findByText("screen-recording.mp4");
    vi.useFakeTimers();
    await act(async () => { fireEvent.pointerEnter(row("c6")); }); // hovering brings up the plain text
    expect(row("c6").textContent).toContain(FAKE_SECRET);
    expect(row("c6").textContent).toContain("Hides again in 5s");
    // even while shown: storage, address, console and bridge log are clean
    expect(setItem).not.toHaveBeenCalled();
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(FAKE_SECRET);
    expect(location.href + location.search + location.hash).not.toContain(FAKE_SECRET);
    expect(JSON.stringify(fakeBridge.log)).not.toContain(FAKE_SECRET);
    await act(async () => { vi.advanceTimersByTime(4900); });
    expect(row("c6").textContent).toContain(FAKE_SECRET);
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(document.body.textContent).not.toContain(FAKE_SECRET);
    expect(within(row("c6")).getByRole("img", { name: "Hidden password" })).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(FAKE_SECRET);
    expect(setItem).not.toHaveBeenCalled();
    for (const l of logs) expect(JSON.stringify(l.mock.calls)).not.toContain(FAKE_SECRET);
  });
  it("pressing again, or the window losing focus, hides it immediately", async () => {
    render(<ClipboardView />);
    await screen.findByText("screen-recording.mp4");
    await act(async () => { fireEvent.pointerEnter(row("c6")); }); // hovering brings up the plain text
    expect(row("c6").textContent).toContain(FAKE_SECRET);
    await act(async () => { fireEvent.click(within(row("c6")).getByRole("button", { name: "Hide" })); });
    expect(document.body.textContent).not.toContain(FAKE_SECRET);
    await act(async () => { fireEvent.click(within(row("c6")).getByRole("button", { name: "Show briefly" })); });
    expect(row("c6").textContent).toContain(FAKE_SECRET);
    act(() => { window.dispatchEvent(new Event("blur")); });
    expect(document.body.textContent).not.toContain(FAKE_SECRET);
  });
  it("when the card unmounts the timer goes too (nothing is written to an unmounted component when time runs out)", async () => {
    const err = vi.spyOn(console, "error");
    const { unmount } = render(<ClipboardView />);
    await screen.findByText("screen-recording.mp4");
    vi.useFakeTimers();
    await act(async () => { fireEvent.pointerEnter(row("c6")); }); // hovering brings up the plain text
    unmount();
    expect(document.body.textContent).not.toContain(FAKE_SECRET);
    await act(async () => { vi.advanceTimersByTime(6000); });
    expect(err).not.toHaveBeenCalled();
  });
  it("copy again does not call clip_reveal (only hovering does)", async () => {
    render(<ClipboardView />);
    await screen.findByText("screen-recording.mp4");
    await act(async () => { fireEvent.pointerEnter(row("c6")); });
    expect(logged("clip_reveal")).toHaveLength(1); // hovering only
    await act(async () => { fireEvent.click(within(row("c6")).getByRole("button", { name: "Copy without showing" })); });
    expect(logged("clip_copy")[0].args).toEqual({ id: "c6" });
    expect(logged("clip_reveal")).toHaveLength(1); // copying does not decrypt again
    fireEvent.pointerLeave(row("c6"));
    expect(document.body.textContent).not.toContain(FAKE_SECRET);
  });
  it("while Peeka is locked the password row is never drawn; the UI filters it out even if Rust sends it by mistake", async () => {
    fakeBridge.setLocked(true);
    render(<ClipboardView />);
    await screen.findByText("screen-recording.mp4");
    expect(row("c6")).toBeNull();
    expect(screen.queryByText(/Bitwarden/)).toBeNull();
    // filtering even if Rust sends a password in the list
    const orig = fakeBridge.call.bind(fakeBridge) as (c: string, ...a: unknown[]) => Promise<unknown>;
    vi.spyOn(fakeBridge, "call").mockImplementation(((cmd: string, ...a: unknown[]) => (cmd === "clip_list" ? Promise.resolve(fakeBridge.rawClips()) : orig(cmd, ...a))) as never);
    cleanup();
    render(<ClipboardView />);
    await screen.findByText("screen-recording.mp4");
    expect(row("c6")).toBeNull();
  });
  it("if the lock arrives while shown the text is wiped instantly; while locked, reveal and copy again are refused", async () => {
    render(<ClipboardView />);
    await screen.findByText("screen-recording.mp4");
    await act(async () => { fireEvent.pointerEnter(row("c6")); }); // hovering brings up the plain text
    expect(row("c6").textContent).toContain(FAKE_SECRET);
    await act(async () => { fakeBridge.setLocked(true); });
    await settle();
    expect(document.body.textContent).not.toContain(FAKE_SECRET);
    expect(row("c6")).toBeNull();
    await expect(fakeBridge.call("clip_reveal", { id: "c6" })).rejects.toBe("denied");
    await expect(fakeBridge.call("clip_copy", { id: "c6" })).rejects.toBe("denied");
    await expect(fakeBridge.call("clip_share", { id: "c6" })).rejects.toBe("denied");
  });
  it("a password whose time has expired drops from the list", () => {
    const p = { id: "x", kind: "password", source: null, createdAt: 0, pinned: false, expiresAt: 1000 } as const;
    expect(alive(p, 999)).toBe(true);
    expect(alive(p, 1000)).toBe(false);
  });
});

describe("clipboard: pure rules", () => {
  it("duration formats", () => {
    expect(ago(0, 30_000)).toBe("now");
    expect(ago(0, 5 * 60_000)).toBe("5m");
    expect(ago(0, 3 * 3_600_000)).toBe("3h");
    expect(left(60 * 60_000, 0)).toBe("1h");
    expect(left(40 * 60_000 - 1, 0)).toBe("40m");
    expect(left(10_000, 0)).toBe("<1m");
  });
  it("a thumbnail is only a raster/SVG data URL; file paths and links are rejected", () => {
    expect(safeThumb("data:image/png;base64,AAAA")).toBeTruthy();
    for (const bad of ["file:///C:/x.png", "https://x/y.png", "javascript:alert(1)", "data:text/html,<script>", "x", null, 5]) expect(safeThumb(bad)).toBeNull();
  });
});

describe("Peeka lock", () => {
  it("while locked, the lock card shows instead of the Clipboard and Modules cards; the clock stops", async () => {
    fakeBridge.setLocked(true, "windows");
    render(<Island monitor="m1" init={{ view: "clipboard" }} />);
    await settle();
    expect(screen.getByRole("dialog", { name: "Peeka locked" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Clipboard" })).toBeNull();
    expect(screen.getByText("Unlocks automatically when you unlock Windows.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Unlock/ })).toBeNull(); // a Windows lock lifts when Windows unlocks: no button
    cleanup();
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    expect(screen.getByRole("dialog", { name: "Peeka locked" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "System" })).toBeNull();
  });
  it("after locking with the Lock button, 'Unlock' appears and calls lock_release; the Clipboard card returns", async () => {
    fakeBridge.setLocked(true, "manual");
    render(<Island monitor="m1" init={{ view: "clipboard" }} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Unlock/ }));
    await settle();
    expect(logged("lock_release")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Clipboard" })).toBeTruthy();
  });
  it("once the Clipboard card has loaded it does not revert to the 800 ms 'slow loading' skeleton (a flaky test under load)", async () => {
    render(<Island monitor="m1" init={{ view: "clipboard" }} />);
    await settle();
    await act(async () => { await new Promise((r) => setTimeout(r, 850)); });
    expect(screen.getByRole("dialog", { name: "Clipboard" })).toBeTruthy();
  });
  it("the Clipboard card comes back when the lock lifts (when the Windows lock lifts)", async () => {
    fakeBridge.setLocked(true);
    render(<Island monitor="m1" init={{ view: "clipboard" }} />);
    await settle();
    await act(async () => { fakeBridge.setLocked(false); });
    await settle();
    expect(screen.getByRole("dialog", { name: "Clipboard" })).toBeTruthy();
    expect(document.querySelector('[data-clip="c6"]')).not.toBeNull();
  });
  it("no screenshot peek while locked; when unlocked it shows and carries 'Ask Compass' + 'Edit'", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const shot = fakeBridge.rawClips()[0];
    await act(async () => { fakeBridge.addClip({ ...shot, id: "fresh" } as never); });
    await settle();
    const g = screen.getByRole("group", { name: "Screenshot" });
    expect(within(g).getByRole("button", { name: "Ask Compass" })).toBeTruthy();
    expect(within(g).getByRole("button", { name: "Edit" })).toBeTruthy();
    fireEvent.click(within(g).getByRole("button", { name: "Edit" }));
    expect(logged("clip_edit")[0].args).toEqual({ id: "fresh" });
    cleanup();
    fakeBridge.setLocked(true);
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await act(async () => { fakeBridge.addClip({ ...shot, id: "fresh2" } as never); });
    await settle();
    expect(screen.queryByRole("group", { name: "Screenshot" })).toBeNull();
  });
});

describe("Ctrl+K search", () => {
  const r = (kind: SearchResult["kind"], title: string, extra: Partial<SearchResult> = {}): SearchResult => ({ id: kind + title, kind, title, subtitle: null, appId: "", icon: "", hwnd: null, ...extra });
  it("group order: apps, open windows, files, settings, plugin groups (whatever order Rust returns them in)", () => {
    const groups = groupResults([
      r("plugin", "October goals", { plugin: COMPASS, group: "Notes" }), r("setting", "Screen saver"), r("file", "a.pdf"), r("window", "Window"), r("app", "App"),
    ], "screen", false);
    expect(groups.map((g) => g.title)).toEqual(["Apps", "Open windows", "Files", "Settings", "Compass › Notes"]);
    expect(flatten(groups).map((x) => x.kind)).toEqual(["app", "window", "file", "setting", "plugin"]);
  });
  it("an empty query is a single 'Recent' group; empty groups are not drawn; with the index off, Files stays as a single warning line", () => {
    expect(groupResults([r("app", "A"), r("file", "b")], "", false).map((g) => g.title)).toEqual(["Recent"]);
    expect(groupResults([r("app", "A")], "a", false).map((g) => g.title)).toEqual(["Apps"]);
    const off = groupResults([r("app", "A")], "a", true);
    expect(off.map((g) => g.title)).toEqual(["Apps", "Files"]);
    expect(off[1].note).toBe(FILES_OFF);
    expect(off[1].rows).toEqual([]);
  });
  it("two plugins' groups stay separate; Peeka prints the title prefix", () => {
    const g = groupResults([r("plugin", "x", { plugin: { id: "b", name: "Example", main: false }, group: "Compass › Fake" })], "x", false);
    expect(g[0].title).toBe("Example › Compass - Fake"); // a plugin cannot set the prefix by imitating the separator
  });
  it("panel: groups are drawn in order; arrow keys move across groups; 'Ask Compass' is at the bottom and Enter sends the query", async () => {
    render(<SearchPanel onClose={() => undefined} />);
    await settle();
    const input = screen.getByRole("combobox", { name: "Search" });
    fireEvent.change(input, { target: { value: "s" } });
    await settle();
    const heads = [...document.querySelectorAll(".groupHead")].map((e) => e.textContent).filter(Boolean);
    expect(heads).toEqual(["Apps", "Open windows", "Files", "Settings", "Compass › Notes"]);
    const opts = screen.getAllByRole("option");
    expect(opts.at(-1)!.textContent).toContain("Ask Compass");
    expect(opts[0].getAttribute("aria-selected")).toBe("true");
    for (let i = 0; i < opts.length + 3; i++) fireEvent.keyDown(input, { key: "ArrowDown" }); // sticks to the end
    expect(opts.at(-1)!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(logged("search_ask")[0].args).toEqual({ query: "s" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(logged("search_open")).toHaveLength(1); // the plugin (note) result in the last group
  });
  it("with no main assistant there is no 'Ask Compass' row or shortcut hint", async () => {
    fakeBridge.setPlugins([]);
    render(<SearchPanel onClose={() => undefined} />);
    await settle();
    fireEvent.change(screen.getByRole("combobox", { name: "Search" }), { target: { value: "s" } });
    await settle();
    expect(screen.queryByText(/Ask Compass/)).toBeNull();
    expect(screen.queryByText(/Notes/)).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Search" }), { target: { value: "xqz" } });
    await settle();
    expect(screen.getByText(/^No results for/)).toBeTruthy();
    expect(screen.queryByText(/You can ask/)).toBeNull();
  });
  it("with the Windows Search index off, Files shows a single warning line", async () => {
    fakeBridge.setFilesIndex(false);
    render(<SearchPanel onClose={() => undefined} />);
    await settle();
    fireEvent.change(screen.getByRole("combobox", { name: "Search" }), { target: { value: "s" } });
    await settle();
    expect(screen.getByText(FILES_OFF)).toBeTruthy();
    expect(screen.queryByText("screen-recording.mp4")).toBeNull();
  });
  it("when empty there is a 'Recent' group and an Ask Compass row", async () => {
    render(<SearchPanel onClose={() => undefined} />);
    await settle();
    expect(screen.getByRole("group", { name: "Recent" })).toBeTruthy();
    expect(screen.getAllByRole("option").at(-1)!.textContent).toContain("Ask Compass…");
  });
});

describe("approval row (Modules › General)", () => {
  const surf = (a: typeof APPROVAL_LOW) => ({ ...EMPTY_SURFACES, approvals: [a], approvalTop: a.id });
  it("a direct 'Allow' sends surface: protrusion (the high-risk rule in Rust relies on this)", () => {
    vi.useFakeTimers();
    render(<SummaryBoxes surf={surf(APPROVAL_LOW)} onDetail={() => undefined} />);
    act(() => { vi.advanceTimersByTime(700); });
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    const a = logged("approval_answer")[0].args as { decision: string; surface: string };
    expect(a.decision).toBe("allow");
    expect(a.surface).toBe("protrusion");
  });
  it("a row that offers only 'Details' has no direct answer", () => {
    render(<SummaryBoxes surf={surf(APPROVAL_HIGH)} onDetail={() => undefined} />);
    expect(screen.getByRole("button", { name: "Details" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
  });
});

describe("Settings › Appearance: Start with Windows and taskbar mode", () => {
  it("the 'Start with Windows' switch writes set_settings({autostart})", async () => {
    render(<SettingsPanel page="appearance" onPage={() => undefined} settings={await fakeBridge.call("get_settings")} />);
    fireEvent.click(screen.getByRole("button", { name: "More settings" }));
    const sw = screen.getByRole("switch", { name: "Start with Windows" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    await settle();
    expect((await fakeBridge.call("get_settings")).autostart).toBe(false);
  });
  it("the three-option taskbar mode is read from taskbarHide and written with taskbar_set_mode; no 'experimental' label", async () => {
    const settings = await fakeBridge.call("get_settings");
    const { container } = render(<SettingsPanel page="appearance" onPage={() => undefined} settings={settings} />);
    fireEvent.click(screen.getByRole("button", { name: "More settings" }));
    const group = screen.getByRole("radiogroup", { name: "Windows taskbar" });
    expect(within(group).getAllByRole("radio").map((b) => b.textContent)).toEqual(["Always hide", "Auto-hide", "Keep Windows taskbar"]);
    expect(within(group).getByRole("radio", { name: "Always hide" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(group).getByRole("radio", { name: "Keep Windows taskbar" }));
    await settle();
    expect((await fakeBridge.call("get_settings")).taskbarHide).toBe("off");
    expect(within(group).getByRole("radio", { name: "Keep Windows taskbar" }).getAttribute("aria-checked")).toBe("true");
    expect(container.textContent?.toLowerCase()).not.toContain("experimental");
  });
  it("Island only is a switch that writes islandOnly and disables the taskbar mode choice", async () => {
    const settings = await fakeBridge.call("get_settings");
    const { rerender } = render(<SettingsPanel page="appearance" onPage={() => undefined} settings={settings} />);
    fireEvent.click(screen.getByRole("button", { name: "More settings" }));
    expect(screen.getByRole("radio", { name: "Auto-hide" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("switch", { name: "Island only" }));
    await settle();
    expect((await fakeBridge.call("get_settings")).islandOnly).toBe(true);
    rerender(<SettingsPanel page="appearance" onPage={() => undefined} settings={{ ...settings, islandOnly: true }} />);
    expect(screen.getByRole("radio", { name: "Auto-hide" }).hasAttribute("disabled")).toBe(true);
  });
  it("the selection follows when taskbarHide changes from outside", async () => {
    const settings = await fakeBridge.call("get_settings");
    const { rerender } = render(<SettingsPanel page="appearance" onPage={() => undefined} settings={settings} />);
    fireEvent.click(screen.getByRole("button", { name: "More settings" }));
    rerender(<SettingsPanel page="appearance" onPage={() => undefined} settings={{ ...settings, taskbarHide: "auto" }} />);
    expect(screen.getByRole("radio", { name: "Auto-hide" }).getAttribute("aria-checked")).toBe("true");
  });
  it("the welcome card does not show with '?autostart=1' and shows when started manually", async () => {
    window.history.replaceState({}, "", "/?autostart=1");
    render(<Island monitor="m1" />);
    await settle();
    expect(screen.queryByRole("dialog", { name: "Welcome to Peeka" })).toBeNull();
    cleanup();
    window.history.replaceState({}, "", "/");
    render(<Island monitor="m1" />);
    await settle();
    expect(screen.getByRole("dialog", { name: "Welcome to Peeka" })).toBeTruthy();
  });
});

describe("Settings › Clipboard", () => {
  it("password lifetime 5/15/30/60; the selected one is marked, and changing it writes set_settings", async () => {
    render(<SettingsPanel page="clipboard" onPage={() => undefined} settings={await fakeBridge.call("get_settings")} />);
    const g = screen.getByRole("radiogroup", { name: "Password lifetime" });
    expect(within(g).getAllByRole("radio").map((b) => b.textContent)).toEqual(["5 min", "15 min", "30 min", "60 min"]);
    expect(within(g).getByRole("radio", { name: "60 min" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(g).getByRole("radio", { name: "15 min" }));
    await settle();
    expect((await fakeBridge.call("get_settings")).clipPasswordMin).toBe(15);
  });
  it("'Delete all' works only when held", async () => {
    vi.useFakeTimers();
    render(<SettingsPanel page="clipboard" onPage={() => undefined} settings={await fakeBridge.call("get_settings")} />);
    const b = screen.getByRole("button", { name: "Delete all: press and hold" });
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
