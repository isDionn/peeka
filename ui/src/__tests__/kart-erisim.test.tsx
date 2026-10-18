// Ada ve kartlar: Ctrl+Space panel kapatır (R2-Y3), çalışan zamanlayıcı müzik çıkıntısını bastırmaz (R2-O2), Modüller sekme deseni ve duyuru (F-01/F-03/F-04).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { onX } from "../lib/xwin";
import { resetMascotRegistry } from "../mascot/useSingleMascot";

const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset(); resetMascotRegistry(); localStorage.clear();
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 80)); });
const pill = () => document.querySelector("button.adaMerkez") as HTMLElement;

describe("R2-Y3: Ctrl+Space açık şerit panelini kapatır", () => {
  it("ask kısayolu island-click yollar", async () => {
    const got: string[] = [];
    const off = onX((m) => got.push(m.t));
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => { fakeBridge.emit("shortcut", { name: "ask", monitor: "m1" }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
    off();
    expect(got).toContain("island-click");
  });
});

describe("R2-O2: zamanlayıcı müzik çıkıntısını bastırmaz", () => {
  it("zamanlayıcı çalışırken yeni parça çıkıntısı görünür", async () => {
    fakeBridge.setTimer({ label: "Çay", totalS: 300, remainingS: 200, running: true });
    render(<Island monitor="m1" init={{ view: null, autoMusic: true, pin: true }} />);
    await settle();
    expect(pill().getAttribute("aria-label")).toMatch(/^Çalıyor: /);
    expect(screen.getByRole("status").textContent).toMatch(/^Çalıyor: /);
    expect(pill().getAttribute("aria-expanded")).toBeNull(); // çıkıntı kart değildir (F-28)
  });
});

describe("Modüller kartı: sekme deseni ve ad (F-03, F-04)", () => {
  it("kart adı etkin sekmeyi taşır; tek Tab durağı; oklar gezer; gövde tabpanel", async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    expect(screen.getByRole("dialog", { name: "Modüller: Genel" })).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.filter((t) => t.tabIndex === 0)).toHaveLength(1);
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tabs[0].id);
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    await settle();
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Modüller: Müzik" })).toBeTruthy();
    fireEvent.keyDown(tabs[1], { key: "End" });
    await settle();
    expect(document.activeElement).toBe(tabs.at(-1));
    fireEvent.keyDown(tabs.at(-1)!, { key: "Home" });
    await settle();
    expect(document.activeElement).toBe(tabs[0]);
  });
  it("× sekme çubuğu grubunda, tüm sekmelerde aynı yerde", async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    const bar = document.querySelector(".modUst")!;
    expect(bar.querySelector(".kapat")).toBeTruthy();
  });
});
