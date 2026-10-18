import { Spring, SpringGroup, SPRINGS } from "./spring";

const EASE = "cubic-bezier(.23,1,.32,1)";

export interface Pill {
  /** slide the selection capsule to the target (spring 0.34 / 0.82); `streak` runs the light across for 620 ms */
  to(target: HTMLElement | { x: number; w: number }, o?: { streak?: boolean; instant?: boolean }): void;
  destroy(): void;
}

/**
 * Flowing highlight: `pill` (a single element, inset:0 inside `track`, background from your CSS) is clipped
 * to a capsule with clip-path; a spring drives x and width, and a light streak inside crosses left to right in 620 ms.
 * `radius`: tab capsule 9, module selection 12.
 */
export function createPill(track: HTMLElement, pill: HTMLElement, radius = 9): Pill {
  pill.style.cssText += ";position:absolute;inset:0;pointer-events:none;overflow:hidden";
  const streak = document.createElement("i");
  streak.style.cssText = "position:absolute;top:0;bottom:0;left:0;width:120px;opacity:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.28),transparent)";
  pill.append(streak);
  const xs = new Spring(0, SPRINGS.pill), ws = new Spring(0, SPRINGS.pill);
  const apply = () => {
    const W = track.offsetWidth;
    pill.style.clipPath = `inset(0 ${Math.max(0, W - xs.x - ws.x)}px 0 ${Math.max(0, xs.x)}px round ${radius}px)`;
  };
  const group = new SpringGroup([xs, ws], apply);
  return {
    to(t, o = {}) {
      const x = t instanceof HTMLElement ? t.offsetLeft : t.x, w = t instanceof HTMLElement ? t.offsetWidth : t.w;
      xs.retarget(x);
      ws.retarget(w);
      if (o.instant) { xs.snap(); ws.snap(); apply(); return; }
      group.kick();
      if (o.streak) streak.animate([{ transform: `translateX(${x - 120}px)`, opacity: 1 }, { transform: `translateX(${x + w}px)`, opacity: 1 }], { duration: 620, easing: EASE });
    },
    destroy: () => group.stop(),
  };
}

/**
 * Hover intent delay (§0i): `onOpen` once the cursor rests on `target` ~120 ms, `onClose` ~200 ms after it leaves.
 * Closing is cancelled while over the `keep` elements (the opened island). The returned function removes the listeners.
 */
export function hoverIntent(
  target: Element,
  o: { onOpen(): void; onClose(): void; keep?: Element[]; openDelay?: number; closeDelay?: number; canOpen?: () => boolean },
) {
  let t: ReturnType<typeof setTimeout> | undefined, opened = false;
  const enter = () => {
    clearTimeout(t);
    if (opened) return;
    t = setTimeout(() => { if (o.canOpen?.() ?? true) { opened = true; o.onOpen(); } }, o.openDelay ?? 120);
  };
  const leave = () => {
    clearTimeout(t);
    if (!opened) return;
    t = setTimeout(() => { opened = false; o.onClose(); }, o.closeDelay ?? 200);
  };
  const stay = () => opened && clearTimeout(t);
  const keep = o.keep ?? [];
  target.addEventListener("pointerenter", enter); target.addEventListener("pointerleave", leave);
  keep.forEach((k) => { k.addEventListener("pointerenter", stay); k.addEventListener("pointerleave", leave); });
  return () => {
    clearTimeout(t);
    target.removeEventListener("pointerenter", enter); target.removeEventListener("pointerleave", leave);
    keep.forEach((k) => { k.removeEventListener("pointerenter", stay); k.removeEventListener("pointerleave", leave); });
  };
}

/**
 * Hover (spring 0.30 / 1): content doesn't grow, it only drops 0.5 px and gets 28% brighter (mockup yon-3d-son.html).
 * Brightness is a `filter` on one small element; everything else is transform. `onProgress` gives 0..1 to let the peek "peek out" 14 px.
 */
export function hoverLift(el: HTMLElement, onProgress?: (p: number) => void) {
  const s = new Spring(0, SPRINGS.press);
  const g = new SpringGroup([s], () => {
    const p = Math.max(0, s.x);
    el.style.transform = p > 0.001 ? `translateY(${p * 0.5}px)` : "";
    el.style.filter = p > 0.001 ? `brightness(${1 + p * 0.28})` : "";
    onProgress?.(p);
  });
  const go = (v: number) => { s.retarget(v); g.kick(); };
  const on = () => go(1), off = () => go(0);
  el.addEventListener("pointerenter", on); el.addEventListener("pointerleave", off);
  return () => { g.stop(); el.removeEventListener("pointerenter", on); el.removeEventListener("pointerleave", off); };
}

/** Press feedback: text button 0.96, icon-only 0.92; instant on press, 160 ms. */
export function press(el: HTMLElement, kind: "label" | "icon" = "label") {
  el.style.transition = `transform 160ms ${EASE}`;
  const down = () => (el.style.transform = `scale(${kind === "icon" ? 0.92 : 0.96})`);
  const up = () => (el.style.transform = "");
  el.addEventListener("pointerdown", down);
  ["pointerup", "pointerleave", "pointercancel"].forEach((e) => el.addEventListener(e, up));
  return () => {
    el.removeEventListener("pointerdown", down);
    ["pointerup", "pointerleave", "pointercancel"].forEach((e) => el.removeEventListener(e, up));
  };
}
