// Yay motoru (§0i madde 8): k = (2π / tepki)², c = 4π × sönüm / tepki, kare başına 8 alt adım. Maketteki `Yay` sınıfı.
export interface SpringParams { tepki: number; sonum: number; eps?: number }
export const YAY = {
  kart: { tepki: 0.44, sonum: 0.78 },
  hizli: { tepki: 0.32, sonum: 0.84 },
  sag: { tepki: 0.4, sonum: 0.8 },
  sekme: { tepki: 0.34, sonum: 0.82 },
  sabit: { tepki: 0.38, sonum: 0.72 },
  serit: { tepki: 0.42, sonum: 0.9 },
  cizgi: { tepki: 0.6, sonum: 1, eps: 0.002 },
  hov: { tepki: 0.3, sonum: 1, eps: 0.002 },
} satisfies Record<string, SpringParams>;

/** §0i yay tablosu, kullanım adlarıyla. `protrusion` çıkıntı ile kart aynı öğe olduğundan `card` ile aynı sayılardır. */
export const SPRINGS = {
  card: YAY.kart,
  protrusion: YAY.kart,
  pill: YAY.sekme,
  press: YAY.hov,
  quick: YAY.hizli,
  side: YAY.sag,
  bar: YAY.serit,
  line: YAY.cizgi,
  fly: YAY.sabit,
} satisfies Record<string, SpringParams>;

export class Spring {
  x: number; t: number; v = 0;
  constructor(x: number, public p: SpringParams) { this.x = this.t = x; }
  step(dt: number) {
    const k = (2 * Math.PI / this.p.tepki) ** 2, c = 4 * Math.PI * this.p.sonum / this.p.tepki;
    this.v += (-k * (this.x - this.t) - c * this.v) * dt;
    this.x += this.v * dt;
  }
  get settled() { const e = this.p.eps ?? 0.05; return Math.abs(this.x - this.t) < e && Math.abs(this.v) < e * 4; }
  snap(x = this.t) { this.x = this.t = x; this.v = 0; }
  /** Yeni hedef; o anki konum ve hız korunur (kesilebilir). */
  retarget(t: number, p?: SpringParams) { this.t = t; if (p) this.p = p; }
}

/** Kareyi sabit ~0,5 ms'lik alt adımlarla ilerletir (en az 8; dt üst sınırı 1/30 sn). Alt adım Hz'den bağımsız: 60 ve 240 Hz aynı hareketi verir. */
export function advance(s: Spring, dt: number) {
  const d = Math.min(dt, 1 / 30), n = Math.max(8, Math.ceil(d * 1920)), h = d / n;
  for (let i = 0; i < n; i++) s.step(h);
  if (s.settled) s.snap();
}

/** Bir grup yayı tek rAF döngüsüyle sürer; yalnız bir yay hareket ederken çalışır. */
export class SpringGroup {
  private raf = 0;
  private last = 0;
  constructor(readonly springs: Spring[], private onFrame: () => void) {}
  get moving() { return this.springs.some((s) => !s.settled); }
  /** Bir kare ilerlet (rAF'siz de çağrılabilir: testler). Hareket sürüyorsa true. */
  advance(dt: number) {
    for (const s of this.springs) advance(s, dt);
    this.onFrame();
    return this.moving;
  }
  /** Döngüyü uyandır (hedef değişince). Zaten çalışıyorsa bir şey yapmaz. */
  kick() {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }
  private tick = (t: number) => {
    this.raf = 0;
    const dt = (t - this.last) / 1000 || 0.016;
    this.last = t;
    if (this.advance(dt) && !this.raf) this.raf = requestAnimationFrame(this.tick);
  };
}
