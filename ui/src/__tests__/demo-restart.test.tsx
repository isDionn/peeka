import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { SettingsPanel } from "../components/SettingsPanel";

// Settings > About "Demo mode": one button that asks Rust to restart Peeka in (or out of) demo mode.
beforeEach(() => fakeBridge.reset());
afterEach(cleanup);

const about = async (demo: boolean) => {
  const settings = { ...(await fakeBridge.call("get_settings")), demo };
  render(<SettingsPanel page="appearance" onPage={() => undefined} settings={settings} />);
  fireEvent.click(screen.getByRole("button", { name: "About" }));
};
const restarts = () => fakeBridge.log.filter((l) => l.cmd === "demo_restart").map((l) => l.args);

describe("About: Demo mode", () => {
  it("normal mode: Try demo restarts into demo", async () => {
    await about(false);
    expect(screen.getByText("Demo mode")).toBeTruthy();
    expect(restarts()).toEqual([]); // never by itself
    fireEvent.click(screen.getByRole("button", { name: "Try demo" }));
    expect(restarts()).toEqual([{ on: true }]);
  });
  it("demo mode: Stop demo restarts normally, same fixed width", async () => {
    await about(true);
    const b = screen.getByRole("button", { name: "Stop demo" });
    expect(b.getAttribute("style")).toContain("width: 92px");
    fireEvent.click(b);
    expect(restarts()).toEqual([{ on: false }]);
  });
});
