import { describe, expect, it } from "vitest";
import { createFlight } from "../flight";
import { createShape, type Rect } from "../shape";
import { advance, Spring, SPRINGS } from "../spring";

const run = (s: Spring, sec: number, dt = 1 / 60) => { for (let t = 0; t < sec; t += dt) advance(s, dt); };

describe("Spring", () => {
  it("hedefe yakınsar ve durgunlaşır", () => {
    const s = new Spring(0, SPRINGS.card);
    s.retarget(100);
    run(s, 3);
    expect(s.settled).toBe(true);
    s.snap();
    expect(s.x).toBe(100);
    expect(s.v).toBe(0);
  });

  it("0,78 sönümle hafif aşar, sönüm 1'de aşmaz", () => {
    const a = new Spring(0, SPRINGS.card), b = new Spring(0, { tepki: 0.44, sonum: 1 });
    a.retarget(100); b.retarget(100);
    let ma = 0, mb = 0;
    for (let t = 0; t < 2; t += 1 / 120) { advance(a, 1 / 120); advance(b, 1 / 120); ma = Math.max(ma, a.x); mb = Math.max(mb, b.x); }
    expect(ma).toBeGreaterThan(100.5);
    expect(mb).toBeLessThanOrEqual(100.01);
  });

  it("hareket ederken hedef değişince konum ve hız korunur (sıçrama yok)", () => {
    const s = new Spring(0, SPRINGS.card);
    s.retarget(100);
    run(s, 0.15);
    const x = s.x, v = s.v;
    expect(v).toBeGreaterThan(50);
    s.retarget(0);
    expect(s.x).toBe(x);
    expect(s.v).toBe(v);
    advance(s, 1 / 240);
    expect(Math.abs(s.x - x)).toBeLessThan(v / 240 + 1); // hızla devam eder, atlamaz
    run(s, 3);
    expect(s.settled).toBe(true);
    expect(Math.abs(s.x)).toBeLessThan(0.05);
  });

  it("geri dönüşte hız bir anda sıfırlanmaz: önce ileri sürer, sonra döner", () => {
    const s = new Spring(0, SPRINGS.card);
    s.retarget(100);
    run(s, 0.1);
    const x0 = s.x;
    s.retarget(0);
    run(s, 0.03);
    expect(s.x).toBeGreaterThan(x0); // momentum
  });
});

const boxAt = (left: number, top: number, w: number, h: number) =>
  ({ left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON() {} }) as DOMRect;

describe("createShape", () => {
  const setup = () => {
    const host = document.createElement("div"), body = document.createElement("div");
    host.getBoundingClientRect = () => boxAt(100, 30, 600, 300);
    const rects: Rect[] = [];
    const sh = createShape(host, body, { maxW: 600, maxH: 300, restW: 200, onRect: (r) => rects.push(r) });
    return { host, body, sh, rects };
  };

  it("kapalıyken boş dikdörtgen, gövde gizli", () => {
    const { body, sh } = setup();
    expect(sh.rect()).toEqual({ x: 300, y: 30, w: 0, h: 0 });
    expect(body.style.visibility).toBe("hidden");
  });

  it("snap: ortalı dikdörtgen host konumuna göre doğru; clip-path ve onRect", () => {
    const { body, sh, rects } = setup();
    sh.snap(400, 120);
    expect(sh.rect()).toEqual({ x: 100 + 100, y: 30, w: 400, h: 120 });
    expect(rects.at(-1)).toEqual({ x: 200, y: 30, w: 400, h: 120 });
    expect(body.style.clipPath).toContain("inset(0 100px 180px 100px round");
    expect(body.style.visibility).toBe("visible");
  });

  it("to: pencere sabit, dikdörtgen her karede değişir ve hedefte tam oturur", () => {
    const { host, body, sh, rects } = setup();
    sh.to(300, 44);
    expect(sh.rect().w).toBe(0); // henüz hareket yok
    let n = 0;
    while (sh.advance(1 / 60) && n++ < 600);
    expect(sh.rect()).toEqual({ x: 100 + 150, y: 30, w: 300, h: 44 });
    expect(rects.length).toBeGreaterThan(5);
    expect(rects.at(-1)).toEqual(sh.rect());
    expect(host.style.width).toBe("600px"); // pencere/host hiç yeniden boyutlanmadı
    expect(body.style.width).toBe("600px");
    // ortada kalır: her ara dikdörtgen merkezi host merkezinde
    for (const r of rects) if (r.w) expect(Math.abs(r.x + r.w / 2 - 400)).toBeLessThanOrEqual(1);
  });

  it("yarıda yeni hedef: kart → çıkıntı geri dönüşü sıçramaz", () => {
    const { sh } = setup();
    sh.snap(300, 44);
    sh.to(560, 260);
    for (let i = 0; i < 8; i++) sh.advance(1 / 60);
    const mid = sh.rect();
    sh.to(300, 44);
    const after = (sh.advance(1 / 240), sh.rect());
    expect(Math.abs(after.h - mid.h)).toBeLessThan(10);
    let n = 0;
    while (sh.advance(1 / 60) && n++ < 600);
    expect(sh.rect().h).toBe(44);
  });

  it("sağ çapa: sağ kenar host sağ kenarında", () => {
    const host = document.createElement("div"), body = document.createElement("div");
    host.getBoundingClientRect = () => boxAt(0, 0, 400, 200);
    const sh = createShape(host, body, { maxW: 400, maxH: 200, anchor: "right" });
    sh.snap(340, 100);
    expect(sh.rect()).toEqual({ x: 60, y: 0, w: 340, h: 100 });
  });
});

describe("createFlight", () => {
  it("öğeyi eski konumdan yeni konuma uçurur, bitince dönüşümü temizler", () => {
    document.body.innerHTML = `<div id="a" data-paylas="t"></div>`;
    const el = document.getElementById("a")!;
    let pos = { left: 10, top: 5, height: 20 };
    el.getBoundingClientRect = () => {
      const hasT = el.style.transform !== "";
      return boxAt(hasT ? pos.left + 30 : pos.left, pos.top, 50, pos.height);
    };
    const fl = createFlight(document);
    fl.capture();
    pos = { left: 200, top: 100, height: 40 };
    fl.play();
    expect(el.style.transform).toContain("translate(-190px,-95px) scale(0.5)");
    let n = 0;
    while (fl.advance(1 / 60) && n++ < 600);
    fl.advance(1 / 60);
    expect(el.style.transform).toBe("");
    fl.destroy();
  });
});
