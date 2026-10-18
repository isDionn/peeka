import { useEffect, useRef, useState } from "react";
import { bridge, type TrayIconX } from "../bridge";
import { initial } from "../lib/plugin";
import { AppIcon, SAFE_ICON } from "./common";
import "../fidelity-ayar.css";

/** Rust `tray_icons`: `open_tray` + renkli simge. Rozet sayısı gelmez; `badge` yoksa rozet çizilmez. */
const loadTray = (monitor: string): Promise<TrayIconX[]> => bridge.call("tray_icons", { monitor });
const open = (t: TrayIconX, then?: () => void) => bridge.call("tray_open", { id: t.id }).then(then).catch(() => undefined);
const label = (t: TrayIconX) => t.name + (t.badge ? `, ${t.badge} yeni` : "");

/** Şerit simgesi 17, gizli simgeler ızgarası (liste rolü) 18: notch.css uygulama simgesi merdiveni. */
function TrayIconView({ t, size }: { t: TrayIconX; size: number }) {
  return (
    <>
      {SAFE_ICON.test(t.icon) ? <AppIcon src={t.icon} color={t.colorIcon} size={size} /> : <b aria-hidden="true">{initial(t.name)}</b>}
      {!!t.badge && <span className="rozet" aria-hidden="true">{t.badge > 99 ? "99+" : t.badge}</span>}
    </>
  );
}

/**
 * Şerit okunun altındaki gizli simgeler (maket y1): 4 sütunlu küçük ızgara, ad üstüne gelince ipucu, rozet kırmızı. Dalga 0 test 4 yedeği:
 * Rust salt okunur `NotifyIconSettings` listesini verir; tıklama `tray_open` (pencere öne gelir ya da uygulama başlar).
 * Panel genişliği ~188 px olmalı (Shell `<Panel width>`), 300 px'te ızgara solda kalır.
 */
export function TrayList({ monitor, onClose }: { monitor: string; onClose: () => void }) {
  const [list, setList] = useState<TrayIconX[] | null>(null);
  useEffect(() => {
    let live = true;
    loadTray(monitor).then((l) => { if (live) setList(l); }).catch(() => { if (live) setList([]); });
    return () => { live = false; };
  }, [monitor]);
  const grid = useRef<HTMLDivElement>(null);
  // simgeler asenkron gelir: panel açılırken odak alacak denetim yoktu, liste gelince ilk simgeye (ya da ızgaraya) odak verilir (F-09)
  useEffect(() => { if (list?.length) grid.current?.querySelector<HTMLElement>("button")?.focus(); }, [list]);
  return (
    <div className="govde tepsi tepsiIzgara">
      <div className="trayBas t12 b6">Gizli simgeler</div>
      {list && list.length === 0 && <div className="bosSonuc">Simge yok</div>}
      {list && list.length > 0 && (
        <div className="trayIzgara" role="group" aria-label="Gizli simgeler" ref={grid}>
          {list.map((t, i) => (
            <button key={t.id} title={t.name} aria-label={label(t)} data-autofocus={i === 0 ? "" : undefined} onClick={() => open(t, onClose)}><TrayIconView t={t} size={18} /></button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Şeridin sağ kümesinde, okun solunda "Hep görünür" işaretli tepsi simgeleri (maket y2). Şerit bunu `<PromotedTray monitor={monitor.id} />` ile çizer. */
export function PromotedTray({ monitor }: { monitor: string }) {
  const [list, setList] = useState<TrayIconX[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => loadTray(monitor).then((l) => { if (live) setList(l.filter((t) => t.promoted)); }).catch(() => undefined);
    load();
    window.addEventListener("focus", load); // rozetler Rust'tan olay almıyor: pencere odağa gelince yenilenir
    return () => { live = false; window.removeEventListener("focus", load); };
  }, [monitor]);
  if (!list.length) return null;
  return (
    <span className="favTray" role="group" aria-label="Sık tepsi simgeleri">
      {list.map((t) => <button key={t.id} className="tus" title={t.name} aria-label={label(t)} onClick={() => open(t)}><TrayIconView t={t} size={17} /></button>)}
    </span>
  );
}
