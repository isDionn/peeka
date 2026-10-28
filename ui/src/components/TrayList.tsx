import { useEffect, useMemo, useRef, useState } from "react";
import { bridge, type AppRef, type StartItem, type TrayIconX } from "../bridge";
import { AppIcon, AppLetter, SAFE_ICON } from "./common";
import { StartGrid } from "./StartGrid";
import { withNew } from "../lib/startItems";
import { useSettings } from "../hooks";
import "../fidelity-settings.css";

/** Rust `tray_icons`: `open_tray` + color icon. No badge count arrives; without `badge` no badge is drawn. */
const loadTray = (monitor: string): Promise<TrayIconX[]> => bridge.call("tray_icons", { monitor });
const open = (t: TrayIconX, then?: () => void) => bridge.call("tray_open", { id: t.id }).then(then).catch(() => undefined);
/** Screen CSS px -> the physical px Windows' menus are placed in. */
const px = (at: { x: number; y: number }) => ({ x: Math.round(at.x * devicePixelRatio), y: Math.round(at.y * devicePixelRatio) });
const label = (t: TrayIconX) => t.name + (t.badge ? `, ${t.badge} new` : "");

/** The last list, so a reopened panel paints its cells at once instead of growing in after the call. */
let last: TrayIconX[] | null = null;

/** Rust `tray_icon`: one entry's live icon/tip (Discord's red dot, OneDrive's sync arrows), at most ~4 a second. */
const patch = (l: TrayIconX[], t: TrayIconX) => l.map((o) => (o.id === t.id ? t : o));
const onLive = (set: (t: TrayIconX) => void) => {
  const off = bridge.on("tray_icon", (t) => { if (last) last = patch(last, t); set(t); });
  return () => { off.then((f) => f()); };
};

/** Strip icon 17, hidden-icons grid (list role) 18: the notch.css app icon scale. No icon: the name's letter in a circle, as on the strip. */
function TrayIconView({ t, size, color }: { t: TrayIconX; size: number; color?: string | null }) {
  return (
    <>
      {SAFE_ICON.test(t.icon) ? <AppIcon src={t.icon} color={color} size={size} /> : <AppLetter name={t.name} />}
      {!!t.badge && <span className="badge" aria-hidden="true">{t.badge > 99 ? "99+" : t.badge}</span>}
    </>
  );
}

/**
 * Hidden icons under the strip arrow (mockup y1): small 4-column grid, name as a tooltip on hover, red badge. Wave 0 test 4 fallback:
 * Rust gives the read-only `NotifyIconSettings` list; clicking calls `tray_open` (the window comes forward or the app starts).
 * Panel width should be ~188 px (Shell `<Panel width>`); at 300 px the grid sits to the left.
 * Owner 2026-10-26: drag to reorder, drop one icon on another to group them: Start's folders (StartGrid, compact), saved as
 * `settings.trayItems` by the tray's stable `exe:<path>` id. Icons of apps not running now keep their place, unseen.
 */
export function TrayList({ monitor, onClose }: { monitor: string; onClose: () => void }) {
  const [list, setList] = useState<TrayIconX[] | null>(last);
  useEffect(() => {
    let live = true;
    loadTray(monitor).then((l) => { last = l; if (live) setList(l); }).catch(() => { if (live) setList([]); });
    return () => { live = false; };
  }, [monitor]);
  useEffect(() => onLive((t) => setList((l) => l && patch(l, t))), []);
  const saved = useSettings()?.trayItems;
  const [mine, setMine] = useState<StartItem[] | null>(null); // shown at once while Rust saves
  useEffect(() => { setMine(null); }, [saved]); // Rust's cleaned copy (settings_changed) wins
  const byId = useMemo(() => new Map((list ?? []).map((t) => [t.id, t])), [list]);
  const refs = useMemo(() => new Map<string, AppRef>((list ?? []).map((t) => [t.id, { appId: t.id, name: t.name, icon: t.icon, colorIcon: t.colorIcon }])), [list]);
  const items = useMemo(() => withNew(mine ?? saved ?? [], (list ?? []).map((t) => t.id)), [mine, saved, list]);
  const save = (next: StartItem[]) => { setMine(next); bridge.call("set_settings", { patch: { trayItems: next } }).catch(() => undefined); };
  const menu = (id: string, at: { x: number; y: number }) => bridge.call("tray_menu", { id, ...px(at) }).catch(() => open(byId.get(id)!));
  const compact = useMemo(() => ({
    tile: (a: AppRef, mini: boolean) => { const t = byId.get(a.appId)!; return mini ? <TrayIconView t={{ ...t, badge: undefined }} size={14} color={t.colorIcon} /> : <TrayIconView t={t} size={18} color={t.colorIcon} />; },
    label: (a: AppRef) => label(byId.get(a.appId)!),
  }), [byId]);
  const grid = useRef<HTMLDivElement>(null);
  // icons arrive async: nothing could take focus when the panel opened, so focus goes to the first icon (or the grid) once the list arrives (F-09)
  useEffect(() => { if (list?.length) grid.current?.querySelector<HTMLElement>("button")?.focus(); }, [list]);
  return (
    <div className="body tray trayGrid">
      <div className="trayHead t12 b6">Hidden icons</div>
      {list && list.length === 0 && <div className="noResults">No icons</div>}
      {list && list.length > 0 && (
        <div className="trayIconGrid" role="group" aria-label="Hidden icons" ref={grid}>
          <StartGrid items={items} apps={refs} onChange={save} onLaunch={(id) => open(byId.get(id)!, onClose)} onMenu={(it, at) => { if (it.kind === "app") menu(it.appId, at); }} compact={compact} />
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
    const load = () => loadTray(monitor).then((l) => { last = l; if (live) setList(l.filter((t) => t.promoted)); }).catch(() => undefined); // also warms the Hidden icons panel: its first open paints full size
    load();
    window.addEventListener("focus", load); // badges get no events from Rust: refresh when the window gains focus
    return () => { live = false; window.removeEventListener("focus", load); };
  }, [monitor]);
  useEffect(() => onLive((t) => setList((l) => patch(l, t))), []);
  if (!list.length) return null;
  return (
    <span className="favTray" role="group" aria-label="Pinned tray icons">
      {list.map((t) => <button key={t.id} className="key" title={t.name} aria-label={label(t)} onClick={() => open(t)} onContextMenu={(e) => { e.preventDefault(); bridge.call("tray_menu", { id: t.id, ...px({ x: e.screenX, y: e.screenY }) }).catch(() => open(t)); }}><TrayIconView t={t} size={17} color={t.colorIcon} /></button>)}
    </span>
  );
}
