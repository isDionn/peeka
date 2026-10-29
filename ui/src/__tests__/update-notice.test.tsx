import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";


// Update notice (Rust `update_available`, the version): "Peeka X is available", Download opens the release page, either button dismisses.
const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset();
});
afterEach(() => {
  cleanup();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const settle = (ms = 80) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const center = () => document.querySelector<HTMLElement>(".islandCenter")!;

describe("update_available", () => {
  it("shows the version; Download opens the page and dismisses, and the notice clears", { timeout: 20000 }, async () => {
    const spy = vi.spyOn(fakeBridge, "call");
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.pushUpdate("0.4.0"));
    await settle(300);
    expect(center().textContent).toContain("Peeka 0.4.0 is available");
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(spy).toHaveBeenCalledWith("update_open");
    expect(spy).toHaveBeenCalledWith("update_dismiss");
    await settle(300);
    expect(center().textContent).not.toContain("is available");
  });
});
