// Friction audit, strip and panels (O1, O6, O9, O10, O12, O16, Y2, Y5).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { panelMaxH } from "../components/common";
import { SearchPanel } from "../components/SearchPanel";
import { Shell } from "../components/Shell";
import { onX, type XMsg } from "../lib/xwin";
import { announceNotif } from "../lib/lineChan";

const proto = HTMLElement.prototype;
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset();
});
afterEach(() => { cleanup(); Reflect.deleteProperty(proto, "offsetHeight"); Reflect.deleteProperty(proto, "offsetWidth"); });
const settle = (ms = 60) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const logged = (cmd: string) => fakeBridge.log.filter((l) => l.cmd === cmd);
const panel = (k: string) => document.querySelector(`[data-panel=${k}]`)!;
// Notifications has no strip button (the clock opens Windows's calendar): the island asks for it
const trigger = (k: string) => k === "notif" ? act(() => announceNotif()) : fireEvent.click(document.querySelector(`[data-panel-trigger="${k}"]`)!);

describe("strip pins", () => {
  it("logos only (owner, after RC1): no visible names; the name stays in aria-label, no native title tooltip", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    const items = [...document.querySelectorAll(".pin, .tabA")];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((p) => p.textContent?.replace(/\d/g, "") === "")).toBe(true); // only a window count, never a name
    expect(items.every((p) => p.getAttribute("aria-label") && !p.hasAttribute("title"))).toBe(true);
    expect(document.querySelector('.pin[data-app="chrome"]')!.getAttribute("aria-label")).toBe("Chrome, 2 windows");
    expect(document.querySelector('.pin[data-app="chrome"] .count')!.textContent).toBe("2");
    expect(items.some((p) => p.classList.contains("openPinned"))).toBe(true);
  });

  it("no logo from Windows: the name's first letter in a circle; a window asking for attention marks its app", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    act(() => fakeBridge.setWindows([
      { appId: "exe:blitz", name: "Blitz", icon: "", hwnd: 50, title: "Blitz", active: false, monitor: "m1", attention: true },
      { appId: "exe:x", name: "Xcalc", icon: "", hwnd: 51, title: "x", active: true, monitor: "m1" },
    ]));
    await settle();
    const blitz = document.querySelector('.tabA[data-app="exe:blitz"]')!;
    expect(blitz.querySelector(".appLetter")!.textContent).toBe("B");
    expect(blitz.classList.contains("attn")).toBe(true);
    expect(document.querySelector('.tabA[data-app="exe:x"]')!.classList.contains("attn")).toBe(false);
  });

  it("hover shows the name: a bubble for an app without windows, the preview's header for one with windows", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    fireEvent.pointerEnter(document.querySelector('.pin[data-app="steam"]')!);
    await settle(300);
    expect(document.querySelector(".stripTip")!.textContent).toBe("Steam");
    fireEvent.pointerEnter(document.querySelector('.pin[data-app="chrome"]')!);
    await settle(60);
    expect(document.querySelector(".stripTip")).toBeNull();
    expect(document.querySelector(".preview .pvName")!.textContent).toBe("Chrome");
  });
  it("owner RC5: the last control on the right is a Show desktop button (after the clock)", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    const b = document.querySelector<HTMLElement>('header.bar button[aria-label="Show desktop"]')!;
    expect(b.nextElementSibling).toBeNull();
    expect(b.previousElementSibling!.getAttribute("data-panel-trigger")).toBe("calendar");
    fireEvent.click(b);
    await settle();
    expect(logged("show_desktop")).toHaveLength(1);
  });
  it("owner RC5: one window = the small bubble with its title, no preview card; 2+ windows keep the preview", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    fireEvent.pointerEnter(document.querySelector('.pin[data-app="vscode"]')!);
    await settle(300);
    expect(document.querySelector(".preview")).toBeNull();
    expect(document.querySelector(".stripTip .tipSub")!.textContent).toBe("Header.tsx, website");
    expect(logged("window_preview")).toHaveLength(0); // no screenshot taken
    fireEvent.pointerEnter(document.querySelector('.pin[data-app="chrome"]')!);
    await settle(60);
    expect(document.querySelector(".stripTip")).toBeNull();
    expect(document.querySelectorAll(".preview .small")).toHaveLength(2);
  });
});

describe("window picker (F-05)", () => {
  it("on a multi-window item ArrowDown opens the picker, arrow keys move, Esc closes it and returns focus to the item", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    const chrome = document.querySelector<HTMLElement>('.pin[data-app="chrome"]')!;
    chrome.focus();
    fireEvent.keyDown(chrome, { key: "ArrowDown" });
    await settle(100);
    const k = document.querySelectorAll<HTMLElement>(".preview .small");
    expect(k.length).toBeGreaterThan(1);
    expect(document.activeElement).toBe(document.querySelector(".preview .small.on") ?? k[0]);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await settle();
    expect(document.querySelector(".preview")).toBeNull();
    expect(document.activeElement).toBe(chrome);
  });
});

