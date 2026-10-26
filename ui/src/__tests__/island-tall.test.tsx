// The island window is a short band at rest: a peek renders only after Rust has grown the window, and it shrinks back
// once the peek has closed. Runs the page as in Tauri (`inTauri`), with the fake bridge answering.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";

vi.mock("../bridge", async (orig) => ({ ...(await orig<typeof import("../bridge")>()), inTauri: true }));

beforeEach(() => { fakeBridge.reset(); localStorage.clear(); });
afterEach(cleanup);
const asked = () => fakeBridge.log.filter((l) => l.cmd === "window_tall").map((l) => (l.args as { tall: boolean }).tall);
const settle = (ms = 80) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe("island window height", () => {
  it("grows before the volume peek renders, shrinks after it closed, asks nothing at rest", async () => {
    render(<Island monitor="m1" init={{ view: null }} />); // no welcome card
    await settle();
    expect(asked()).toEqual([]);
    act(() => { fakeBridge.emit("volume_osd", { percent: 40, muted: false, device: null }); });
    expect(document.querySelector(".hudTrack")).toBeNull(); // not before the window is tall
    await settle();
    expect(asked()).toEqual([true]);
    expect(document.querySelector(".hudTrack")).not.toBeNull();
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    await settle(1500); // the close spring ends, then the band comes back
    expect(asked()).toEqual([true, false]);
  });
});
