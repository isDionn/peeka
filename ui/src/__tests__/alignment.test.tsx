// Compass line wall-clock phase and the cross-window Tab order (tabs -> island -> right group).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { ContextMenu } from "../components/Menus";
import { Island } from "../components/Island";
import { Shell } from "../components/Shell";
import { lineVars, phaseDelay } from "../lib/line";
import { onX, sendX, stripSides, type XMsg } from "../lib/xwin";

const proto = HTMLElement.prototype;
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset();
});
afterEach(() => { cleanup(); Reflect.deleteProperty(proto, "offsetHeight"); Reflect.deleteProperty(proto, "offsetWidth"); });
const settle = (ms = 60) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe("line phase", () => {
  it("negative delay = wall clock mod period; two windows compute the same value at the same time", () => {
    expect(phaseDelay(2200, 1_000_000_000_000 + 500)).toBe(`-${(1_000_000_000_500 % 2200) / 1000}s`);
    expect(phaseDelay(9000, 18_000)).toBe("-0s");
    expect(phaseDelay(1150, 1150 * 7 + 300)).toBe("-0.3s");
    expect(phaseDelay(2400, 123456)).toBe(phaseDelay(2400, 123456));
  });
  it("lineVars returns the delays and keeps them constant while the mode is unchanged", () => {
    const a = lineVars({ color: "#fff", mod: "listen" }) as Record<string, string>;
    expect(a["--flowDelay"]).toMatch(/^-\d+(\.\d+)?s$/);
    const b = lineVars({ color: "#000", mod: "listen" }) as Record<string, string>;
    expect([b["--flowDelay"], b["--sd"], b["--bd"]]).toEqual([a["--flowDelay"], a["--sd"], a["--bd"]]);
  });
});

describe("Tab across windows", () => {
  it("on the strip Tab from the last left control goes to the island; Shift+Tab from the first of the right group goes to the end of the island", async () => {
    const got: XMsg[] = [];
    const off = onX((m) => got.push(m));
    render(<Shell monitor="m1" />);
    await settle(150);
    const { left, right } = stripSides(document.querySelector("header.bar")!);
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    left[left.length - 1].focus();
    fireEvent.keyDown(left[left.length - 1], { key: "Tab" });
    right[0].focus();
    fireEvent.keyDown(right[0], { key: "Tab", shiftKey: true });
    left[0].focus();
    fireEvent.keyDown(left[0], { key: "Tab" }); // not the middle control: no handoff
    await settle();
    off();
    expect(got.filter((m) => m.t === "to-island")).toEqual([{ t: "to-island" }, { t: "to-island", end: true }]);
  });

  it("on the island Tab from the end goes to the strip's right group, Shift+Tab from the start to the left group; to-island gives the island focus", async () => {
    const got: XMsg[] = [];
    const off = onX((m) => got.push(m));
    fakeBridge.setMedia(null); // with music playing, keyboard focus on the island shows the controls and Tab walks into them first
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const merkez = document.querySelector<HTMLElement>("button.islandCenter")!;
    sendX({ t: "to-island" });
    await settle();
    expect(document.activeElement).toBe(merkez);
    fireEvent.keyDown(merkez, { key: "Tab" });
    fireEvent.keyDown(merkez, { key: "Tab", shiftKey: true });
    await settle();
    off();
    expect(got.filter((m) => m.t === "to-strip")).toEqual([{ t: "to-strip", side: "right" }, { t: "to-strip", side: "left" }]);
  });

  it("to-strip puts focus on the first of the right group / the end of the left group on the strip", async () => {
    render(<Shell monitor="m1" />);
    await settle(150);
    const { left, right } = stripSides(document.querySelector("header.bar")!);
    sendX({ t: "to-strip", side: "right" });
    await settle();
    expect(document.activeElement).toBe(right[0]);
    sendX({ t: "to-strip", side: "left" });
    await settle();
    expect(document.activeElement).toBe(left[left.length - 1]);
    expect(screen.getByRole("banner", { hidden: true })).toBeTruthy();
  });
});

describe("OS focus and the admin window", () => {
  it("if OS focus is refused (focus is not in Peeka) there is no cross-window handoff; if accepted there is", async () => {
    const got: XMsg[] = [];
    const off = onX((m) => got.push(m));
    fakeBridge.setMedia(null); // no music: the center is the island's last stop (music controls would follow it under keyboard focus)
    render(<Island monitor="m2" init={{ view: null }} />);
    await settle();
    const merkez = document.querySelector<HTMLElement>("button.islandCenter")!;
    merkez.focus();
    const call = fakeBridge.call;
    fakeBridge.call = ((c: string, ...a: unknown[]) => (c === "focus_strip" ? Promise.reject("refused") : (call as (...x: unknown[]) => unknown)(c, ...a))) as typeof call;
    fireEvent.keyDown(merkez, { key: "Tab" });
    await settle();
    expect(got.filter((m) => m.t === "to-strip")).toEqual([]);
    fakeBridge.call = call;
    fireEvent.keyDown(merkez, { key: "Tab" });
    await settle();
    off();
    expect(fakeBridge.log.filter((l) => l.cmd === "focus_strip").map((l) => l.args)).toContainEqual({ monitor: "m2" });
    expect(got.filter((m) => m.t === "to-strip")).toEqual([{ t: "to-strip", side: "right" }]);
  });

  it("in an admin window, when close returns 'denied', the menu suggests Task Manager", async () => {
    const w = { appId: "x", name: "X", icon: "", hwnd: 5, title: "t", active: true, monitor: "m1", elevated: true };
    render(<ContextMenu menu={{ kind: "app", appId: "x", x: 10 }} pins={[]} windows={[w]} onClose={() => undefined} onPins={() => undefined} />);
    fireEvent.click(screen.getByRole("menuitem", { name: /Task Manager/ }));
    await settle();
    expect(fakeBridge.log.some((l) => l.cmd === "open_task_manager")).toBe(true);
  });
});
