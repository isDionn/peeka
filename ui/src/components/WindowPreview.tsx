// Şeritteki bir uygulamanın üstüne gelince pencere önizlemesi (maket i, FPV §0i madde 8: 26 köşe, omuz 13, 340 ms hafif aşan eğri).
// Görüntü `window_preview` ile gelir (PrintWindow); gelene dek önbellekteki ya da yer tutucu görünür. Bazı pencereler (DirectX, korumalı) siyah gelebilir.
import { useEffect, useRef, useState } from "react";
import { bridge, type WindowInfo } from "../bridge";
import type { StripItem } from "../lib/mergePins";
import { flat } from "../lib/plugin";
import { safeThumb } from "../lib/clip";
import { AppIcon } from "./common";

const cache = new Map<number, string>();
export const clearPreviewCache = () => cache.clear();

/** Pencerenin son bilinen görüntüsü (hemen) ve tazesi (gelince). Başarısızlıkta önbellek ya da null kalır. */
function usePreview(hwnd: number): string | null {
  const [src, setSrc] = useState<string | null>(cache.get(hwnd) ?? null);
  useEffect(() => {
    let live = true;
    bridge.call("window_preview", { hwnd }).then((s) => {
      const ok = safeThumb(s); // yalnız raster/SVG data URL
      if (ok && live) { cache.set(hwnd, ok); setSrc(ok); }
    }).catch(() => undefined);
    return () => { live = false; };
  }, [hwnd]);
  return src;
}

function Thumb({ w, item, onPick }: { w: WindowInfo; item: StripItem; onPick: (w: WindowInfo) => void }) {
  const src = usePreview(w.hwnd);
  return (
    <button className={"kucuk" + (w.active ? " on" : "")} data-hwnd={w.hwnd} aria-label={flat(w.title, 80)} onClick={() => onPick(w)}>
      <div className={"resim" + (src ? "" : " yukleniyor")} aria-busy={!src}>{src && <img src={src} alt="" draggable={false} />}</div>
      <div className="ad"><AppIcon src={item.icon} color={item.colorIcon} size={14} /><span>{flat(w.title, 60)}</span></div>
    </button>
  );
}

/** `x`: öğenin yatay ortası (sayfa px). Üstüne gelinen uygulamanın pencereleri (en çok 4) yan yana. */
export function WindowPreview({ item, x, onEnter, onLeave, onPick }: { item: StripItem; x: number; onEnter: () => void; onLeave: () => void; onPick: (w: WindowInfo) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(x);
  const [on, setOn] = useState(false);
  useEffect(() => { const el = box.current; if (el) setLeft(Math.max(8, Math.min(x - el.offsetWidth / 2, window.innerWidth - el.offsetWidth - 8))); }, [x, item.windows.length]);
  useEffect(() => { const r = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(r); }, []);
  return (
    <div ref={box} className={"onizleme" + (on ? " on" : "")} data-hit role="group" aria-label={`${item.name} pencereleri`} style={{ left }} onPointerEnter={onEnter} onPointerLeave={onLeave}>
      {item.windows.slice(0, 4).map((w) => <Thumb key={w.hwnd} w={w} item={item} onPick={onPick} />)}
    </div>
  );
}
