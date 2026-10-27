import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { UsagePanel } from "../components/UsagePanel";

beforeEach(() => { fakeBridge.reset(); });
afterEach(() => { vi.restoreAllMocks(); });
const settle = () => act(async () => { await new Promise((done) => setTimeout(done, 0)); });

describe("usage panel", () => {
  it("shows only populated agents, and compact mode keeps the five-hour window", async () => {
    render(<UsagePanel onSettings={() => undefined} />);
    await settle();
    expect(screen.getByText("Codex")).toBeTruthy();
    expect(screen.getByText("Claude")).toBeTruthy();
    expect(screen.getAllByText("Weekly")).toHaveLength(2);
    fireEvent.click(screen.getByRole("radio", { name: "Compact" }));
    expect(screen.queryByText("Weekly")).toBeNull();
    expect(screen.getAllByText("5-hour")).toHaveLength(2);
  });

  it("uses the bridge fixture for an empty-state Settings handoff", async () => {
    const onSettings = vi.fn();
    fakeBridge.setAgentUsage([]);
    render(<UsagePanel onSettings={onSettings} />);
    await settle();
    expect(screen.getByText("No usage data yet — Claude needs the statusline bridge in Settings")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(onSettings).toHaveBeenCalledOnce();
  });

  it("hides percentages while Peeka is locked", async () => {
    render(<UsagePanel onSettings={() => undefined} />);
    await settle();
    act(() => fakeBridge.setLocked(true));
    await settle();
    expect(screen.getAllByText("Usage hidden")).toHaveLength(4);
    expect(screen.queryByText("84%")).toBeNull();
  });
});
