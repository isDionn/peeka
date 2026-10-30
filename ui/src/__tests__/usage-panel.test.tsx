import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bridge } from "../bridge";
import { fakeBridge } from "../bridge.fake";
import { UsageBox } from "../components/IslandCards";

beforeEach(() => { fakeBridge.reset(); });
const settle = () => act(async () => { await new Promise((done) => setTimeout(done, 0)); });

describe("usage tab", () => {
  it("one row per agent, Claude, Codex and Gemini, with a 5-hour and a Weekly meter; 80% and up turns red", async () => {
    render(<UsageBox generic={false} onSettings={() => undefined} />);
    await settle();
    expect(screen.getByText("Claude")).toBeTruthy();
    expect(screen.getByText("Codex")).toBeTruthy();
    expect(screen.getByText("Gemini")).toBeTruthy();
    expect(screen.getByText(/Gemini keeps no usage on this PC/)).toBeTruthy();
    expect(screen.getAllByText("5-hour")).toHaveLength(2);
    expect(screen.getAllByText("Weekly")).toHaveLength(2);
    expect(screen.getByText("Resets in 2h 0m")).toBeTruthy(); // Claude
    expect(screen.getByText("Resets in 2h 30m")).toBeTruthy(); // Codex: never more than 5 h on a 5-hour window
    expect(screen.getByText("Resets in 4d 0h")).toBeTruthy(); // Claude weekly
    expect(screen.getAllByRole("meter", { name: "5-hour" })[0].style.getPropertyValue("--color")).toBe("var(--cyan)"); // Claude 42%
    expect(screen.getAllByRole("meter", { name: "5-hour" })[1].style.getPropertyValue("--color")).toBe("var(--red)"); // Codex 84%
  });

  it("an agent without numbers says what to do; Claude's hands off to Settings", async () => {
    const onSettings = vi.fn();
    fakeBridge.setAgentUsage([]);
    render(<UsageBox generic={false} onSettings={onSettings} />);
    await settle();
    expect(screen.getByText(/Reinstall the Claude Code bridge/)).toBeTruthy();
    expect(screen.getByText(/after your next Codex reply/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(onSettings).toHaveBeenCalledOnce();
  });

  it("Refresh asks the app to skip its cache", async () => {
    const call = vi.spyOn(bridge, "call");
    render(<UsageBox generic={false} onSettings={() => undefined} />);
    await settle();
    expect(call).toHaveBeenLastCalledWith("agent_usage", { refresh: false });
    fireEvent.click(screen.getByRole("button", { name: "Refresh usage" }));
    expect(call).toHaveBeenLastCalledWith("agent_usage", { refresh: true });
    call.mockRestore();
  });

  it("a window whose reset time has passed reads 0%, not the old number", async () => {
    fakeBridge.setAgentUsage([{ agent: "codex", windows: [{ usedPercent: 84, windowMinutes: 300, resetsAt: Math.round(Date.now() / 1000) - 60 }] }]);
    render(<UsageBox generic={false} onSettings={() => undefined} />);
    await settle();
    expect(screen.getByText("0%")).toBeTruthy();
    expect(screen.getByText("Window reset")).toBeTruthy();
    expect(screen.queryByText("84%")).toBeNull();
  });

  it("generic mode (locked, presenting, shared) hides every number", async () => {
    render(<UsageBox generic onSettings={() => undefined} />);
    await settle();
    expect(screen.getAllByText("Hidden")).toHaveLength(4);
    expect(screen.queryByText("84%")).toBeNull();
    expect(screen.queryByText(/Resets/)).toBeNull();
  });
});
