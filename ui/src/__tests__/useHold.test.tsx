import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HoldButton } from "../components/common";

afterEach(() => vi.useRealTimers());

describe("press-and-hold confirmation", () => {
  it("does not fire without holding for 1.2 s, fires when held", () => {
    vi.useFakeTimers();
    const done = vi.fn();
    const { getByRole } = render(<HoldButton label="Close" icon={null} onDone={done} />);
    const b = getByRole("button");
    fireEvent.pointerDown(b, { button: 0 });
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.pointerUp(b);
    act(() => { vi.advanceTimersByTime(500); });
    expect(done).not.toHaveBeenCalled();
    fireEvent.pointerDown(b, { button: 0 });
    act(() => { vi.advanceTimersByTime(1250); });
    expect(done).toHaveBeenCalledOnce();
  });
  it("also works with the keyboard (Enter held)", () => {
    vi.useFakeTimers();
    const done = vi.fn();
    const { getByRole } = render(<HoldButton label="Close" icon={null} onDone={done} />);
    fireEvent.keyDown(getByRole("button"), { key: "Enter" });
    act(() => { vi.advanceTimersByTime(1250); });
    expect(done).toHaveBeenCalledOnce();
  });
});
