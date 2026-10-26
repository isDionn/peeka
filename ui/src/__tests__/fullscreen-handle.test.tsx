// @ts-expect-error node types are not installed; vitest runs on Node
import { readFileSync } from "node:fs";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { collectHitRects } from "../lib/hitRects";
import { APPROVAL_HIGH } from "../plugin.fixtures";

// A fullscreen app on the island's screen (Rust `notch://fullscreen`): only a small top handle; hovering it opens the card, leaving folds it back.
const style = Object.assign(document.createElement("style"), { textContent: readFileSync("src/island.css", "utf8") });
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return { left: 0, top: 0, width: 40, height: 8 } as DOMRect; });
  fakeBridge.reset();
  localStorage.clear();
  document.head.appendChild(style);
});
afterEach(() => { vi.restoreAllMocks(); style.remove(); });
const settle = (ms = 80) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const handle = (c: HTMLElement) => c.querySelector<HTMLElement>(".fsHandle");

describe("island over a fullscreen app", () => {
  it("folds to the handle, the only clickable rect; hover opens the card, leaving folds it back; fullscreen off brings the island back", async () => {
    const a = render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(handle(a.container)).toBeNull();
    act(() => fakeBridge.emit("notch://fullscreen", true));
    await settle();
    const h = handle(a.container)!;
    expect(h).toBeTruthy();
    expect(collectHitRects()).toHaveLength(1); // the island's centre, mascot and hover footprint are folded away
    fireEvent.pointerEnter(h);
    await settle(200);
    expect(handle(a.container)).toBeNull();
    expect(a.container.querySelector(".islandCenter")?.getAttribute("aria-expanded")).toBe("true"); // the card is open
    expect(a.container.querySelector(".fsBand")).toBeTruthy(); // with its own band where the strip used to be
    act(() => fakeBridge.emit("notch://island_leave", undefined as never));
    await settle(300);
    expect(handle(a.container)).toBeTruthy();
    act(() => fakeBridge.emit("notch://fullscreen", false));
    await settle();
    expect(handle(a.container)).toBeNull();
    expect(a.container.querySelector(".fsBand")).toBeNull();
  });

  it("a quick pass over the handle opens nothing", async () => {
    const a = render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.emit("notch://fullscreen", true));
    await settle();
    const h = handle(a.container)!;
    fireEvent.pointerEnter(h);
    fireEvent.pointerLeave(h);
    await settle(300);
    expect(handle(a.container)).toBeTruthy();
  });

  it("an approval still peeks over the fullscreen app (no handle while it waits)", async () => {
    const a = render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.emit("notch://fullscreen", true));
    act(() => fakeBridge.setSurfaces({ approvals: [APPROVAL_HIGH], approvalTop: APPROVAL_HIGH.id }));
    await settle();
    expect(handle(a.container)).toBeNull();
    expect(a.container.querySelector(".fsBand")).toBeTruthy();
  });
});
