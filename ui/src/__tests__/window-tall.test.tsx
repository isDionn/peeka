// A strip or the island window is short while nothing hangs below the bar: it grows before a panel renders and shrinks only after
// everything below has stopped painting (a closing panel's spring).
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { STRIP_IDLE_HEIGHT, useWindowTall } from "../lib/windowTall";

beforeEach(() => fakeBridge.reset());
const asked = () => fakeBridge.log.filter((l) => l.cmd === "window_tall").map((l) => (l.args as { tall: boolean }).tall);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("strip window height", () => {
  it("grows before what hangs renders, shrinks after it stopped painting", async () => {
    const { result, rerender } = renderHook(({ want, hang }) => useWindowTall(want, hang, STRIP_IDLE_HEIGHT, true), { initialProps: { want: false, hang: false } });
    expect(result.current).toBe(false);
    rerender({ want: true, hang: false });
    expect(result.current).toBe(false); // not before Rust has answered
    await settle();
    expect(result.current).toBe(true);
    expect(asked()).toEqual([true]);
    rerender({ want: false, hang: true }); // closed, the spring still runs
    await settle();
    expect(result.current).toBe(true);
    expect(asked()).toEqual([true]);
    rerender({ want: false, hang: false });
    await settle();
    expect(result.current).toBe(false);
    expect(asked()).toEqual([true, false]);
  });

  it("a browser page is full size and never asks", async () => {
    const { result } = renderHook(() => useWindowTall(true, false, STRIP_IDLE_HEIGHT, false));
    await settle();
    expect(result.current).toBe(true);
    expect(asked()).toEqual([]);
  });
});
