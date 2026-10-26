// Owner RC7: ~20 imported taskbar pins + running apps ran into each other and under the island. The list now fits:
// slots shrink to 26 px, the rest goes behind "+N", the foreground app always stays on the strip.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MonitorInfo, PinnedApp, WindowInfo } from "../bridge";
import { Strip } from "../components/Strip";
import { DIVIDER, GAP, MORE, SLOT, SLOT_MIN, fitStrip, mergePins } from "../lib/mergePins";

const app = (appId: string): PinnedApp => ({ appId, name: appId.toUpperCase(), icon: "" });
const win = (hwnd: number, appId: string, active = false): WindowInfo => ({ ...app(appId), hwnd, title: "t" + hwnd, active, monitor: "m1" });
/** 20 pins (8 running, so no second item for them) + 10 unpinned running apps; the last one is in front. */
const thirty = () => {
  const pins = Array.from({ length: 20 }, (_, i) => app("pin" + i));
  const windows = [...Array.from({ length: 8 }, (_, i) => win(100 + i, "pin" + i * 2)), ...Array.from({ length: 10 }, (_, i) => win(200 + i, "tab" + i, i === 9))];
  return { pins, windows, ...mergePins(pins, windows) };
};
/** The left list's room as the strip measures it: up to the island's half (224) from the screen centre, after Start + Search (8 + 30 + 2 + 30). */
const roomAt = (screen: number) => screen / 2 - 224 - 70 - GAP;

/** The boxes fitStrip's widths give, left to right (pins, divider, tabs, "+N"), from 0. */
function rects(f: ReturnType<typeof fitStrip>) {
  const out: { id: string; l: number; r: number }[] = [];
  let x = 0;
  const put = (id: string, w: number) => { out.push({ id, l: x, r: x + w }); x += w + GAP; };
  f.pinned.forEach((i) => put(i.appId, f.slot));
  if (f.tabs.length) x += DIVIDER - GAP;
  f.tabs.forEach((i) => put(i.appId, f.slot));
  if (f.hidden.length) put("+N", MORE);
  return out;
}

describe("strip overflow (fitStrip)", () => {
  it.each([[1366, 18], [1920, 9]])("30 apps at %i px: no overlap, nothing under the island, +%i, foreground shown, every app once", (screen, hiddenN) => {
    const { pinned, tabs } = thirty();
    expect(pinned.length + tabs.length).toBe(30); // dedupe: running pins are one item each
    const room = roomAt(screen);
    const f = fitStrip(pinned, tabs, room);
    const r = rects(f);
    r.slice(1).forEach((b, i) => expect(b.l).toBeGreaterThanOrEqual(r[i].r));
    expect(r[r.length - 1].r).toBeLessThanOrEqual(room);
    expect(f.slot).toBe(SLOT_MIN);
    expect(f.slot - 18).toBeGreaterThanOrEqual(8); // the 18 px logo keeps 4 px either side
    expect(f.hidden).toHaveLength(hiddenN);
    expect([...f.pinned, ...f.tabs].some((i) => i.appId === "tab9" && i.active)).toBe(true);
    const ids = [...f.pinned, ...f.tabs, ...f.hidden].map((i) => i.appId);
    expect(new Set(ids).size).toBe(30);
    expect(f.pinned.map((p) => p.appId)).toEqual(pinned.slice(0, f.pinned.length).map((p) => p.appId)); // pin order kept
  });

  it("few apps keep the full 32 px slot and no +N; slots shrink before anything hides", () => {
    const { pinned } = thirty();
    expect(fitStrip(pinned.slice(0, 6), [], roomAt(1920))).toMatchObject({ slot: SLOT, hidden: [] });
    const f = fitStrip(pinned, [], 20 * 29);
    expect(f.hidden).toEqual([]);
    expect(f.slot).toBeLessThan(SLOT);
  });

  it("the foreground app swaps into the last slot; the app it displaced leads the hidden list", () => {
    const { pinned, tabs } = thirty();
    const f = fitStrip(pinned, tabs, roomAt(1366));
    const shown = [...f.pinned, ...f.tabs];
    expect(shown[shown.length - 1].appId).toBe("tab9");
    expect(f.hidden[0].appId).toBe("pin11");
    expect(f.hidden.map((i) => i.appId)).not.toContain("tab9");
  });

  it("while the pointer holds the slot width, a new app goes behind +N instead of resizing the logos", () => {
    const { pinned } = thirty();
    const room = 12 * (SLOT + GAP);
    expect(fitStrip(pinned.slice(0, 12), [], room).slot).toBe(SLOT);
    const held = fitStrip(pinned.slice(0, 13), [], room, SLOT);
    expect(held.slot).toBe(SLOT);
    expect(held.hidden.length).toBeGreaterThan(0);
  });
});

describe("strip overflow (DOM)", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  it("1366 px: a +N button opens a panel with the hidden apps; they click, hover and right-click like strip items", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1366);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 40, right: 70, width: 30, top: 0, bottom: 30, height: 30, x: 40, y: 0, toJSON: () => ({}) });
    const { pins, windows } = thirty();
    const onPanel = vi.fn(), onMenu = vi.fn();
    const props = { monitor: { id: "m1", primary: true } as MonitorInfo, windows, pins, status: null, onPanel, onMenu, onReorder: () => undefined };
    const { rerender } = render(<Strip {...props} openPanel={null} />);
    const more = document.querySelector<HTMLButtonElement>('[data-panel-trigger="more"]')!;
    expect(more.textContent).toBe("+18");
    expect(more.getAttribute("aria-label")).toBe("18 more apps");
    expect(document.querySelectorAll("header.bar :is(.pin, .tabA)")).toHaveLength(12);
    expect(document.querySelector('header.bar .tabA[data-app="tab9"]')).not.toBeNull();
    fireEvent.click(more);
    expect(onPanel).toHaveBeenCalledWith("more");
    rerender(<Strip {...props} openPanel="more" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const cells = [...document.querySelectorAll<HTMLElement>('[data-panel="more"] :is(.pin, .tabA)')];
    expect(cells).toHaveLength(18);
    const tab = cells.find((c) => c.dataset.app === "tab0")!;
    fireEvent.contextMenu(tab);
    expect(onMenu).toHaveBeenCalledWith({ kind: "app", appId: "tab0", x: 40 });
  });
});
