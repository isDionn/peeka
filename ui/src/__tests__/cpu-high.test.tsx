import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";

// Item 31: Rust `cpu_high {app}` (the 60 s decision lives in Rust; no timer on the page) + `topCpu` on the System card.
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

describe("cpu_high (D)", () => {
  it("'<app> is using a lot of CPU' and the Task Manager button (open_task_manager)", { timeout: 20000 }, async () => {
    const spy = vi.spyOn(fakeBridge, "call");
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.emit("cpu_high", { app: "chrome" }));
    await settle(300);
    expect(center().textContent).toContain("chrome is using a lot of CPU");
    fireEvent.click(screen.getByRole("button", { name: "Task Manager" }));
    expect(spy).toHaveBeenCalledWith("open_task_manager");
  });
  it("generic text when the app is unknown or while locked", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.emit("cpu_high", { app: null }));
    await settle(300);
    expect(center().textContent).toContain("CPU is very busy");
    fireEvent.keyDown(document, { key: "Escape" });
    await settle(300);
    act(() => fakeBridge.setLocked(true));
    act(() => fakeBridge.emit("cpu_high", { app: "chrome" }));
    await settle(300);
    expect(center().textContent).not.toContain("chrome");
  });
  it("the System card names the top app", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle(1500);
    fireEvent.click(await screen.findByRole("tab", { name: "System" }));
    await settle(1500);
    expect(document.body.textContent).toContain("Top app");
    expect(document.body.textContent).toContain("chrome");
  });
});
