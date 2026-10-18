// A file dragged over a strip or the island: `shelf_drag` opens the Shelf bump; "off" is held briefly so moving from
// the strip onto the island (leave, then enter) never blinks it, and dragging away still closes it.
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { SHELF_DRAG_HOLD_MS, useShelfDrag } from "../hooks";

const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
beforeEach(() => fakeBridge.reset());
afterEach(cleanup);

describe("useShelfDrag", () => {
  it("opens on enter, survives a strip-to-island hop, closes after leaving", async () => {
    const { result } = renderHook(() => useShelfDrag());
    await wait(0);
    expect(result.current).toBe(false);
    act(() => fakeBridge.emit("shelf_drag", true));
    expect(result.current).toBe(true);
    act(() => { fakeBridge.emit("shelf_drag", false); fakeBridge.emit("shelf_drag", true); });
    await wait(SHELF_DRAG_HOLD_MS + 30);
    expect(result.current).toBe(true);
    act(() => fakeBridge.emit("shelf_drag", false));
    expect(result.current).toBe(true);
    await wait(SHELF_DRAG_HOLD_MS + 30);
    expect(result.current).toBe(false);
  });
});
