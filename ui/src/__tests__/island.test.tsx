import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { Shell } from "../components/Shell";
import { useHitRects } from "../hooks";
import { grows, rectOf as hitRect } from "../lib/hitRects";
import { announceNotif } from "../lib/lineChan";

// jsdom gives no measurements: getBoundingClientRect that sizes [data-hit] elements from the inline style (else 100x30)
const rectOf = (el: HTMLElement) => ({ left: 10, top: 5, width: parseFloat(el.style.width) || (el.dataset.hit !== undefined ? 100 : 0), height: parseFloat(el.style.height) || 30 }) as DOMRect;
const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return rectOf(this); });
  fakeBridge.reset();
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 80)); });

describe("island: clickable rects", () => {
  it("report_hit_rects is called with the new rects when the shape changes", async () => {
    const spy = vi.spyOn(fakeBridge, "call");
    render(<Island monitor="m1" init={{ view: null }} />);
    // the first report waits for an animation frame, which a loaded test machine can delay past one settle()
    await vi.waitFor(async () => { await settle(); expect(spy.mock.calls.some((c) => c[0] === "report_hit_rects")).toBe(true); }, { timeout: 3000 });
    const first = spy.mock.calls.filter((c) => c[0] === "report_hit_rects").length;
    fireEvent.click(screen.getByRole("button", { name: /Open card/ }));
    // reports are debounced to a quiet frame and the card opens over several (spring, ghost cross-fade): an early report
    // can still show the closed shape, so wait until the LATEST report shows the open card instead of reading the first new one
    await vi.waitFor(async () => {
      await settle();
      const calls = spy.mock.calls.filter((c) => c[0] === "report_hit_rects");
      expect(calls.length).toBeGreaterThan(first);
      const last = calls.at(-1)![1] as { page: string; rects: { paint?: boolean }[] };
      expect(last.page).toBe("island");
      expect(last.rects.length).toBeGreaterThanOrEqual(2); // the middle button + the shape box
      expect(last.rects.some((r) => r.paint)).toBe(true); // shadow margin: the window region does not clip the card's shadow
    }, { timeout: 3000 });
  });
  it("measures again when a CSS animation ends (a menu opening from scale .94 must not keep its smaller region)", async () => {
    const spy = vi.spyOn(fakeBridge, "call");
    function Page() { useHitRects("strip", "m1"); return <div data-hit style={{ width: 100, height: 30 }} />; }
    render(<Page />);
    await settle();
    const n = spy.mock.calls.filter((c) => c[0] === "report_hit_rects").length;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return { ...rectOf(this), width: rectOf(this).width + 7 } as DOMRect; });
    fireEvent.animationEnd(document.body);
    await settle();
    expect(spy.mock.calls.filter((c) => c[0] === "report_hit_rects").length).toBe(n + 1);
  });
  it("when the region grows the whole page is drawn again (0.3.4: stale pieces in newly clipped-in areas); a shrink doesn't", async () => {
    expect(hitRect({ left: 10.4, top: 29.6, width: 100.2, height: 0.8 })).toEqual({ x: 10, y: 29, w: 101, h: 2 }); // covers every partial px
    const R = (x: number, w: number) => ({ x, y: 0, w, h: 30 });
    expect(grows([R(0, 100)], [R(10, 50)])).toBe(false);
    expect(grows([R(0, 100)], [R(0, 100), R(0, 101)])).toBe(true);
    expect(grows([], [R(0, 1)])).toBe(true);
    let w = 100;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return { ...rectOf(this), width: this.hasAttribute("data-hit") ? w : 0 } as DOMRect; });
    function Page() { useHitRects("strip", "m1"); return <div data-hit style={{ width: 100, height: 30 }} />; }
    const seen: string[] = [];
    const mo = new MutationObserver(() => seen.push(document.documentElement.style.opacity));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    render(<Page />);
    await vi.waitFor(() => expect(seen.at(-1)).toBe(""), { timeout: 1000 }); // the first report grows from nothing
    await new Promise((r) => setTimeout(r, 300));
    seen.length = 0;
    w = 300;
    fireEvent.animationEnd(document.body);
    await vi.waitFor(() => expect(seen.filter((o) => o === "0.999").length).toBe(2), { timeout: 1000 }); // right away and once more 150 ms later
    await vi.waitFor(() => expect(document.documentElement.style.opacity).toBe(""));
    seen.length = 0;
    w = 200;
    fireEvent.animationEnd(document.body);
    await new Promise((r) => setTimeout(r, 300));
    mo.disconnect();
    expect(seen).toEqual([]);
  });
  it("at rest only the hover peek's footprint is reported as paint (so hovering never grows the region), the button stays clickable", async () => {
    const spy = vi.spyOn(fakeBridge, "call");
    render(<Island monitor="m1" init={{ view: null }} />);
    await vi.waitFor(async () => { await settle(); expect(spy.mock.calls.some((c) => c[0] === "report_hit_rects")).toBe(true); }, { timeout: 3000 });
    const rects = spy.mock.calls.filter((c) => c[0] === "report_hit_rects").at(-1)![1] as { rects: { paint?: boolean; h: number }[] };
    expect(rects.rects.filter((r) => r.paint).map((r) => r.h)).toEqual([14 + 110]); // the "hov" peek (14 px) and its shadow
    expect(rects.rects.some((r) => !r.paint)).toBe(true);
  });
});

