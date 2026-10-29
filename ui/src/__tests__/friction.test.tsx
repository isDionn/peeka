// Friction audit (Y1-Y4, O2-O4, O8, System history): leaving with the mouse, the single rule "a peek opens Modules on its own tab", a fixed tab bar.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
// @ts-expect-error node types are not installed; vitest runs on Node
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { SURFACES_J, COMPASS, APPROVAL_LOW } from "../plugin.fixtures";
import { Island } from "../components/Island";
import { FirstRunCard, MOD_NARROW, TimerStart } from "../components/IslandCards";
import { ComposerCard, resetComposerDraft } from "../components/Plugin";
import { onX, sendX } from "../lib/xwin";
import { resetMascotRegistry } from "../mascot/useSingleMascot";

const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset(); resetMascotRegistry(); resetComposerDraft(); localStorage.clear();
  vi.useFakeTimers(); // no real waiting: under CPU load real 80 ms waits stretched and the springs committed every real frame (5 s timeouts on CI)
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const settle = (ms = 80) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const pill = () => screen.getAllByRole("button").find((b) => b.className.includes("islandCenter"))!;
const TIMER = { label: "Tea", totalS: 300, remainingS: 200, running: true };

describe("Y1: with a peek showing, the island opens to Modules", () => {
  it("with an approval peek, clicking the center opens Modules; Esc returns to the peek", async () => {
    fakeBridge.setSurfaces({ approvals: [APPROVAL_LOW], approvalTop: APPROVAL_LOW.id });
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    fireEvent.click(pill());
    await settle();
    expect(screen.getByRole("dialog", { name: /^Modules/ })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("while the pointer is over it, an 'Open Modules' hint shows", async () => {
    fakeBridge.setSurfaces({ approvals: [APPROVAL_LOW], approvalTop: APPROVAL_LOW.id });
    render(<Island monitor="m1" init={{ view: null }} />);
    await act(async () => { vi.advanceTimersByTime(100); });
    fireEvent.pointerEnter(pill());
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(pill().getAttribute("title")).toBe("Open Modules");
  });
});

describe("Y2: every card has a visible way out", () => {
  it("× closes the card (no keyboard focus needed)", async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("clicking outside the card closes it; clicking inside does not", async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    fireEvent.pointerDown(screen.getByRole("tab", { name: "Clipboard" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("the Rust outside message closes it too; the card closes when a strip panel opens (panel-open)", async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    sendX({ t: "outside" });
    await settle(30);
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    sendX({ t: "panel-open", panel: "search" });
    await settle(30);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("a click on another app (notch://outside_press) closes the card; a click on the island's own window does not", async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    await act(async () => { fakeBridge.emit("notch://outside_press", "island"); });
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => { fakeBridge.emit("notch://outside_press", ""); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("on a card without a tab bar, the Modules button opens Modules on its own tab", async () => {
    render(<Island monitor="m1" init={{ view: "clipboard" }} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Modules" }));
    await settle();
    expect(screen.getByRole("tab", { name: "Clipboard" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("Y5: the island and a strip panel close each other", () => {
  it("clicking inside the island sends island-click", async () => {
    const got: string[] = [];
    const off = onX((m) => got.push(m.t));
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    fireEvent.pointerDown(pill());
    await settle(30);
    off();
    expect(got).toContain("island-click");
  });
});

describe("Y3: peeks open Modules on their own tab", () => {
  it("shelf drag peek -> Shelf tab", async () => {
    render(<Island monitor="m1" init={{ view: null, shelfDrag: true }} />);
    await settle();
    fireEvent.click(pill());
    await settle();
    expect(screen.getByRole("tab", { name: "Shelf" }).getAttribute("aria-selected")).toBe("true");
  });
  it("screenshot peek -> Clipboard tab", async () => {
    render(<Island monitor="m1" init={{ view: null, shot: true }} />);
    await settle();
    fireEvent.click(pill());
    await settle();
    expect(screen.getByRole("tab", { name: "Clipboard" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("Y4: the tab bar never shifts and is the same on every tab", () => {
  const css: string = readFileSync("src/components/cards.css", "utf8");
  it("every tab has the same width, General included (Places is drawn for 620)", () => {
    expect(MOD_NARROW).toBe(620);
  });
  it("the corner group has a fixed width (498) on the island center line, and × is always at the same screen point (independent of card width)", () => {
    expect(css).toMatch(/\.modTop \{[^}]*justify-content: flex-end;[^}]*width: 498px/);
    expect(css).toMatch(/\.cardBar \{[^}]*width: 498px/); // Modules and the card bar share the same corner group (R1-1)
    expect(css).toMatch(/\.modTop \.seg \{[^}]*flex: none;[^}]*max-width: 422px/);
    expect(css).not.toMatch(/\.modUst > \.mini \{[^}]*margin-left: auto/);
  });
  it("on every tab the button boxes, icon size and button count are the same; the bar is the same element", async () => {
    fakeBridge.setSurfaces(SURFACES_J);
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    const bar = () => screen.getByRole("tablist", { name: "Modules" });
    const el0 = bar();
    const snap = () => within(bar()).getAllByRole("tab").map((t) => [t.getAttribute("aria-label"), t.className.replace(" on", ""), t.querySelector("svg")?.getAttribute("class") ?? "", t.style.cssText]);
    const first = snap();
    for (const t of within(bar()).getAllByRole("tab")) {
      fireEvent.click(t);
      expect(snap()).toEqual(first);
      expect(bar()).toBe(el0);
    }
  });
});

describe("O2: a peek does not close while the pointer is over it", () => {
  it("the screenshot peek does not close while the pointer is over it and closes after it leaves", async () => {
    render(<Island monitor="m1" init={{ view: null, shot: true }} />);
    await act(async () => { vi.advanceTimersByTime(100); });
    fireEvent.pointerEnter(pill());
    await act(async () => { vi.advanceTimersByTime(300); });
    await act(async () => { vi.advanceTimersByTime(6000); });
    expect(pill().getAttribute("title")).toBe("Open Modules");
    fireEvent.pointerLeave(pill());
    await act(async () => { vi.advanceTimersByTime(300); });
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(pill().getAttribute("title")).toBeNull();
  });
});

describe("stuck hover: Rust's notch://island_leave clears hover (the click-through window never gets pointerleave)", () => {
  it("hover set by pointerenter is cleared by the event alone", async () => {
    fakeBridge.setSurfaces({ approvals: [APPROVAL_LOW], approvalTop: APPROVAL_LOW.id });
    render(<Island monitor="m1" init={{ view: null }} />);
    await act(async () => { vi.advanceTimersByTime(100); });
    fireEvent.pointerEnter(pill());
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(pill().getAttribute("title")).toBe("Open Modules");
    await act(async () => { fakeBridge.emit("notch://island_leave", null); });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(pill().getAttribute("title")).toBeNull();
  });
  it("a CPU peek held open by hover auto-closes after the event, with no pointerleave", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await act(async () => { vi.advanceTimersByTime(100); });
    await act(async () => { fakeBridge.emit("cpu_high", { app: "chrome" }); });
    fireEvent.pointerEnter(pill());
    await act(async () => { vi.advanceTimersByTime(300); });
    await act(async () => { vi.advanceTimersByTime(12_000); });
    expect(pill().textContent).toContain("using a lot of CPU");
    await act(async () => { fakeBridge.emit("notch://island_leave", null); });
    await act(async () => { vi.advanceTimersByTime(300); });
    await act(async () => { vi.advanceTimersByTime(10_500); });
    await act(async () => { vi.advanceTimersByTime(2000); }); // the close animation
    expect(pill().textContent).not.toContain("using a lot of CPU");
  });
});

describe("O3: timer", () => {
  it("clicking the peek opens the Timer tab; the running counter and controls are above the form", async () => {
    fakeBridge.setTimer(TIMER);
    fakeBridge.setMedia(null); // playing music takes precedence over the timer (side bubble decision 2026-10-17); here the timer is the only job
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    fireEvent.click(pill());
    await settle();
    expect(screen.getByRole("tab", { name: "Timer" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("Running timer").textContent).toContain("Tea");
    expect(screen.getAllByRole("button", { name: "Pause" }).length).toBeGreaterThan(0);
  });
  it("Start gives visible feedback", async () => {
    render(<TimerStart />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await settle(30);
    expect(screen.getByRole("button", { name: "Started" })).toBeTruthy();
  });
});

describe("O4: Ctrl+Space box", () => {
  const send = vi.fn();
  const owner = { ...COMPASS, voice: false };
  it("after sending, the box stays the same element, with focus and position preserved", () => {
    const view = render(<ComposerCard owner={owner} turns={[]} send={send} />);
    const inp = screen.getByRole("textbox") as HTMLInputElement;
    inp.focus();
    fireEvent.change(inp, { target: { value: "hello" } });
    fireEvent.keyDown(inp, { key: "Enter" });
    view.rerender(<ComposerCard owner={owner} turns={[{ id: 1, ask: "hello", answer: "", chips: [], state: "wait" }]} send={send} />);
    expect(screen.getByRole("textbox")).toBe(inp);
    expect(document.activeElement).toBe(inp);
    expect(inp.closest("[data-composer]")!.firstElementChild!.contains(inp)).toBe(true);
  });
  it("a written draft is not lost when closing and reopening; it is cleared when sent", () => {
    const a = render(<ComposerCard owner={owner} turns={[]} send={send} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "half written" } });
    a.unmount();
    render(<ComposerCard owner={owner} turns={[]} send={send} />);
    const inp = screen.getByRole("textbox") as HTMLInputElement;
    expect(inp.value).toBe("half written");
    fireEvent.keyDown(inp, { key: "Enter" });
    expect(inp.value).toBe("");
  });
});

describe("O8: first-run buttons stay in place", () => {
  it("Back, Skip and Next are in the same three slots on every page; a missing one is only hidden", () => {
    render(<FirstRunCard onDone={() => undefined} />);
    const row = () => [...document.querySelector(".frBtn")!.children] as HTMLElement[];
    expect(row().length).toBe(3);
    const go = () => fireEvent.click(screen.getByRole("button", { name: /Next|Start/ }));
    go();
    expect(row().length).toBe(3);
    go();
    expect(row().length).toBe(3);
    expect(row()[1].style.visibility).toBe("hidden");
    expect(row()[0].style.visibility).toBe("visible");
    expect(row()[2].textContent).toBe("Start");
  });
});

describe("System history", () => {
  it("16 bars; those without a sample are dim, the rest have heights", async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    fireEvent.click(screen.getByRole("tab", { name: "System" }));
    await settle(1200);
    expect(document.querySelectorAll(".spark i").length).toBe(16);
    expect(document.querySelectorAll(".spark i.empty").length).toBeLessThan(16);
    // a bar is the sample's percent, never taller than its box (72% once drew at 144%, over the CPU row)
    for (const i of document.querySelectorAll<HTMLElement>(".spark i")) expect(parseFloat(i.style.height)).toBeLessThanOrEqual(100);
  });
});

describe("General home: the empty-state line fits", () => {
  it("the Now box takes all but the 236 px glance column, so \"Nothing needs you\" isn't cut next to the reserved ghost spot (VM v0.3.4)", () => {
    expect(readFileSync("src/components/cards.css", "utf8")).toMatch(/\.genHome \{[^}]*grid-template-columns: minmax\(0, 1fr\) 236px;[^}]*"now music"/);
  });
});

describe("copy peek / Shelf handle: the hanging ghost stays whole", () => {
  it("the island center holding the 40 px hanging ghost sits above the bump (.dangling, z 7) (VM v0.3.4)", () => {
    const css = readFileSync("src/island.css", "utf8") + readFileSync("src/notch-extra.css", "utf8");
    expect(css).toMatch(/\.dangling \{ z-index: 7; \}/);
    expect(css).toMatch(/\.islandCenter:has\(\.mascot\[data-hang\]\) \{ z-index: 8; \}/);
  });
});
