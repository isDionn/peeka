// Panel yüzeyi (sürtünme 2 R2-O1, O4, O5, O6; tutarlılık T-1): zamanlayıcı cümleleri, Pano süzgeci ve geri bildirimi.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { PanoView } from "../components/Pano";
import { SearchPanel } from "../components/SearchPanel";
import { parseTimer } from "../lib/search";

const proto = HTMLElement.prototype;
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset(); localStorage.clear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });
const logged = (cmd: string) => fakeBridge.log.filter((l) => l.cmd === cmd);

describe("parseTimer: Türkçe zamanlayıcı cümleleri", () => {
  it.each([
    ["5 dk", 300], ["5dk", 300], ["5 dakika", 300], ["zamanlayıcı 10 dakika", 600], ["Zamanlayıcı 10", 600], ["timer 7", 420],
    ["sayaç 90 sn", 90], ["25 dk odak", 1500], ["1 saat", 3600], ["2 sa", 7200], ["10 dk zamanlayıcı", 600],
  ])("%s", (q, s) => expect(parseTimer(q)?.seconds).toBe(s));
  it("etiket: sondaki kelime", () => expect(parseTimer("25 dk odak")?.label).toBe("Odak"));
  it.each(["2026", "5", "merhaba", "dk 5", "999 sa", "0 dk"])("zamanlayıcı değil: %s", (q) => expect(parseTimer(q)).toBeNull());
});

describe("Ctrl+K zamanlayıcı eylemi", () => {
  it("'5 dk' üstte 'Zamanlayıcı başlat: 5 dk' satırı çıkarır ve Enter timer_start çağırır; Pusula'ya gitmez", async () => {
    const close = vi.fn();
    render(<SearchPanel onClose={close} />);
    await settle();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "5 dk" } });
    await settle();
    const first = document.querySelector('[role="option"]')!;
    expect(first.textContent).toContain("Zamanlayıcı başlat: 5 dk");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(logged("timer_start")[0].args).toEqual({ label: "Zamanlayıcı", seconds: 300 });
    expect(logged("search_ask")).toHaveLength(0);
    expect(close).toHaveBeenCalled();
  });
  it("sıradan metin eskisi gibi Pusula'ya gider", async () => {
    render(<SearchPanel onClose={() => undefined} />);
    await settle();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "merhaba dünya" } });
    await settle();
    expect(screen.queryByText(/Zamanlayıcı başlat/)).toBeNull();
    fireEvent.click(document.querySelector(".asistanSor")!);
    expect(logged("search_ask")).toHaveLength(1);
  });
});

describe("Pano süzgeci", () => {
  it("yazdıkça süzer, eşleşme yoksa 'Eşleşme yok', Esc temizler", async () => {
    render(<PanoView />);
    await screen.findByText("ekran-kaydı.mp4");
    const box = screen.getByRole("textbox", { name: "Panoda ara" });
    fireEvent.change(box, { target: { value: "ekran-kaydı" } });
    expect(screen.getByText("ekran-kaydı.mp4")).toBeTruthy();
    expect(document.querySelectorAll("[data-clip]").length).toBe(1);
    fireEvent.change(box, { target: { value: "yokboyle" } });
    expect(screen.getByText("Eşleşme yok")).toBeTruthy();
    fireEvent.keyDown(box, { key: "Escape" });
    expect((box as HTMLInputElement).value).toBe("");
    expect(document.querySelectorAll("[data-clip]").length).toBeGreaterThan(1);
  });
  it("parola satırı yalnız kaynak adıyla bulunur", async () => {
    render(<PanoView />);
    await screen.findByText("ekran-kaydı.mp4");
    const box = screen.getByRole("textbox", { name: "Panoda ara" });
    fireEvent.change(box, { target: { value: "bitwarden" } });
    expect(document.querySelectorAll(".sat.gizli").length).toBe(1);
    fireEvent.change(box, { target: { value: "Kd9!mPq2" } });
    expect(document.querySelectorAll(".sat.gizli").length).toBe(0);
  });
});

describe("Pano geri bildirimi", () => {
  it("satır gövdesine tıklamak kopyalar ve 'Kopyalandı' der", async () => {
    render(<PanoView />);
    await screen.findByText("ekran-kaydı.mp4");
    fireEvent.click(document.querySelector('[data-clip="c9"]')!);
    await settle();
    expect(logged("clip_copy").some((l) => (l.args as { id: string }).id === "c9")).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Kopyalandı");
  });
  it("Pusula bağlı değilken 'Pusula'ya sor' kapalı ve nedenini söyler", async () => {
    fakeBridge.setPlugins([]);
    render(<PanoView />);
    await screen.findByText("ekran-kaydı.mp4");
    fireEvent.pointerEnter(document.querySelector('[data-clip="c9"]')!);
    const b = screen.getByRole("button", { name: "Asistan bağlı değil" }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
  });
});
