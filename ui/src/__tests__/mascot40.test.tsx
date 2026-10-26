import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { ApprovalCard, TabBlocks } from "../components/Plugin";
import { collectHitRects } from "../lib/hitRects";
import { resetMascotRegistry } from "../mascot/useSingleMascot";
import { APPROVAL_HIGH, APPROVAL_LOW, COMPASS } from "../plugin.fixtures";

const proto = HTMLElement.prototype;
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset();
});
afterEach(() => { cleanup(); resetMascotRegistry(); vi.useRealTimers(); vi.restoreAllMocks(); });
const settle = (ms = 80) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const answers = () => fakeBridge.log.filter((l) => l.cmd === "approval_answer").map((l) => l.args as { decision: string });
const tab = { plugin: COMPASS, id: "cc", title: "Claude Code", blocks: [{ type: "list" as const, rows: [{ title: "project", state: "running", session: "s-1" }, { title: "Old", session: "none" }, { title: "Plain" }] }] };

describe("strip mascot 40 px", () => {
  it("40 px hanging pose, clicking opens the composer; hovering shows the counts in the bubble", async () => {
    fakeBridge.setSurfaces({ composer: { ...COMPASS, voice: true } });
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const m = document.querySelector<HTMLElement>(".islandCenter .mascot")!;
    expect(m.dataset.size).toBe("40");
    const hit = m.querySelector<HTMLElement>(".mascot-hit")!;
    fireEvent.pointerOver(hit);
    await settle();
    expect(document.querySelector(".mkBubble")!.textContent).toBe("2 running · 1 awaiting approval");
    fireEvent.pointerLeave(document.querySelector(".islandCenter")!);
    expect(document.querySelector(".mkBubble")).toBeNull();
    fireEvent.pointerDown(hit);
    fireEvent.click(hit);
    await waitFor(() => expect(document.querySelector("[data-composer]")).not.toBeNull()); // the composer, not Modules (slow CI runners need more than 200 ms)
  });
  it("F7: dragging the mascot onto a window opens the composer with that window attached; a cancelled drag opens nothing", async () => {
    fakeBridge.setSurfaces({ composer: { ...COMPASS, voice: true } });
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const hit = () => document.querySelector<HTMLElement>(".mascot-hit")!;
    fakeBridge.setWindowPick([]);
    fireEvent.pointerDown(hit());
    fireEvent.click(hit()); // the drag's release
    await settle(250);
    expect(document.querySelector("[data-composer]")).toBeNull();
    fakeBridge.setWindowPick([{ kind: "window_info", label: "Window: Notepad" }, { kind: "screen_image", label: "Screenshot" }]);
    fireEvent.pointerDown(hit());
    await settle(250);
    expect(document.querySelector("[data-composer]")).not.toBeNull();
    const added = Array.from(document.querySelectorAll(".chip.added")).map((c) => c.textContent);
    expect(added).toEqual(["Window: Notepad", "Screenshot"]);
    expect(fakeBridge.log.filter((l) => l.cmd === "window_pick")).toHaveLength(2);
  });
  it("the mascot's clickable rectangle is included in the reported boxes", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const hit = document.querySelector<HTMLElement>(".mascot-hit")!;
    vi.spyOn(hit, "getBoundingClientRect").mockReturnValue({ left: 10, top: 5, width: 30, height: 37, right: 40, bottom: 42, x: 10, y: 5, toJSON: () => ({}) });
    expect(collectHitRects()).toContainEqual({ x: 10, y: 5, w: 30, h: 37 });
  });
  it("demo: Demo badge; a command that returns unsupported says 'Not available in demo mode'", async () => {
    await fakeBridge.call("set_settings", { patch: { demo: true } });
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(screen.getByText("Demo")).toBeTruthy();
    const { bridge } = await import("../bridge");
    await bridge.call("cc_focus_terminal", { sessionId: "s-1" }).catch(() => undefined);
    await settle(20);
    expect(screen.getByText("Not available in demo mode")).toBeTruthy();
  });
});

