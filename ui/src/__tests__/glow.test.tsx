import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { GlowField, glowOf, tintOf } from "../components/Glow";

describe("Drift glow", () => {
  it("screen_tint colours: three #rrggbb (left, centre, right) become left, right, centre; anything else falls back (null)", () => {
    expect(tintOf(["#111111", "#222222", "#333333"])).toEqual(["#111111", "#333333", "#222222"]);
    expect(tintOf(null)).toBeNull();
    expect(tintOf(["#111111", "#222222"])).toBeNull();
    expect(tintOf(["red", "#222222", "#333333"])).toBeNull();
  });

  it("line mode → glow state", () => {
    expect(glowOf("wait")).toBe("attention");
    expect(glowOf("speak")).toBe("busy");
    expect(glowOf("listen")).toBe("busy");
    expect(glowOf("idle")).toBe("idle");
    expect(glowOf("off")).toBe("idle");
  });

  it("only its own monitor's tint; a new colour goes into the hidden copy and the copies swap", () => {
    const { container } = render(<GlowField monitor="m1" />);
    const copies = () => [...container.querySelectorAll<HTMLElement>(".glowCopy")];
    expect(copies().map((c) => c.style.opacity)).toEqual(["1", "0"]);
    act(() => fakeBridge.emit("screen_tint", { monitor: "m2", colors: ["#111111", "#222222", "#333333"] }));
    expect(copies().map((c) => c.style.opacity)).toEqual(["1", "0"]);
    act(() => fakeBridge.emit("screen_tint", { monitor: "m1", colors: ["#111111", "#222222", "#333333"] }));
    expect(copies().map((c) => c.style.opacity)).toEqual(["0", "1"]);
    expect(copies()[1].style.getPropertyValue("--c3")).toBe("#222222");
    act(() => fakeBridge.emit("screen_tint", { monitor: "m1", colors: null }));
    expect(copies().map((c) => c.style.opacity)).toEqual(["1", "0"]);
    expect(copies()[0].style.getPropertyValue("--c1")).toBe(""); // --glow-color
  });

  it("a field mounted later (a panel opening) starts with the last colours: no fallback first frame, no cross-fade", () => {
    const strip = render(<GlowField monitor="m7" />);
    act(() => fakeBridge.emit("screen_tint", { monitor: "m7", colors: ["#ff0000", "#00ff00", "#0000ff"] }));
    strip.unmount(); // LAST outlives the field that heard the colours
    const { container } = render(<GlowField monitor="m7" />);
    const copies = [...container.querySelectorAll<HTMLElement>(".glowCopy")];
    expect(copies.map((c) => c.style.opacity)).toEqual(["1", "0"]);
    expect(copies[0].style.getPropertyValue("--c1")).toBe("#ff0000");
  });

  it("the island follows its own tint copy (Rust sends the primary monitor's tint again as monitor \"island\")", async () => {
    const { Island, ISLAND_TINT } = await import("../components/Island");
    const { container } = render(<Island monitor="m1" init={{ view: null }} />);
    act(() => fakeBridge.emit("screen_tint", { monitor: ISLAND_TINT, colors: ["#ff0000", "#00ff00", "#0000ff"] }));
    const on = [...container.querySelectorAll<HTMLElement>("#island .glowCopy")].filter((c) => c.style.opacity === "1");
    expect(on.length).toBeGreaterThan(0);
    for (const c of on) expect(c.style.getPropertyValue("--c1")).toBe("#ff0000");
  });
});
