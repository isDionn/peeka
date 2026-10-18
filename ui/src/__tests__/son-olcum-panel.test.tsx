// Son ölçüm (2026-10-17) panel ve şerit bulguları: R1-5, R1-6.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { NotificationList } from "../components/Notifications";
import { Plugins } from "../components/PluginSettings";

beforeEach(() => fakeBridge.reset());
afterEach(cleanup);
const settle = (ms = 60) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe("R1-5: silinen bildirimin yeri tutulur", () => {
  it("kaldır sonrası boşluk kalır, 600 ms sonra kapanır", async () => {
    render(<NotificationList onReview={() => undefined} />);
    await settle(600); // delOk 500 ms koruması
    const before = screen.getAllByRole("listitem").length;
    fireEvent.click(screen.getAllByRole("button", { name: /, kaldır$/ })[0]);
    await settle(120);
    expect(screen.getAllByRole("listitem").length).toBe(before - 1);
    expect(document.querySelectorAll(".bildBos")).toHaveLength(1);
    await settle(650);
    expect(document.querySelectorAll(".bildBos")).toHaveLength(0);
  });
  it("imleç listeden çıkınca boşluk hemen kapanır", async () => {
    render(<NotificationList onReview={() => undefined} />);
    await settle(600);
    fireEvent.click(screen.getAllByRole("button", { name: /, kaldır$/ })[0]);
    await settle(120);
    fireEvent.pointerLeave(document.querySelector(".bilds")!);
    expect(document.querySelectorAll(".bildBos")).toHaveLength(0);
  });
});

describe("R1-6: Ana asistan satırı silinmez", () => {
  it("Ctrl+Space izni kapanınca satır kalır, anahtarı devre dışı olur", async () => {
    render(<Plugins />);
    await settle();
    const scope = screen.getAllByRole("switch", { name: "Ctrl+Space sorularını almak" })[0];
    expect(screen.getAllByText("Ana asistan").length).toBeGreaterThan(0);
    fireEvent.click(scope);
    await settle();
    const main = screen.getAllByRole("switch", { name: /ana asistan$/ })[0];
    expect(screen.getAllByText("Ana asistan").length).toBeGreaterThan(0);
    expect(main.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(/Önce yukarıdaki/)).toBeTruthy();
  });
});
