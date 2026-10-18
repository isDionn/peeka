// Spring engine (§0i item 8): k = (2π / response)², c = 4π × damping / response, 8 substeps per frame. The mockup's `Yay` class.
export interface SpringParams { response: number; damping: number; eps?: number }

/** §0i spring table by use. `protrusion` equals `card` because the peek and the card are the same element. */
export const SPRINGS = {
  card: { response: 0.44, damping: 0.78 },
  protrusion: { response: 0.44, damping: 0.78 },
  pill: { response: 0.34, damping: 0.82 },
  press: { response: 0.3, damping: 1, eps: 0.002 },
  quick: { response: 0.32, damping: 0.84 },
  side: { response: 0.4, damping: 0.8 },
  bar: { response: 0.42, damping: 0.9 },
  line: { response: 0.6, damping: 1, eps: 0.002 },
  fly: { response: 0.38, damping: 0.72 },
} satisfies Record<string, SpringParams>;

export class Spring {
  x: number; t: number; v = 0;
  constructor(x: number, public p: SpringParams) { this.x = this.t = x; }
  step(dt: number) {
    const k = (2 * Math.PI / this.p.response) ** 2, c = 4 * Math.PI * this.p.damping / this.p.response;
    this.v += (-k * (this.x - this.t) - c * this.v) * dt;
    this.x += this.v * dt;
  }
  get settled() { const e = this.p.eps ?? 0.05; return Math.abs(this.x - this.t) < e && Math.abs(this.v) < e * 4; }
  snap(x = this.t) { this.x = this.t = x; this.v = 0; }
  /** New target; the current position and velocity carry over (interruptible). */
  retarget(t: number, p?: SpringParams) { this.t = t; if (p) this.p = p; }
}

/** Advances a frame in fixed ~0.5 ms substeps (at least 8; dt capped at 1/30 s). Substeps don't depend on Hz: 60 and 240 Hz give the same motion. */
export function advance(s: Spring, dt: number) {
  const d = Math.min(dt, 1 / 30), n = Math.max(8, Math.ceil(d * 1920)), h = d / n;
  for (let i = 0; i < n; i++) s.step(h);
  if (s.settled) s.snap();
}

/** Drives a group of springs with one rAF loop; runs only while a spring is moving. */
export class SpringGroup {
  private raf = 0;
  private last = 0;
  constructor(readonly springs: Spring[], private onFrame: () => void) {}
  get moving() { return this.springs.some((s) => !s.settled); }
  /** Advance one frame (callable without rAF: tests). true while still moving. */
  advance(dt: number) {
    for (const s of this.springs) advance(s, dt);
    this.onFrame();
    return this.moving;
  }
  /** Wake the loop (when a target changes). Does nothing if already running. */
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
