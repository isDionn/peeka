import { Spring, SpringGroup, SPRINGS } from "./spring";

const EASE = "cubic-bezier(.23,1,.32,1)";

export interface Pill {
  /** seçim kapsülünü hedefe kaydır (yay 0,34 / 0,82); `streak` ışığı 620 ms geçirir */
  to(target: HTMLElement | { x: number; w: number }, o?: { streak?: boolean; instant?: boolean }): void;
  destroy(): void;
}

/**
 * Akan vurgu: `pill` (tek elemanlı, `track` içinde inset:0, arka planı senin CSS'in) clip-path ile
 * kapsül biçiminde kırpılır; yay x ve genişliği sürer, içindeki ışık şeridi 620 ms soldan sağa geçer.
 * `radius`: sekme kapsülü 9, modül seçimi 12.
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
 * Üstüne gelme niyet gecikmesi (§0i): imleç `target` üstünde ~120 ms durunca `onOpen`, ayrılınca ~200 ms sonra `onClose`.
 * `keep` öğelerinin (açılan ada) üstündeyken kapanma iptal olur. Dönen işlev dinleyicileri söker.
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
 * Üstüne gelme (yay 0,30 / 1): içerik büyümez, yalnız 0,5 px iner ve parlaklığı %28 artar (maket yon-3d-son.html).
 * Parlaklık tek küçük öğede `filter`; geri kalan her şey transform. `onProgress` çıkıntıyı 14 px "göz atırmak" için 0..1 verir.
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

/** Basma geri bildirimi: yazılı düğme 0,96, yalnız simgeli 0,92; basınca anında, 160 ms. */
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
