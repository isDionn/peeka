import { Spring, SpringGroup, SPRINGS } from "./spring";

/** The current shape handed to the layers (shoulder, shadow, halo) each frame. Coordinates are relative to the host box. */
export interface ShapeState {
  w: number; h: number; tw: number; th: number;
  /** the host box: the target when settled; while moving, the larger of the old and new size (so nothing is cut) */
  bw: number; bh: number;
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
  moving: boolean;
}
export type ShapeLayer = (s: ShapeState) => void;

export interface ShapeOptions {
  anchor?: "center" | "left" | "right";
  /** bottom corner radius; default peek → card (min(h·0.6, 34, 15 + max(0,h−40)·0.3)) */
  radius?: (h: number) => number;
  layers?: ShapeLayer[];
  /** card-colour layer inside the body: fades in as the shape grows (at peek height the body is strip-coloured) */
  tone?: HTMLElement | null;
  /** the host box changed, or the motion started / stopped: a few times per animation, never per frame */
  onBox?: (bw: number, bh: number, moving: boolean) => void;
}

export const notchRadius = (h: number) => Math.min(h * 0.6, 34, 15 + Math.max(0, h - 40) * 0.3);
/** Shoulder fillet follows the corner: at most 60 % of it and never over 12 px (polish audit #3; the island line gap uses the same rule). */
export const shoulderOf = (r: number) => Math.min(12, r * 0.6);

/** Clip for the body while it moves: straight top, bottom corners matching `corner-shape: squircle` (a cubic with 1.1 r handles: measured against
 *  Chromium's own squircle at DPR 1 and 1.5, at most 1 colour level apart), so the corner doesn't change when the clip goes at rest. */
/** Handle factor: 1.1 for `corner-shape: squircle`; a WebView without it draws a circular corner (0.5523 = circle as a cubic), so the path follows that. */
const K = typeof CSS !== "undefined" && CSS.supports?.("corner-shape", "squircle") ? 1.1 : 0.5523;
export function bodyPath(x: number, w: number, h: number, r: number): string {
  const k = r * K, R = x + w, n = (v: number) => Math.round(v * 100) / 100;
  return `path("M${n(x)} 0H${n(R)}V${n(h - r)}C${n(R)} ${n(h - r + k)} ${n(R - r + k)} ${n(h)} ${n(R - r)} ${n(h)}H${n(x + r)}C${n(x + r - k)} ${n(h)} ${n(x)} ${n(h - r + k)} ${n(x)} ${n(h - r)}Z")`;
}

export interface Shape {
  /** new target size; springs on from the current size and velocity (growing: SPRINGS.open, shrinking: SPRINGS.close) */
  to(w: number, h: number): void;
  /** instantly, without the spring */
  snap(w: number, h: number): void;
  /** advance one frame without rAF (tests) */
  advance(dt: number): boolean;
  readonly moving: boolean;
  destroy(): void;
}

/**
 * Grows and shrinks the `body` inside `host` (polish audit #1). The host box is resized only when the target changes and once when the motion ends;
 * every frame writes only the body's clip-path and the layers' transform / opacity: no layout, no React render.
 * The clip stays at rest (same path as the last frame); `--r` on the host still sizes the shadow's corners.
 */
export function createShape(host: HTMLElement, body: HTMLElement, o: ShapeOptions = {}): Shape {
  const { anchor = "center", radius = notchRadius, layers = [] } = o;
  const ws = new Spring(0, SPRINGS.open), hs = new Spring(0, SPRINGS.open);
  let bw = -1, bh = -1, moving = false;
  const corner = (w: number, h: number) => Math.min(radius(h), w / 2, h);

  const state = (): ShapeState => {
    const h = Math.max(0, hs.x), w = Math.max(0, ws.x), th = hs.t, tw = ws.t, r = corner(w, h);
    const offsetX = anchor === "center" ? (bw - w) / 2 : anchor === "left" ? 0 : bw - w;
    return { w, h, tw, th, bw, bh, offsetX, r, rt: corner(tw, th), f: shoulderOf(r), go: Math.min(1, h / 80), kt: Math.max(0, 1 - h / 70), hidden: h < 0.4 && th < 0.4, moving };
  };
  const setBox = (w: number, h: number) => {
    w = Math.ceil(w); h = Math.ceil(h);
    if (w === bw && h === bh) return false;
    bw = w; bh = h;
    host.style.width = `${w}px`;
    host.style.height = `${h}px`;
    return true;
  };
  const apply = () => {
    const s = state();
    host.style.visibility = s.hidden ? "hidden" : "visible";
    // the same clip at rest: the last moving frame and the resting frame are one path, so the corner never snaps when the motion ends
    body.style.clipPath = s.hidden ? "" : bodyPath(s.offsetX, s.w, s.h, s.r);
    if (o.tone) o.tone.style.opacity = String(1 - s.kt);
    for (const l of layers) l(s);
  };
  const notify = () => o.onBox?.(bw, bh, moving);
  const group = new SpringGroup([ws, hs], () => {
    if (moving && ws.settled && hs.settled) { moving = false; setBox(ws.t, hs.t); notify(); }
    apply();
  });
  const target = (w: number, h: number) => {
    const rt = corner(w, h);
    host.style.setProperty("--r", `${rt}px`);
    host.style.setProperty("--f", `${shoulderOf(rt)}px`);
  };

  return {
    to(w, h) {
      if (w === ws.t && h === hs.t) return;
      target(w, h);
      const closed = hs.x < 0.4 && hs.t < 0.4;
      if (closed && h < 0.4) { this.snap(w, h); return; } // resting: the width follows without motion
      const grow = h > hs.x + 0.5 || (Math.abs(h - hs.x) <= 0.5 && w > ws.x);
      const p = grow ? SPRINGS.open : SPRINGS.close;
      ws.retarget(w, p);
      hs.retarget(h, p);
      const changed = setBox(Math.max(closed ? 0 : bw, w, ws.x), Math.max(closed ? 0 : bh, h, hs.x));
      if (!moving) { moving = true; notify(); } else if (changed) notify();
      apply();
      group.kick();
    },
    snap(w, h) {
      target(w, h);
      ws.snap(w);
      hs.snap(h);
      const was = moving;
      moving = false;
      if (setBox(w, h) || was) notify();
      apply();
    },
    advance: (dt) => group.advance(dt),
    get moving() { return moving; },
    destroy: () => group.stop(),
  };
}
