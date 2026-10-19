import type { Rect } from "../bridge";

const rectOf = (r: DOMRect | { left: number; top: number; width: number; height: number }): Rect => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });

/** Rectangles of the page's `[data-hit]` (clickable) and `[data-paint]` (drawn, clicks pass through) elements, CSS pixels; empty and invisible ones are skipped.
 *  Every ghost is in too (a fading one too, as paint only), wherever it sits: its drawn box overflows its parents (the 40 px one hangs below the strip) and its effects move past that
 *  (sway, squash, hearts, sparks), so the window region would cut it. Paint = the drawn box plus half its width on every side; hit = the hanging body (`.mascot-hit`). */
export function collectHitRects(root: ParentNode = document): Rect[] {
  const out: Rect[] = [];
  root.querySelectorAll<HTMLElement>(".mascot").forEach((m) => {
    if (getComputedStyle(m).visibility === "hidden") return; // inside a closed strip panel: no paint, no dead click zone
    const g = (m.querySelector<HTMLElement>(".g") ?? m).getBoundingClientRect();
    const pad = g.width / 2;
    if (g.width >= 1 && g.height >= 1) out.push({ ...rectOf({ left: g.left - pad, top: g.top - pad, width: g.width + 2 * pad, height: g.height + 2 * pad }), paint: true });
    const hit = m.matches(".out") || m.closest("[data-leaving]") ? null : m.querySelector<HTMLElement>(".mascot-hit");
    const h = hit?.getBoundingClientRect();
    if (h && h.width >= 1 && h.height >= 1) out.push(rectOf(h));
  });
  root.querySelectorAll<HTMLElement>("[data-hit], [data-paint]").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || getComputedStyle(el).visibility === "hidden") return;
    out.push(el.hasAttribute("data-hit") ? rectOf(r) : { ...rectOf(r), paint: true });
  });
  return out;
}

export const sameRects = (a: Rect[], b: Rect[]) => a.length === b.length && a.every((r, i) => r.x === b[i].x && r.y === b[i].y && r.w === b[i].w && r.h === b[i].h && !r.paint === !b[i].paint);
