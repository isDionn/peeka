import "./shoulder.css";
import type { ShapeLayer, ShapeState } from "./shape";

export interface ShoulderLayers {
  /** pass into `createShape({ layers: [x.layer] })` */
  layer: ShapeLayer;
  /** cover color (only the halo under the card); null = the halo fades. The color transitions over 0.8 s. */
  setAmbient(color: string | null, amount?: number): void;
  destroy(): void;
}

const div = (cls: string) => Object.assign(document.createElement("div"), { className: cls });

/**
 * Builds the concave shoulder (a drop flowing from the strip), shadow and halo layers inside an empty `.nm-layers` container.
 * Shoulders scale uniformly; shadow and halo are drawn at the target size and scaled with transform: only transform + opacity per frame.
 * Shoulders overflow the body by 16 px; leave a 16 px margin on every side of the window.
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
    const k16 = s.f / 16;
    l.style.transform = `translate(${s.offsetX - s.f}px,0) scale(${k16})`;
    r.style.transform = `translate(${s.offsetX + s.w}px,0) scale(${k16})`;
    l.style.visibility = r.style.visibility = vis ? "hidden" : "visible";
  };
  return {
    layer,
    setAmbient(color, amount = 0.42) {
      if (color) halo.style.setProperty("--nm-amb", color);
      halo.style.opacity = color ? String(amount) : "0";
    },
    destroy: () => [halo, shadow, l, r].forEach((e) => e.remove()),
  };
}
