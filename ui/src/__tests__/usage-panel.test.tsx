import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { UsageBox } from "../components/IslandCards";

beforeEach(() => { fakeBridge.reset(); });
const settle = () => act(async () => { await new Promise((done) => setTimeout(done, 0)); });

describe("usage tab", () => {
  it("one box per agent with a 5-hour and a Weekly meter; 80% and up turns red", async () => {
    render(<UsageBox generic={false} onSettings={() => undefined} />);
    await settle();
    expect(screen.getByText("Codex")).toBeTruthy();
    expect(screen.getByText("Claude")).toBeTruthy();
    expect(screen.getAllByText("5-hour")).toHaveLength(2);
    expect(screen.getAllByText("Weekly")).toHaveLength(2);
    expect(screen.getByText("Resets in 2h 0m")).toBeTruthy();
    expect(screen.getAllByRole("meter", { name: "5-hour" })[0].style.getPropertyValue("--color")).toBe("var(--red)"); // Codex 84%
    expect(screen.getAllByRole("meter", { name: "5-hour" })[1].style.getPropertyValue("--color")).toBe("var(--cyan)"); // Claude 42%
  });

  it("empty state hands off to Settings", async () => {
    const onSettings = vi.fn();
    fakeBridge.setAgentUsage([]);
    render(<UsageBox generic={false} onSettings={onSettings} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(onSettings).toHaveBeenCalledOnce();
  });

  it("generic mode (locked, presenting, shared) hides every number", async () => {
    render(<UsageBox generic onSettings={() => undefined} />);
    await settle();
    expect(screen.getAllByText("Hidden")).toHaveLength(4);
    expect(screen.queryByText("84%")).toBeNull();
    expect(screen.queryByText(/Resets/)).toBeNull();
  });
});
