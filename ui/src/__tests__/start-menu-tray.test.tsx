// Start's right-click menu (pinned apps, folders, All apps, search) and the Hidden icons panel's order and groups (owner 2026-10-26).
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import type { StartItem } from "../bridge";
import { StartPanel } from "../components/StartPanel";
import { TrayList } from "../components/TrayList";
import { hasApp, pinApp, ungroup, withNew } from "../lib/startItems";

beforeEach(() => { fakeBridge.reset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const settle = (ms = 60) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const logged = (cmd: string) => fakeBridge.log.filter((l) => l.cmd === cmd);
const F = (name: string, ...appIds: string[]): StartItem => ({ kind: "folder", name, appIds });
const A = (appId: string): StartItem => ({ kind: "app", appId });
const itemsOf = (menu: HTMLElement) => within(menu).getAllByRole("menuitem").map((b) => b.textContent);

describe("grid model: ungroup, pin, new ids", () => {
  it("ungroup puts a folder's apps in its place; pin adds once; new ids go last", () => {
    expect(ungroup([A("x"), F("W", "a", "b"), A("y")], "folder:a")).toEqual([A("x"), A("a"), A("b"), A("y")]);
    const g = [A("x"), F("W", "a", "b")];
    expect(hasApp(g, "b")).toBe(true);
    expect(pinApp(g, "b")).toBe(g);
    expect(pinApp(g, "c")).toEqual([...g, A("c")]);
    expect(withNew(g, ["b", "z", "x", "q"])).toEqual([...g, A("z"), A("q")]);
  });
});

describe("Start menu", () => {
  const start = async (items?: StartItem[]) => {
    if (items) await fakeBridge.call("set_start_items", { items });
    const monitor = await fakeBridge.call("get_monitor", { monitor: "m1" });
    const onClose = vi.fn();
    render(<StartPanel monitor={monitor} pins={await fakeBridge.call("get_pins")} onClose={onClose} />);
    await settle();
    return onClose;
  };

  it("a pinned app that is also on the strip: Unpin from Start / strip, file location, admin, uninstall", async () => {
    const onClose = await start([A("chrome"), A("calc")]);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Chrome/ }));
    const menu = screen.getByRole("menu", { name: "Chrome" });
    expect(itemsOf(menu)).toEqual(["Unpin from Start", "Unpin from strip", "Open file location", "Run as administrator", "Uninstall"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Unpin from strip" }));
    await settle();
    expect((await fakeBridge.call("get_pins")).map((p) => p.appId)).not.toContain("chrome");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onClose).not.toHaveBeenCalled(); // pinning keeps Start open
    fireEvent.contextMenu(screen.getByRole("button", { name: /Chrome/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open file location" }));
    await settle();
    expect(logged("app_show_in_folder")[0].args).toEqual({ appId: "chrome" });
    expect(onClose).toHaveBeenCalled();
  });

  it("an app with no window and no strip pin has no strip item; Unpin from Start saves the grid", async () => {
    await start([A("chrome"), A("calc")]);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Calculator|calc/i }));
    expect(itemsOf(screen.getByRole("menu"))).toEqual(["Unpin from Start", "Open file location", "Run as administrator", "Uninstall"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Unpin from Start" }));
    await settle();
    expect(logged("set_start_items").at(-1)!.args).toEqual({ items: [A("chrome")] });
  });

  it("Uninstall only opens Windows's Installed apps page", async () => {
    const spy = vi.spyOn(fakeBridge, "call");
    const onClose = await start([A("chrome")]);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Chrome/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Uninstall" }));
    await settle();
    expect(spy).toHaveBeenCalledWith("open_windows_settings", { uri: "ms-settings:appsfeatures" });
    expect(onClose).toHaveBeenCalled();
  });

  it("a folder: Rename opens it with the name field focused; Ungroup puts its apps back", async () => {
    await start([F("Work", "chrome", "vscode"), A("calc")]);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Work, folder, 2 apps" }));
    expect(itemsOf(screen.getByRole("menu", { name: "Work" }))).toEqual(["Rename", "Ungroup"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    await settle();
    expect(document.activeElement).toBe(screen.getByLabelText("Folder name"));
    act(() => { fireEvent.keyDown(document.activeElement!, { key: "Escape" }); });
    fireEvent.contextMenu(screen.getByRole("button", { name: "Work, folder, 2 apps" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Ungroup" }));
    await settle();
    expect(logged("set_start_items").at(-1)!.args).toEqual({ items: [A("chrome"), A("vscode"), A("calc")] });
  });

  it("All apps: a Store app gets Pin to Start and Uninstall only; Shift+F10 opens the menu, Esc gives focus back", async () => {
    const real = fakeBridge.call.bind(fakeBridge) as (...a: unknown[]) => Promise<unknown>;
    vi.spyOn(fakeBridge, "call").mockImplementation(((cmd: string, ...rest: unknown[]) => cmd === "list_apps"
      ? Promise.resolve([{ appId: "aumid:Microsoft.Photos", name: "Photos", icon: "" }])
      : real(cmd, ...rest)) as typeof fakeBridge.call);
    await start([A("chrome")]);
    fireEvent.click(screen.getByRole("button", { name: /All apps/ }));
    const row = within(screen.getByRole("group", { name: "All apps" })).getByRole("button", { name: /Photos/ });
    row.focus();
    fireEvent.keyDown(row, { key: "F10", shiftKey: true });
    const menu = screen.getByRole("menu", { name: "Photos" });
    expect(itemsOf(menu)).toEqual(["Pin to Start", "Uninstall"]);
    expect(document.activeElement).toBe(within(menu).getAllByRole("menuitem")[0]);
    act(() => { fireEvent.keyDown(document.activeElement!, { key: "Escape" }); });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(row);
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Pin to Start" }));
    await settle();
    expect(logged("set_start_items").at(-1)!.args).toEqual({ items: [A("chrome"), A("aumid:Microsoft.Photos")] });
  });

  it("search: app rows have the menu (Pin to Start), other rows don't", async () => {
    await start([A("chrome")]);
    fireEvent.change(screen.getByLabelText("Search in Start"), { target: { value: "spot" } });
    await settle();
    const rows = within(screen.getByRole("group", { name: "Search results" })).getAllByRole("button");
    fireEvent.contextMenu(rows[0]);
    expect(itemsOf(screen.getByRole("menu"))[0]).toBe("Pin to Start");
    fireEvent.pointerDown(document.body); // a click anywhere else closes it
    expect(screen.queryByRole("menu")).toBeNull();
    const win = rows.find((r) => !r.textContent?.match(/^Spotify$/));
    if (win) { fireEvent.contextMenu(win); expect(screen.queryByRole("menu")).toBeNull(); }
  });
});

describe("Hidden icons: order and groups", () => {
  const tray = async () => { render(<TrayList monitor="m1" onClose={() => undefined} />); await settle(); };
  const cells = () => [...screen.getByRole("group", { name: "Hidden icons" }).querySelectorAll<HTMLElement>(":scope .startGrid > .appGrid > .appCell")];
  const trayIds = async () => (await fakeBridge.call("tray_icons", { monitor: "m1" })).map((t) => t.id);

  /** A pointer drag from cell `from` to (x, y) over cell `to` (its tile spans 80..120 on both axes). */
  const drag = (from: HTMLElement, to: HTMLElement, x: number) => {
    const lt = to.querySelector(".lt")!;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return (this === to || this === lt ? new DOMRect(80, 80, 40, 40) : new DOMRect(0, 0, 0, 0));
    });
    document.elementFromPoint = () => lt;
    act(() => {
      from.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 0, clientY: 0 }));
      document.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: 100 }));
      document.dispatchEvent(new MouseEvent("pointerup", { clientX: x, clientY: 100 }));
    });
  };

  it("no saved order: Windows's order; a saved one wins, with new icons last and groups as Start folders", async () => {
    const ids = await trayIds();
    await tray();
    expect(cells().map((c) => c.dataset.key)).toEqual(ids.map((id) => "app:" + id));
    cleanup();
    await fakeBridge.call("set_settings", { patch: { trayItems: [F("Sync", ids[2], ids[1]), A(ids[3])] } });
    await tray();
    const keys = cells().map((c) => c.dataset.key);
    expect(keys.slice(0, 3)).toEqual(["folder:" + ids[2], "app:" + ids[3], "app:" + ids[0]]);
    expect(keys).toHaveLength(ids.length - 1);
    // the group opens in place; a click on an icon inside still reaches the app
    fireEvent.click(screen.getByRole("button", { name: "Sync, folder, 2 apps" }));
    const card = screen.getByRole("dialog", { name: "Sync folder" });
    fireEvent.click(within(card).getAllByRole("button")[0]);
    await settle();
    expect(logged("tray_open")[0].args).toEqual({ id: ids[2] });
  });

  it("drag onto an icon's middle groups them; onto its edge reorders; both are saved", async () => {
    const ids = await trayIds();
    await tray();
    drag(cells()[0], cells()[3], 100); // middle of the tile: merge
    await settle();
    let saved = (await fakeBridge.call("get_settings")).trayItems!;
    expect(saved[2]).toEqual(F("Folder", ids[3], ids[0]));
    expect(cells().map((c) => c.dataset.key)[2]).toBe("folder:" + ids[3]);
    drag(cells()[0], cells()[2], 82); // left edge of the folder: before it
    await settle();
    saved = (await fakeBridge.call("get_settings")).trayItems!;
    expect(saved.slice(0, 3)).toEqual([A(ids[2]), A(ids[1]), F("Folder", ids[3], ids[0])]);
  });

  it("rename a group; dragging its last-but-one icon out dissolves it", async () => {
    const ids = await trayIds();
    await fakeBridge.call("set_settings", { patch: { trayItems: [F("Folder", ids[0], ids[1])] } });
    await tray();
    fireEvent.click(screen.getByRole("button", { name: "Folder, folder, 2 apps" }));
    const name = screen.getByLabelText("Folder name");
    fireEvent.change(name, { target: { value: "Chat" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await settle();
    expect((await fakeBridge.call("get_settings")).trayItems![0]).toEqual(F("Chat", ids[0], ids[1]));
    // out of the card onto the grid's last icon edge: the group of one becomes that icon
    const inner = within(screen.getByRole("dialog", { name: /folder/ })).getAllByRole("button")[1];
    drag(inner, cells().at(-1)!, 82);
    await settle();
    const after = (await fakeBridge.call("get_settings")).trayItems!;
    expect(after[0]).toEqual(A(ids[0]));
    expect(after.some((it) => it.kind === "folder")).toBe(false);
  });
});
