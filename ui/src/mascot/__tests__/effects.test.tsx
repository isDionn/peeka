// Maskot davranışları: sahte zamanlayıcıyla süre ve değer denetimi (rAF ve performance da sahte, 16 ms adım).
import { act, createRef } from "react";
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mascot, type MascotHandle } from "../Mascot";
import type { Mood } from "../moods";
import { resetMascotRegistry } from "../useSingleMascot";

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] }));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); resetMascotRegistry(); });

const adv = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const mount = (size: number, mood: Mood = "idle", extra: Record<string, unknown> = {}) => {
  const ref = createRef<MascotHandle>();
  const ui = (m: Mood) => <Mascot ref={ref} size={size} mood={m} isMainAssistant single={false} {...extra} />;
  const r = render(ui(mood));
  return { ...r, ref, set: (m: Mood) => r.rerender(ui(m)), q: (s: string) => r.container.querySelector(s) as HTMLElement | null };
};
const scale = (el: HTMLElement) => (/scale\(([-\d.e]+), ([-\d.e]+)\)/.exec(el.style.transform) ?? []).slice(1).map(Number) as [number, number];
const tx = (el: HTMLElement) => Number(/translate\(([-\d.e]+)px/.exec(el.style.transform)?.[1]);

describe("boşta döngü durur", () => {
  it("hareket yoksa rAF çağrılmaz; hop döngüyü uyandırır, bitince tekrar durur", async () => {
    const m = mount(56, "idle");
    adv(200);
    expect(m.ref.current!.running()).toBe(false);
    const spy = vi.spyOn(window, "requestAnimationFrame");
    adv(5000);
    expect(spy).not.toHaveBeenCalled();
    m.ref.current!.hop();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(m.ref.current!.running()).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });   // hop dizisi async (await wait), mikro görevler için async ilerlet
    expect(m.ref.current!.running()).toBe(false);
  });
  it("24 px şerit de durur; konuşan ağız (speaking) durmaz", () => {
    const a = mount(24, "idle"); adv(300); expect(a.ref.current!.running()).toBe(false);
    const b = mount(56, "speaking"); adv(2000); expect(b.ref.current!.running()).toBe(true);
  });
  it("bakış hedefe varınca durur", () => {
    const m = mount(56, "idle", { cursor: { x: 200, y: 0 } });
    adv(100); expect(m.ref.current!.running()).toBe(true);
    adv(3000); expect(m.ref.current!.running()).toBe(false);
  });
});

describe("izin rozeti", () => {
  it("56 px: eski rozet silinir, 100 ms sonra gelir; hal bitince silinir", () => {
    const m = mount(56, "idle");
    expect(m.q(".g-rozet")!.dataset.s).toBe("out");
    m.set("approval");
    adv(99); expect(m.q(".g-rozet")!.dataset.s).toBe("out");
    adv(1); expect(m.q(".g-rozet")!.dataset.s).toBe("in");
    expect(m.q(".g-isik")!.style.opacity).toBe("0.45");   // amber ışık güçlenir
    m.set("idle"); expect(m.q(".g-rozet")!.dataset.s).toBe("out");
  });
  it("onayın '!' rozeti 56 altında görünmez (24, 28 rozet yok; 40'ta yalnız etiketli haller)", () => {
    for (const s of [24, 28]) { const m = mount(s, "approval"); adv(300); expect(m.q(".g-rozet")).toBeNull(); m.unmount(); }
    const m = mount(40, "approval"); adv(300); expect(m.q(".g-rozet")!.dataset.s).toBe("out"); m.unmount();
  });
  it("klavye ipucu yuvası yalnız ≥56 px ve izin halinde", () => {
    const a = mount(56, "approval", { badgeHint: <kbd>Y</kbd> }); expect(a.q(".mascot-ipucu kbd")).toBeTruthy(); a.set("idle"); expect(a.q(".mascot-ipucu")).toBeNull(); a.unmount();
    const b = mount(40, "approval", { badgeHint: <kbd>Y</kbd> }); expect(b.q(".mascot-ipucu")).toBeNull();
  });
});

describe("hata titremesi", () => {
  it("56 px: +4, -4, +2,5, 0 px; 280 ms sonra sakin", () => {
    const m = mount(56, "idle"); adv(100);
    m.set("error");
    const sal = m.q(".g-sal")!;
    adv(48); expect(tx(sal)).toBeGreaterThan(3.3);
    adv(80); expect(tx(sal)).toBeLessThan(-3.3);       // t=128
    adv(64); expect(tx(sal)).toBeGreaterThan(1.8);     // t=192
    adv(300); expect(tx(sal)).toBe(0);
  });
  it("56 altında titreme yok", () => {
    const m = mount(40, "idle"); adv(100); m.set("error"); adv(48);
    expect(tx(m.q(".g-sal")!)).toBe(0);
  });
});

