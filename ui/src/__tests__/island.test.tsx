import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { Shell } from "../components/Shell";

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
    await settle();
    const first = spy.mock.calls.filter((c) => c[0] === "report_hit_rects").length;
    expect(first).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Open card/ }));
    await settle();
    const calls = spy.mock.calls.filter((c) => c[0] === "report_hit_rects");
    expect(calls.length).toBeGreaterThan(first);
    const last = calls.at(-1)![1] as { page: string; rects: unknown[] };
    expect(last.page).toBe("island");
    expect(last.rects.length).toBeGreaterThanOrEqual(2); // the middle button + the shape box
    expect(last.rects.some((r) => (r as { paint?: boolean }).paint)).toBe(true); // shadow margin: the window region does not clip the card's shadow
  });
  it("no shadow rect is reported without a card, the button stays clickable", async () => {
    const spy = vi.spyOn(fakeBridge, "call");
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const rects = spy.mock.calls.filter((c) => c[0] === "report_hit_rects").at(-1)![1] as { rects: { paint?: boolean }[] };
    expect(rects.rects.some((r) => r.paint)).toBe(false);
    expect(rects.rects.length).toBeGreaterThanOrEqual(1);
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
  it("opens on clicking the clock, focus enters the card; Esc returns focus to the clock button", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    const clock = await screen.findByRole("button", { name: /Notifications$/ });
    clock.focus();
    fireEvent.click(clock);
    await settle();
    const dlg = screen.getByRole("dialog", { name: "Notifications" });
    expect(dlg.contains(document.activeElement)).toBe(true);
    expect(screen.getByText("Disk 91% full")).toBeTruthy();
    fireEvent.keyDown(dlg, { key: "Escape" });
    await settle();
    expect(document.activeElement).toBe(clock);
  });
  it("Review opens the approval card", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    fireEvent.click(await screen.findByRole("button", { name: /Notifications$/ }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    await settle();
    expect(screen.getByRole("dialog", { name: "Cleanup approval" })).toBeTruthy();
    expect(screen.getByText("Delete temporary files?")).toBeTruthy();
  });
});
