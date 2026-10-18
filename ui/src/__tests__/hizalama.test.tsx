// Pusula çizgisi duvar saati evresi ve pencereler arası Tab sırası (sekmeler -> ada -> sağ grup).
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

describe("çizgi evresi", () => {
  it("negatif gecikme = duvar saati mod dönem; iki pencere aynı anda aynı değeri hesaplar", () => {
    expect(phaseDelay(2200, 1_000_000_000_000 + 500)).toBe(`-${(1_000_000_000_500 % 2200) / 1000}s`);
    expect(phaseDelay(9000, 18_000)).toBe("-0s");
    expect(phaseDelay(1150, 1150 * 7 + 300)).toBe("-0.3s");
    expect(phaseDelay(2400, 123456)).toBe(phaseDelay(2400, 123456));
  });
  it("lineVars gecikmeleri verir ve kip aynıyken sabit tutar", () => {
    const a = lineVars({ color: "#fff", mod: "dinle" }) as Record<string, string>;
    expect(a["--ad"]).toMatch(/^-\d+(\.\d+)?s$/);
    const b = lineVars({ color: "#000", mod: "dinle" }) as Record<string, string>;
    expect([b["--ad"], b["--sd"], b["--bd"]]).toEqual([a["--ad"], a["--sd"], a["--bd"]]);
  });
});

describe("Tab pencereler arası", () => {
  it("şeritte son sol denetimden Tab adaya gider; sağ grubun ilkinden Shift+Tab adanın sonuna", async () => {
    const got: XMsg[] = [];
    const off = onX((m) => got.push(m));
    render(<Shell monitor="m1" />);
    await settle(150);
    const { left, right } = stripSides(document.querySelector("header.cubuk")!);
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    left[left.length - 1].focus();
    fireEvent.keyDown(left[left.length - 1], { key: "Tab" });
    right[0].focus();
    fireEvent.keyDown(right[0], { key: "Tab", shiftKey: true });
    left[0].focus();
    fireEvent.keyDown(left[0], { key: "Tab" }); // ortadaki denetim değil: aktarım yok
    await settle();
    off();
    expect(got.filter((m) => m.t === "to-island")).toEqual([{ t: "to-island" }, { t: "to-island", end: true }]);
  });

  it("adada Tab sondan şeridin sağ grubuna, Shift+Tab baştan sol gruba; to-island odağı adaya verir", async () => {
    const got: XMsg[] = [];
    const off = onX((m) => got.push(m));
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const merkez = document.querySelector<HTMLElement>("button.adaMerkez")!;
    sendX({ t: "to-island" });
    await settle();
    expect(document.activeElement).toBe(merkez);
    fireEvent.keyDown(merkez, { key: "Tab" });
    fireEvent.keyDown(merkez, { key: "Tab", shiftKey: true });
    await settle();
    off();
    expect(got.filter((m) => m.t === "to-strip")).toEqual([{ t: "to-strip", side: "right" }, { t: "to-strip", side: "left" }]);
  });

  it("to-strip şeritte odağı sağ grubun ilkine / sol grubun sonuna koyar", async () => {
    render(<Shell monitor="m1" />);
    await settle(150);
    const { left, right } = stripSides(document.querySelector("header.cubuk")!);
    sendX({ t: "to-strip", side: "right" });
    await settle();
    expect(document.activeElement).toBe(right[0]);
    sendX({ t: "to-strip", side: "left" });
    await settle();
    expect(document.activeElement).toBe(left[left.length - 1]);
    expect(screen.getByRole("banner", { hidden: true })).toBeTruthy();
  });
});

describe("OS odağı ve yönetici pencere", () => {
  it("OS odağı reddedilirse (odak Peeka'da değil) pencereler arası aktarım olmaz; kabul edilirse olur", async () => {
    const got: XMsg[] = [];
    const off = onX((m) => got.push(m));
    render(<Island monitor="m2" init={{ view: null }} />);
    await settle();
    const merkez = document.querySelector<HTMLElement>("button.adaMerkez")!;
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

  it("yönetici pencerede ve kapatma 'denied' dönünce menü Görev Yöneticisi'ni önerir", async () => {
    const w = { appId: "x", name: "X", icon: "", hwnd: 5, title: "t", active: true, monitor: "m1", elevated: true };
    render(<ContextMenu menu={{ kind: "app", appId: "x", x: 10 }} pins={[]} windows={[w]} onClose={() => undefined} onPins={() => undefined} onSettings={() => undefined} />);
    fireEvent.click(screen.getByRole("menuitem", { name: /Görev Yöneticisi/ }));
    await settle();
    expect(fakeBridge.log.some((l) => l.cmd === "open_task_manager")).toBe(true);
  });
});
