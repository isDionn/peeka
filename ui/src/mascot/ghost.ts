// maskot-motor.js'in TS portu: gerçek görsel parçalar (public/mascot/parts) üst üste konup yaylarla oynar. Çizim kodu yok, SVG yok.
// 24 px (27 ve altı): tek siluet (public/mascot/sprite24, 1x/2x/3x srcset); 28 px ve üstü: parçalı, allıklı.
// Hareketsizken çizim döngüsü durur (CouCou `busy` kapısı: windows/src/mochi/engine.ts, MIT, bkz. docs/THIRD_PARTY_NOTICES.md).
// Sürekli süzülme/nefes/efekt salınımı CSS animasyonudur (mascot.css), JS döngüsü yalnız yay/bakış/süreli izlerde çalışır.
import { CLOSED_EYES, MOODS, pickScale, sizePlan, type Fx, type Mood } from "./moods";
import { BADGE, CHEW, CHEW_Y, POKE_X, POKE_Y, REACT, SPARKLE, SWALLOW_FILE_MS, SWALLOW_MOUTH_MS, SWALLOW_X, SWALLOW_Y, dizzyTrack, gazeStep, gazeTarget, sample, shakeTrack, swayTrack, trackMs, type Track } from "./motion";

export const ASSET_BASE = `${import.meta.env.BASE_URL}mascot/`;
const PARTS = `${ASSET_BASE}parts/`;
const SPRITES = `${ASSET_BASE}sprite24/`;

// tasarım kutusu 600x800 birim; yüz noktası (300, 380)
const KX = 600, KY = 800, YX = 300, YY = 380;
const BODY_FACE: Record<string, [number, number, number]> = { // genişlik, yüz x, yüz y (piksel, 3840 ölçeği)
  "notr": [419, 208, 316], "eller-yukari": [444, 220, 280], "cene": [378, 178, 270], "yanaklar": [396, 196, 268],
  "egik": [419, 213, 278], "basik": [465, 233, 226], "uzun": [394, 191, 282], "ucceyrek": [362, 192, 277],
};
const EYE = { w: 268, dy: -8 }, MOUTH = { w: 180 * .8, dy: 70, h: 168 * .8 }, BLUSH = { w: 299, h: 209, dy: 44 };
// efekt: [dosya, x, y, genişlik, ek stil]
const FX: Record<Exclude<Fx, "ter">, [string, number, number, number, string?]> = {
  zzz: ["efekt-zzz-jeton", 395, 70, 210],
  mintSol: ["efekt-dalga-mint-jeton", 20, 250, 250, "clip-path:inset(0 52% 0 0)"],
  mintSag: ["efekt-dalga-mint-jeton", 330, 250, 250, "clip-path:inset(0 0 0 48%)"],
  nokta: ["efekt-noktalar-jeton", 400, 150, 190],
  kirmiziSag: ["efekt-dalga-kirmizi-jeton", 470, 255, 120],
  kirmiziSol: ["efekt-dalga-kirmizi-jeton", 15, 275, 100],
  tabela: ["soru-tabela", 40, 400, 170],
  amber: ["efekt-pirilti-beyaz", 420, 150, 120],
  pirilti: ["efekt-pirilti-jeton", 20, 90, 200],
  pirilti2: ["efekt-pirilti-2-jeton", 450, 120, 130],
  halka: ["efekt-yildiz-halka", 70, 20, 460],
  sallama: ["el-sallama", 455, 285, 135],
  nota: ["efekt-nota", -10, 200, 470, "clip-path:inset(0 68% 0 0)"],
  nota2: ["efekt-nota", 235, 140, 450, "clip-path:inset(0 0 0 36%)"],
};

class Spring {
  v: number; target: number; vel = 0;
  constructor(v: number, private k = 170, private c = 18) { this.v = v; this.target = v; }
  step(dt: number) { const f = -this.k * (this.v - this.target) - this.c * this.vel; this.vel += f * dt; this.v += this.vel * dt; }
  get rest() { return Math.abs(this.v - this.target) < 1e-3 && Math.abs(this.vel) < 1e-3; }
}

const pct = (v: number, t: number) => `${(v / t) * 100}%`;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: Element, attrs: Record<string, string> = {}) {
  const e = document.createElement(tag);
  e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
}
const img = (cls: string, parent: Element, style: Record<string, string> = {}) => {
  const e = el("img", cls, parent, { alt: "", draggable: "false" });
  Object.assign(e.style, style);
  return e;
};