describe("island: keyboard and focus", () => {
  it("when a card opens focus enters it; Esc closes it and focus returns to the middle button", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const opener = screen.getByRole("button", { name: /Open card/ });
    opener.focus();
    fireEvent.click(opener);
    await settle();
    const dlg = screen.getByRole("dialog", { name: /^Modules/ });
    expect(dlg.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dlg, { key: "Escape" });
    await settle();
    expect(screen.queryByRole("dialog", { name: /^Modules/ })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
  it("Esc goes back one step: player, music peek, rest", async () => {
    render(<Island monitor="m1" init={{ view: "music-card" }} />);
    await settle();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Music" }), { key: "Escape" });
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("group", { name: "Music" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await settle();
    expect(screen.queryByRole("group", { name: "Music" })).toBeNull();
  });
  it("clicking the center while music plays opens Modules on the Music tab; switching to General; Esc closes", async () => {
    render(<Island monitor="m1" init={{ view: null, autoMusic: true, pin: true }} />);
    await settle();
    fireEvent.click(document.querySelector("button.islandCenter") as HTMLElement);
    await settle();
    expect(screen.getByRole("dialog", { name: /^Modules/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Music" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    await settle();
    expect(screen.getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("dialog", { name: /^Modules/ }), { key: "Escape" });
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("Ctrl+Shift+Enter focuses a self-appearing peek; Ctrl+Space opens the Compass-not-connected card", async () => {
    render(<Island monitor="m1" init={{ view: null, pin: true, osd: { percent: 40, muted: false, device: null } }} />);
    await settle();
    expect(document.activeElement === document.body).toBe(true); // a peek does not steal focus
    await act(async () => { fakeBridge.emit("shortcut", { name: "focus_island", monitor: "m1" }); });
    expect(screen.getByRole("group", { name: "Volume" }).contains(document.activeElement) || document.activeElement?.className === "islandCenter").toBe(true);
    await act(async () => { fakeBridge.emit("shortcut", { name: "ask", monitor: "m1" }); });
    await settle();
    expect(screen.getByRole("dialog", { name: "Compass isn't connected" })).toBeTruthy();
  });
  it("sysmon starts when the System card opens and stops when it closes", async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    expect(fakeBridge.sysmonOn).toBe(true);
    fireEvent.keyDown(screen.getByRole("dialog", { name: /^Modules/ }), { key: "Escape" });
    await settle();
    expect(fakeBridge.sysmonOn).toBe(false);
  });
});

describe("notification list", () => {
  it("the clock opens Peeka's own calendar panel (not Win+N); the link inside calls open_calendar; the clock doesn't move", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    const clock = await screen.findByRole("button", { name: /Calendar$/ });
    fireEvent.click(clock);
    await settle();
    expect(fakeBridge.log.filter((l) => l.cmd === "open_calendar")).toHaveLength(0);
    const dlg = screen.getByRole("dialog", { name: "Calendar" });
    expect(clock.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Windows calendar/ }));
    expect(fakeBridge.log.filter((l) => l.cmd === "open_calendar")).toHaveLength(1);
    expect(dlg.isConnected && clock.isConnected).toBe(true);
  });
  it("opens when the island asks, focus enters the card; Esc closes it", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    act(() => announceNotif());
    await settle(); await settle();
    const dlg = screen.getByRole("dialog", { name: "Notifications" });
    expect(dlg.contains(document.activeElement)).toBe(true);
    expect(screen.getByText("Disk 91% full")).toBeTruthy();
    fireEvent.keyDown(dlg, { key: "Escape" });
    await settle();
    expect(screen.queryByRole("dialog", { name: "Notifications" })).toBeNull();
  });
  it("Review opens the approval card", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    act(() => announceNotif());
    await settle(); await settle();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    await settle();
    expect(screen.getByRole("dialog", { name: "Cleanup approval" })).toBeTruthy();
    expect(screen.getByText("Delete temporary files?")).toBeTruthy();
  });
});

describe("island: typing focus for card text fields", () => {
  it("focusing Clipboard search holds typing_focus (so the click's focus hand-back doesn't kick the user out); blur and close release it", async () => {
    const spy = vi.spyOn(fakeBridge, "call");
    const typing = () => spy.mock.calls.filter((c) => c[0] === "typing_focus").map((c) => (c[1] as { on: boolean }).on);
    render(<Island monitor="m1" init={{ view: "clipboard" }} />);
    await settle(); await settle();
    const box = await screen.findByRole("textbox", { name: "Search clipboard" });
    expect(typing()).toEqual([]);
    act(() => box.focus());
    await settle();
    expect(typing()).toEqual([true]);
    act(() => box.blur());
    await settle();
    expect(typing()).toEqual([true, false]);
    act(() => box.focus());
    await settle();
    fireEvent.keyDown(document, { key: "Escape" }); // closes the card with the field focused
    await settle(); await settle();
    expect(typing()).toEqual([true, false, true, false]);
  });
});
