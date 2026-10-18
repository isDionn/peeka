import { describe, expect, it } from "vitest";
import type { PinnedApp, WindowInfo } from "../bridge";
import { dragLayout, mergePins, reorder } from "../lib/mergePins";

const app = (appId: string): PinnedApp => ({ appId, name: appId.toUpperCase(), icon: "data:x" });
const win = (hwnd: number, appId: string, active = false): WindowInfo => ({ ...app(appId), hwnd, title: "t" + hwnd, active, monitor: "m1" });

describe("mergePins", () => {
  it("kapalı sabit yalnız simge: pencere yok, etkin değil", () => {
    const { pinned, tabs } = mergePins([app("steam")], []);
    expect(pinned).toHaveLength(1);
    expect(pinned[0]).toMatchObject({ appId: "steam", pinned: true, windows: [], active: false });
    expect(tabs).toEqual([]);
  });
  it("açık sabit tek öğe: pencereler birleşir, sayı ve etkinlik taşınır, ayrı sekme olmaz", () => {
    const { pinned, tabs } = mergePins([app("chrome")], [win(1, "chrome"), win(2, "chrome", true)]);
    expect(pinned[0].windows.map((w) => w.hwnd)).toEqual([1, 2]);
    expect(pinned[0].active).toBe(true);
    expect(tabs).toEqual([]);
  });
  it("sabit olmayan pencereler uygulama başına bir sekme, ilk görülme sırasıyla", () => {
    const { tabs } = mergePins([app("chrome")], [win(1, "vscode"), win(2, "terminal"), win(3, "vscode"), win(4, "chrome")]);
    expect(tabs.map((t) => [t.appId, t.windows.length, t.pinned])).toEqual([["vscode", 2, false], ["terminal", 1, false]]);
  });
  it("sabit sırası korunur", () => {
    const { pinned } = mergePins([app("b"), app("a")], [win(1, "a")]);
    expect(pinned.map((p) => p.appId)).toEqual(["b", "a"]);
  });
});

describe("sürükle-sırala", () => {
  const w = [30, 60, 30, 30]; // sol uçlar 0, 30, 90, 120
  it("kımıldamayınca yer değişmez", () => {
    expect(dragLayout(w, 1, 0)).toMatchObject({ to: 1, shifts: [0, 0, 0, 0] });
  });
  it("sağa geçince ortayı aşılan öğeler tutulanın genişliği kadar sola kayar", () => {
    const r = dragLayout(w, 0, 80); // tutulan merkezi 15 + 80 = 95: 2. öğe (merkez 60) aşıldı, 3. (105) aşılmadı
    expect(r.to).toBe(1);
    expect(r.shifts).toEqual([0, -30, 0, 0]);
  });
  it("sola geçince öğeler sağa kayar", () => {
    const r = dragLayout(w, 3, -130);
    expect(r.to).toBe(0);
    expect(r.shifts).toEqual([30, 30, 30, 0]);
  });
  it("kenarda durur", () => {
    expect(dragLayout(w, 0, -500).dx).toBe(0);
    expect(dragLayout(w, 0, 500).dx).toBe(120);
  });
  it("reorder", () => {
    expect(reorder(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(reorder(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });
});