export interface GhostOptions { size: number; mood: Mood; still?: boolean }

type OvKey = "shake" | "swX" | "swY" | "daze";
const OV_DEFAULT: Record<OvKey, number> = { shake: 0, swX: 1, swY: 1, daze: 0 };

export class Ghost {
  readonly root: HTMLElement;
  private plan; private still: boolean; private size: number;
  private mood: Mood;
  private sal: HTMLElement; private squash: HTMLElement;
  private sil?: HTMLImageElement;
  private bodies: HTMLImageElement[] = []; private bodyIdx = 0; private bodyName = "";
  private eyes?: HTMLImageElement; private mouth?: HTMLImageElement; private blush?: HTMLImageElement;
  private track?: HTMLElement; private blink?: HTMLElement; private light?: HTMLElement; private ground?: HTMLElement;
  private badge?: HTMLElement; private ter?: HTMLElement;
  private fx = new Map<Exclude<Fx, "ter">, HTMLImageElement>(); private fxw = new Map<Exclude<Fx, "ter">, HTMLElement>();
  private y = new Spring(0, 140, 14); private sx = new Spring(1, 260, 14); private sy = new Spring(1, 260, 14);
  private rot = new Spring(0, 120, 12);
  /** Bakış (yüzde): x,y şimdiki, tx,ty hedef; CouCou üstel yumuşatma. */
  private gz = { x: 0, y: 0, tx: 0, ty: 0 };
  /** Süreli izler (titreme, yutma, ezilme, sersem sallanma); biri sürerken döngü uyumaz. */
  private anims = new Map<OvKey, { t0: number; from: number; tr: Track }>();
  private ov = { ...OV_DEFAULT };
  private playing = false; private ovBody: string | null = null; private ovEyes: string | null = null; private ovMouth: string | null = null;
  private raf = 0; private t0 = performance.now(); private last = this.t0; private phase: number;
  private timers = new Set<ReturnType<typeof setTimeout>>(); private dead = false;
  private badgeT?: ReturnType<typeof setTimeout>; private eyesT?: ReturnType<typeof setTimeout>; private dazeT?: ReturnType<typeof setTimeout>; private dazeEnd = 0;
  /** Son klavye girdisi (ms, performance.now): 3 sn içinde kırpma yok (madde 19, kural 3). Dışarıdan beslenir. */
  lastInput = -Infinity;

  constructor(host: HTMLElement, { size, mood, still = false }: GhostOptions) {
    this.plan = sizePlan(size); this.mood = mood; this.still = still; this.size = size;
    this.phase = still ? 0 : Math.random() * 6;
    const cls = "g" + (this.plan.silhouette ? " sade" : "") + (this.plan.hang ? " asili" : "") + (still ? " durgun" : "");
    const root = this.root = el("div", cls, host, { "aria-hidden": "true" });
    root.style.setProperty("--olcek", String(size / 300));
    root.style.setProperty("--faz", `${-this.phase}s`);
    if (this.plan.effects) {
      this.light = el("div", "g-isik", root);
      this.ground = el("div", "g-zemin", root);
    }
    this.sal = el("div", "g-sal", el("div", "g-yuz-dis", root));
    this.squash = el("div", "g-ezil", this.sal);
    if (this.plan.silhouette) {
      this.sil = img("g-sil", this.squash);
    } else {
      this.bodies = [img("g-govde", this.squash), img("g-govde gizli", this.squash)];
      const face = el("div", "g-yuz", this.squash);
      if (this.plan.blush) {
        this.blush = img("g-parca g-allik", face, { left: pct(YX - BLUSH.w / 2, KX), top: pct(YY + BLUSH.dy - BLUSH.h / 2, KY), width: pct(BLUSH.w, KX), opacity: ".9" });
        this.blush.src = `${PARTS}allik.webp`;
      }
      this.track = el("div", "g-gozler-takip", face);
      this.blink = el("div", "g-gozler-kirp", this.track);
      this.eyes = img("g-parca g-goz", this.blink, { left: pct(YX - EYE.w / 2, KX), top: pct(YY + EYE.dy - 257 / 2, KY), width: pct(EYE.w, KX) });
      this.mouth = img("g-parca g-agiz", face, { left: pct(YX - MOUTH.w / 2, KX), top: pct(YY + MOUTH.dy - MOUTH.h / 2, KY), width: pct(MOUTH.w, KX) });
      for (const [name, [, x, yy, w, extra]] of Object.entries(FX) as [Exclude<Fx, "ter">, (typeof FX)[Exclude<Fx, "ter">]][]) {
        const wrap = el("div", `g-fxw fx-${name}`, this.sal);   // salınım CSS animasyonu sarmalayıcıda, açma/kapama img'de
        const f = img("g-fx", wrap, { left: pct(x, KX), top: pct(yy, KY), width: pct(w, KX) });
        if (extra) f.style.cssText += `;${extra}`;
        if (name === "kirmiziSol") f.style.transform = "scaleX(-1)";
        this.fx.set(name, f); this.fxw.set(name, wrap);
      }
    }
    if (this.plan.effects) {   // kota halinin ter damlaları (CSS): vücutla birlikte hareket eder
      this.ter = el("div", "g-ter", this.sal);
      for (let i = 0; i < 3; i++) el("span", "", this.ter).style.setProperty("--i", String(i));
    }
    if (this.plan.tag) { this.badge = el("div", "g-rozet", root, { "data-s": "out" }); this.badge.textContent = "!"; }
    this.setMood(mood, true);
    if (!still) { this.scheduleBlink(); this.wake(); }
    else this.frame(this.t0 + 600);
  }

