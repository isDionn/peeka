import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { ConsentBody, ConsentWindow } from "../components/Consent";
import { Island } from "../components/Island";
import { ApprovalBump, ApprovalCard, ComposerCard, ProtrusionBump, ProtrusionCenter, TabBlocks } from "../components/Plugin";
import { useComposer } from "../hooks";
import { mascotOf, prefixed, riskOf, safeImage } from "../lib/plugin";
import { APPROVAL_CHOICE, APPROVAL_HIGH, APPROVAL_LOW, PUSULA, CONSENT, OTHER, PROTRUSION } from "../plugin.fixtures";

const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const answers = () => fakeBridge.log.filter((l) => l.cmd === "approval_answer").map((l) => l.args as { decision: string });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe("onay riski", () => {
  it("yalnız tam 'low' düşüktür; alan yok ya da tanınmayan değer yüksektir", () => {
    expect(riskOf("low")).toBe("low");
    for (const v of [undefined, null, "", "LOW", "medium", "high", 0, {}, ["low"]]) expect(riskOf(v)).toBe("high");
  });
  it("bilinmeyen riskte çıkıntıda yalnız 'Ayrıntı' vardır", () => {
    render(<ApprovalBump a={{ ...APPROVAL_LOW, risk: "belki" }} onDetail={() => undefined} />);
    expect(screen.getByRole("button", { name: "Ayrıntı" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "İzin ver" })).toBeNull();
  });
  it("yüksek riskte çıkıntıda 'İzin ver' yok; düşükte var", () => {
    const { unmount } = render(<ApprovalBump a={APPROVAL_HIGH} onDetail={() => undefined} />);
    expect(screen.queryByRole("button", { name: "İzin ver" })).toBeNull();
    unmount();
    render(<ApprovalBump a={APPROVAL_LOW} onDetail={() => undefined} />);
    expect(screen.getByRole("button", { name: "İzin ver" })).toBeTruthy();
  });
  it("tam ekranda inen şeritte düşük riskte de yalnız 'Ayrıntı'", () => {
    render(<ApprovalBump a={APPROVAL_LOW} onlyDetail onDetail={() => undefined} />);
    expect(screen.queryByRole("button", { name: "İzin ver" })).toBeNull();
  });
  it("kartta yüksek risk: 'Her zaman' yok, Reddet varsayılan odakta, İzin ver basılı tutulur", () => {
    const { container } = render(<ApprovalCard a={APPROVAL_HIGH} />);
    expect(screen.queryByText("Her zaman izin ver")).toBeNull();
    expect(container.querySelector("[data-autofocus]")?.textContent).toContain("Reddet");
    expect(screen.getByRole("button", { name: "İzin ver: basılı tut" })).toBeTruthy();
    expect(container.querySelector(".kod")?.textContent).toContain("git push --force origin main");
  });
  it("kartta düşük risk: 'Her zaman izin ver' var", () => {
    render(<ApprovalCard a={APPROVAL_LOW} />);
    expect(screen.getByText("Her zaman izin ver")).toBeTruthy();
  });
  it("bilinmeyen riskte kart yüksek gibi davranır", () => {
    render(<ApprovalCard a={{ ...APPROVAL_LOW, risk: undefined }} />);
    expect(screen.queryByText("Her zaman izin ver")).toBeNull();
  });
  it("Claude'un sorusu: seçenek listesi ve yazı kutusu; cevap seçimle gider", () => {
    vi.useFakeTimers();
    render(<ApprovalCard a={APPROVAL_CHOICE} />);
    advance(600);
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    fireEvent.click(screen.getByRole("radio", { name: /Yeni bileşen/ }));
    fireEvent.click(screen.getByRole("button", { name: "Başka cevap yaz" })); // yazı kutusu düğmeyle açılır (maket c3)
    fireEvent.change(screen.getByLabelText("Başka cevap yaz"), { target: { value: "dosya adı Baslik.tsx" } });
    fireEvent.click(screen.getByRole("button", { name: "Planı onayla" }));
    expect(fakeBridge.log.at(-1)?.args).toMatchObject({ decision: "choice", choiceId: "yeni", text: "dosya adı Baslik.tsx" });
  });
});

