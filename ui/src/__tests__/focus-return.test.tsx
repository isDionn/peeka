// Real window, round 2: after a click the strip/island hands focus back to the previous app. A blur right after the
// click does not close the panel; a blur without a click (Alt+Tab, Win+L) still closes it. When a text field in an
// open panel gets focus, the strip holds focus (typing_focus) and releases it when focus leaves.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Shell } from "../components/Shell";
import { isTextEntry } from "../lib/justPressed";

beforeEach(() => fakeBridge.reset());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const settle = (ms = 60) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const open = () => document.querySelector("[data-panel=status]")?.getAttribute("aria-hidden") === "false";
const typing = () => fakeBridge.log.filter((l) => l.cmd === "typing_focus").map((l) => (l.args as { on: boolean }).on);

describe("strip when focus is handed back", () => {
  it("a blur right after a click leaves the panel open, a blur without a click closes it", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    const t0 = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(t0);
    const btn = document.querySelector('[data-panel-trigger="status"]')!;
    fireEvent.pointerUp(btn);
    fireEvent.click(btn);
    await settle();
    expect(open()).toBe(true);
    now.mockReturnValue(t0 + 300); // the hand-back happens ~300 ms after the click
    act(() => { window.dispatchEvent(new Event("blur")); });
    await settle();
    expect(open()).toBe(true);
    now.mockReturnValue(t0 + 5000); // Alt+Tab: the last click is old
    act(() => { window.dispatchEvent(new Event("blur")); });
    await settle();
    expect(open()).toBe(false);
  });

  it("a blur while the press is still held (Start's search box hands focus back on pointerdown) keeps the panel; the click then toggles it", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    const btn = document.querySelector('[data-panel-trigger="status"]')!;
    fireEvent.pointerUp(btn);
    fireEvent.click(btn);
    await settle();
    const t0 = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(t0 + 5000); // the opening click is old
    fireEvent.pointerDown(btn);
    act(() => { window.dispatchEvent(new Event("blur")); });
    await settle();
    expect(open()).toBe(true);
    fireEvent.pointerUp(btn);
    fireEvent.click(btn);
    await settle();
    expect(open()).toBe(false);
    now.mockRestore();
  });

  it("a text field in an open panel holds focus and releases it on exit; a slider does not count", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    fireEvent.click(document.querySelector('[data-panel-trigger="status"]')!);
    await settle();
    const box = document.createElement("input");
    document.querySelector("[data-panel=status]")!.appendChild(box);
    act(() => box.focus());
    await settle();
    expect(typing()).toEqual([true]);
    act(() => box.blur());
    await settle();
    expect(typing()).toEqual([true, false]);
    const range = Object.assign(document.createElement("input"), { type: "range" });
    expect([isTextEntry(box), isTextEntry(range), isTextEntry(document.createElement("textarea"))]).toEqual([true, false, true]);
  });
});