describe("bitti pırıltısı", () => {
  it("56 px: 500 ms'de başlar, 140 ms arayla 5 pırıltı; sonra hepsi kalkar", () => {
    const m = mount(56, "idle"); adv(100);
    m.set("done");
    const n = () => m.container.querySelectorAll(".g-spark").length;
    adv(499); expect(n()).toBe(0);
    adv(1); expect(n()).toBe(1);
    adv(140); expect(n()).toBe(2);
    adv(140); expect(n()).toBe(3);
    adv(140); expect(n()).toBe(4);
    adv(140); expect(n()).toBe(5);
    adv(2000); expect(n()).toBe(0);
  });
  it("40 px: pırıltı yok", () => {
    const m = mount(40, "idle"); adv(100); m.set("done"); adv(1500);
    expect(m.container.querySelectorAll(".g-spark").length).toBe(0);
  });
});

describe("bakış", () => {
  it("40 px: göz hedefi tanh ile, CouCou yumuşatmasıyla ilerler", () => {
    const m = mount(40, "idle", { cursor: { x: 260, y: 200 } });
    const track = m.q(".g-gozler-takip")!;
    adv(16);
    const first = Number(/translate\(([-\d.e]+)%/.exec(track.style.transform)![1]);
    expect(first).toBeGreaterThan(0.1); expect(first).toBeLessThan(0.6);   // 2,59 hedefin ~%9'u
    adv(1000);
    expect(track.style.transform).toBe(`translate(${Math.tanh(1) * 3.4}%, ${Math.tanh(1) * 2.6}%)`);
  });
  it("24 px: göz takibi yok", () => {
    const m = mount(24, "idle", { cursor: { x: 260, y: 0 } }); adv(500);
    expect(m.q(".g-gozler-takip")).toBeNull();
  });
});

describe("dosya yutma", () => {
  it("swallow: sy 0,78 -> 1,18 -> 1; ağız 460 ms açık", () => {
    const m = mount(56, "idle"); adv(100);
    const sq = m.q(".g-ezil")!, mouth = m.q(".g-agiz")!;
    m.ref.current!.swallow();
    adv(80); expect(scale(sq)[1]).toBeCloseTo(.78, 1); expect(mouth.dataset.d).toBe("agiz-acik");
    adv(128); expect(scale(sq)[1]).toBeCloseTo(1.18, 1);
    adv(224); expect(scale(sq)[1]).toBeCloseTo(1, 1);
    adv(120); expect(mouth.dataset.d).toBe("agiz-gulus");   // 552 > 460
  });
  it("yutma: dosya simgesi çıkar ve ağza küçülüp kalkar; ağız kapanınca 3 çiğneme, sonra ağız normale döner", () => {
    const m = mount(56, "idle"); adv(100);
    const mouth = m.q(".g-agiz")!;
    m.ref.current!.swallow(); adv(50);
    expect(m.container.querySelectorAll(".g-dosya").length).toBe(1);
    adv(330); expect(m.container.querySelectorAll(".g-dosya").length).toBe(0); expect(mouth.dataset.d).toBe("agiz-acik");   // 380 ms: simge gitti, ağız hâlâ açık (460'ta çiğneme başlar)
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) { adv(60); seen.add(mouth.dataset.d!); }
    expect(seen.has("agiz-o") && seen.has("agiz-gulus")).toBe(true);   // çiğneme: o <-> gülüş
    adv(600); expect(mouth.dataset.d).toBe("agiz-gulus");
    expect(m.q(".g-goz")!.dataset.d).toBe("goz-acik");
  });
  it("24 px: yalnız ezilme, ağız yok", () => {
    const m = mount(24, "idle"); adv(100);
    m.ref.current!.swallow(); adv(80);
    expect(scale(m.q(".g-ezil")!)[1]).toBeCloseTo(.78, 1);
  });
  it("onFileDrop: dosya bırakınca yutar ve çağrılır; dosya olmayan sürükleme yok sayılır", () => {
    const onFileDrop = vi.fn();
    const m = mount(56, "idle", { onFileDrop }); adv(100);
    const f = new File(["x"], "a.txt");
    fireEvent.drop(m.q(".mascot")!, { dataTransfer: { types: ["text/plain"], files: [] } });
    expect(onFileDrop).not.toHaveBeenCalled();
    fireEvent.drop(m.q(".mascot")!, { dataTransfer: { types: ["Files"], files: [f] } });
    expect(onFileDrop).toHaveBeenCalledWith([f]);
    expect(m.q(".g-agiz")!.dataset.d).toBe("agiz-acik");
  });
});

