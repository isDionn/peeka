// Window preview when hovering an app on the strip (mockup i, FPV §0i item 8: 26 corner, 13 shoulder, 340 ms slight-overshoot curve).
// The image comes from `window_preview` (PrintWindow); until then the cached image or a placeholder shows. Some windows (DirectX, protected) may come back black.
import { useEffect, useRef, useState } from "react";
import { bridge, type WindowInfo } from "../bridge";
import type { StripItem } from "../lib/mergePins";
import { flat } from "../lib/plugin";
import { safeThumb } from "../lib/clip";
import { AppIcon } from "./common";

const cache = new Map<number, string>();
export const clearPreviewCache = () => cache.clear();

/** The window's last known image (right away) and a fresh one (when it arrives). On failure the cached image or null stays. */
function usePreview(hwnd: number): string | null {
  const [src, setSrc] = useState<string | null>(cache.get(hwnd) ?? null);
  useEffect(() => {
    let live = true;
    bridge.call("window_preview", { hwnd }).then((s) => {
      const ok = safeThumb(s); // raster/SVG data URLs only
      if (ok && live) { cache.set(hwnd, ok); setSrc(ok); }
    }).catch(() => undefined);
    return () => { live = false; };
  }, [hwnd]);
  return src;
}

function Thumb({ w, item, onPick }: { w: WindowInfo; item: StripItem; onPick: (w: WindowInfo) => void }) {
  const src = usePreview(w.hwnd);
  return (
    <button className={"small" + (w.active ? " on" : "")} data-hwnd={w.hwnd} aria-label={flat(w.title, 80)} onClick={() => onPick(w)}>
      <div className={"image" + (src ? "" : " loading")} aria-busy={!src}>{src && <img src={src} alt="" draggable={false} />}</div>
      <div className="name"><AppIcon src={item.icon} color={item.colorIcon} size={14} /><span>{flat(w.title, 60)}</span></div>
    </button>
  );
}

/** `x`: the item's horizontal center (page px). The hovered app's windows (up to 4) side by side. */
export function WindowPreview({ item, x, onEnter, onLeave, onPick }: { item: StripItem; x: number; onEnter: () => void; onLeave: () => void; onPick: (w: WindowInfo) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(x);
  const [on, setOn] = useState(false);
  useEffect(() => { const el = box.current; if (el) setLeft(Math.max(8, Math.min(x - el.offsetWidth / 2, window.innerWidth - el.offsetWidth - 8))); }, [x, item.windows.length]);
  useEffect(() => { const r = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(r); }, []);
  return (
    <div ref={box} className={"preview" + (on ? " on" : "")} data-hit role="group" aria-label={`${item.name} windows`} style={{ left }} onPointerEnter={onEnter} onPointerLeave={onLeave}>
      <div className="pvName" aria-hidden="true">{item.name}</div>{/* logos-only strip: the app's name rides on its preview */}
      {item.windows.slice(0, 4).map((w) => <Thumb key={w.hwnd} w={w} item={item} onPick={onPick} />)}
    </div>
  );
}
