import { Spring, SpringGroup, SPRINGS, type SpringParams } from "./spring";

export interface Rect { x: number; y: number; w: number; h: number }

/** The current shape handed to the layers (shoulder, shadow, halo) each frame. Coordinates are relative to the host box. */
export interface ShapeState {
  w: number; h: number; tw: number; th: number;
  /** the body's left edge inside the host */
  offsetX: number;
  /** bottom corner radius (current / target) */
  r: number;
  rt: number;
  /** liquid shoulder size */
  f: number;
  /** shadow strength 0..1 (h/80) */
  go: number;
  /** strip color to card color blend 1..0 (1 - h/70) */
  kt: number;
  hidden: boolean;
}
export type ShapeLayer = (s: ShapeState) => void;

export interface ShapeOptions {
  /** fixed window: the body is clipped inside this box and never resized */
  maxW: number;
  maxH: number;
  anchor?: "center" | "left" | "right";
  /** bottom corner radius; default peek → card (min(h·0.6, 34, 15 + max(0,h−40)·0.3)) */
  radius?: (h: number) => number;
  /** starting width when opening from a closed peek (the content in the middle of the strip) */
  restW?: number;
  layers?: ShapeLayer[];
  /** whenever the clickable rectangle changes (CSS px, relative to the viewport, rounded) */
  onRect?: (r: Rect) => void;
}

export const notchRadius = (h: number) => Math.min(h * 0.6, 34, 15 + Math.max(0, h - 40) * 0.3);
/** top-right card */
export const sideRadius = (h: number) => Math.min(h * 0.6, 28, 15 + h * 0.1);

export interface Shape {
  /** new target size; springs on from the current size and velocity */
  to(w: number, h: number, preset?: SpringParams): void;
  /** instantly, without the spring */
  snap(w: number, h: number): void;
  /** the current clickable rectangle (w or h = 0 if empty) */
  rect(): Rect;
  /** advance one frame without rAF (tests) */
  advance(dt: number): boolean;
  readonly moving: boolean;
  destroy(): void;
}

/**
 * Grows and shrinks the `body` element inside a fixed-size `host` with clip-path (the window never resizes).
 * Writes only clip-path; no layout. Reports the current click area through `onRect` every frame.
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
      if (hs.x < 1) ws.snap(restW); // when closed the width doesn't fly to the target, it starts from the middle content
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
