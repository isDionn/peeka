import { useEffect, useRef, useState } from "react";
import { bridge, type TrayIconX } from "../bridge";
import { AppWindow } from "lucide-react";
import { AppIcon, SAFE_ICON } from "./common";
import "../fidelity-settings.css";

/** Rust `tray_icons`: `open_tray` + color icon. No badge count arrives; without `badge` no badge is drawn. */
const loadTray = (monitor: string): Promise<TrayIconX[]> => bridge.call("tray_icons", { monitor });
const open = (t: TrayIconX, then?: () => void) => bridge.call("tray_open", { id: t.id }).then(then).catch(() => undefined);
const label = (t: TrayIconX) => t.name + (t.badge ? `, ${t.badge} new` : "");

/** The last list, so a reopened panel paints its cells at once instead of growing in after the call. */
let last: TrayIconX[] | null = null;
/** Rust's icons are the exe's own PNG; an SVG (preview glyphs) stays a monochrome template icon. */
const PNG = /^data:image\/png[;,]/;

/** Strip icon 17, hidden-icons grid (list role) 18: the notch.css app icon scale. No icon: one neutral glyph, same box. */
function TrayIconView({ t, size, color }: { t: TrayIconX; size: number; color?: string | null }) {
  return (
    <>
      {SAFE_ICON.test(t.icon) ? <AppIcon src={t.icon} color={color} size={size} /> : <AppWindow aria-hidden="true" style={{ width: size, height: size }} />}
      {!!t.badge && <span className="badge" aria-hidden="true">{t.badge > 99 ? "99+" : t.badge}</span>}
    </>
  );
}

/**
 * Hidden icons under the strip arrow (mockup y1): small 4-column grid, name as a tooltip on hover, red badge. Wave 0 test 4 fallback:
 * Rust gives the read-only `NotifyIconSettings` list; clicking calls `tray_open` (the window comes forward or the app starts).
 * Panel width should be ~188 px (Shell `<Panel width>`); at 300 px the grid sits to the left.
 */
export function TrayList({ monitor, onClose }: { monitor: string; onClose: () => void }) {
  const [list, setList] = useState<TrayIconX[] | null>(last);
  useEffect(() => {
    let live = true;
    loadTray(monitor).then((l) => { last = l; if (live) setList(l); }).catch(() => { if (live) setList([]); });
    return () => { live = false; };
  }, [monitor]);
  const grid = useRef<HTMLDivElement>(null);
  // icons arrive async: nothing could take focus when the panel opened, so focus goes to the first icon (or the grid) once the list arrives (F-09)
  useEffect(() => { if (list?.length) grid.current?.querySelector<HTMLElement>("button")?.focus(); }, [list]);
  return (
    <div className="body tray trayGrid">
      <div className="trayHead t12 b6">Hidden icons</div>
      {list && list.length === 0 && <div className="noResults">No icons</div>}
      {list && list.length > 0 && (
        <div className="trayIconGrid" role="group" aria-label="Hidden icons" ref={grid}>
          {list.map((t, i) => (
            <button key={t.id} title={t.name} aria-label={label(t)} data-autofocus={i === 0 ? "" : undefined} onClick={() => open(t, onClose)}><TrayIconView t={t} size={18} color={PNG.test(t.icon) ? t.icon : t.colorIcon} /></button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tray icons marked "Always show", in the strip's right group left of the arrow (mockup y2). The strip draws this with `<PromotedTray monitor={monitor.id} />`. */
export function PromotedTray({ monitor }: { monitor: string }) {
  const [list, setList] = useState<TrayIconX[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => loadTray(monitor).then((l) => { if (live) setList(l.filter((t) => t.promoted)); }).catch(() => undefined);
    load();
    window.addEventListener("focus", load); // badges get no events from Rust: refresh when the window gains focus
    return () => { live = false; window.removeEventListener("focus", load); };
  }, [monitor]);
  if (!list.length) return null;
  return (
    <span className="favTray" role="group" aria-label="Pinned tray icons">
      {list.map((t) => <button key={t.id} className="key" title={t.name} aria-label={label(t)} onClick={() => open(t)}><TrayIconView t={t} size={17} color={t.colorIcon} /></button>)}
    </span>
  );
}