  private afterTimer(fn: () => void, ms: number) {
    const id = setTimeout(() => { this.timers.delete(id); if (!this.dead) fn(); }, ms);
    this.timers.add(id);
  }

  private setPart(e: HTMLImageElement, name: string) {
    if (e.dataset.d === name) return;
    const first = !e.dataset.d;
    e.dataset.d = name;
    if (first || this.still) { e.src = `${PARTS}${name}.webp`; return; }
    e.classList.add("gizli");
    this.afterTimer(() => { e.src = `${PARTS}${name}.webp`; e.classList.remove("gizli"); }, 90);
  }
  private setBody(name: string) {
    if (this.bodyName === name) return;
    this.bodyName = name;
    const [oldB, newB] = [this.bodies[this.bodyIdx], this.bodies[1 - this.bodyIdx]];
    const [w, fx, fy] = BODY_FACE[name];
    newB.src = `${PARTS}govde-${name}.webp`;
    Object.assign(newB.style, { left: pct(YX - fx, KX), top: pct(YY - fy, KY), width: pct(w, KX) });
    newB.classList.remove("gizli"); oldB.classList.add("gizli");
    this.bodyIdx = 1 - this.bodyIdx;
  }
  private show() {
    const m = MOODS[this.mood];
    if (this.sil) {
      const s = MOODS[this.mood].sil;
      this.sil.srcset = [1, 2, 3].map((k) => `${SPRITES}${s}@${k}x.webp ${k}x`).join(", ");
      this.sil.src = `${SPRITES}${s}@${pickScale(devicePixelRatio)}x.webp`;
      return;
    }
    this.setBody(this.ovBody ?? m.body);
    this.setPart(this.eyes!, this.ovEyes ?? m.eyes);
    if (!m.talk) this.setPart(this.mouth!, this.ovMouth ?? m.mouth);
  }

  setMood(mood: Mood, first = false) {
    if (!first && mood === this.mood) return;
    if (!first) { clearTimeout(this.eyesT); this.ovEyes = null; }   // tokat/sevgi gözleri yeni halin gözlerini örtmesin
    this.mood = mood;
    const m = MOODS[mood];
    const on = new Set(m.fx.filter((f) => f !== "tabela" || this.plan.sign));
    this.ter?.classList.toggle("acik", on.has("ter"));
    for (const [name, f] of this.fx) {
      if (on.has(name) && !f.src) f.src = `${PARTS}${FX[name][0]}.webp`;   // efekt görseli ilk gereken ana kadar yüklenmez
      f.classList.toggle("acik", on.has(name));
      this.fxw.get(name)!.classList.toggle("acik", on.has(name));
    }
    this.root.style.setProperty("--hiz", String(m.speed));
    this.root.dataset.sway = m.sway ? "1" : "";
    this.root.dataset.sakin = m.speed === 0 ? "1" : "";
    this.root.dataset.tara = m.scan ? "1" : "";
    this.rot.target = m.tilt ?? 0;
    const perm = mood === "approval" && this.plan.badge;
    const tag = this.plan.tag ? m.tag : undefined;
    if (this.light) { this.light.style.backgroundColor = m.light ?? "transparent"; this.light.style.opacity = m.light ? (perm ? ".45" : ".22") : "0"; }
    this.show();
    if (this.badge) { this.badge.textContent = tag === "?" ? "?" : tag === "dot" ? "" : "!"; this.badge.dataset.k = tag ?? ""; }
    this.syncBadge(perm || !!tag, first);
    if (!first && !this.still && m.speed > 0) { this.sy.v = .94; this.sx.v = 1.04; }
    if (!first && !this.still) {
      if (mood === "error" && this.plan.shake) this.anim("shake", 0, shakeTrack(this.size));
      if (mood === "done" && this.plan.sparkle) this.sparkle();
      if (m.roll) this.anim("daze", 0, dizzyTrack(REACT.dizzyMs));
    }
    this.wake();
  }

  /** "!" rozeti: eski rozet 90 ms silinir, 100 ms sonra 280 ms geri-yaylı gelir (süreler CSS'te, motion.ts BADGE). */
  private syncBadge(on: boolean, first: boolean) {
    if (!this.badge) return;
    clearTimeout(this.badgeT);
    this.badge.dataset.s = "out";
    if (!on) return;
    if (first || this.still) { this.badge.dataset.s = "in"; return; }
    this.badgeT = setTimeout(() => { if (!this.dead) this.badge!.dataset.s = "in"; }, BADGE.delay);
  }

  private anim(key: OvKey, from: number, tr: Track) { this.anims.set(key, { t0: performance.now(), from, tr }); this.wake(); }

  /** Bitti pırıltısı: 500 ms sonra 5 pırıltı, 140 ms arayla; her biri 1,3-1,8 sn yukarı süzülüp söner (CSS). */
  private sparkle() {
    for (let i = 0; i < SPARKLE.count; i++) {
      this.afterTimer(() => {
        const life = SPARKLE.lifeMin + Math.random() * (SPARKLE.lifeMax - SPARKLE.lifeMin);
        const rise = (SPARKLE.riseMin + Math.random() * (SPARKLE.riseMax - SPARKLE.riseMin)) * (life / 1000) * ((this.size * 4) / 3) * .75;
        const e = img("g-spark", this.root, { left: `${22 + Math.random() * 46}%`, top: `${12 + Math.random() * 22}%`, width: "14%" });
        e.src = `${PARTS}efekt-pirilti-jeton.webp`;
        e.style.setProperty("--omur", `${Math.round(life)}ms`);
        e.style.setProperty("--yuk", `${-Math.round(rise)}px`);
        e.style.setProperty("--yan", `${Math.round((Math.random() - .5) * this.size * .5)}px`);
        this.afterTimer(() => e.remove(), life);
      }, SPARKLE.startMs + i * SPARKLE.gapMs);
    }
  }

  /** Dosya yutma: sy 0,78 -> 1,18 -> 1 (80/130/220 ms), sx tersi; parçalı boyda ağız açılır, dosya simgesi ağza küçülür,
   *  ağız kapanınca 3 çiğneme, gözler şaşkın sonra memnun. 24 px siluette yalnız ezilme. */
  swallow() {
    if (this.still) return;
    this.anim("swY", 1, SWALLOW_Y); this.anim("swX", 1, SWALLOW_X);
    if (this.plan.silhouette) return;
    const file = el("span", "g-dosya", this.root);
    file.style.setProperty("--sure", `${SWALLOW_FILE_MS}ms`);
    this.afterTimer(() => file.remove(), SWALLOW_FILE_MS + 40);
    this.ovMouth = "agiz-acik"; this.eyesFor("goz-saskin", SWALLOW_MOUTH_MS);
    this.afterTimer(() => {
      this.eyesFor("goz-mutlu", 900);
      this.anim("swY", 1, CHEW_Y);
      for (let i = 0; i < CHEW.steps; i++) this.afterTimer(() => { this.ovMouth = i % 2 ? "agiz-o" : "agiz-gulus"; this.show(); }, i * CHEW.stepMs);
      this.afterTimer(() => { this.ovMouth = null; this.show(); }, CHEW.steps * CHEW.stepMs);
    }, SWALLOW_MOUTH_MS);
    this.show();
  }

  /** Gözleri `ms` boyunca değiştirir; yeni çağrı eskinin sayacını sıfırlar. */
  private eyesFor(name: string, ms: number) {
    clearTimeout(this.eyesT);
    this.ovEyes = name; this.show();
    this.eyesT = setTimeout(() => { if (this.dead) return; this.ovEyes = null; this.show(); }, ms);
  }

