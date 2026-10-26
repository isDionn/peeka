import "./shoulder.css";
import type { ShapeLayer, ShapeState } from "./shape";

export interface ShoulderLayers {
  /** pass into `createShape({ layers: [x.layer] })` */
  layer: ShapeLayer;
  /** halo color (a soft light under the card); null = the halo fades. The color transitions over 0.8 s. */
  setAmbient(color: string | null, amount?: number): void;
  /** the shoulder elements (left, right; absent sides omitted): content inside one is scaled with it */
  shoulders: HTMLElement[];
  destroy(): void;
}

const div = (cls: string) => Object.assign(document.createElement("div"), { className: cls });
/** Shoulder base size (CSS px): the largest fillet (shape.ts `shoulderOf`), drawn once and scaled down, never up. */
const BASE = 12;

/**
 * Builds the concave shoulder (a drop flowing from the strip), shadow and halo layers inside an empty `.nm-layers` container.
 * Shoulders scale uniformly; shadow and halo are drawn at the target size and scaled with transform: only transform + opacity per frame.
 * Each shoulder reaches 1 px (scaled) into the body, so the body's edge highlight never shows beside the curve (polish audit #2).
 * `sides`: only "left" on the top-right card (no right shoulder 8 px from the screen edge).
 */
export function mountShoulders(container: HTMLElement, o: { sides?: "both" | "left" | "right" } = {}): ShoulderLayers {
  const sides = o.sides ?? "both";
  const halo = div("nm-halo"), shadow = div("nm-shadow"), l = div("nm-shoulder l"), r = div("nm-shoulder r");
  container.append(halo, shadow, ...(sides !== "right" ? [l] : []), ...(sides !== "left" ? [r] : []));
  let key = "";

  const layer: ShapeLayer = (s: ShapeState) => {
    const vis = s.hidden;
    // resize once (layout) when the target size/radius changes; per frame only transform
    const k = `${s.tw}|${s.th}|${s.rt}`;
    if (k !== key) {
      key = k;
      shadow.style.width = `${s.tw}px`;
      shadow.style.height = `${s.th}px`;
      shadow.style.borderRadius = `0 0 ${s.rt}px ${s.rt}px`;
      halo.style.width = `${s.tw * 1.1}px`;
      halo.style.height = `${s.th * 1.15}px`;
    }
    const sx = s.tw ? s.w / s.tw : 0, sy = s.th ? s.h / s.th : 0;
    shadow.style.transform = `translate(${s.offsetX}px,0) scale(${sx},${sy})`;
    shadow.style.opacity = vis ? "0" : String(s.go);
    halo.style.transform = `translate(${s.offsetX + s.w / 2 - (s.tw * 1.1 * sx) / 2}px,0) scale(${sx},${sy})`;
    const kf = s.f / BASE;
    l.style.transform = `translate(${s.offsetX - s.f}px,0) scale(${kf})`;
    r.style.transform = `translate(${s.offsetX + s.w - kf}px,0) scale(${kf})`;
    l.style.visibility = r.style.visibility = vis ? "hidden" : "visible";
  };
  return {
    layer,
    setAmbient(color, amount = 0.42) {
      if (color) halo.style.setProperty("--nm-amb", color);
      halo.style.opacity = color ? String(amount) : "0";
    },
    shoulders: [...(sides !== "right" ? [l] : []), ...(sides !== "left" ? [r] : [])],
    destroy: () => [halo, shadow, l, r].forEach((e) => e.remove()),
  };
}
