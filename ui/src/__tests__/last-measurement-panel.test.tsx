// Last measurement (2026-10-17) panel and strip findings: R1-5, R1-6.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { NotificationList } from "../components/Notifications";
import { Plugins } from "../components/PluginSettings";

beforeEach(() => fakeBridge.reset());
afterEach(cleanup);
const settle = (ms = 60) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe("R1-5: a removed notification keeps its place", () => {
  it("after remove a gap stays and closes after 600 ms", async () => {
    render(<NotificationList onReview={() => undefined} />);
    await settle(600); // delOk 500 ms guard
    const before = screen.getAllByRole("listitem").length;
    fireEvent.click(screen.getAllByRole("button", { name: /, remove$/ })[0]);
    await settle(120);
    expect(screen.getAllByRole("listitem").length).toBe(before - 1);
    expect(document.querySelectorAll(".notifEmpty")).toHaveLength(1);
    await settle(650);
    expect(document.querySelectorAll(".notifEmpty")).toHaveLength(0);
  });
  it("the gap closes immediately when the pointer leaves the list", async () => {
    render(<NotificationList onReview={() => undefined} />);
    await settle(600);
    fireEvent.click(screen.getAllByRole("button", { name: /, remove$/ })[0]);
    await settle(120);
    fireEvent.pointerLeave(document.querySelector(".notifs")!);
    expect(document.querySelectorAll(".notifEmpty")).toHaveLength(0);
  });
});

describe("R1-6: the Main assistant row is not removed", () => {
  it("when the Ctrl+Space permission is turned off the row stays and its switch is disabled", async () => {
    render(<Plugins />);
    await settle();
    const scope = screen.getAllByRole("switch", { name: "Answer Ctrl+Space questions" })[0];
    expect(screen.getAllByText("Main assistant").length).toBeGreaterThan(0);
    fireEvent.click(scope);
    await settle();
    const main = screen.getAllByRole("switch", { name: /main assistant$/ })[0];
    expect(screen.getAllByText("Main assistant").length).toBeGreaterThan(0);
    expect(main.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(/First turn on/)).toBeTruthy();
  });
});
