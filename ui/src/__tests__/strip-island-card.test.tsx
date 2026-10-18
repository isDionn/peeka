import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { firstRunDone } from "../lib/firstRun";
import { onX, sendX, type XMsg } from "../lib/xwin";
import { APPROVAL_LOW } from "../plugin.fixtures";

// When a strip panel (status, Settings...) opens, the island card is pulled back: the island window sits above the strip, so the card must not cover the panel (no dead end).
const settle = (ms = 150) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
beforeEach(() => { fakeBridge.reset(); localStorage.clear(); });

describe("the island card is pulled back when a strip panel opens", () => {
  it("if the status panel opens while the welcome card is showing, the card closes, counts as 'Skip' and does not return", async () => {
    const got: XMsg[] = [];
    const off = onX((m) => got.push(m));
    render(<Island monitor="m1" />);
    await settle();
    expect(screen.getByRole("dialog", { name: /Welcome/ })).toBeTruthy();
    sendX({ t: "panel-open", panel: "status" });
    sendX({ t: "panel", panel: "status" });
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(firstRunDone()).toBe(true);
    expect(got).toContainEqual({ t: "welcome", open: false });
    sendX({ t: "panel", panel: null }); // panel closed: the card does not come back by itself
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    off();
  });

  it("a pending approval is not lost when a panel opens and closes", async () => {
    fakeBridge.setSurfaces({ approvals: [APPROVAL_LOW], approvalTop: APPROVAL_LOW.id });
    localStorage.setItem("notch.ilkAcilis", "1"); // old key on purpose: exercises the one-time migration to notch.firstRun
    render(<Island monitor="m1" />);
    await settle();
    sendX({ t: "panel-open", panel: "status" });
    sendX({ t: "panel", panel: "status" });
    await settle();
    sendX({ t: "panel", panel: null });
    await settle();
    expect(fakeBridge.log.some((c) => c.cmd === "approval_answer")).toBe(false);
    expect(screen.getAllByText(/api\-server needs approval/).length).toBeGreaterThan(0);
  });
});
