import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Activity, AppWindow, CircleX, Eye, File, EyeOff, Lock, PanelBottom, Pin, PinOff, Power, X } from "lucide-react";
import { bridge, type PinnedApp, type RecentItem, type WindowInfo } from "../bridge";
import { pickWindow } from "./Strip";
import { mergePins } from "../lib/mergePins";
import { AppIcon } from "./common";
import { GlowField } from "./Glow";
import { setStripGap } from "../lib/lineChan";
import { useFocusTrap } from "../lib/useFocusTrap";
import { useSettings } from "../hooks";
import { useIslandHidden } from "../hooks.fidelity";
import type { MenuState } from "./Strip";

/** A menu built by its opener (Start's apps and folders): a title, then items; "hr" is a divider. Fixed at the pointer
 *  (or the focused item), kept inside `bounds` (the panel, so the window's click region covers it). */
export type MenuItem = { label: string; icon: React.ReactNode; run: () => void } | "hr";
export type ListMenu = { kind: "list"; x: number; y: number; bounds?: DOMRect; title: string; icon?: React.ReactNode; items: MenuItem[] };

/** Right-click menu. Arrow keys move, Esc closes and focus returns to the opener. App menu: Pin, New window, Close window, Quit app.
 * Strip menu (mockup sr): Restore or hide taskbar, Hide island for now, Lock Peeka; opens under the center chip. "Quit" opens the confirmation (`onQuit`). */
