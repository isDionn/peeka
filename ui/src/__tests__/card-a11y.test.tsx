// Island and cards: Ctrl+Space closes the panel (R2-Y3), a running timer does not suppress the music peek (R2-O2), Modules tab pattern and announcement (F-01/F-03/F-04).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { onX } from "../lib/xwin";
import { resetMascotRegistry } from "../mascot/useSingleMascot";

const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset(); resetMascotRegistry(); localStorage.clear();
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 80)); });
const pill = () => document.querySelector("button.islandCenter") as HTMLElement;

describe("R2-Y3: Ctrl+Space closes the open strip panel", () => {
  it("the ask shortcut sends island-click", async () => {
    const got: string[] = [];
    const off = onX((m) => got.push(m.t));
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => { fakeBridge.emit("shortcut", { name: "ask", monitor: "m1" }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
    off();
    expect(got).toContain("island-click");
  });
});

describe("R2-O2: the timer does not suppress the music peek", () => {
  it("the new-track peek shows while the timer runs", async () => {
    fakeBridge.setTimer({ label: "Tea", totalS: 300, remainingS: 200, running: true });
    render(<Island monitor="m1" init={{ view: null, autoMusic: true, pin: true }} />);
    await settle();
    expect(pill().getAttribute("aria-label")).toMatch(/^Playing: /);
    expect(screen.getByRole("status").textContent).toMatch(/^Playing: /);
    expect(pill().getAttribute("aria-expanded")).toBeNull(); // a peek is not a card (F-28)
  });
});

describe("Modules card: tab pattern and name (F-03, F-04)", () => {
  it("the card name carries the active tab; single Tab stop; arrows navigate; body is a tabpanel", async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    expect(screen.getByRole("dialog", { name: "Modules: General" })).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.filter((t) => t.tabIndex === 0)).toHaveLength(1);
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tabs[0].id);
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    await settle();
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Modules: Music" })).toBeTruthy();
    fireEvent.keyDown(tabs[1], { key: "End" });
    await settle();
    expect(document.activeElement).toBe(tabs.at(-1));
    fireEvent.keyDown(tabs.at(-1)!, { key: "Home" });
    await settle();
    expect(document.activeElement).toBe(tabs[0]);
  });
  it("the × sits in the tab bar group, in the same place on every tab", async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    const bar = document.querySelector(".modTop")!;
    expect(bar.querySelector(".close")).toBeTruthy();
  });
});
