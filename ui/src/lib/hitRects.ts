import type { Rect } from "../bridge";

/** Sayfadaki `[data-hit]` öğelerinin dikdörtgenleri (CSS piksel). Boş ve görünmez olanlar atlanır. */
const providers = new Set<() => { x: number; y: number; width: number; height: number } | null>();
/** Kutusunun dışına taşan öğenin (şerit maskotunun gövdesi) tıklanabilir dikdörtgeni; dönen işlev kaydı siler. */
export function addHitProvider(f: () => { x: number; y: number; width: number; height: number } | null) { providers.add(f); return () => { providers.delete(f); }; }

export function collectHitRects(root: ParentNode = document): Rect[] {
  const out: Rect[] = [];
  providers.forEach((f) => { const r = f(); if (r && r.width >= 1 && r.height >= 1) out.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }); });
  root.querySelectorAll<HTMLElement>("[data-hit], [data-paint]").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || getComputedStyle(el).visibility === "hidden") return;
    const rect: Rect = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    out.push(el.hasAttribute("data-hit") ? rect : { ...rect, paint: true });
  });
  return out;
}

export const sameRects = (a: Rect[], b: Rect[]) => a.length === b.length && a.every((r, i) => r.x === b[i].x && r.y === b[i].y && r.w === b[i].w && r.h === b[i].h && !r.paint === !b[i].paint);
