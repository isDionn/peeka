// Gerçek pencere 2. tur: şerit/ada tıklamadan sonra odağı önceki uygulamaya geri verir. Tıklamanın hemen ardından gelen
// bulanıklaşma paneli kapatmaz; tıklamasız bulanıklaşma (Alt+Tab, Win+L) yine kapatır. Açık bir panelde yazı alanına
// odak gelince şerit odağı tutar (typing_focus), çıkınca bırakır.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Shell } from "../components/Shell";
import { isTextEntry } from "../lib/justPressed";

beforeEach(() => fakeBridge.reset());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const settle = (ms = 60) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const open = () => document.querySelector("[data-panel=status]")?.getAttribute("aria-hidden") === "false";
const typing = () => fakeBridge.log.filter((l) => l.cmd === "typing_focus").map((l) => (l.args as { on: boolean }).on);

describe("odak geri verilince şerit", () => {
  it("tıklamadan hemen sonraki bulanıklaşma paneli açık bırakır, tıklamasız olan kapatır", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    const t0 = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(t0);
    const btn = document.querySelector('[data-panel-trigger="status"]')!;
    fireEvent.pointerUp(btn);
    fireEvent.click(btn);
    await settle();
    expect(open()).toBe(true);
    now.mockReturnValue(t0 + 300); // geri verme tıklamadan ~300 ms sonra
    act(() => { window.dispatchEvent(new Event("blur")); });
    await settle();
    expect(open()).toBe(true);
    now.mockReturnValue(t0 + 5000); // Alt+Tab: son tıklama eski
    act(() => { window.dispatchEvent(new Event("blur")); });
    await settle();
    expect(open()).toBe(false);
  });

  it("açık panelde yazı alanı odak tutar, çıkınca bırakır; kaydırıcı saymaz", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    fireEvent.click(document.querySelector('[data-panel-trigger="status"]')!);
    await settle();
    const box = document.createElement("input");
    document.querySelector("[data-panel=status]")!.appendChild(box);
    act(() => box.focus());
    await settle();
    expect(typing()).toEqual([true]);
    act(() => box.blur());
    await settle();
    expect(typing()).toEqual([true, false]);
    const range = Object.assign(document.createElement("input"), { type: "range" });
    expect([isTextEntry(box), isTextEntry(range), isTextEntry(document.createElement("textarea"))]).toEqual([true, false, true]);
  });
});