describe("tıklamada sersemleme (yalnız 96 px)", () => {
  const eyes = (m: ReturnType<typeof mount>) => m.q(".g-goz")!.dataset.d;
  it("1 tıklama 800 ms sersem", () => {
    const m = mount(96, "sleeping"); adv(100);
    const base = eyes(m);
    fireEvent.pointerDown(m.q(".mascot")!);
    adv(799); expect(eyes(m)).toBe("goz-sersem");
    adv(2); expect(eyes(m)).toBe(base);
  });
  it("1,7 sn içinde 3 tıklama 3,3 sn", () => {
    const m = mount(96, "idle"); adv(100);
    const el = m.q(".mascot")!;
    fireEvent.pointerDown(el); adv(500); fireEvent.pointerDown(el); adv(500); fireEvent.pointerDown(el);
    adv(3299); expect(eyes(m)).toBe("goz-sersem");
    adv(2); expect(eyes(m)).toBe("goz-acik");
  });
  it("3 tıklamalık uzun sersemlik, sonradan gelen 4. tıklamayla kısalmaz", () => {
    const m = mount(96, "idle"); adv(100);
    const el = m.q(".mascot")!;
    for (let i = 0; i < 3; i++) { fireEvent.pointerDown(el); adv(200); }
    fireEvent.pointerDown(el);                       // 4. tıklama: tek tıklama süresi (800) uzun olanı kısaltmaz
    adv(2500); expect(eyes(m)).toBe("goz-sersem");   // 3. tıklamadan ~3,1 sn sonra hâlâ sersem
    adv(800); expect(eyes(m)).toBe("goz-acik");
  });
  it("56 ve 40 px: sersemleme yok", () => {
    for (const s of [56, 40]) {
      const m = mount(s, "idle"); adv(100);
      fireEvent.pointerDown(m.q(s === 40 ? ".mascot-hit" : ".mascot")!); adv(50);
      expect(eyes(m)).toBe("goz-cizgi"); m.unmount();   // sersem değil: tokat (kısık gözler)
    }
  });
});

describe("40 px asılı poz", () => {
  it("kutu 40x30, hit kutusu gövdede; tıklama yalnız hit kutusundan", () => {
    const onPoke = vi.fn();
    const m = mount(40, "idle", { onPoke }); adv(100);
    const host = m.q(".mascot")!, hit = m.q(".mascot-hit")!;
    expect([host.style.width, host.style.height, host.dataset.hang]).toEqual(["40px", "30px", "1"]);
    expect([hit.style.left, hit.style.top, hit.style.width, hit.style.height]).toEqual(["5px", "5px", "30px", "37px"]);
    expect(m.q(".g")!.classList.contains("asili")).toBe(true);
    fireEvent.pointerDown(host); expect(onPoke).not.toHaveBeenCalled();
    fireEvent.pointerDown(hit); expect(onPoke).toHaveBeenCalledTimes(1);
    expect(m.ref.current!.hitRect()).toEqual({ x: 0, y: 0, width: 0, height: 0 });   // jsdom'da yerleşim yok; gerçek değer tarayıcı karesinde ölçülür
  });
  it("hal efektleri 40 px'te: izin = el sallama, hata = yıldız halkası, dinliyor = kulak dalgaları", () => {
    const on = (m: ReturnType<typeof mount>, cls: string) => m.q(`.${cls}`)!.classList.contains("acik");
    const m = mount(40, "approval"); expect(on(m, "fx-sallama")).toBe(true); expect(on(m, "fx-tabela")).toBe(false);
    m.set("error"); expect(on(m, "fx-halka")).toBe(true);
    m.set("listening"); expect(on(m, "fx-mintSol")).toBe(true);
    m.set("thinking"); expect(on(m, "fx-nokta")).toBe(true);
    m.set("done"); expect(on(m, "fx-pirilti")).toBe(true);
  });
});

