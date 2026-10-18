import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { StripLine } from "../components/Fidelity";
import { Shell } from "../components/Shell";
import { sendX } from "../lib/xwin";
import { CONSENT } from "../plugin.fixtures";
import { announceLine } from "../lib/lineChan";
import { AMBER, lineOf, lineVars, MINT } from "../lib/line";
import { APPROVAL_LOW, PLUGINS, PROTRUSION } from "../plugin.fixtures";

const rectOf = (el: HTMLElement) => ({ left: 10, top: 5, width: parseFloat(el.style.width) || (el.dataset.hit !== undefined ? 100 : 0), height: parseFloat(el.style.height) || 30 }) as DOMRect;
const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return rectOf(this); });
  vi.useFakeTimers({ shouldAdvanceTime: false });
  fakeBridge.reset();
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
// fake timers: waiting does not depend on the real clock, same result under load
const settle = (ms = 120) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const disconnected = () => fakeBridge.setPlugins(PLUGINS.map((p) => (p.main ? { ...p, connected: false } : p)));

describe("Compass line rules", () => {
  it("orange wait on approval, mint listen on dictation, no line without Compass or while hidden, the rest faded gray", () => {
    const base = { assistantUp: true, hidden: false };
    expect(lineOf({ ...base, kind: "approval" })).toEqual({ color: AMBER, mod: "wait" });
    expect(lineOf({ ...base, kind: "approval-card" }).mod).toBe("wait");
    expect(lineOf({ ...base, kind: "plugin", mascot: "listening" })).toEqual({ color: MINT, mod: "listen" });
    expect(lineOf({ ...base, kind: "plugin", mascot: "thinking" })).toEqual({ color: AMBER, mod: "wait" });
    expect(lineOf({ ...base, kind: "plugin", mascot: "speaking" })).toEqual({ color: "#F2555A", mod: "speak" });
    expect(lineOf({ ...base, kind: "plugin" }).mod).toBe("idle");
    expect(lineOf({ ...base, kind: "rest" }).mod).toBe("idle");
    expect(lineOf({ ...base, kind: "rest", assistantUp: false }).mod).toBe("off");
    expect(lineOf({ ...base, kind: "rest", hidden: true }).mod).toBe("off");
    expect(lineOf({ ...base, kind: "noassistant" }).mod).toBe("off");
    expect(lineOf({ ...base, kind: "welcome" }).mod).toBe("off");
  });
  it("CSS variables are the mockup's numbers", () => {
    expect(lineVars({ color: MINT, mod: "listen" })).toMatchObject({ "--sh": .55, "--gl": .45, "--co": 1 });
    expect(lineVars({ color: "#8E8E93", mod: "idle" })).toMatchObject({ "--sh": .22, "--co": .32 });
    expect(lineVars({ color: "#8E8E93", mod: "off" })).toMatchObject({ "--co": 0 });
  });
  it("when the island announces a state the strip line takes color and mode", async () => {
    render(<StripLine />);
    announceLine({ color: AMBER, mod: "wait", gap: 0 });
    await settle(200);
    const el = document.getElementById("line")!;
    expect(el.dataset.mode).toBe("wait");
    expect(el.style.getPropertyValue("--lc")).toBe(AMBER);
  });
});

describe("island: new states", () => {
  it("dnd: quiet mascot, Do not disturb, approval count, end time", async () => {
    fakeBridge.setSurfaces({ approvals: [APPROVAL_LOW], approvalTop: null });
    fakeBridge.setStatus({ dnd: true, dndUntil: "until 6:00 PM" });
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(screen.getByText("Do not disturb")).toBeTruthy();
    expect(screen.getByText("1 approval")).toBeTruthy();
    expect(screen.getByText("until 6:00 PM")).toBeTruthy();
  });
  it("offline: sleeping mascot and Offline; also opens via the event", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(screen.queryByText("Offline")).toBeNull();
    await act(async () => { fakeBridge.emit("assistant_offline", true); });
    await settle();
    expect(screen.getByText("Offline")).toBeTruthy();
  });
  it("muted: Muted in the center, Off in the peek", async () => {
    render(<Island monitor="m1" init={{ view: null, pin: true, osd: { percent: 0, muted: true, device: null } }} />);
    await settle();
    expect(screen.getAllByText("Muted").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Muted").length).toBeGreaterThan(1);
  });
  it("when the island is hidden only an eye icon shows in the center; clicking the center brings it back", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await act(async () => { await fakeBridge.call("island_hide", { on: true }); });
    await settle(400);
    const c = screen.getByRole("button", { name: /Island hidden\. Press Ctrl\+Shift\+A to show it/ });
    expect(screen.queryByText("Compass ready")).toBeNull();
    fireEvent.click(c);
    await settle();
    expect(screen.getByText("Compass ready")).toBeTruthy();
  });
  it("task done: title and duration on the strip, at most 3 in the clock", async () => {
    render(<Island monitor="m1" init={{ view: null, pin: true }} />);
    await settle();
    for (const t of ["bir", "iki", "uc", "dort"]) await act(async () => { fakeBridge.emit("job_done", { title: t, took: "Took 4 min" }); });
    await settle();
    expect(screen.getByText("uc")).toBeTruthy();
    expect(screen.queryByText("dort")).toBeNull();
    expect(screen.getByText("Took 4 min")).toBeTruthy();
  });
  it("budget 80%: tired mascot, Details opens the System card; no Later", async () => {
    fakeBridge.pushAlert({ id: "q1", title: "Daily budget at 80%", subtitle: "Automatic jobs paused, your requests still run", icon: "tired", progress: 0.8, priority: 70 });
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(screen.getAllByText("Daily budget at 80%").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Later" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    await settle();
    expect(screen.getByRole("dialog", { name: /^Modules/ })).toBeTruthy();
  });
  it("alert u: primary button with the Task Manager action, Later beside it", async () => {
    fakeBridge.pushAlert({ id: "cpu", title: "Chrome is maxing out the CPU", subtitle: "100% for 30 s", icon: "attention", action: "task_manager", priority: 70 });
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(screen.getByRole("button", { name: "Open Task Manager" }).className).toContain("primary");
    expect(screen.getByRole("button", { name: "Later" })).toBeTruthy();
  });
});

