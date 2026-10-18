// Sürtünme denetimi, şerit ve paneller (O1, O6, O9, O10, O12, O16, Y2, Y5).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { panelMaxH } from "../components/common";
import { SearchPanel } from "../components/SearchPanel";
import { Shell } from "../components/Shell";
import { onX, type XMsg } from "../lib/xwin";

const proto = HTMLElement.prototype;
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset();
});
afterEach(() => { cleanup(); Reflect.deleteProperty(proto, "offsetHeight"); Reflect.deleteProperty(proto, "offsetWidth"); });
const settle = (ms = 60) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const logged = (cmd: string) => fakeBridge.log.filter((l) => l.cmd === cmd);
const panel = (k: string) => document.querySelector(`[data-panel=${k}]`)!;
const trigger = (k: string) => fireEvent.click(document.querySelector(`[data-panel-trigger="${k}"]`)!);

describe("şerit sabitleri", () => {
  it("O1: her sabit simge + ad (sabit yuva); ad hem kapalıda hem açıkta var, tam ad title ve aria-label'da", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    const pins = [...document.querySelectorAll(".sabit")];
    expect(pins.length).toBeGreaterThan(0);
    expect(pins.every((p) => p.querySelector(".sabitAd")?.textContent)).toBe(true);
    expect(pins.every((p) => p.getAttribute("title") && p.getAttribute("aria-label"))).toBe(true);
    expect(pins.some((p) => p.classList.contains("acikSabit"))).toBe(true);
  });
});

describe("pencere seçici (F-05)", () => {
  it("çok pencereli öğede Aşağı ok seçiciyi açar, ok tuşu gezer, Esc kapatıp odağı öğeye verir", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    const chrome = document.querySelector<HTMLElement>('.sabit[data-app="chrome"]')!;
    chrome.focus();
    fireEvent.keyDown(chrome, { key: "ArrowDown" });
    await settle(100);
    const k = document.querySelectorAll<HTMLElement>(".onizleme .kucuk");
    expect(k.length).toBeGreaterThan(1);
    expect(document.activeElement).toBe(document.querySelector(".onizleme .kucuk.on") ?? k[0]);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await settle();
    expect(document.querySelector(".onizleme")).toBeNull();
    expect(document.activeElement).toBe(chrome);
  });
});

describe("paneller", () => {
  it("O6: yükseklik sınırı = görünür alan - şerit - boşluk", () => {
    expect(panelMaxH(768)).toBe(768 - 46);
    expect(panelMaxH(100)).toBe(160);
  });

  it("Y5: panel açılınca ada penceresine {t:'panel-open', panel} gider", async () => {
    const got: XMsg[] = [];
    const off = onX((m) => got.push(m));
    render(<Shell monitor="m1" />);
    await settle();
    act(() => fakeBridge.emit("shortcut", { name: "search", monitor: "m1" }));
    await settle(100);
    off();
    expect(got).toContainEqual({ t: "panel-open", panel: "search" });
  });

  it("odak: Ara açılınca şerit klavye odağını alır, kapanınca geri verir; başka panel odak istemez", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    trigger("notif");
    await settle(300);
    expect(logged("typing_focus")).toHaveLength(0);
    act(() => fakeBridge.emit("shortcut", { name: "search", monitor: "m1" }));
    await settle(100);
    expect(logged("typing_focus").map((l) => l.args)).toEqual([{ label: "strip-m1", on: true }]);
    act(() => fakeBridge.emit("shortcut", { name: "search", monitor: "m1" }));
    await settle(300);
    expect(logged("typing_focus").map((l) => l.args)).toEqual([{ label: "strip-m1", on: true }, { label: "strip-m1", on: false }]);
  });

  it("Y2: kapat düğmesi paneli kapatır (Ara hariç: kendi Esc ipucu var); dışarı tıklama da kapatır", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    trigger("notif");
    await settle(300);
    expect(panel("notif").getAttribute("aria-hidden")).toBe("false");
    fireEvent.click(panel("notif").querySelector(".panelKapat")!);
    await settle(300);
    expect(panel("notif").getAttribute("aria-hidden")).toBe("true");
    trigger("start");
    await settle(300);
    expect(panel("start").querySelector(".panelKapat")).not.toBeNull();
    fireEvent.pointerDown(document.body);
    await settle(300);
    expect(panel("start").getAttribute("aria-hidden")).toBe("true");
    trigger("search");
    await settle(300);
    expect(panel("search").querySelector(".panelKapat")).not.toBeNull();
    trigger("tray");
    await settle(300);
    expect(panel("tray").querySelector(".panelKapat")).not.toBeNull();
  });

  it("Y2: odak panelin dışındayken de tek Esc paneli kapatır", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    trigger("status");
    await settle(300);
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await settle(300);
    expect(panel("status").getAttribute("aria-hidden")).toBe("true");
  });

  it("O16: Başlat panelinden Peeka ayarları açılır", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    trigger("start");
    await settle(300);
    fireEvent.click(screen.getAllByRole("button", { name: /Peeka ayarları/ })[0]);
    await settle(300);
    expect(panel("settings").getAttribute("aria-hidden")).toBe("false");
  });
});

describe("menüler", () => {
  it("O9: şerit menüsü işaretçinin altında açılır, varsayılan odak güvenli satırda", async () => {
    render(<Shell monitor="m1" init={{ menu: { kind: "strip", x: 700 } }} />);
    await settle();
    expect(document.querySelector<HTMLElement>(".baglam")!.style.left).toBe("700px");
    expect((document.activeElement as HTMLElement).textContent).toContain("Peeka ayarları");
  });

  it("O10: Uygulamadan çık ilk tıkta onay ister", async () => {
    render(<Shell monitor="m1" init={{ menu: { kind: "app", appId: "vscode", x: 100 } }} />);
    await settle();
    fireEvent.click(screen.getByRole("menuitem", { name: "Uygulamadan çık" }));
    expect(screen.getByRole("menuitem", { name: /Tekrar tıkla/ })).toBeTruthy();
    expect(logged("quit_app")).toHaveLength(0);
  });
});

describe("Ara", () => {
  it("O12: sonuç yokken Enter Pusula'ya sormaz; oka basınca sorar", async () => {
    render(<SearchPanel onClose={() => undefined} />);
    await settle();
    const input = screen.getByLabelText("Ara");
    fireEvent.change(input, { target: { value: "zzzqqq" } });
    await settle();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(logged("search_ask")).toHaveLength(0);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(logged("search_ask")).toHaveLength(1);
  });

  it("O12: sonuç yokken Esc yazıyı siler; sonuç varken yakalamaz, panel kapanır", async () => {
    render(<SearchPanel onClose={() => undefined} />);
    await settle();
    const input = screen.getByLabelText("Ara") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "zzqxw" } });
    await settle();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "ek" } });
    await settle();
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    expect(fireEvent.keyDown(input, { key: "Escape" })).toBe(true); // yakalanmadı: odak tuzağı kapatır
    expect(input.value).toBe("ek");
  });
});
