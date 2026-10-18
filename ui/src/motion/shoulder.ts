import "./shoulder.css";
import type { ShapeLayer, ShapeState } from "./shape";

export interface ShoulderLayers {
  /** `createShape({ layers: [x.layer] })` içine ver */
  layer: ShapeLayer;
  /** kapak rengi (yalnız kartın altındaki hale); null = hale söner. Renk 0,8 sn'de geçer. */
  setAmbient(color: string | null, amount?: number): void;
  destroy(): void;
}

const div = (cls: string) => Object.assign(document.createElement("div"), { className: cls });

/**
 * Boş `.nm-layers` kabına iç bükey omuz (şeritten akan damla), gölge ve hale katmanlarını kurar.
 * Omuzlar tek tip ölçeklenir, gölge ve hale hedef boyutta çizilip transform ile ölçeklenir: kare başına yalnız transform + opacity.
 * Omuzlar gövdenin dışına 16 px taşar; pencerede her yanda 16 px pay bırak.
 * `sides`: sağ üst kartta yalnız "left" (sağ omuz ekran kenarına 8 px kala yok).
 */
export function mountShoulders(container: HTMLElement, o: { sides?: "both" | "left" | "right" } = {}): ShoulderLayers {
  const sides = o.sides ?? "both";
  const halo = div("nm-halo"), shadow = div("nm-shadow"), l = div("nm-shoulder l"), r = div("nm-shoulder r");
  container.append(halo, shadow, ...(sides !== "right" ? [l] : []), ...(sides !== "left" ? [r] : []));
  let key = "";

  const layer: ShapeLayer = (s: ShapeState) => {
    const vis = s.hidden;
    // hedef boyut/yarıçap değişince bir kez yeniden boyutla (layout), kare başına yalnız transform
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
