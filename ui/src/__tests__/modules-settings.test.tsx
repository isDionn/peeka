// Settings › Modules: every built-in tab (Usage and Claude included) and General's session row turn off; only plugin tabs have an order to drag.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Modules } from "../components/PluginSettings";

beforeEach(() => fakeBridge.reset());
afterEach(cleanup);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

describe("Settings › Modules", () => {
  it("built-in rows: a switch each, no handle; plugin tabs under their own heading with a handle", async () => {
    render(<Modules />);
    await settle();
    for (const name of ["Usage", "Claude", "Claude Code sessions", "Music"]) {
      expect(screen.getByRole("switch", { name })).toBeTruthy();
      expect(screen.queryByRole("button", { name: new RegExp(`^Reorder ${name}:`) })).toBeNull();
    }
    expect(screen.getByText(/From plugins/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Reorder Compass:/ })).toBeTruthy();
  });

  it("Usage off is saved; arrow keys move a plugin tab past the built-in rows", async () => {
    render(<Modules />);
    await settle();
    fireEvent.click(screen.getByRole("switch", { name: "Usage" }));
    await settle();
    expect((await fakeBridge.call("modules_get")).find((m) => m.id === "usage")?.on).toBe(false);
    fireEvent.keyDown(screen.getByRole("button", { name: /^Reorder Claude Code:/ }), { key: "ArrowUp" });
    await settle();
    const ids = (await fakeBridge.call("modules_get")).map((m) => m.id);
    expect(ids.indexOf("claude code")).toBeLessThan(ids.indexOf("compass"));
  });
});