describe("Open terminal", () => {
  it("button only on rows that have a session field; the error is written out", async () => {
    render(<TabBlocks tab={tab} />);
    expect(screen.getAllByRole("button", { name: "Open terminal" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Open terminal" })[0]);
    await settle(20);
    expect(fakeBridge.log.at(-1)).toMatchObject({ cmd: "cc_focus_terminal", args: { sessionId: "s-1" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Open terminal" })[1]);
    await settle(20);
    expect(screen.getByText("This session is gone")).toBeTruthy();
  });
});

describe("approval card N / Y", () => {
  it("N and Y are ignored before 600 ms; afterwards N denies, Y allows", () => {
    vi.useFakeTimers();
    render(<ApprovalCard a={APPROVAL_LOW} />);
    fireEvent.keyDown(document, { key: "y" });
    advance(300);
    fireEvent.keyDown(document, { key: "n" });
    expect(answers()).toHaveLength(0);
    advance(400);
    fireEvent.keyDown(document, { key: "N" });
    expect(answers()).toEqual([expect.objectContaining({ decision: "deny" })]);
    fireEvent.keyDown(document, { key: "y" });
    expect(answers().at(-1)).toMatchObject({ decision: "allow" });
  });
  it("on high risk Y does not allow, focus goes to the press-and-hold button; N denies", () => {
    vi.useFakeTimers();
    render(<ApprovalCard a={APPROVAL_HIGH} />);
    advance(700);
    fireEvent.keyDown(document, { key: "y" });
    expect(answers()).toHaveLength(0);
    expect(document.activeElement?.textContent).toContain("Allow");
    fireEvent.keyDown(document, { key: "n" });
    expect(answers()).toEqual([expect.objectContaining({ decision: "deny" })]);
  });
});

describe("window region: every ghost's full drawn box", () => {
  const box = (el: Element, left: number, top: number, width: number, height: number) =>
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
  it("a hanging ghost adds its drawn box (with room for sway and effects) as paint and its body as hit; a fading or leaving one paints only", () => {
    document.body.innerHTML = `<div class="mascot" id="a"><div class="g"></div><div class="mascot-hit"></div></div>
      <div data-leaving><div class="mascot" id="b"><div class="g"></div><div class="mascot-hit"></div></div></div>
      <div class="mascot out" id="c"><div class="g"></div><div class="mascot-hit"></div></div>
      <div style="visibility:hidden"><div class="mascot" id="d"><div class="g"></div><div class="mascot-hit"></div></div></div>`; // a closed strip panel's ghost: nothing
    for (const id of ["a", "b", "c", "d"]) { box(document.querySelector(`#${id} .g`)!, 100, -3.5, 40, 53); box(document.querySelector(`#${id} .mascot-hit`)!, 105, 5, 30, 37); }
    const rects = collectHitRects();
    expect(rects.filter((r) => r.paint)).toHaveLength(3);
    const paint = rects.find((r) => r.paint)!;
    expect(paint.x <= 100 && paint.y <= -3 && paint.x + paint.w >= 140 && paint.y + paint.h >= 50).toBe(true); // covers the whole ghost, hanging part included
    expect(rects.filter((r) => !r.paint)).toEqual([{ x: 105, y: 5, w: 30, h: 37 }]); // only the live ghost takes clicks
    document.body.innerHTML = "";
  });
});

describe("one mascot on screen: the strip ghost hides only for another visible ghost", () => {
  const ghost = () => document.querySelector(".islandCenter .mascot:not(.out)");
  it("Status (and Start) keep the strip ghost; the empty Notifications board's ghost makes it step aside", async () => {
    const { sendX } = await import("../lib/xwin");
    fakeBridge.setPlugins([]); // the clock rest: the owner's setup
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle(300);
    expect(ghost()).not.toBeNull();
    sendX({ t: "panel-open", panel: "status" }); sendX({ t: "panel", panel: "status" });
    await settle(400);
    expect(ghost()).not.toBeNull();
    sendX({ t: "panel", panel: "notif" }); sendX({ t: "ghost", on: false }); // Notifications with items: no other ghost
    await settle(400);
    expect(ghost()).not.toBeNull();
    sendX({ t: "ghost", on: true }); // the empty board's 96 px ghost is on screen
    await settle(400);
    expect(ghost()).toBeNull();
    sendX({ t: "panel", panel: null }); sendX({ t: "ghost", on: false });
    await settle(400);
    expect(ghost()).not.toBeNull();
  });
});
