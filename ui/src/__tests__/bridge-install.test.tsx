import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { PluginExtras } from "../components/PluginExtras";

// Settings > Plugins: Claude Code bridge Install / Remove (Peeka's own hook). Only on a manual click; disabled in demo mode; the row does not shift.
const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });
const calls = (cmd: string) => fakeBridge.log.filter((l) => l.cmd === cmd).length;
const btn = (n: string) => screen.getByRole("button", { name: n });

describe("Claude Code bridge: Install / Remove", () => {
  it("Install when not installed; clicking installs, status and button become Remove; Remove undoes it", async () => {
    fakeBridge.setBridge({ installed: false, healthy: false, lastEventAgoS: null });
    render(<PluginExtras />);
    await screen.findByText("Claude Code bridge");
    expect(screen.getByText("Not installed")).toBeTruthy();
    expect(calls("claude_bridge_install")).toBe(0); // never installs by itself
    const w = btn("Install").getAttribute("style");
    fireEvent.click(btn("Install"));
    await settle();
    expect(calls("claude_bridge_install")).toBe(1);
    expect(screen.getByText(/Installed · connected to this Peeka/)).toBeTruthy();
    expect(btn("Remove").getAttribute("style")).toBe(w); // fixed width: the row does not shift
    fireEvent.click(btn("Remove"));
    await settle();
    expect(calls("claude_bridge_remove")).toBe(1);
    expect(screen.getByText("Not installed")).toBeTruthy();
  });
  it("if it points to another copy the status says so and the button becomes Reinstall", async () => {
    fakeBridge.setBridge({ installed: true, healthy: false, lastEventAgoS: 30 });
    render(<PluginExtras />);
    expect(await screen.findByText(/Installed · points to another copy/)).toBeTruthy();
    fireEvent.click(btn("Reinstall"));
    await settle();
    expect(screen.getByText(/connected to this Peeka/)).toBeTruthy();
  });
  it("button disabled in demo mode; if Rust refuses, the reason is written in the notification", async () => {
    fakeBridge.setBridge({ installed: false, healthy: false, lastEventAgoS: null });
    const real = fakeBridge.call.bind(fakeBridge) as (c: string, ...a: unknown[]) => Promise<unknown>;
    vi.spyOn(fakeBridge, "call").mockImplementation(((c: string, ...a: unknown[]) => (c === "claude_bridge_install" ? Promise.reject("refused") : real(c, ...a))) as never);
    render(<PluginExtras />);
    await screen.findByText("Claude Code bridge");
    fireEvent.click(btn("Install"));
    await settle();
    expect(screen.getByText("Didn't work. See the notification for why")).toBeTruthy();
    expect(btn("Install")).toBeTruthy(); // status unchanged
  });
  it("Install is disabled while the demo setting is on", async () => {
    fakeBridge.setBridge({ installed: false, healthy: false, lastEventAgoS: null });
    await fakeBridge.call("set_settings", { patch: { demo: true } });
    render(<PluginExtras />);
    await screen.findByText("Claude Code bridge");
    await settle();
    expect((btn("Install") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Other coding agents: one row each", () => {
  it("lists only agents present on this PC, says which file Install changes, and installs/removes one agent on a click", async () => {
    render(<PluginExtras />);
    await screen.findByText("Codex CLI bridge");
    expect(screen.getByText("Gemini CLI bridge")).toBeTruthy();
    expect(screen.queryByText("Cursor bridge")).toBeNull(); // not on this PC: no row
    expect(screen.getByText("Not installed · Install adds Peeka's hook to ~\\.codex\\hooks.json (backup kept)")).toBeTruthy();
    expect(calls("agent_bridge_install")).toBe(0);
    const b = btn("Install Codex CLI bridge");
    const w = b.getAttribute("style");
    fireEvent.click(b);
    await settle();
    expect(fakeBridge.log.filter((l) => l.cmd === "agent_bridge_install").map((l) => l.args)).toEqual([{ agent: "codex" }]);
    expect(btn("Remove Codex CLI bridge").getAttribute("style")).toBe(w);
    expect(btn("Install Gemini CLI bridge")).toBeTruthy(); // the other row is untouched
    fireEvent.click(btn("Remove Codex CLI bridge"));
    await settle();
    expect(calls("agent_bridge_remove")).toBe(1);
    expect(btn("Install Codex CLI bridge")).toBeTruthy();
  });
});
