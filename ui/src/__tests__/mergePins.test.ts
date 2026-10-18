import { describe, expect, it } from "vitest";
import type { PinnedApp, WindowInfo } from "../bridge";
import { dragLayout, mergePins, reorder } from "../lib/mergePins";

const app = (appId: string): PinnedApp => ({ appId, name: appId.toUpperCase(), icon: "data:x" });
const win = (hwnd: number, appId: string, active = false): WindowInfo => ({ ...app(appId), hwnd, title: "t" + hwnd, active, monitor: "m1" });

describe("mergePins", () => {
  it("a closed pin is just an icon: no windows, not active", () => {
    const { pinned, tabs } = mergePins([app("steam")], []);
    expect(pinned).toHaveLength(1);
    expect(pinned[0]).toMatchObject({ appId: "steam", pinned: true, windows: [], active: false });
    expect(tabs).toEqual([]);
  });
  it("an open pin is a single item: windows merge, count and active state carry over, no separate tab", () => {
    const { pinned, tabs } = mergePins([app("chrome")], [win(1, "chrome"), win(2, "chrome", true)]);
    expect(pinned[0].windows.map((w) => w.hwnd)).toEqual([1, 2]);
    expect(pinned[0].active).toBe(true);
    expect(tabs).toEqual([]);
  });
  it("unpinned windows get one tab per app, in first-seen order", () => {
    const { tabs } = mergePins([app("chrome")], [win(1, "vscode"), win(2, "terminal"), win(3, "vscode"), win(4, "chrome")]);
    expect(tabs.map((t) => [t.appId, t.windows.length, t.pinned])).toEqual([["vscode", 2, false], ["terminal", 1, false]]);
  });
  it("pin order is kept", () => {
    const { pinned } = mergePins([app("b"), app("a")], [win(1, "a")]);
    expect(pinned.map((p) => p.appId)).toEqual(["b", "a"]);
  });
});

describe("drag-to-reorder", () => {
  const w = [30, 60, 30, 30]; // left edges 0, 30, 90, 120
  it("nothing moves when the pointer does not move", () => {
    expect(dragLayout(w, 1, 0)).toMatchObject({ to: 1, shifts: [0, 0, 0, 0] });
  });
  it("dragging right shifts the items whose center was passed left by the dragged item width", () => {
    const r = dragLayout(w, 0, 80); // dragged center is 15 + 80 = 95: item 2 (center 60) is passed, item 3 (105) is not
    expect(r.to).toBe(1);
    expect(r.shifts).toEqual([0, -30, 0, 0]);
  });
  it("dragging left shifts the items right", () => {
    const r = dragLayout(w, 3, -130);
    expect(r.to).toBe(0);
    expect(r.shifts).toEqual([30, 30, 30, 0]);
  });
  it("stops at the edge", () => {
    expect(dragLayout(w, 0, -500).dx).toBe(0);
    expect(dragLayout(w, 0, 500).dx).toBe(120);
  });
  it("reorder", () => {
    expect(reorder(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(reorder(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });
});
