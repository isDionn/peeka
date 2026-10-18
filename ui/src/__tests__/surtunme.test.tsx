// Sürtünme denetimi (Y1-Y4, O2-O4, O8, Sistem geçmişi): fare ile çıkış, tek kural "çıkıntı Modüller'i kendi sekmesinde açar", sabit sekme çubuğu.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
// @ts-expect-error node tipleri yüklü değil; vitest Node'da koşar
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { SURFACES_J, PUSULA, APPROVAL_LOW } from "../plugin.fixtures";
import { Island } from "../components/Island";
import { FirstRunCard, modulesKw, TimerStart } from "../components/IslandCards";
import { ComposerCard, resetComposerDraft } from "../components/Plugin";
import { onX, sendX } from "../lib/xwin";
import { resetMascotRegistry } from "../mascot/useSingleMascot";

const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset(); resetMascotRegistry(); resetComposerDraft(); localStorage.clear();
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 80)); });
const pill = () => screen.getAllByRole("button").find((b) => b.className.includes("adaMerkez"))!;
const TIMER = { label: "Çay", totalS: 300, remainingS: 200, running: true };

describe("Y1: çıkıntı varken ada Modüller'e açılır", () => {
  it("onay çıkıntısı varken ortaya tıklamak Modüller'i açar; Esc çıkıntıya döner", async () => {
    fakeBridge.setSurfaces({ approvals: [APPROVAL_LOW], approvalTop: APPROVAL_LOW.id });
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    fireEvent.click(pill());
    await settle();
    expect(screen.getByRole("dialog", { name: /^Modüller/ })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("imleç üstündeyken 'Modülleri aç' ipucu çıkar", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fakeBridge.setSurfaces({ approvals: [APPROVAL_LOW], approvalTop: APPROVAL_LOW.id });
    render(<Island monitor="m1" init={{ view: null }} />);
    await act(async () => { vi.advanceTimersByTime(100); });
    fireEvent.pointerEnter(pill());
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(pill().getAttribute("title")).toBe("Modülleri aç");
  });
});

describe("Y2: her kartta görünür çıkış", () => {
  it("× kartı kapatır (klavye odağı gerekmez)", async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Kapat" }));
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("kartın dışına tıklamak kartı kapatır; kartın içine tıklamak kapatmaz", async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    fireEvent.pointerDown(screen.getByRole("tab", { name: "Pano" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("Rust mesajı outside de kapatır; şerit paneli açılınca (panel-open) kart kapanır", async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    sendX({ t: "outside" });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    sendX({ t: "panel-open", panel: "search" });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("başka uygulamaya tıklama (notch://outside_press) kartı kapatır; adanın kendi penceresine tıklama kapatmaz", async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    await act(async () => { fakeBridge.emit("notch://outside_press", "island"); });
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => { fakeBridge.emit("notch://outside_press", ""); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("sekme çubuğu olmayan kartta Modüller düğmesi kendi sekmesinde Modüller'i açar", async () => {
    render(<Island monitor="m1" init={{ view: "pano" }} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Modüller" }));
    await settle();
    expect(screen.getByRole("tab", { name: "Pano" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("Y5: ada ile şerit paneli birbirini kapatır", () => {
  it("adanın içine tıklamak island-click yollar", async () => {
    const got: string[] = [];
    const off = onX((m) => got.push(m.t));
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    fireEvent.pointerDown(pill());
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    off();
    expect(got).toContain("island-click");
  });
});

describe("Y3: çıkıntılar kendi sekmesinde Modüller'i açar", () => {
  it("raf sürükleme çıkıntısı -> Raf sekmesi", async () => {
    render(<Island monitor="m1" init={{ view: null, shelfDrag: true }} />);
    await settle();
    fireEvent.click(pill());
    await settle();
    expect(screen.getByRole("tab", { name: "Raf" }).getAttribute("aria-selected")).toBe("true");
  });
  it("ekran alıntısı çıkıntısı -> Pano sekmesi", async () => {
    render(<Island monitor="m1" init={{ view: null, shot: true }} />);
    await settle();
    fireEvent.click(pill());
    await settle();
    expect(screen.getByRole("tab", { name: "Pano" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("Y4: sekme çubuğu hiç kaymaz, her sekmede aynıdır", () => {
  const css: string = readFileSync("src/components/cards.css", "utf8");
  it("Genel dışındaki her sekme aynı genişlikte; yalnız Genel geniş", () => {
    const pages = ["müzik", "pano", "raf", "takvim", "zamanlayıcı", "sistem", "bildirimler", "eklenti"];
    expect(new Set(pages.map((p) => modulesKw(p, 1920)))).toEqual(new Set([620]));
    expect(modulesKw("genel", 1920)).toBeGreaterThan(620);
  });
  it("köşe grubu ada orta çizgisinde sabit genişlikte (464), × hep aynı ekran noktasında (kart genişliğine bağlı değil)", () => {
    expect(css).toMatch(/\.modUst \{[^}]*justify-content: flex-end;[^}]*width: 464px/);
    expect(css).toMatch(/\.kartBar \{[^}]*width: 464px/); // Modüller ile kart çubuğu aynı köşe grubu (R1-1)
    expect(css).toMatch(/\.modUst \.seg \{[^}]*flex: none;[^}]*max-width: 388px/);
    expect(css).not.toMatch(/\.modUst > \.mini \{[^}]*margin-left: auto/);
  });
  it("her sekmede düğme kutuları, simge boyutu ve düğme sayısı aynı; çubuk aynı öğe", async () => {
    fakeBridge.setSurfaces(SURFACES_J);
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    const bar = () => screen.getByRole("tablist", { name: "Modüller" });
    const el0 = bar();
    const snap = () => within(bar()).getAllByRole("tab").map((t) => [t.getAttribute("aria-label"), t.className.replace(" on", ""), t.querySelector("svg")?.getAttribute("class") ?? "", t.style.cssText]);
    const first = snap();
    for (const t of within(bar()).getAllByRole("tab")) {
      fireEvent.click(t);
      expect(snap()).toEqual(first);
      expect(bar()).toBe(el0);
    }
  });
});

describe("O2: çıkıntı imleç üstündeyken kapanmaz", () => {
  it("ekran alıntısı çıkıntısı imleç üstündeyken kapanmaz, ayrılınca kapanır", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<Island monitor="m1" init={{ view: null, shot: true }} />);
    await act(async () => { vi.advanceTimersByTime(100); });
    fireEvent.pointerEnter(pill());
    await act(async () => { vi.advanceTimersByTime(300); });
    await act(async () => { vi.advanceTimersByTime(6000); });
    expect(pill().getAttribute("title")).toBe("Modülleri aç");
    fireEvent.pointerLeave(pill());
    await act(async () => { vi.advanceTimersByTime(300); });
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(pill().getAttribute("title")).toBeNull();
  });
});

describe("O3: zamanlayıcı", () => {
  it("çıkıntıya tıklamak Zamanlayıcı sekmesini açar; çalışan sayaç ve kontroller formun üstünde", async () => {
    fakeBridge.setTimer(TIMER);
    fakeBridge.setMedia(null); // çalan müzik zamanlayıcının önünde durur (yan baloncuk kararı 2026-10-17); burada zamanlayıcı tek iş
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    fireEvent.click(pill());
    await settle();
    expect(screen.getByRole("tab", { name: "Zamanlayıcı" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("Çalışan zamanlayıcı").textContent).toContain("Çay");
    expect(screen.getAllByRole("button", { name: "Duraklat" }).length).toBeGreaterThan(0);
  });
  it("Başlat görünür geri bildirim verir", async () => {
    render(<TimerStart />);
    fireEvent.click(screen.getByRole("button", { name: "Başlat" }));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(screen.getByRole("button", { name: "Başlatıldı" })).toBeTruthy();
  });
});

describe("O4: Ctrl+Space kutusu", () => {
  const send = vi.fn();
  const owner = { ...PUSULA, voice: false };
  it("gönderince kutu aynı öğe, odak ve konum korunur", () => {
    const view = render(<ComposerCard owner={owner} turns={[]} send={send} suggestions={[]} />);
    const inp = screen.getByRole("textbox") as HTMLInputElement;
    inp.focus();
    fireEvent.change(inp, { target: { value: "selam" } });
    fireEvent.keyDown(inp, { key: "Enter" });
    view.rerender(<ComposerCard owner={owner} turns={[{ id: 1, ask: "selam", answer: "", chips: [], state: "wait" }]} send={send} suggestions={[]} />);
    expect(screen.getByRole("textbox")).toBe(inp);
    expect(document.activeElement).toBe(inp);
    expect(inp.closest("[data-composer]")!.firstElementChild!.contains(inp)).toBe(true);
  });
  it("yazılmış taslak kapanıp açılınca kaybolmaz; gönderilince temizlenir", () => {
    const a = render(<ComposerCard owner={owner} turns={[]} send={send} suggestions={[]} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "yarım kalan" } });
    a.unmount();
    render(<ComposerCard owner={owner} turns={[]} send={send} suggestions={[]} />);
    const inp = screen.getByRole("textbox") as HTMLInputElement;
    expect(inp.value).toBe("yarım kalan");
    fireEvent.keyDown(inp, { key: "Enter" });
    expect(inp.value).toBe("");
  });
});

describe("O8: ilk açılış düğmeleri yerinde kalır", () => {
  it("Geri, Geç ve İleri her sayfada aynı üç yuvada; olmayan yalnız gizlenir", () => {
    render(<FirstRunCard onDone={() => undefined} />);
    const row = () => [...document.querySelector(".frDugme")!.children] as HTMLElement[];
    expect(row().length).toBe(3);
    const go = () => fireEvent.click(screen.getByRole("button", { name: /İleri|Başla/ }));
    go();
    expect(row().length).toBe(3);
    go();
    expect(row().length).toBe(3);
    expect(row()[1].style.visibility).toBe("hidden");
    expect(row()[0].style.visibility).toBe("visible");
    expect(row()[2].textContent).toBe("Başla");
  });
});

describe("Sistem geçmişi", () => {
  it("16 çubuk; örnek gelmeyenler soluk, gelenler yükseklikle", async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    fireEvent.click(screen.getByRole("tab", { name: "Sistem" }));
    await act(async () => { await new Promise((r) => setTimeout(r, 1200)); });
    expect(document.querySelectorAll(".spark i").length).toBe(16);
    expect(document.querySelectorAll(".spark i.bos").length).toBeLessThan(16);
  });
});
