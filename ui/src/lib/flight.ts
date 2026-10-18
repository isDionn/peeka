import { advance, Spring, SPRINGS } from "../motion/spring";

/**
 * Shared element flight (§0i item 9): an element keyed by `data-share` travels from its old spot to the new one on the card's spring (0.44 / 0.78).
 * If a new flight starts midway, the element restarts from the beginning instead of its current spot (simple version).
 * motion: when a shared FLIP helper lands under motion/, this file switches to it.
 */
export function fly(el: HTMLElement, from: DOMRect) {
  const to = el.getBoundingClientRect();
  if (!to.height || (Math.abs(from.left - to.left) < 1 && Math.abs(from.top - to.top) < 1)) return;
  const dx = from.left - to.left, dy = from.top - to.top, s = from.height / to.height;
  el.style.transformOrigin = "0 0";
  const sp = new Spring(1, SPRINGS.card);
  sp.t = 0;
  let last = performance.now();
  const frame = (now: number) => {
    if (!el.isConnected) return;
    advance(sp, (now - last) / 1000); last = now;
    if (sp.settled) { el.style.transform = ""; return; }
    el.style.transform = `translate(${dx * sp.x}px,${dy * sp.x}px) scale(${1 + (s - 1) * sp.x})`;
    requestAnimationFrame(frame);
  };
  el.style.transform = `translate(${dx}px,${dy}px) scale(${s})`;
  requestAnimationFrame(frame);
}
