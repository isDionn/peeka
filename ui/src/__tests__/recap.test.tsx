import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import type { RecapWeek } from "../bridge";
import { Island } from "../components/Island";
import { busiest, duration, recapRows, weekRange } from "../lib/recap";

// F8 weekly recap: the card's numbers, "Copy image" (PNG through Rust's clipboard path), closing acks it for the week.
const WEEK: RecapWeek = { startDay: 20_738, sessions: 14, sessionMs: 23_400_000, allowed: 37, denied: 3, files: 58, clips: 112, days: [9, 14, 31, 12, 18, 2, 0] };
const settle = (ms = 150) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(() => { fakeBridge.reset(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("recap text", () => {
  it("formats time, the busiest day and the week's dates", () => {
    expect([duration(0), duration(45 * 60_000), duration(23_400_000)]).toEqual(["0m", "45m", "6h 30m"]);
    expect(busiest(WEEK)).toBe("Wednesday");
    expect(busiest({ ...WEEK, days: [0, 0, 0, 0, 0, 0, 0] })).toBeNull();
    expect(busiest({ ...WEEK, days: [3, 3, 0, 0, 0, 0, 0] })).toBe("Monday");
    expect(weekRange(WEEK)).toBe("Oct 12 – 18");
    expect(weekRange({ ...WEEK, startDay: 20_752 })).toBe("Oct 26 – Nov 1");
    expect(recapRows(WEEK).map((r) => r.value)).toEqual(["14", "6h 30m", "37 allowed, 3 denied", "58", "Wednesday", "112"]);
  });
});

describe("recap card", () => {
  it("opens on its own with last week's numbers; Copy image sends a PNG and keeps the button; OK closes it for the week", async () => {
    fakeBridge.setRecap(WEEK);
    // jsdom has no canvas: a stub context and a fixed PNG blob
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => new Proxy({}, { get: (_, k) => (k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => undefined), set: () => true })) as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (cb: BlobCallback) { cb(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })); });
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(screen.getByRole("dialog", { name: "Your week" })).toBeTruthy();
    expect(screen.getByText("Oct 12 – 18")).toBeTruthy();
    expect(screen.getByText("37 allowed, 3 denied")).toBeTruthy();
    expect(screen.getByText("Wednesday")).toBeTruthy();
    const copy = screen.getByRole("button", { name: "Copy image" });
    fireEvent.click(copy);
    await settle(200);
    expect(fakeBridge.log.find((l) => l.cmd === "recap_copy_image")).toEqual({ cmd: "recap_copy_image", args: { bytes: 4 } });
    expect(copy.textContent).toBe("Copied"); // same button, in place
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await settle();
    expect(screen.queryByRole("dialog", { name: "Your week" })).toBeNull();
    expect(await fakeBridge.call("recap_get")).toBeNull();
  });

  it("never opens while locked", async () => {
    fakeBridge.setRecap(WEEK);
    await fakeBridge.call("lock_now");
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(screen.queryByRole("dialog", { name: "Your week" })).toBeNull();
  });
});
