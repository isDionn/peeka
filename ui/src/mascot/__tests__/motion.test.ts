import { describe, expect, it } from "vitest";
import { DAZE, REACT, SHAKE, SWALLOW_X, SWALLOW_Y, createClickCounter, createReactionGate, dizzyTrack, gazeStep, gazeTarget, sample, shakeTrack, swayTrack, trackMs } from "../motion";
import { HANG, sizePlan } from "../moods";

describe("izler", () => {
  it("titreme: +4, -4, +2,5, 0 px; 50/70/70/90 ms (toplam 280)", () => {
    expect(SHAKE.map(([, d]) => d)).toEqual([50, 70, 70, 90]);
    expect(trackMs(SHAKE)).toBe(280);
    const at = (t: number) => sample(SHAKE, 0, t);
    expect([at(50), at(120), at(190), at(280)]).toEqual([4, -4, 2.5, 0]);
    expect(at(25)).toBeGreaterThan(0); expect(at(25)).toBeLessThan(4);
    expect(at(1000)).toBe(0);
  });
  it("titreme büyük kartta size/56 ölçeklenir, 56'da aynı", () => {
    expect(shakeTrack(56)).toEqual(SHAKE);
    expect(shakeTrack(112)[0][0]).toBe(8);
  });
  it("yutma: sy 0,78 -> 1,18 -> 1 (80/130/220), sx 1,28 -> 0,92 -> 1", () => {
    expect(SWALLOW_Y.map(([v, d]) => [v, d])).toEqual([[.78, 80], [1.18, 130], [1, 220]]);
    expect(sample(SWALLOW_Y, 1, 80)).toBeCloseTo(.78); expect(sample(SWALLOW_Y, 1, 210)).toBeCloseTo(1.18); expect(sample(SWALLOW_Y, 1, 430)).toBeCloseTo(1);
    expect(sample(SWALLOW_X, 1, 80)).toBeCloseTo(1.28); expect(sample(SWALLOW_X, 1, 210)).toBeCloseTo(.92);
  });
  it("sersem sallanması süre sonunda 0'a döner", () => {
    const tr = swayTrack(3300);
    expect(sample(tr, 0, trackMs(tr))).toBe(0);
  });
});

describe("sersemleme eşikleri", () => {
  it("tek tıklama 800 ms; 1,7 sn içinde 3. tıklama 3,3 sn", () => {
    let t = 0; const click = createClickCounter(() => t);
    expect(click()).toBe(DAZE.one); t = 800; expect(click()).toBe(DAZE.one); t = 1700; expect(click()).toBe(DAZE.triple);
    expect(DAZE.triple).toBe(3300); expect(DAZE.one).toBe(800);
  });
  it("1,7 sn dışına taşan 3. tıklama sayılmaz; sayaç üçlüden sonra sıfırlanır", () => {
    let t = 0; const click = createClickCounter(() => t);
    click(); t = 900; click(); t = 1701; expect(click()).toBe(DAZE.one);   // ilk tıklama pencereden düştü, elde 2
    t = 2000; expect(click()).toBe(DAZE.triple);                         // 900, 1701, 2000 hepsi 1,7 sn içinde
    t = 2100; expect(click()).toBe(DAZE.one);                            // sıfırlandı
  });
});

describe("bakış matematiği", () => {
  it("hedef tanh(dx/260), tanh(dy/200)", () => {
    const [x, y] = gazeTarget(260, 200);
    expect(x).toBeCloseTo(Math.tanh(1)); expect(y).toBeCloseTo(Math.tanh(1));
    expect(gazeTarget(0, 0)).toEqual([0, 0]);
    expect(gazeTarget(-5000, 5000)).toEqual([-1, 1]);
  });
  it("yumuşatma 1 - 0,0025^dt: dt 0 -> 0, 1 sn -> 0,9975, dt arttıkça artar", () => {
    expect(gazeStep(0)).toBe(0);
    expect(gazeStep(1)).toBeCloseTo(.9975);
    expect(gazeStep(.016)).toBeGreaterThan(0); expect(gazeStep(.016)).toBeLessThan(gazeStep(.033));
  });
});

describe("boy planı", () => {
  it("rozet, titreme, pırıltı yalnız ≥56 px", () => {
    for (const s of [20, 24, 28, 40, 55]) expect(sizePlan(s)).toMatchObject({ badge: false, shake: false, sparkle: false });
    for (const s of [56, 96]) expect(sizePlan(s)).toMatchObject({ badge: true, shake: true, sparkle: true });
  });
  it("40 px asılı poz; göz takibi var, siluet yok; hit kutusu şerit altına ~12 px sarkar", () => {
    expect(sizePlan(40)).toMatchObject({ hang: true, silhouette: false, eyeTracking: true });
    expect(sizePlan(24).hang).toBe(false);
    const bottom = HANG.hit.y + HANG.hit.h - HANG.box.h;
    expect(bottom).toBeGreaterThanOrEqual(10); expect(bottom).toBeLessThanOrEqual(14);
  });
});

describe("tepki kapısı", () => {
  it("tokat: 350 ms'den sık tıklama sayılmaz, sonra yine serbest", () => {
    let t = 0; const g = createReactionGate(() => t);
    expect(g.tap()).toBe("slap");
    t = 100; expect(g.tap()).toBe("none");
    t = 349; expect(g.tap()).toBe("none");
    t = 350; expect(g.tap()).toBe("slap");
  });
  it("sel: 3 sn'de 100 tıklama en çok 9 tokat", () => {
    let t = 0; const g = createReactionGate(() => t); let n = 0;
    for (; t < 3000; t += 30) if (g.tap() === "slap") n++;
    expect(n).toBeLessThanOrEqual(9);
  });
  it("sersem: 3 sn içinde 5. tıklama 'dizzy'; süresince tepki yok; sonra sayaç sıfırdan", () => {
    let t = 0; const g = createReactionGate(() => t);
    const r: string[] = [];
    for (let i = 0; i < 5; i++) { r.push(g.tap()); t += 200; }
    expect(r).toEqual(["slap", "none", "slap", "none", "dizzy"]);
    t += 500; expect(g.tap()).toBe("none");                       // sersemlik sürüyor
    t += REACT.dizzyMs; expect(g.tap()).toBe("slap");              // bitti, ilk tıklama yine tokat
    for (let i = 0; i < 3; i++) { t += 400; expect(g.tap()).not.toBe("dizzy"); }
  });
  it("sersem: yavaş tıklama (pencere dışı) asla sersem yapmaz", () => {
    let t = 0; const g = createReactionGate(() => t);
    for (let i = 0; i < 20; i++) { expect(g.tap()).toBe("slap"); t += 900; }
  });
  it("sersem izi: ilk 900 ms'de bir tur (360), sonda 360'ta biter", () => {
    const tr = dizzyTrack(REACT.dizzyMs);
    expect(sample(tr, 0, 900)).toBeCloseTo(360); expect(sample(tr, 0, trackMs(tr))).toBeCloseTo(360);
  });
  it("sevgi: 8 sn'de bir", () => {
    let t = 0; const g = createReactionGate(() => t);
    expect(g.love()).toBe(true); t = REACT.loveGap - 1; expect(g.love()).toBe(false); t = REACT.loveGap; expect(g.love()).toBe(true);
  });
});
