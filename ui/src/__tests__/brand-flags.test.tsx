// Another brand (brand file `product_name`, `mascot: false`, every `hide` id): its name on screen, no ghost, no Claude parts.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { ModulesCard } from "../components/IslandCards";
import { SettingsPanel } from "../components/SettingsPanel";
import { Mascot } from "../mascot/Mascot";
import { EMPTY_SURFACES } from "../plugin.fixtures";

vi.mock("../brand", async (orig) => {
  const real = (await orig()) as typeof import("../brand");
  const BRAND = { ...real.BRAND, productName: "Other App", mascot: false, hide: ["module.claude", "module.usage", "module.cc", "settings.agent-hooks", "settings.about-line", "settings.demo", "settings.intro"] };
  return { BRAND, brandHides: (id: string) => BRAND.hide.includes(id) };
});

beforeEach(() => fakeBridge.reset());
afterEach(cleanup);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

describe("brand flags", () => {
  it("settings: the brand's name, no Mascot page, no agent hook rows, About without the blurb and demo", async () => {
    const settings = await fakeBridge.call("get_settings");
    render(<SettingsPanel page="plugins" onPage={() => undefined} settings={settings} onQuit={() => undefined} />);
    await settle();
    expect(screen.queryByRole("button", { name: "Mascot" })).toBeNull();
    expect(screen.queryByText(/bridge$/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "About" }));
    expect(screen.getByText("Quit Other App")).toBeTruthy();
    expect(screen.queryByText(/replace the Windows taskbar/)).toBeNull();
    expect(screen.queryByText("Demo mode")).toBeNull();
    expect(document.body.textContent).not.toContain("Peeka");
  });

  it("Modules card: no Claude or Usage tab, no Claude Code row", async () => {
    const r = render(<ModulesCard media={null} pos={0} sys={null} cpu={[]} surf={EMPTY_SURFACES} shelf={[]} main={null} meeting={null} onPage={() => undefined} onClose={() => undefined} onApproval={() => undefined} />);
    await settle();
    expect(screen.queryByRole("tab", { name: "Claude" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Usage" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Music" })).toBeTruthy();
    expect(r.container.querySelector(".genHead[aria-label^='Claude Code']")).toBeNull();
  });

  it("no ghost", () => {
    const r = render(<Mascot size={40} mood="idle" isMainAssistant />);
    expect(r.container.innerHTML).toBe("");
  });
});
