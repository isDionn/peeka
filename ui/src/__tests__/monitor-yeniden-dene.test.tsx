import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bridge, type MonitorInfo } from "../bridge";
import { useMonitor } from "../hooks";

const info = { id: "0", primary: true, hasBattery: false, radios: "ok", brightness: false, user: "u", hz: 60 } as MonitorInfo;

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("useMonitor (VM run 2: a failed monitor query left the strip blank)", () => {
  it("asks again after a failure and draws once it answers", async () => {
    vi.useFakeTimers();
    const call = vi.spyOn(bridge, "call").mockRejectedValueOnce("unknown").mockRejectedValueOnce("unknown").mockResolvedValue(info as never);
    const { result } = renderHook(() => useMonitor("0"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(call).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(call).toHaveBeenCalledTimes(3);
    expect(result.current).toEqual(info);
  });

  it("gives up after 3 tries", async () => {
    vi.useFakeTimers();
    const call = vi.spyOn(bridge, "call").mockRejectedValue("unknown");
    const { result } = renderHook(() => useMonitor("0"));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(call).toHaveBeenCalledTimes(3);
    expect(result.current).toBeNull();
  });
});
