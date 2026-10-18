import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_SECRET, fakeBridge } from "../bridge.fake";
import { ClipboardView } from "../components/Pano";

// Decision 2026-10-17: a password row is shown blurred and the blur lifts on hover/focus.
// Security: while hovering, the real password is not in the DOM (a fixed blurred placeholder); it is wiped instantly on leave; 5 s at most; never revealed while locked or presenting.
const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const row = () => document.querySelector<HTMLElement>('[data-clip="c6"]')!;
const reveals = () => fakeBridge.log.filter((l) => l.cmd === "clip_reveal").length;
const hover = () => act(async () => { fireEvent.pointerEnter(row()); });
const leave = () => act(async () => { fireEvent.pointerLeave(row()); });
const mount = async () => { render(<ClipboardView />); await screen.findByText("screen-recording.mp4"); };

describe("password row: blurred, revealed on hover", () => {
  it("while not hovering the plain text is not in the DOM; a blurred placeholder is (same box, fixed length)", async () => {
    await mount();
    expect(row().className).toContain("hidden");
    expect(row().className).not.toContain("shown");
    expect(document.body.innerHTML).not.toContain(FAKE_SECRET);
    expect(row().querySelector(".text")!.textContent).toMatch(/^\S{10,}$/);
    expect(reveals()).toBe(0);
  });
  it("reveals on hover (one enter = one call, pointermove does not call); wipes instantly on leave", async () => {
    await mount();
    await hover();
    expect(row().textContent).toContain(FAKE_SECRET);
    expect(row().className).toContain("shown");
    for (let i = 0; i < 10; i++) fireEvent.pointerMove(row());
    expect(reveals()).toBe(1);
    await leave();
    expect(document.body.innerHTML).not.toContain(FAKE_SECRET);
    expect(row().className).not.toContain("shown");
    await hover(); // re-entering = a new call; nothing stays cached
    expect(reveals()).toBe(2);
    expect(row().textContent).toContain(FAKE_SECRET);
  });
  it("at most 5 s even if the cursor stays; afterwards the eye button shows it again", async () => {
    await mount();
    vi.useFakeTimers();
    await hover();
    await act(async () => { vi.advanceTimersByTime(4900); });
    expect(row().textContent).toContain(FAKE_SECRET);
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(document.body.innerHTML).not.toContain(FAKE_SECRET);
    await act(async () => { fireEvent.click(row().querySelector('button[aria-label="Show briefly"]')!); });
    expect(row().textContent).toContain(FAKE_SECRET);
  });
  it("keyboard focus (kb mode) reveals; wipes when focus leaves; mouse focus does not reveal", async () => {
    await mount();
    fireEvent.focus(row());
    await settle();
    expect(reveals()).toBe(0); // no data-kb: a mouse click gave the focus
    document.documentElement.setAttribute("data-kb", "");
    await act(async () => { fireEvent.focus(row()); });
    expect(row().textContent).toContain(FAKE_SECRET);
    await act(async () => { fireEvent.blur(row(), { relatedTarget: document.body }); });
    expect(document.body.innerHTML).not.toContain(FAKE_SECRET);
    document.documentElement.removeAttribute("data-kb");
  });
  it("when the lock arrives the text is wiped and the row goes away; while locked Rust refuses", async () => {
    await mount();
    await hover();
    expect(row().textContent).toContain(FAKE_SECRET);
    await act(async () => { fakeBridge.setLocked(true); });
    expect(document.body.innerHTML).not.toContain(FAKE_SECRET);
    expect(row()).toBeNull();
    await expect(fakeBridge.call("clip_reveal", { id: "c6" })).rejects.toBe("denied");
  });
  it("in presentation mode hovering and the eye button reveal nothing", async () => {
    await mount();
    await act(async () => { fakeBridge.emit("input_tick", { lastInputAgoMs: 0, cursor: null, presentation: true }); });
    await hover();
    expect(reveals()).toBe(0);
    expect(document.body.innerHTML).not.toContain(FAKE_SECRET);
    await act(async () => { fireEvent.click(row().querySelector('button[aria-label="Show briefly"]')!); });
    expect(reveals()).toBe(0);
    expect(document.body.innerHTML).not.toContain(FAKE_SECRET);
  });
});
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });
