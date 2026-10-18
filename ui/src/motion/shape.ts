import { Spring, SpringGroup, SPRINGS, type SpringParams } from "./spring";

export interface Rect { x: number; y: number; w: number; h: number }

/** Her karede katmanlara (omuz, gölge, hale) verilen anlık şekil. Koordinatlar host kutusuna göredir. */
export interface ShapeState {
  w: number; h: number; tw: number; th: number;
  /** gövdenin host içindeki sol kenarı */
  offsetX: number;
  /** alt köşe yarıçapı (şu an / hedefte) */
  r: number;
  rt: number;
  /** sıvı omuz boyu */
  f: number;
  /** gölge gücü 0..1 (h/80) */
  go: number;
  /** şerit renginden kart rengine geçiş 1..0 (1 - h/70) */
  kt: number;
  hidden: boolean;
}
export type ShapeLayer = (s: ShapeState) => void;

export interface ShapeOptions {
  /** sabit pencere: gövde bu kutunun içinde kırpılır, hiç yeniden boyutlanmaz */
  maxW: number;
  maxH: number;
  anchor?: "center" | "left" | "right";
  /** alt köşe yarıçapı; varsayılan çıkıntı → kart (min(h·0,6, 34, 15 + max(0,h−40)·0,3)) */
  radius?: (h: number) => number;
  /** çıkıntı kapalıyken açılırken başlangıç genişliği (şeridin ortasındaki içerik) */
  restW?: number;
  layers?: ShapeLayer[];
  /** tıklanabilir dikdörtgen her değiştiğinde (CSS px, görünüm penceresine göre, yuvarlanmış) */
  onRect?: (r: Rect) => void;
}

export const notchRadius = (h: number) => Math.min(h * 0.6, 34, 15 + Math.max(0, h - 40) * 0.3);
/** sağ üst kart */
export const sideRadius = (h: number) => Math.min(h * 0.6, 28, 15 + h * 0.1);

export interface Shape {
  /** yeni hedef boyut; o anki boyut ve hızdan yayla devam eder */
  to(w: number, h: number, preset?: SpringParams): void;
  /** yaysız anında */
  snap(w: number, h: number): void;
  /** şu anki tıklanabilir dikdörtgen (boşsa w ya da h = 0) */
  rect(): Rect;
  /** rAF'siz bir kare ilerlet (test) */
  advance(dt: number): boolean;
  readonly moving: boolean;
  destroy(): void;
}

/**
 * Sabit boyutlu `host` içindeki `body` öğesini clip-path ile büyütüp küçültür (pencere hiç boyut değiştirmez).
 * Yalnız clip-path yazar; layout yok. Her karede `onRect` ile güncel tıklama alanını bildirir.
 */
export function createShape(host: HTMLElement, body: HTMLElement, o: ShapeOptions): Shape {
  const { maxW, maxH, anchor = "center", radius = notchRadius, restW = 120, layers = [] } = o;
  host.style.width = `${maxW}px`;
  host.style.height = `${maxH}px`;
  body.style.width = `${maxW}px`;
  body.style.height = `${maxH}px`;
  body.classList.add("nm-shape");
  const ws = new Spring(restW, SPRINGS.card), hs = new Spring(0, SPRINGS.card);
  let last: Rect | null = null;

  const state = (): ShapeState => {
    const h = Math.max(0, hs.x), w = Math.min(maxW, Math.max(0, ws.x));
    const th = hs.t, tw = ws.t;
    const offsetX = anchor === "center" ? (maxW - w) / 2 : anchor === "left" ? 0 : maxW - w;
    return {
      w, h, tw, th, offsetX,
      r: Math.min(radius(h), w / 2, h),
      rt: Math.min(radius(th), tw / 2, th),
      f: Math.min(16, 8 + h * 0.12, h * 0.8),
      go: Math.min(1, h / 80),
      kt: Math.max(0, 1 - h / 70),
      hidden: h < 0.4,
    };
  };
  const rect = (): Rect => {
    const s = state(), b = host.getBoundingClientRect();
    if (s.hidden) return { x: Math.round(b.left + s.offsetX), y: Math.round(b.top), w: 0, h: 0 };
    return { x: Math.round(b.left + s.offsetX), y: Math.round(b.top), w: Math.round(s.w), h: Math.round(s.h) };
  };
  const apply = () => {
    const s = state();
    body.style.visibility = s.hidden ? "hidden" : "visible";
    body.style.clipPath = `inset(0 ${maxW - s.w - s.offsetX}px ${maxH - s.h}px ${s.offsetX}px round 0 0 ${s.r}px ${s.r}px)`;
    for (const l of layers) l(s);
    if (o.onRect) {
      const r = rect();
      if (!last || r.x !== last.x || r.y !== last.y || r.w !== last.w || r.h !== last.h) o.onRect((last = r));
    }
  };
  const group = new SpringGroup([ws, hs], apply);
  apply();

  return {
    to(w, h, preset = SPRINGS.card) {
      if (hs.x < 1) ws.snap(restW); // kapalıyken genişlik hedefe uçmaz, ortadaki içerikten başlar
      ws.retarget(Math.min(maxW, w), preset);
      hs.retarget(Math.min(maxH, h), preset);
      group.kick();
    },
    snap(w, h) {
      ws.snap(Math.min(maxW, w));
      hs.snap(Math.min(maxH, h));
      apply();
    },
    rect,
    advance: (dt) => group.advance(dt),
    get moving() { return group.moving; },
    destroy: () => group.stop(),
  };
}
