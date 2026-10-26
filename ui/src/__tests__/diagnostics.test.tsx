import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { SettingsPanel } from "../components/SettingsPanel";

// Settings > About "Save diagnostics": one local text file (Rust writes it), then "Open folder" for that file.
beforeEach(() => fakeBridge.reset());
afterEach(cleanup);

const calls = () => fakeBridge.log.map((l) => l.cmd).filter((c) => c === "save_diagnostics" || c === "diagnostics_open_folder");

describe("About: Save diagnostics", () => {
  it("saves only on a click, then offers Open folder", async () => {
    const settings = await fakeBridge.call("get_settings");
    render(<SettingsPanel page="appearance" onPage={() => undefined} settings={settings} />);
    fireEvent.click(screen.getByRole("button", { name: "About" }));
    expect(calls()).toEqual([]); // never by itself
    fireEvent.click(screen.getByRole("button", { name: "Save diagnostics" }));
    expect(calls()).toEqual(["save_diagnostics"]);
    fireEvent.click(await screen.findByRole("button", { name: "Open folder" }));
    expect(calls()).toEqual(["save_diagnostics", "diagnostics_open_folder"]);
    expect(screen.getByText(/Nothing was sent/)).toBeTruthy();
  });
});
