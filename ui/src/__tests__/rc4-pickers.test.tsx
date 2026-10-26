// RC4 wave 2: the clock's month calendar and the Wi-Fi / Bluetooth lists under the Status tiles.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { CalendarPanel, weeks } from "../components/CalendarPanel";
import { bars } from "../components/RadioPicker";
import { StatusCard } from "../components/StatusCard";

beforeEach(() => { fakeBridge.reset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const settle = (ms = 60) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe("calendar", () => {
  it("always 6 rows of 7 from a Monday, so the panel never changes height", () => {
    for (let m = 0; m < 24; m++) {
      const w = weeks(new Date(2026, m, 1));
      expect(w).toHaveLength(6);
      expect(w.every((r) => r.length === 7 && r[0].getDay() === 1)).toBe(true);
      expect(w[0].some((d) => d.getDate() === 1 && d.getMonth() === new Date(2026, m, 1).getMonth())).toBe(true);
    }
  });
  it("today is marked; arrows, PageDown and Home move focus; Today shows only when away", async () => {
    render(<CalendarPanel />);
    const today = screen.getByRole("gridcell", { current: "date" });
    expect(today.getAttribute("tabindex")).toBe("0");
    const title = () => screen.getByRole("heading").textContent;
    const now = title();
    const today$ = () => document.querySelector(".calToday")!;
    expect(today$().getAttribute("aria-hidden")).toBe("true");
    fireEvent.keyDown(today, { key: "PageDown" });
    expect(title()).not.toBe(now);
    expect(today$().getAttribute("aria-hidden")).toBe("false");
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Home" });
    expect(title()).toBe(now);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(title()).toBe(now);
    expect(screen.getAllByRole("row")).toHaveLength(7); // weekday header + 6 weeks
  });
});

describe("Wi-Fi / Bluetooth lists", () => {
  const card = async () => {
    const [monitor, status] = [await fakeBridge.call("get_monitor", { monitor: "m1" }), await fakeBridge.call("get_status")];
    render(<StatusCard monitor={monitor} status={status} setStatus={() => undefined} />);
    await settle();
  };
  const tile = (name: RegExp) => screen.getByRole("button", { name });
  it("signal maps to 1-3 bars", () => { expect([bars(10), bars(50), bars(90)]).toEqual([1, 2, 3]); });
  it("a short click toggles; a 0.52 s hold opens the list instead (no toggle)", async () => {
    await card();
    const wifiOn = async () => (await fakeBridge.call("get_status")).wifi!.on;
    const was = await wifiOn();
    fireEvent.click(tile(/^Wi-Fi,/));
    expect(await wifiOn()).toBe(!was);
    vi.useFakeTimers();
    fireEvent.pointerDown(tile(/^Wi-Fi,/), { button: 0 });
    act(() => { vi.advanceTimersByTime(530); });
    fireEvent.pointerUp(tile(/^Wi-Fi,/)); fireEvent.click(tile(/^Wi-Fi,/));
    vi.useRealTimers();
    await settle();
    expect(await wifiOn()).toBe(!was);
    expect(screen.getByRole("group", { name: "Wi-Fi networks" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Studio-WPA3/ })).toBeTruthy();
  });
  it("password: under 8 is refused locally, a wrong one shows the error, the password is never kept or logged", async () => {
    await card();
    fireEvent.keyDown(tile(/^Wi-Fi,/), { key: "Enter", shiftKey: true });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /^Studio-WPA3/ }));
    const input = screen.getByLabelText("Password for Studio-WPA3") as HTMLInputElement;
    expect(screen.getByText("Windows keeps the password, Peeka never stores it.")).toBeTruthy();
    fireEvent.change(input, { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(fakeBridge.log.filter((l) => l.cmd === "wifi_connect")).toHaveLength(0);
    fireEvent.change(input, { target: { value: "hunter22!" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(input.value).toBe(""); // cleared at submit
    await settle();
    expect(JSON.stringify(fakeBridge.log)).not.toContain("hunter22!");
    expect(screen.getByRole("button", { name: /^Studio-WPA3.*Connected/ })).toBeTruthy();
  });
  it("Esc closes only the password form, then only the list, never the card", async () => {
    await card();
    fireEvent.keyDown(tile(/^Wi-Fi,/), { key: "Enter", shiftKey: true });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /^Studio-WPA3/ }));
    fireEvent.keyDown(screen.getByLabelText("Password for Studio-WPA3"), { key: "Escape" });
    expect(screen.queryByLabelText("Password for Studio-WPA3")).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: /^Studio-WPA3/ }), { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Wi-Fi networks" })).toBeNull();
  });
  it("Bluetooth: audio connects; other kinds are disabled with a quiet note", async () => {
    await card();
    fireEvent.keyDown(tile(/^Bluetooth,/), { key: "Enter", shiftKey: true });
    await settle();
    expect((screen.getByRole("button", { name: "Disconnect MX Keys" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Peeka connects audio devices/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Buds Pro" }));
    await settle(1400);
    expect(fakeBridge.log.filter((l) => l.cmd === "bt_set")).toEqual([{ cmd: "bt_set", args: { id: "demo-bt-buds", connect: false } }]);
    expect(screen.getByRole("button", { name: "Connect Buds Pro" })).toBeTruthy();
  });
  it("locked: a generic line, no names", async () => {
    await card();
    act(() => fakeBridge.setLocked(true));
    fireEvent.keyDown(tile(/^Wi-Fi,/), { key: "Enter", shiftKey: true });
    await settle();
    expect(screen.getByText("Not available while Peeka is locked.")).toBeTruthy();
    expect(screen.queryByText("Studio-WPA3")).toBeNull();
  });
});