describe("island: meeting, Compass not connected, shelf suggestion", () => {
  it("clicking the center of the meeting peek opens the meeting card: Join and upcoming events", async () => {
    fakeBridge.setSurfaces({ protrusion: PROTRUSION });
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    fireEvent.click(screen.getAllByRole("button").find((b) => b.className.includes("islandCenter"))!);
    await settle();
    const dlg = screen.getByRole("dialog", { name: /^Modules/ }); // Modules, on the Calendar tab
    expect(screen.getByRole("tab", { name: "Calendar" }).getAttribute("aria-selected")).toBe("true");
    expect(dlg.textContent).toContain("Weekly planning");
    expect(dlg.textContent).toContain("Assistant routine");
    expect(screen.getByRole("button", { name: "Join" })).toBeTruthy();
  });
  it("Compass-not-connected card: the white Launch Compass button calls assistant_start", async () => {
    disconnected();
    render(<Island monitor="m1" init={{ view: "noassistant" }} />);
    await settle();
    const b = screen.getByRole("button", { name: "Launch Compass" });
    expect(b.className).toContain("primary");
    fireEvent.click(b);
    await settle();
    expect(fakeBridge.log.some((l) => l.cmd === "assistant_start")).toBe(true);
  });
  it("clicking the center at rest while Compass is not connected opens the Compass-not-connected card", async () => {
    disconnected();
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Compass isn't connected. Open to launch it/ }));
    await settle();
    expect(screen.getByRole("dialog", { name: "Compass isn't connected" })).toBeTruthy();
  });
  it("shelf card: Compass suggestion for a PDF and three buttons; only Shelf in the center", async () => {
    fakeBridge.setShelf([{ id: "f1", name: "presentation-draft.pdf", sub: "2,4 MB", kind: "pdf" }, { id: "f2", name: "screen-recording.mp4", sub: "38 MB", kind: "video" }]);
    render(<Island monitor="m1" init={{ view: "shelf" }} />);
    await settle();
    expect(screen.getByText(/summarize it into Notes/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add to Notes/ }));
    await settle();
    expect(fakeBridge.log.some((l) => l.cmd === "shelf_memory")).toBe(true);
    expect(screen.queryByText("2 dosya")).toBeNull();
  });
});

describe("card states and bindings", () => {
  it("first connection: the firstconnect card opens, OK closes it and first_connect_ack fires", async () => {
    fakeBridge.setFirstConnect(true);
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const dlg = screen.getByRole("dialog", { name: "Compass connected" });
    expect(dlg).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent === "OK")!);
    await settle();
    expect(screen.queryByRole("dialog", { name: "Compass connected" })).toBeNull();
  });
  it("if Clipboard fails to load: error card: can't reach Claude Code, Try again", async () => {
    render(<Island monitor="m1" init={{ view: "clipboard", card: "kh" }} />);
    await settle();
    expect(screen.getByRole("dialog", { name: "Error" }).textContent).toContain("Can't reach Claude Code");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
  it("the loading card does not show before 800 ms", async () => {
    render(<Island monitor="m1" init={{ view: "clipboard" }} />);
    await settle(30);
    expect(screen.queryByRole("status", { name: "Reading clipboard" })).toBeNull();
  });
  it("when a plugin permission is pending: shield icon on the strip and Plugin permission; notification count in the d2 chat", async () => {
    fakeBridge.setConsent(CONSENT);
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(screen.getByText("Plugin permission")).toBeTruthy();
  });
  it("Quit in the strip menu opens Peeka's own confirmation question", async () => {
    render(<Shell monitor="m1" init={{ menu: { kind: "strip", x: 900 } }} />);
    await settle();
    fireEvent.click(screen.getByRole("menuitem", { name: "Quit" }));
    await settle(400);
    expect(screen.getByRole("dialog", { name: "Quit Peeka" }).getAttribute("aria-hidden")).toBe("false");
  });
  it("the gear on the island page (open-panel) opens Settings > Modules", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    act(() => sendX({ t: "open-panel", panel: "modules" }));
    await settle(300);
    expect(document.querySelector("[data-panel=settings]")!.getAttribute("aria-hidden")).toBe("false");
  });
});
