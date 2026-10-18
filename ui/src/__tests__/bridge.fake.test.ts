import { describe, expect, it, vi } from "vitest";
import { createFakeBridge } from "../bridge.fake";
import { clockParts } from "../lib/clock";
import { collectHitRects } from "../lib/hitRects";
import { formatCombo } from "../lib/shortcut";

describe("fake bridge", () => {
  it("changing status emits status_changed and a read returns the new value", async () => {
    const b = createFakeBridge();
    const seen = vi.fn();
    await b.on("status_changed", seen);
    await b.call("set_radio", { kind: "wifi", on: false });
    expect(seen).toHaveBeenCalledOnce();
    expect(seen.mock.calls[0][0].wifi).toEqual({ on: false, name: null });
    expect((await b.call("get_status")).wifi?.on).toBe(false);
  });
  it("saves pins and emits pins_changed", async () => {
    const b = createFakeBridge();
    const seen = vi.fn();
    await b.on("pins_changed", seen);
    const pins = await b.call("set_pins", { appIds: ["vscode", "chrome"] });
    expect(pins.map((p) => p.appId)).toEqual(["vscode", "chrome"]);
    expect(seen).toHaveBeenCalled();
  });
  it("battery is null on a machine without a battery", async () => {
    expect((await createFakeBridge({ battery: false }).call("get_status")).battery).toBeNull();
  });
  it("search is case-insensitive; an empty query returns mixed recents", async () => {
    const b = createFakeBridge();
    const r = await b.call("search", { query: "REPORT" });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => ["app", "window", "file", "setting", "plugin"].includes(x.kind))).toBe(true);
    expect(r.some((x) => x.title === "q3-report.xlsx")).toBe(true);
  });
  it("an opened result brings the window to the front", async () => {
    const b = createFakeBridge();
    await b.call("open_result", { id: "win:3" });
    const w = await b.call("list_windows", { monitor: "m1" });
    expect(w.find((x) => x.active)?.hwnd).toBe(3);
  });
  it("a shortcut conflict is rejected", async () => {
    const b = createFakeBridge();
    const r = await b.call("set_settings", { patch: { shortcuts: { search: "Ctrl+Shift+A" } as never } });
    expect(r.ok).toBe(false);
  });
  it("Ctrl+K becomes a shortcut event in the browser (same as the Rust path)", async () => {
    const b = createFakeBridge();
    const seen = vi.fn();
    await b.on("shortcut", seen);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    expect(seen).toHaveBeenCalledWith({ name: "search", monitor: "m1" });
  });
  it("the clock can be frozen", () => {
    expect(createFakeBridge({ now: new Date(2025, 9, 16, 14, 32) }).now().getHours()).toBe(14);
  });
});

describe("helpers", () => {
  it("clock: Thu Oct 16 / 2:32 PM", () => {
    const c = clockParts(new Date(2025, 9, 16, 14, 32));
    expect(c.date).toBe("Thu Oct 16");
    expect(c.time).toBe("2:32 PM");
    expect(c.label).toBe("Thursday, October 16, 2:32 PM");
  });
  it("shortcut format: a bare letter and a lone modifier are invalid", () => {
    const k = { shiftKey: false, altKey: false, metaKey: false, ctrlKey: false };
    expect(formatCombo({ ...k, key: "a" })).toBeNull();
    expect(formatCombo({ ...k, ctrlKey: true, key: "Control" })).toBeNull();
    expect(formatCombo({ ...k, ctrlKey: true, shiftKey: true, key: "a" })).toBe("Ctrl+Shift+A");
    expect(formatCombo({ ...k, ctrlKey: true, key: " " })).toBe("Ctrl+Space");
  });
  it("clickable rects are collected only from [data-hit] elements that have a size", () => {
    document.body.innerHTML = '<div id="a" data-hit></div><div id="b" data-hit></div><div id="c"></div>';
    const rect = (w: number) => () => ({ left: 5, top: 6, width: w, height: 30 }) as DOMRect;
    document.getElementById("a")!.getBoundingClientRect = rect(100);
    document.getElementById("b")!.getBoundingClientRect = rect(0);
    document.getElementById("c")!.getBoundingClientRect = rect(100);
    expect(collectHitRects()).toEqual([{ x: 5, y: 6, w: 100, h: 30 }]);
  });
});
