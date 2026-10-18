import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { ApprovalBump } from "../components/Plugin";
import { APPROVAL_LOW } from "../plugin.fixtures";

// R2-Y2: an approval button that appears under a stationary cursor swallows clicks until the cursor leaves and re-enters (and the layout settles for 600 ms)
let box = { left: 100, top: 0, width: 62, height: 26 };
const rect = () => ({ ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON: () => ({}) });
const answers = () => fakeBridge.log.filter((l) => l.cmd === "approval_answer");
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const move = (x: number, y = 10) => fireEvent(document, new PointerEvent("pointermove", { clientX: x, clientY: y, bubbles: true }));
const mouseClick = (el: Element) => fireEvent.click(el, { detail: 1 });
const allow = () => screen.getByRole("button", { name: "Allow" });

beforeEach(() => {
  box = { left: 100, top: 0, width: 62, height: 26 };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rect() as DOMRect);
  fakeBridge.reset();
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("approval button guard", () => {
  it("'Allow' appearing under the cursor: a mouse click is ignored even after 450 ms and 5 s; it works after leaving and re-entering", () => {
    move(130); // cursor is still, the button will land right under it
    render(<ApprovalBump a={APPROVAL_LOW} onDetail={() => undefined} />);
    advance(450);
    mouseClick(allow());
    advance(5000);
    mouseClick(allow());
    expect(answers()).toHaveLength(0);
    move(600); // left the button
    move(130); // re-entered
    mouseClick(allow());
    expect(answers()).toEqual([expect.objectContaining({ args: expect.objectContaining({ decision: "allow", surface: "protrusion" }) })]);
  });
  it("if the cursor is elsewhere only 600 ms is awaited", () => {
    move(600);
    render(<ApprovalBump a={APPROVAL_LOW} onDetail={() => undefined} />);
    advance(450);
    mouseClick(allow());
    expect(answers()).toHaveLength(0);
    advance(160);
    mouseClick(allow());
    expect(answers()).toHaveLength(1);
  });
  it("if the button moves the timer restarts; if it slides under a stationary cursor it waits again", () => {
    move(600);
    render(<ApprovalBump a={APPROVAL_LOW} onDetail={() => undefined} />);
    advance(1000);
    box = { ...box, left: 580 }; // the card spring moved the button under the cursor (cursor at 600)
    advance(40);
    mouseClick(allow());
    expect(answers()).toHaveLength(0); // layout just changed
    advance(2000);
    mouseClick(allow());
    expect(answers()).toHaveLength(0); // stayed under the cursor
    move(5); move(600);
    mouseClick(allow());
    expect(answers()).toHaveLength(1);
  });
  it("keyboard (Enter) is exempt from the cursor rule, only the 600 ms applies", () => {
    move(130);
    render(<ApprovalBump a={APPROVAL_LOW} onDetail={() => undefined} />);
    advance(400);
    fireEvent.click(allow()); // detail 0: keyboard
    expect(answers()).toHaveLength(0);
    advance(300);
    fireEvent.click(allow());
    expect(answers()).toHaveLength(1);
  });
  it("on high risk the peek has only Details", () => {
    render(<ApprovalBump a={{ ...APPROVAL_LOW, risk: "high" }} onDetail={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
    expect(screen.getByRole("button", { name: "Details" })).toBeTruthy();
  });
});