describe("dokunma tepkileri", () => {
  const hitOf = (m: ReturnType<typeof mount>) => m.q(".mascot-hit")!;
  const eyes = (m: ReturnType<typeof mount>) => m.q(".g-goz")!.dataset.d;
  it("tokat: gözler kısılır, ~600 ms sonra önceki hale döner; hal değişmez", () => {
    const onPoke = vi.fn();
    const m = mount(40, "idle", { onPoke }); adv(100);
    fireEvent.pointerDown(hitOf(m)); adv(100);
    expect(eyes(m)).toBe("goz-cizgi"); expect(m.q(".mascot")!.dataset.mood).toBe("idle");
    adv(700); expect(eyes(m)).toBe("goz-acik");
    expect(onPoke).toHaveBeenCalledTimes(1);
  });
  it("tıklama seli: asıl eylem (onPoke) her tıklamada çalışır; 5. tıklama sersem yapar, süre dolunca asıl hale döner, döngü yok", () => {
    const onPoke = vi.fn();
    const m = mount(40, "idle", { onPoke }); adv(100);
    for (let i = 0; i < 8; i++) { fireEvent.pointerDown(hitOf(m)); adv(50); }   // 400 ms'de 8 tıklama
    expect(onPoke).toHaveBeenCalledTimes(8);
    expect(m.q(".mascot")!.dataset.mood).toBe("dizzy"); expect(eyes(m)).toBe("goz-sersem");
    adv(3000); expect(m.q(".mascot")!.dataset.mood).toBe("idle"); expect(eyes(m)).toBe("goz-acik");
    fireEvent.pointerDown(hitOf(m)); adv(60); expect(eyes(m)).toBe("goz-cizgi");   // sersemden sonra tokat yine çalışır
  });
  it("sevgi: 1,9 sn üstünde kalınca kalpler çıkar, gözler yumuşar; erken ayrılırsa hiçbir şey", () => {
    const m = mount(40, "idle"); adv(100);
    fireEvent.pointerEnter(hitOf(m)); adv(1000); fireEvent.pointerLeave(hitOf(m)); adv(2000);
    expect(m.container.querySelectorAll(".g-kalp").length).toBe(0);
    fireEvent.pointerEnter(hitOf(m)); adv(2000);
    expect(eyes(m)).toBe("goz-huzurlu");
    adv(600); expect(m.container.querySelectorAll(".g-kalp").length).toBeGreaterThan(0);
    adv(3500); expect(m.container.querySelectorAll(".g-kalp").length).toBe(0); expect(eyes(m)).toBe("goz-acik");
  });
  it("sevgi: onay gibi hallerde yok; 8 sn içinde ikinci kez yok", () => {
    const a = mount(40, "approval"); adv(100);
    fireEvent.pointerEnter(hitOf(a)); adv(2500);
    expect(a.container.querySelectorAll(".g-kalp").length).toBe(0); a.unmount();
    const m = mount(40, "idle"); adv(100);
    fireEvent.pointerEnter(hitOf(m)); adv(2000); adv(4000); fireEvent.pointerLeave(hitOf(m));
    fireEvent.pointerEnter(hitOf(m)); adv(2500);
    expect(eyes(m)).toBe("goz-acik");
  });
});

describe("yeni haller: arıyor, soru, kota, sersem", () => {
  const tag = (m: ReturnType<typeof mount>) => m.q(".g-rozet");
  it("arıyor: gözler tarar (tara işareti), açık gözler, mavi ışık", () => {
    const m = mount(56, "searching"); adv(300);
    expect(m.q(".g")!.dataset.tara).toBe("1"); expect(m.q(".g-goz")!.dataset.d).toBe("goz-acik");
    m.set("idle"); expect(m.q(".g")!.dataset.tara).toBe("");
  });
  it("soru: '?' rozeti 40 px ve üstünde, 24'te yok; baş yatar", () => {
    for (const s of [40, 56]) { const m = mount(s, "question"); adv(300); expect(tag(m)!.textContent).toBe("?"); expect(tag(m)!.dataset.s).toBe("in"); expect(m.q(".g-goz")!.dataset.d).toBe("goz-yukari"); m.unmount(); }
    const a = mount(24, "question"); adv(300); expect(tag(a)).toBeNull();
  });
  it("kota: turuncu nokta rozeti, yorgun gözler, ter damlaları açık; başka hale geçince kapanır", () => {
    const m = mount(56, "ratelimit"); adv(300);
    expect(tag(m)!.dataset.k).toBe("dot"); expect(tag(m)!.textContent).toBe(""); expect(m.q(".g-goz")!.dataset.d).toBe("goz-uzgun");
    expect(m.q(".g-ter")!.classList.contains("acik")).toBe(true);
    m.set("idle"); expect(m.q(".g-ter")!.classList.contains("acik")).toBe(false); expect(tag(m)!.dataset.s).toBe("out");
  });
  it("sersem: spiral gözler, dil, yıldız halkası; girişte yuvarlanır (daze izi 360'a gider)", () => {
    const m = mount(56, "idle"); adv(300); m.set("dizzy"); adv(450);
    expect(m.q(".g-goz")!.dataset.d).toBe("goz-sersem"); expect(m.q(".g-agiz")!.dataset.d).toBe("agiz-dil"); expect(m.q("div.fx-halka")!.classList.contains("acik")).toBe(true);
    const deg = Number(/rotate\(([-\d.e]+)deg\)/.exec(m.q(".g-sal")!.style.transform)?.[1]);
    expect(deg).toBeGreaterThan(30);   // 450 ms'de tur ortasında
  });
});