export function ContextMenu({ menu, pins, windows, locked, onClose, onPins, onQuit, glow }: {
  menu: MenuState | ListMenu; pins: PinnedApp[]; windows: WindowInfo[]; /** No "Lock Peeka" item when Peeka is already locked. */ locked?: boolean; onClose: () => void;
  /** Monitor id when the strip draws the Drift glow (a strip or app menu continues it). */ glow?: string;
  onPins: (appIds: string[]) => void; /** "Quit": opens Peeka's own confirmation (ADR-0062; the second route is "Quit Peeka" in Settings > About, owner 2026-10-26). */ onQuit?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false); // "Quit app" can lose unsaved work: the first click asks for confirmation (O10)
  useFocusTrap(ref, onClose);
  const arrows = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...ref.current!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
  };
  const [denied, setDenied] = useState(false); // close/quit was denied (elevated window): the menu stays open and offers Task Manager
  const attempt = (p: Promise<unknown>) => p.then(onClose, (e) => { if (String(e) === "denied") setDenied(true); else onClose(); });
  const done = (fn: () => void) => () => { fn(); onClose(); };
  const settings = useSettings();
  const hidden = useIslandHidden();
  useLayoutEffect(() => {
    const el = ref.current, b = menu.kind === "list" ? menu.bounds : undefined;
    if (!el || !b || menu.kind !== "list") return;
    const r = el.getBoundingClientRect(), fit = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
    Object.assign(el.style, { left: `${fit(menu.x, b.left + 4, b.right - r.width - 4)}px`, top: `${fit(menu.y, b.top + 4, b.bottom - r.height - 4)}px` });
  }, [menu]);
  // strip and app menus hang from the strip (panel-surface.css .hang): the strip line breaks over them and their shoulders, and the Drift glow continues in them
  const hang = menu.kind !== "list";
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !hang) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--gx", `${innerWidth / 2 - r.left}px`); // the glow field's origin: the screen's centre line (glow.css)
    setStripGap("menu", [Math.round(r.left - 8), Math.round(r.right + 8)]);
    return () => setStripGap("menu", null);
  }, [menu, hang]);
  // the app's jump-list files go last, so a late answer pushes no other item under the cursor
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const appId = menu.kind === "app" ? menu.appId : null;
  useEffect(() => {
    if (!appId || locked || !appId.startsWith("aumid:")) return;
    let live = true;
    bridge.call("app_recent", { appId }).then((r) => live && setRecent(r.slice(0, 8)), () => undefined);
    return () => { live = false; };
  }, [appId, locked]);
  const glowHost = glow ? <div className="glowHost"><GlowField monitor={glow} /></div> : null;

  if (menu.kind === "list") {
    return (
      <div ref={ref} className="context open" role="menu" aria-label={menu.title} style={{ position: "fixed", left: menu.x, top: menu.y }} data-hit onKeyDown={arrows}>
        <div className="title">{menu.icon}<span className="titleName" title={menu.title}>{menu.title}</span></div>
        {menu.items.map((it, i) => it === "hr" ? <hr key={i} /> : (
          <button key={it.label} role="menuitem" data-autofocus={i === 0 ? "" : undefined} onClick={done(it.run)}>{it.icon}{it.label}</button>
        ))}
      </div>
    );
  }
  if (menu.kind === "strip") {
    const hideKeys = settings?.shortcuts.hide_island ?? "Ctrl+Shift+A";
    return (
      <div ref={ref} className="context open hang" role="menu" aria-label="Peeka menu" style={{ left: menu.x }} data-hit onKeyDown={arrows}>
        {glowHost}
        <div className="title"><AppWindow />Peeka</div>
        {settings?.taskbarHide === "off"
          ? <button role="menuitem" data-autofocus onClick={done(() => { bridge.call("taskbar_set_mode", { mode: "full" }).catch(() => undefined); })}><PanelBottom />Hide taskbar</button>
          : <button role="menuitem" data-autofocus onClick={done(() => bridge.call("restore_taskbar"))}><PanelBottom />Restore taskbar</button>}
        <button role="menuitem" onClick={done(() => { bridge.call("island_hide", { on: !hidden }).catch(() => undefined); })}>
          {hidden ? <Eye /> : <EyeOff />}{hidden ? "Show island" : "Hide island for now"}<span className="key-hint" style={{ marginLeft: "auto" }}>{hideKeys}</span>
        </button>
        <hr />
        {!locked && <button role="menuitem" onClick={done(() => { bridge.call("lock_now").catch(() => undefined); })}><Lock />Lock Peeka</button>}
        <button role="menuitem" onClick={done(() => onQuit?.())}><Power />Quit</button>
      </div>
    );
  }
  const { pinned, tabs } = mergePins(pins, windows);
  const item = [...pinned, ...tabs].find((i) => i.appId === menu.appId);
  const isPinned = pins.some((p) => p.appId === menu.appId);
  const w = item ? pickWindow(item) : null;
  const ids = pins.map((p) => p.appId);
  return (
    <div ref={ref} className="context open hang" role="menu" aria-label={item?.name ?? "App"} style={{ left: menu.x }} data-hit onKeyDown={arrows}>
      {glowHost}
      {item && <div className="title"><AppIcon src={item.icon} /><span className="titleName" title={item.name}>{item.name}</span></div>}
      <button role="menuitem" onClick={done(() => onPins(isPinned ? ids.filter((i) => i !== menu.appId) : [...ids, menu.appId]))}>
        {isPinned ? <PinOff /> : <Pin />}{isPinned ? "Unpin" : "Pin"}
      </button>
      <button role="menuitem" data-autofocus onClick={done(() => bridge.call("new_window", { appId: menu.appId }))}><AppWindow />New window</button>
      {w && (
        <>
          <hr />
          <button role="menuitem" onClick={() => attempt(bridge.call("close_window", { hwnd: w.hwnd }))}><X />Close window</button>
          <button role="menuitem" className={armed ? "destructive" : undefined} onClick={armed ? () => attempt(bridge.call("quit_app", { appId: menu.appId })) : () => setArmed(true)}><CircleX />{armed ? "Sure? Click again" : "Quit app"}</button>
          {(denied || w.elevated) && <button role="menuitem" onClick={done(() => { bridge.call("open_task_manager").catch(() => undefined); })}><Activity />Open Task Manager</button>}
        </>
      )}
      {recent.length > 0 && !locked && (
        <>
          <hr />
          {recent.map((f) => <button key={f.id} role="menuitem" title={f.name} onClick={done(() => { bridge.call("app_recent_open", { id: f.id }).catch(() => undefined); })}><File /><span className="titleName">{f.name}</span></button>)}
        </>
      )}
    </div>
  );
}

/** Quit confirmation: Peeka's own prompt (not a Windows dialog). Cancel has default focus. */
export function QuitConfirm({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="body" style={{ gap: 10 }}>
      <div className="t17 b6">Quit Peeka?</div>
      <div className="t13 l2 b4">The Windows taskbar comes back. The strip stays off until you open Peeka again.</div>
      <div className="buttons" style={{ justifyContent: "flex-end" }}>
        <button className="btn glass" data-autofocus onClick={onCancel}>Cancel</button>
        <button className="btn destructiveFill" onClick={() => { bridge.call("quit"); onCancel(); }}>Quit</button>
      </div>
    </div>
  );
}