describe("panels", () => {
  it("O6: height limit = visible area - strip - gap", () => {
    expect(panelMaxH(768)).toBe(768 - 46);
    expect(panelMaxH(100)).toBe(160);
  });

  it("Y5: when a panel opens, {t:'panel-open', panel} goes to the island window", async () => {
    const got: XMsg[] = [];
    const off = onX((m) => got.push(m));
    render(<Shell monitor="m1" />);
    await settle();
    act(() => fakeBridge.emit("shortcut", { name: "search", monitor: "m1" }));
    await settle(100);
    off();
    expect(got).toContainEqual({ t: "panel-open", panel: "search" });
  });

  it("focus: when Search opens the strip takes keyboard focus and gives it back on close; other panels do not ask for focus", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    trigger("notif");
    await settle(300);
    expect(logged("typing_focus")).toHaveLength(0);
    act(() => fakeBridge.emit("shortcut", { name: "search", monitor: "m1" }));
    await settle(100);
    expect(logged("typing_focus").map((l) => l.args)).toEqual([{ label: "strip-m1", on: true }]);
    act(() => fakeBridge.emit("shortcut", { name: "search", monitor: "m1" }));
    await settle(300);
    expect(logged("typing_focus").map((l) => l.args)).toEqual([{ label: "strip-m1", on: true }, { label: "strip-m1", on: false }]);
  });

  it("Y2: the close button closes the panel (except Search: it has its own Esc hint); clicking outside closes it too", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    trigger("notif");
    await settle(300);
    expect(panel("notif").getAttribute("aria-hidden")).toBe("false");
    fireEvent.click(panel("notif").querySelector(".panelClose")!);
    await settle(300);
    expect(panel("notif").getAttribute("aria-hidden")).toBe("true");
    trigger("start");
    await settle(300);
    expect(panel("start").querySelector(".panelClose")).not.toBeNull();
    fireEvent.pointerDown(document.body);
    await settle(300);
    expect(panel("start").getAttribute("aria-hidden")).toBe("true");
    trigger("search");
    await settle(300);
    expect(panel("search").querySelector(".panelClose")).not.toBeNull();
    trigger("tray");
    await settle(300);
    expect(panel("tray").querySelector(".panelClose")).not.toBeNull();
  });

  it("Y2: a single Esc closes the panel even when focus is outside it", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    trigger("status");
    await settle(300);
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await settle(300);
    expect(panel("status").getAttribute("aria-hidden")).toBe("true");
  });

  it("O16: Peeka settings opens from the Start panel", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    trigger("start");
    await settle(300);
    fireEvent.click(screen.getAllByRole("button", { name: /Peeka settings/ })[0]);
    await settle(300);
    expect(panel("settings").getAttribute("aria-hidden")).toBe("false");
  });
});

describe("menus", () => {
  it("O9: the strip menu opens under the pointer, default focus on the safe row", async () => {
    render(<Shell monitor="m1" init={{ menu: { kind: "strip", x: 700 } }} />);
    await settle();
    expect(document.querySelector<HTMLElement>(".context")!.style.left).toBe("700px");
    expect((document.activeElement as HTMLElement).textContent).toContain("taskbar");
  });

  it("O10: Quit app asks for confirmation on the first click", async () => {
    render(<Shell monitor="m1" init={{ menu: { kind: "app", appId: "vscode", x: 100 } }} />);
    await settle();
    fireEvent.click(screen.getByRole("menuitem", { name: "Quit app" }));
    expect(screen.getByRole("menuitem", { name: /Click again/ })).toBeTruthy();
    expect(logged("quit_app")).toHaveLength(0);
  });
});

describe("Win key", () => {
  it("a lone Win tap (Rust `shortcut` start) toggles Start on the cursor's screen only, with no data wait", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    const start = () => document.querySelector('[data-panel="start"]')!.getAttribute("aria-hidden");
    act(() => fakeBridge.emit("shortcut", { name: "start", monitor: "m2" }));
    expect(start()).toBe("true");
    act(() => fakeBridge.emit("shortcut", { name: "start", monitor: "m1" }));
    expect(start()).toBe("false"); // open in the same commit as the event, before list_apps answers
    act(() => fakeBridge.emit("shortcut", { name: "start", monitor: "m1" }));
    expect(start()).toBe("true");
  });
});

describe("Search", () => {
  it("one selection style: keys and hover move the same single highlighted row", async () => {
    render(<SearchPanel onClose={() => undefined} />);
    await settle();
    const input = screen.getByLabelText("Search");
    fireEvent.change(input, { target: { value: "s" } });
    await settle();
    const selected = () => screen.getAllByRole("option").filter((o) => o.classList.contains("selected") || o.getAttribute("aria-selected") === "true");
    const rows = screen.getAllByRole("option");
    expect(rows.length).toBeGreaterThan(2);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(selected()).toEqual([rows[1]]);
    fireEvent.mouseMove(rows[2]);
    expect(selected()).toEqual([rows[2]]);
    expect(rows[2].classList.contains("selected") && rows[2].getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector(".selPill")).toBeNull(); // the fill is the row's own: no second highlight layer
  });

  it("O12: with no results Enter does not ask Compass; pressing the arrow does", async () => {
    render(<SearchPanel onClose={() => undefined} />);
    await settle();
    const input = screen.getByLabelText("Search");
    fireEvent.change(input, { target: { value: "zzzqqq" } });
    await settle();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(logged("search_ask")).toHaveLength(0);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(logged("search_ask")).toHaveLength(1);
  });

  it("O12: with no results Esc clears the text; with results it does not capture it, and the panel closes", async () => {
    render(<SearchPanel onClose={() => undefined} />);
    await settle();
    const input = screen.getByLabelText("Search") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "zzqxw" } });
    await settle();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "sc" } });
    await settle();
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    expect(fireEvent.keyDown(input, { key: "Escape" })).toBe(true); // not captured: the focus trap closes it
    expect(input.value).toBe("sc");
  });
});
