import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { PLUGINS } from "../plugin.fixtures";

// Claude Code events (cc_event) drive the mascot even without a main assistant; while Compass is connected its state takes precedence (wave5.test.tsx).
const rectOf = (el: HTMLElement) => ({ left: 10, top: 5, width: parseFloat(el.style.width) || (el.dataset.hit !== undefined ? 100 : 0), height: parseFloat(el.style.height) || 30 }) as DOMRect;
const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return rectOf(this); });
  fakeBridge.reset();
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const settle = (ms = 80) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

const mood = () => document.querySelector<HTMLElement>(".islandCenter .mascot")!.dataset.mood;

describe("cc_event: without Compass", () => {
  it("with no main assistant 'prompt' makes the mascot 'thinking'; 'stop' = done, 'session_end' = idle", async () => {
    fakeBridge.setPlugins([]);
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(mood()).toBe("idle");
    await act(async () => { fakeBridge.emit("cc_event", { kind: "prompt" }); });
    expect(mood()).toBe("thinking");
    await act(async () => { fakeBridge.emit("cc_event", { kind: "stop" }); });
    expect(mood()).toBe("done");
    await act(async () => { fakeBridge.emit("cc_event", { kind: "session_end" }); });
    expect(mood()).toBe("idle");
  });
  it("also works while the main assistant is not connected (sleeping)", async () => {
    fakeBridge.setPlugins(PLUGINS.map((p) => (p.main ? { ...p, connected: false } : p)));
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await act(async () => { fakeBridge.emit("cc_event", { kind: "prompt" }); });
    expect(mood()).toBe("thinking");
  });
});