  /** Tokat: hızlı ezilme + yatay titreme, gözler kısık; ~600 ms sonra önceki hal (hal değişmez, yalnız geçici). */
  slap() {
    if (this.still) return;
    this.anim("swY", 1, POKE_Y); this.anim("swX", 1, POKE_X); this.anim("shake", 0, shakeTrack(this.size));
    if (!this.plan.silhouette) this.eyesFor("goz-cizgi", REACT.slapMs);
  }

  /** Sevgi: gözler yumuşar, kalpler yukarı süzülür (yalnız parçalı boylarda). */
  love() {
    if (this.still || this.plan.silhouette) return;
    this.eyesFor("goz-huzurlu", REACT.loveMs);
    for (let i = 0; i < REACT.hearts; i++) {
      this.afterTimer(() => {
        const life = 1500 + Math.random() * 500;
        const e = el("span", "g-kalp", this.root);
        e.textContent = "♥";
        e.style.left = `${24 + Math.random() * 44}%`; e.style.top = `${10 + Math.random() * 18}%`;
        e.style.setProperty("--omur", `${Math.round(life)}ms`);
        e.style.setProperty("--yuk", `${-Math.round(this.size * .55)}px`);
        e.style.setProperty("--yan", `${Math.round((Math.random() - .5) * this.size * .4)}px`);
        e.style.fontSize = `${Math.max(9, Math.round(this.size * .2))}px`;
        this.afterTimer(() => e.remove(), life);
      }, i * 260);
    }
  }

  /** Büyük karta tıklama: ezilme + `ms` süreli sersem gözler; uzun sersemlikte hafif sallanma. */
  daze(ms: number) {
    if (this.still) return;
    this.anim("swY", 1, POKE_Y); this.anim("swX", 1, POKE_X);
    if (ms > 1000) this.anim("daze", 0, swayTrack(ms));
    this.ovEyes = "goz-sersem"; this.show();
    const end = Math.max(performance.now() + ms, this.dazeEnd);   // sonradan gelen kısa sersemlik uzun olanı kısaltmaz
    this.dazeEnd = end;
    clearTimeout(this.dazeT);
    this.dazeT = setTimeout(() => { if (this.dead) return; this.ovEyes = null; this.show(); }, end - performance.now());
  }

  /** Gözleri imlece çevir; px/py bu elemanın penceresindeki istemci koordinatı. 28 px altında göz takibi yok. */
  lookAt(px: number | null, py = 0) {
    if (!this.plan.eyeTracking) return;
    const g = this.gz;
    if (px === null) { g.tx = g.ty = 0; }
    else {
      const r = this.root.getBoundingClientRect();
      const [x, y] = gazeTarget(px - (r.left + (r.width * YX) / KX), py - (r.top + (r.height * YY) / KY));
      g.tx = x * 3.4; g.ty = y * 2.6;
    }
    if (this.still) { g.x = g.tx; g.y = g.ty; }
    this.wake();
  }

  private async seq(steps: [number, () => void][]) {
    this.playing = true; this.wake();
    for (const [ms, fn] of steps) { fn(); await wait(ms); if (this.dead) return; }
    this.ovBody = null; this.show(); this.playing = false; this.wake();
  }
  /** Küçük zıplama (sahip kararı 6): çök, uzayarak zıpla, in, toparlan. */
  hop() {
    if (this.still || this.playing || MOODS[this.mood].speed === 0) return;
    const L = !this.plan.silhouette;   // 20 px'te gövde parçası değişmez, yalnız yay oynar
    return this.seq([
      [80, () => { if (L) { this.ovBody = "basik"; this.show(); } this.sy.v = .86; this.sx.v = 1.1; }],
      [210, () => { if (L) { this.ovBody = "uzun"; this.show(); } this.y.vel = -175; this.sy.v = 1.12; this.sx.v = .92; }],
      [260, () => { if (L) { this.ovBody = "notr"; this.show(); } }],
      [120, () => { if (L) { this.ovBody = "basik"; this.show(); } this.sy.v = .9; this.sx.v = 1.08; }],
      [380, () => { this.ovBody = null; this.show(); }],
    ]);
  }
  /** Boştaki muziplik: sağa sola bakma, bir an esneme (idlePrank çağırır). */
  prank() {
    if (this.still || this.playing || MOODS[this.mood].speed === 0) return;
    const L = !this.plan.silhouette;
    const look = (x: number, r: number) => () => { if (L) this.gz.tx = x * 3.4; else this.rot.target = r; };
    return this.seq([
      [550, look(1, 7)], [550, look(-1, -7)],
      [250, () => { this.gz.tx = 0; this.rot.target = 0; }],
      [700, () => { if (L) { this.ovBody = "uzun"; this.show(); } this.sy.target = 1.1; this.sx.target = .94; }],
      [200, () => { this.sy.target = 1; this.sx.target = 1; this.ovBody = null; this.show(); }],
    ]);
  }

