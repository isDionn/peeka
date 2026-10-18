import { advance, Spring, YAY } from "../motion/spring";

/**
 * Paylaşılan öğe uçuşu (§0i madde 9): `data-paylas` anahtarlı öğe eski yerinden yenisine kartla aynı yayla (0,44 / 0,78) gelir.
 * Yarıda yeni uçuş başlarsa öğe o anki yerinden devam etmez, baştan başlar (basit sürüm).
 * motion: motion/ altına ortak FLIP yardımcısı gelince bu dosya onunla değişir.
 */
export function fly(el: HTMLElement, from: DOMRect) {
  const to = el.getBoundingClientRect();
  if (!to.height || (Math.abs(from.left - to.left) < 1 && Math.abs(from.top - to.top) < 1)) return;
  const dx = from.left - to.left, dy = from.top - to.top, s = from.height / to.height;
  el.style.transformOrigin = "0 0";
  const sp = new Spring(1, YAY.kart);
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