describe("300 ms koruması", () => {
  it("çıkıntıdaki 'İzin ver' ilk 300 ms yok sayılır", () => {
    vi.useFakeTimers();
    render(<ApprovalBump a={APPROVAL_LOW} onDetail={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "İzin ver" }));
    expect(answers()).toHaveLength(0);
    advance(599);
    fireEvent.click(screen.getByRole("button", { name: "İzin ver" }));
    expect(answers()).toHaveLength(0);
    advance(2);
    fireEvent.click(screen.getByRole("button", { name: "İzin ver" }));
    expect(answers()).toEqual([expect.objectContaining({ decision: "allow" })]);
  });
  it("card.module düğmesi ve çıkıntı düğmesi de ilk 300 ms yok sayılır", () => {
    vi.useFakeTimers();
    render(<><TabBlocks tab={{ plugin: PUSULA, id: "t", title: "Pusula", blocks: [{ type: "buttons", buttons: [{ id: "durdur", label: "Durdur", style: "destructive" }] }] }} /><ProtrusionBump item={PROTRUSION} /></>);
    const calls = () => fakeBridge.log.filter((l) => l.cmd === "plugin_action").length;
    fireEvent.click(screen.getByRole("button", { name: "Durdur" }));
    fireEvent.click(screen.getByRole("button", { name: "Katıl" }));
    expect(calls()).toBe(0);
    advance(600);
    fireEvent.click(screen.getByRole("button", { name: "Durdur" }));
    fireEvent.click(screen.getByRole("button", { name: "Katıl" }));
    expect(calls()).toBe(2);
  });
  it("yüksek riskte basılı tutma da ilk 300 ms sayılmaz", () => {
    vi.useFakeTimers();
    render(<ApprovalCard a={APPROVAL_HIGH} />);
    const b = screen.getByRole("button", { name: "İzin ver: basılı tut" });
    fireEvent.pointerDown(b, { button: 0 });
    advance(1300);
    expect(answers()).toHaveLength(0);
    fireEvent.pointerUp(b);
    fireEvent.pointerDown(b, { button: 0 });
    advance(1250);
    expect(answers()).toEqual([expect.objectContaining({ decision: "allow" })]);
  });
});

describe("kimlik: ad ön eki ve maskot", () => {
  it("ön ek her zaman başta; eklenti başlığıyla kaldıramaz ya da taklit edemez", () => {
    expect(prefixed(OTHER, "Peeka › Sistem")).toBe("Örnek Asistan › Peeka - Sistem");
    expect(prefixed(OTHER, "")).toBe("Örnek Asistan");
    expect(prefixed({ name: "Sahte › Pusula" }, "x")).toBe("Sahte - Pusula › x");
    expect(prefixed(OTHER, "a‮​b")).toBe("Örnek Asistan › ab");
  });
  it("çıkıntı başlığında ve onay kaynağında ad ön eki çizilir", () => {
    const { container } = render(<ProtrusionCenter item={{ ...PROTRUSION, plugin: OTHER, title: "Sahte › Pusula › Onay" }} />);
    expect(container.textContent).toContain("Örnek Asistan › Sahte - Pusula - Onay");
    render(<ApprovalCard a={{ ...APPROVAL_LOW, plugin: OTHER, source: "Pusula" }} />);
    expect(screen.getByText(/Örnek Asistan › Pusula/)).toBeTruthy();
  });
  it("mascot yalnız ana asistanda ve yalnız tablodaki halde kabul edilir", () => {
    expect(mascotOf(OTHER, "dinliyor")).toBeNull();
    expect(mascotOf(PUSULA, "dinliyor")).toBe("dinliyor");
    expect(mascotOf(PUSULA, "<script>")).toBeNull();
    const other = render(<ProtrusionCenter item={{ ...PROTRUSION, plugin: OTHER, mascot: "dinliyor" }} />);
    expect(other.container.querySelector("[data-mk]")).toBeNull();
    expect(other.container.querySelector(".basHarf")?.textContent).toBe("Ö");
    other.unmount();
    const main = render(<ProtrusionCenter item={{ ...PROTRUSION, mascot: "dinliyor" }} />);
    expect(main.container.querySelector("[data-mk='dinliyor']")).not.toBeNull();
  });
});