  private scheduleBlink() {
    if (!this.blink) return;
    this.afterTimer(() => {
      this.scheduleBlink();
      const m = MOODS[this.mood];
      if (m.speed === 0 || CLOSED_EYES.has(this.ovEyes ?? m.eyes) || performance.now() - this.lastInput < 3000) return;
      this.blink!.animate([{ transform: "scaleY(1)" }, { transform: "scaleY(.08)" }, { transform: "scaleY(1)" }],
        { duration: 170, easing: "cubic-bezier(0.77, 0, 0.175, 1)" });
    }, 4000 + Math.random() * 4000);
  }

  /** Çizim döngüsü çalışıyor mu (ölçüm ve test için). */
  get running() { return this.raf !== 0; }

  private wake() { if (!this.raf && !this.dead && !this.still) { this.last = performance.now(); this.raf = requestAnimationFrame(this.frame); } }

  /** Hâlâ bir şey hareket ediyor mu: dizi, süreli iz, konuşan ağız, yay ya da bakış. Hayırsa döngü durur. */
  private moving(springs: Spring[]) {
    const g = this.gz;
    return this.playing || this.anims.size > 0 || !!(MOODS[this.mood].talk && this.mouth) || !springs.every((s) => s.rest)
      || g.x !== g.tx || g.y !== g.ty;
  }

  private frame = (_now: number) => {
    this.raf = 0;
    if (this.dead) return;
    const now = performance.now();   // sahte zamanlayıcıda da tutarlı olsun diye rAF argümanı yerine
    const dt = this.still ? 0 : Math.min(.033, Math.max(0, now - this.last) / 1000);
    this.last = now;
    const t = this.still ? .6 : Math.max(0, now - this.t0) / 1000;
    const m = MOODS[this.mood];
    const springs = [this.y, this.sx, this.sy, this.rot];
    for (const s of springs) s.step(dt);
    const g = this.gz, k = gazeStep(dt);
    g.x += (g.tx - g.x) * k; g.y += (g.ty - g.y) * k;
    if (Math.abs(g.x - g.tx) < .01 && Math.abs(g.y - g.ty) < .01) { g.x = g.tx; g.y = g.ty; }
    for (const [key, a] of this.anims) {
      const e = now - a.t0;
      if (e >= trackMs(a.tr)) { this.ov[key] = OV_DEFAULT[key]; this.anims.delete(key); }
      else this.ov[key] = sample(a.tr, a.from, e);
    }
    this.sal.style.transform = `translate(${this.ov.shake}px, ${this.y.v}%) rotate(${this.rot.v + this.ov.daze}deg)`;
    this.squash.style.transform = `scale(${this.sx.v * this.ov.swX}, ${this.sy.v * this.ov.swY})`;
    if (this.ground) {
      const up = Math.max(0, -this.y.v);
      this.ground.style.transform = `scale(${1 - up * .02})`; this.ground.style.opacity = String(.75 - up * .03);
    }
    if (this.track) this.track.style.transform = `translate(${g.x}%, ${g.y}%)`;
    if (m.talk && this.mouth && !this.ovMouth) {
      const cycle = ["agiz-kahkaha", "agiz-acik", "agiz-o", "agiz-kahkaha", "agiz-gulus"];
      const n = cycle[this.still ? 0 : Math.floor(t * 7) % cycle.length];
      if (this.mouth.dataset.d !== n) { this.mouth.dataset.d = n; this.mouth.src = `${PARTS}${n}.webp`; }
    }
    if (!this.still && !this.dead && this.moving(springs)) this.raf = requestAnimationFrame(this.frame);
  };

  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.timers.forEach(clearTimeout);
    clearTimeout(this.badgeT); clearTimeout(this.dazeT); clearTimeout(this.eyesT);
    this.root.remove();
  }
}