describe("HTML enjeksiyonu yok", () => {
  const evil = '<img src=x onerror="window.pwned=1"><a href="javascript:1">tıkla</a>';
  it("çıkıntı, onay ve sekme metinleri düz metin olarak çizilir", () => {
    const { container } = render(<>
      <ProtrusionCenter item={{ ...PROTRUSION, title: evil, subtitle: evil, icon: evil }} />
      <ProtrusionBump item={{ ...PROTRUSION, subtitle: evil, actions: [{ id: "a", label: evil }] }} />
      <ApprovalCard a={{ ...APPROVAL_LOW, title: evil, command: evil, cwd: evil, detail: evil, alwaysLabel: evil }} />
      <TabBlocks tab={{ plugin: PUSULA, id: "t", title: evil, blocks: [{ type: "heading", text: evil }, { type: "text", text: evil }, { type: "list", rows: [{ title: evil, sub: evil, value: evil }] }, { type: "kv", rows: [{ k: evil, v: evil }] }] }} />
    </>);
    expect(container.querySelector("img:not(.mascot img)")).toBeNull(); // maskotun kendi görselleri hariç
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(container.textContent).toContain("<img src=x");
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });
  it("görsel bloğu yalnız küçük PNG/JPEG data: kabul eder", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(safeImage(png)).toBe(png);
    for (const bad of ["data:image/svg+xml;base64,PHN2Zz4=", "javascript:alert(1)", "https://x/y.png", 'data:image/png;base64,AA" onerror="x', "data:image/png;base64," + "A".repeat(400_000)]) expect(safeImage(bad)).toBeNull();
    const { container } = render(<TabBlocks tab={{ plugin: PUSULA, id: "t", title: "Pusula", blocks: [{ type: "image", src: "data:image/svg+xml;base64,PHN2Zz4=" }, { type: "image", src: png }] }} />);
    expect(container.querySelectorAll("img.blokGorsel")).toHaveLength(1);
  });
});

describe("ada: eklenti yüzeyleri", () => {
  it("yüksek riskli onay çıkıntısı yalnız 'Ayrıntı' gösterir; Ayrıntı kartı açar, Esc çıkıntıya döner", async () => {
    fakeBridge.setSurfaces({ approvals: [APPROVAL_HIGH], approvalTop: "ap-2" });
    render(<Island monitor="m1" init={{ view: null }} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    expect(screen.queryByRole("button", { name: "İzin ver" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ayrıntı" }));
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Ayrıntı" })).toBeTruthy();
  });
  it("Ctrl+Space ana asistan varsa sohbet kutusunu, yoksa 'Pusula bağlı değil' kartını açar", async () => {
    const r = render(<Island monitor="m1" init={{ view: null }} />);
    await act(async () => { await new Promise((x) => setTimeout(x, 40)); });
    act(() => fakeBridge.emit("shortcut", { name: "ask", monitor: "m1" }));
    await act(async () => { await new Promise((x) => setTimeout(x, 40)); });
    expect(screen.getByRole("dialog", { name: "Pusula bağlı değil" })).toBeTruthy();
    r.unmount();
    fakeBridge.setSurfaces({ composer: { ...PUSULA, voice: false } });
    render(<Island monitor="m1" init={{ view: null }} />);
    await act(async () => { await new Promise((x) => setTimeout(x, 40)); });
    act(() => fakeBridge.emit("shortcut", { name: "ask", monitor: "m1" }));
    await act(async () => { await new Promise((x) => setTimeout(x, 40)); });
    expect(screen.getByRole("dialog", { name: "Sor" })).toBeTruthy();
  });
});

function Harness() {
  const c = useComposer();
  const [, force] = useState(0);
  void force;
  return <ComposerCard owner={{ ...PUSULA, voice: false }} turns={c.turns} send={c.send} suggestions={[{ id: "window_image", label: "Bu pencere: Chrome" }]} />;
}
describe("Ctrl+Space akışı", () => {
  it("çip yalnız tıklanınca eklenir; cevap parça parça akar, kaynak çipleri ve bitiş gelir", async () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/sor/), { target: { value: "Yarın ne var?" } });
    fireEvent.click(screen.getByRole("button", { name: /Bu pencere: Chrome/ }));
    fireEvent.keyDown(screen.getByLabelText(/sor/), { key: "Enter" });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(fakeBridge.log.at(-1)).toMatchObject({ cmd: "composer_submit", args: { text: "Yarın ne var?", attachments: [{ kind: "window_image" }] } });
    expect(screen.getByText("Yarın ne var?")).toBeTruthy();
    expect(screen.getByText(/09:30'daki Tasarım incelemesi için\s*$/)).toBeTruthy(); // ilk parça
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.getByText(/09:15'te hatırlatacağım\./)).toBeTruthy();
    expect(screen.getByText("3 not okundu")).toBeTruthy();
    expect(screen.getByText("Hatırlatma 09:15")).toBeTruthy();
  });
  it("tıklamadan gönderince ek gitmez", async () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/sor/), { target: { value: "Merhaba" } });
    fireEvent.keyDown(screen.getByLabelText(/sor/), { key: "Enter" });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(fakeBridge.log.at(-1)).toMatchObject({ args: { attachments: [] } });
  });
  it("hata gelirse kartta görünür", async () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/sor/), { target: { value: "x" } });
    fireEvent.keyDown(screen.getByLabelText(/sor/), { key: "Enter" });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    act(() => fakeBridge.emit("composer_event", { turn: 1, kind: "error", message: "Pusula yanıt vermiyor" }));
    expect(screen.getByRole("alert").textContent).toContain("Pusula yanıt vermiyor");
  });
});

describe("eklenti onay penceresi", () => {
  const req = () => ({ ...CONSENT, expiresAt: Date.now() + 120_000 });
  it("dokuz maddenin içeriği: kimlik, program, benzer ad, üç düzey, risk cümlesi, hiç verilmeyenler, ağ cümlesi", () => {
    const { container } = render(<ConsentBody req={req()} onClose={() => undefined} />);
    const t = container.textContent ?? "";
    for (const s of ["Yeni eklenti bağlanmak istiyor", "Yayıncı: Örnek · doğrulanmadı", "İmzasız", "Bu ad zaten bağlı bir eklentiye benziyor.", "Düşük", "Orta", "Yüksek",
      "Risk düzeyini eklenti söyler, Peeka doğrulayamaz.", "Ana asistan yapılsın mı?", "Hiçbir eklenti parolalarını", "kendi internet bağlantısını kullanabilir", "Bu eklentiyi bir daha sorma", "2.1 · dev.example.pusula"]) expect(t).toContain(s);
    const boxes = screen.getAllByRole("checkbox").map((b) => b.getAttribute("aria-checked"));
    expect(boxes).toEqual(["true", "true", "true", "false", "false"]); // düşük, orta, orta, ana asistan, yüksek
  });
  it("varsayılan odak 'Reddet'te; Esc reddeder", async () => {
    render(<ConsentWindow req={req()} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(document.activeElement?.textContent).toContain("Reddet");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(fakeBridge.log.at(-1)).toMatchObject({ cmd: "consent_answer", args: { allow: false, scopes: [] } });
  });
  it("'İzin ver' ilk 600 ms yok sayılır (useGuard), sonra yalnız işaretli kapsamlarla gider", () => {
    vi.useFakeTimers();
    render(<ConsentBody req={req()} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "İzin ver" }));
    expect(fakeBridge.log).toHaveLength(0);
    advance(400);
    fireEvent.click(screen.getByRole("button", { name: "İzin ver" }));
    expect(fakeBridge.log).toHaveLength(0);
    advance(300);
    fireEvent.click(screen.getByRole("checkbox", { name: "Ana asistan yapılsın mı?" }));
    fireEvent.click(screen.getByRole("button", { name: "İzin ver" }));
    expect(fakeBridge.log.at(-1)).toMatchObject({ cmd: "consent_answer", args: { allow: true, mainAssistant: true, never: false, scopes: ["island.protrusion", "approvals.prompt", "composer.handler"] } });
  });
  it("2 dakikada cevap yoksa kendiliğinden reddedilir; sayaç görünür", () => {
    vi.useFakeTimers();
    render(<ConsentBody req={req()} onClose={() => undefined} />);
    expect(screen.getByRole("timer").textContent).toBe("2:00 sonra reddedilir");
    advance(60_000);
    expect(screen.getByRole("timer").textContent).toBe("1:00 sonra reddedilir");
    advance(60_500);
    expect(fakeBridge.log.filter((l) => l.cmd === "consent_answer")).toHaveLength(1);
    expect(fakeBridge.log.at(-1)).toMatchObject({ args: { allow: false, scopes: [] } });
  });
  it("'Bir daha sorma' kara listeye yazdırır", () => {
    render(<ConsentBody req={req()} onClose={() => undefined} />);
    fireEvent.click(screen.getByText("Bu eklentiyi bir daha sorma"));
    expect(fakeBridge.log.at(-1)).toMatchObject({ args: { allow: false, never: true } });
  });
  it("eklenti adı ve gerekçesi düz metin olarak çizilir", () => {
    const evil = '<img src=x onerror="1">';
    const { container } = render(<ConsentBody req={{ ...req(), plugin: { ...CONSENT.plugin, name: evil, publisher: evil }, why: { "island.protrusion": evil } }} onClose={() => undefined} />);
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("onay yüzeyi ve sayaç", () => {
  it("çıkıntıdan verilen cevap surface: 'protrusion', karttan verilen 'card' gider", () => {
    vi.useFakeTimers();
    const { unmount } = render(<ApprovalBump a={APPROVAL_LOW} onDetail={() => undefined} />);
    advance(600);
    fireEvent.click(screen.getByRole("button", { name: "İzin ver" }));
    expect(fakeBridge.log.at(-1)?.args).toMatchObject({ decision: "allow", surface: "protrusion" });
    unmount();
    render(<ApprovalCard a={APPROVAL_LOW} />);
    advance(600);
    fireEvent.click(screen.getByRole("button", { name: "İzin ver" }));
    expect(fakeBridge.log.at(-1)?.args).toMatchObject({ decision: "allow", surface: "card" });
  });
  it("sayaç öğenin ilk görüldüğü andan sayar; yüzey güncellemesinde (yeniden çizimde) başa dönmez", () => {
    vi.useFakeTimers();
    const a = { ...APPROVAL_LOW, id: "sayac-1", expiresS: 100 };
    const { rerender } = render(<ApprovalCard a={a} />);
    advance(40_000);
    rerender(<ApprovalCard a={{ ...a }} />); // Rust her güncellemede aynı expiresS'i yeniden yollar
    expect(screen.getByRole("timer").textContent).toBe("1:00");
  });
});

describe("Rust güvenlik alanları", () => {
  it("freeTextWarning: yazı kutusunun üstünde eklenti adlı uyarı, kutuya aria-describedby ile bağlı; alan yoksa uyarı yok", () => {
    const a = { ...APPROVAL_CHOICE, plugin: OTHER, freeTextWarning: true };
    const { unmount } = render(<ApprovalCard a={a} />);
    fireEvent.click(screen.getByRole("button", { name: "Başka cevap yaz" }));
    const warn = screen.getByText(/Bu soru Örnek Asistan eklentisinden; buraya şifre yazma/);
    expect(screen.getByRole("textbox", { name: "Başka cevap yaz" }).getAttribute("aria-describedby")).toBe(warn.id);
    expect(warn.compareDocumentPosition(screen.getByRole("textbox")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();
    render(<ApprovalCard a={{ ...APPROVAL_CHOICE, plugin: OTHER }} />);
    fireEvent.click(screen.getByRole("button", { name: "Başka cevap yaz" }));
    expect(screen.queryByText(/buraya şifre yazma/)).toBeNull();
    expect(screen.getByRole("textbox").getAttribute("aria-describedby")).toBeNull();
  });
  it("tarama denied dönünce notch://notice metni, yoksa varsayılan Türkçe neden görünür", async () => {
    render(<Harness />);
    fakeBridge.setScanDenied(true);
    const btn = await screen.findByRole("button", { name: "Ekran görüntüsü ekle" });
    const scan = () => fireEvent.click(btn);
    scan();
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(screen.getByRole("status").textContent).toBe("Bu pencere hassas bir uygulamanın; taranmadı");
    act(() => fakeBridge.emit("notch://notice", "Parola yöneticisi açık; tarama yapılmadı"));
    scan();
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(screen.getByRole("status").textContent).toBe("Parola yöneticisi açık; tarama yapılmadı");
  });
  it("eklenti adı ayraç taşımaz: ön ek tek '›' ile basılır", () => {
    const { container } = render(<ApprovalCard a={{ ...APPROVAL_LOW, plugin: { ...OTHER, name: "Sahte › Pusula" } }} />);
    expect(container.textContent).toContain("Sahte - Pusula ›");
    expect(container.textContent).not.toContain("Sahte ›");
  });
});
