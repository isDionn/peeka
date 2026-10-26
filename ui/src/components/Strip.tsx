import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Battery, BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, ChevronDown, Moon, Search, Volume2, VolumeX, Wifi, WifiOff } from "lucide-react";
import { bridge, type MonitorInfo, type PinnedApp, type Status, type WindowInfo } from "../bridge";
import { clockParts } from "../lib/clock";
import { dragLayout, mergePins, reorder, type StripItem } from "../lib/mergePins";
import { useNow, usePrivacy, useSurfaces } from "../hooks";
import { StripLine, Waves } from "./Fidelity";
import { onX, sendX, stripSides, tabLeaves, focusViaKeys } from "../lib/xwin";
import { installKbModality } from "../lib/kbModality";
import { listenLine } from "../lib/lineChan";
import { WindowPreview } from "./WindowPreview";
import { SPRINGS } from "../motion/spring";
import { useSpring } from "../motion/useSpring";
import { AppIcon, AppLetter, WinLogo } from "./common";
import "./strip-items.css";
import { GlowField } from "./Glow";
import { PromotedTray } from "./TrayList";
import { IslandHiddenGlyph } from "./IslandHidden";
import { useIslandHidden } from "../hooks.fidelity";
import { cap99 } from "../lib/plugin";

export type PanelKind = "setup" | "calendar" | "start" | "status" | "search" | "appearance" | "shortcuts" | "plugins" | "modules" | "clipboard" | "mascot" | "quit" | "notif" | "cleanup" | "tray";
export type MenuState = { kind: "app"; appId: string; x: number } | { kind: "strip"; x: number };

const GAP = 2;
const batteryIcon = (b: NonNullable<Status["battery"]>) =>
  b.charging ? <BatteryCharging /> : b.percent === null ? <Battery /> : b.percent <= 15 ? <BatteryLow /> : b.percent <= 40 ? <Battery /> : b.percent >= 90 ? <BatteryFull /> : <BatteryMedium />;

/** Window choice: the active window if any, else the first; if the app is already active, move to its next window. */
export function pickWindow(item: StripItem): WindowInfo | null {
  if (!item.windows.length) return null;
  const i = item.windows.findIndex((w) => w.active);
  return item.windows[i < 0 ? 0 : item.windows.length > 1 ? (i + 1) % item.windows.length : i];
}

function activate(item: StripItem) {
  const w = pickWindow(item);
  if (w) bridge.call("activate_window", { hwnd: w.hwnd }); else bridge.call("launch_app", { appId: item.appId });
}

/** Pins and tabs share one look: the logo alone in a fixed-width slot (strip-items.css), the name in aria-label and the hover bubble.
 *  No logo from Windows: the name's first letter in a coloured circle. Several windows: a count badge on the logo's corner. */
function ItemLabel({ item }: { item: StripItem }) {
  return (
    <span className="ikK">
      {item.icon || item.colorIcon ? <AppIcon src={item.icon} color={item.colorIcon} /> : <AppLetter name={item.name} />}
      {item.windows.length > 1 && <span className="count num">{cap99(item.windows.length)}</span>}
    </span>
  );
}
/** Item classes shared by pins and tabs: the dot under the logo says running / foreground / asking for attention. */
const stateOf = (item: StripItem) => (item.active ? " active" : "") + (item.windows.some((w) => w.attention) ? " attn" : "");

/** Preview intent: item + its box (open), `undefined` = pointer left (close after a delay), `null` = close now. */
/** F-05: on a multi-window item, Enter/Space/Down arrow opens the window picker (Strip keeps the picker with kb). */
type OpenPick = (item: StripItem, el: HTMLElement) => void;
const pickKeys = (e: React.KeyboardEvent, item: StripItem, el: HTMLElement, open: OpenPick) => {
  if (item.windows.length < 2 || !["Enter", " ", "ArrowDown"].includes(e.key)) return;
  e.preventDefault();
  open(item, el);
};
/** `kb`: keyboard focus (only while the keyboard is in use, `data-kb`): the name bubble alone, no preview; with `null` (blur) only the bubble closes. */
type HoverFn = (item: StripItem | null | undefined, el?: HTMLElement, kb?: boolean) => void;
const ariaOf = (item: StripItem) =>
  item.windows.length ? `${item.name}${item.windows.length > 1 ? `, ${item.windows.length} windows` : ""}` : `${item.name}, pinned, not running`;

/** Pins: reorder by dragging (3 px threshold), all in fixed-width slots. */
function Pins({ items, pins, onMenu, onReorder, onHover, onPick }: { items: StripItem[]; pins: PinnedApp[]; onMenu: (appId: string, x: number) => void; onReorder: (ids: string[]) => void; onHover: HoverFn; onPick: OpenPick }) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; dx: number; shifts: number[]; to: number } | null>(null);
  const moved = useRef(false);

  const down = (e: React.PointerEvent, from: number) => {
    if (e.button !== 0) return;
    const kids = [...(box.current?.children ?? [])] as HTMLElement[];
    const widths = kids.map((k) => k.offsetWidth + GAP);
    const x0 = e.clientX;
    moved.current = false;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!moved.current && Math.abs(dx) < 3) return;
      moved.current = true;
      const { to, shifts, dx: cdx } = dragLayout(widths, from, dx);
      setDrag({ from, dx: cdx, shifts, to });
    };
    const up = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      if (moved.current) {
        const { to } = dragLayout(widths, from, ev.clientX - x0);
        if (to !== from) onReorder(reorder(pins.map((p) => p.appId), from, to));
        setDrag(null);
      }
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  return (
    <div className="pins" ref={box} role="tablist" aria-label="Pinned apps and their open windows">
      {items.map((item, i) => {
        const open = item.windows.length > 0;
        const style: CSSProperties | undefined = drag
          ? i === drag.from
            ? { transform: `translateX(${drag.dx}px)`, zIndex: 3, transition: "none" }
            : { transform: `translateX(${drag.shifts[i]}px)`, transition: "transform .38s cubic-bezier(.34,1.36,.64,1)" }
          : undefined;
        return (
          <button key={item.appId} role="tab" aria-selected={item.active} aria-label={ariaOf(item)}
            className={"pin" + (open ? " openPinned" : "") + stateOf(item) + (drag?.from === i ? " grabbing" : "")}
            data-app={item.appId} style={style}
            onPointerDown={(e) => { onHover(null); down(e, i); }} onPointerEnter={(e) => onHover(item, e.currentTarget)} onPointerLeave={() => onHover(undefined)}
            onFocus={(e) => onHover(item, e.currentTarget, true)} onBlur={() => onHover(null, undefined, true)}
            onKeyDown={(e) => pickKeys(e, item, e.currentTarget, onPick)} onKeyUp={(e) => { if (e.key === " " && item.windows.length > 1) e.preventDefault(); }}
            onClick={() => { if (!moved.current) activate(item); moved.current = false; }}
            onContextMenu={(e) => { e.preventDefault(); onMenu(item.appId, e.currentTarget.getBoundingClientRect().left); }}>
            <ItemLabel item={item} />
          </button>
        );
      })}
    </div>
  );
}

/** Selection pill: springs along behind the active item; a light sweeps over it on change (flowing highlight). */
function SelectionPill({ host, watch }: { host: React.RefObject<HTMLElement | null>; watch: string }) {
  const [box, setBox] = useState({ x: 0, w: 0, on: false });
  const measure = useCallback(() => {
    const el = host.current;
    const a = el?.querySelector<HTMLElement>(".pin.active, .tabA.active");
    if (!el || !a) return setBox((b) => (b.on ? { ...b, on: false } : b));
    const x = a.getBoundingClientRect().left - el.getBoundingClientRect().left, w = a.getBoundingClientRect().width;
    setBox((b) => (b.on && b.x === x && b.w === w ? b : { x, w, on: true }));
  }, [host]);
  // re-measure when `watch` changes (active item, window count); a passive effect so it runs after refs attach
  useEffect(measure, [measure, watch]);
  useEffect(() => {
    const ro = new ResizeObserver(measure);
    if (host.current) ro.observe(host.current);
    return () => ro.disconnect();
  }, [host, measure]);
  const x = useSpring(box.x, SPRINGS.pill);
  const w = useSpring(box.w, SPRINGS.pill);
  return (
    <span className="tabPill" aria-hidden="true" style={{ transform: `translateX(${x}px)`, width: Math.max(0, w), opacity: box.on ? 1 : 0, transition: "opacity .2s" }}>
      <i key={watch} style={{ animation: "glow .62s var(--ease) both" }} />
    </span>
  );
}

export interface StripProps {
  monitor: MonitorInfo;
  windows: WindowInfo[];
  pins: PinnedApp[];
  status: Status | null;
  openPanel: PanelKind | null;
  onPanel: (k: PanelKind) => void;
  onMenu: (m: MenuState) => void;
  onReorder: (ids: string[]) => void;
  /** Content placed in the center gap (preview only: the island page is a separate window; there DOM order sets Tab order). */
  center?: React.ReactNode;
}

/** Half the island window's width + gap (c1: left edge 169 px from the midline). */
const ISLAND_HALF = 176;

export function Strip({ monitor, windows, pins, status, openPanel, onPanel, onMenu, onReorder, center }: StripProps) {
  const now = useNow();
  const { date, time, label } = clockParts(now);
  // no pins on secondary displays (reference frame k): windows there are tabs only
  const { pinned, tabs } = useMemo(() => mergePins(monitor.primary ? pins : [], windows), [pins, windows, monitor.primary]);
  const left = useRef<HTMLDivElement>(null);
  const activeKey = [...pinned, ...tabs].filter((i) => i.active).map((i) => i.appId).join() + "|" + pinned.map((p) => p.appId + p.windows.length).join() + tabs.map((t) => t.appId + t.windows.length).join();
  // window preview: opens after ~250 ms of hover, closes ~200 ms after leaving (same approach as island hover intent)
  const [pv, setPv] = useState<{ item: StripItem; x: number; from?: HTMLElement } | null>(null);
  // name bubble (logos only, owner): with the same hover intent as the preview; an app with windows shows its name on the preview instead
  const [tip, setTip] = useState<{ name: string; x: number } | null>(null);
  const pvTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hover: HoverFn = useCallback((item, el, kb) => {
    clearTimeout(pvTimer.current);
    if (item === null) { setTip(null); return kb ? undefined : setPv(null); } // a blur takes only the bubble: the keyboard picker moves focus into the preview
    if (item === undefined) { pvTimer.current = setTimeout(() => { setPv(null); setTip(null); }, 200); return; }
    if (!el || (kb && !document.documentElement.hasAttribute("data-kb"))) return;
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2;
    pvTimer.current = setTimeout(() => {
      if (item.windows.length && !kb) { setTip(null); setPv({ item, x }); } else { setPv(null); setTip({ name: item.name, x }); }
    }, pv || tip ? 0 : 250);
  }, [pv, tip]);
  const pickByKey: OpenPick = useCallback((item, el) => {
    clearTimeout(pvTimer.current);
    const r = el.getBoundingClientRect();
    setPv({ item, x: r.left + r.width / 2, from: el });
    requestAnimationFrame(() => document.querySelector<HTMLElement>(".preview .small.on, .preview .small")?.focus());
  }, []);
  useEffect(() => () => clearTimeout(pvTimer.current), []);
  // keyboard-opened picker: left/right arrows move, Esc closes and returns focus to the item
  const from = pv?.from;
  useEffect(() => {
    if (!from) return;
    const key = (e: KeyboardEvent) => {
      const k = [...document.querySelectorAll<HTMLElement>(".preview .small")];
      const i = k.indexOf(document.activeElement as HTMLElement);
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setPv(null); from.focus(); }
      else if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); k[(i + (e.key === "ArrowRight" ? 1 : -1) + k.length) % k.length]?.focus(); }
      else if (e.key === "Home" || e.key === "End") { e.preventDefault(); k[e.key === "Home" ? 0 : k.length - 1]?.focus(); }
    };
    addEventListener("keydown", key, true);
    return () => removeEventListener("keydown", key, true);
  }, [from]);
  const live = pv ? [...pinned, ...tabs].find((i) => i.appId === pv.item.appId) : null; // the preview refreshes when a window closes or updates
  const privacy = usePrivacy();
  const priv = [privacy.screen ? "Screen is being shared" : "", privacy.camera.length ? "Camera in use" : ""].filter(Boolean).join(". "); // owner: no app names; no mic dot on the strip (mic state is in Status)
  // full screen: the strip slides up (t1), returns when the pointer touches the top edge (4 px), leaves ~500 ms after it drops below 140 px (t2); stays visible while an approval drops in (t3)
  const surf = useSurfaces();
  const [fs, setFs] = useState(false);
  const [edge, setEdge] = useState(false);
  useEffect(() => { installKbModality(); const off = bridge.on("fullscreen_screens", (s) => setFs(s.strips.includes(monitor.id))); return () => { off.then((f) => f()); }; }, [monitor.id]); // only this display's strip hides (a video on the second display doesn't hide the other)
  // while an approval waits and the pointer is on another monitor's strip, show a small badge there (absolutely placed: nothing shifts); cleared on null
  const [badge, setBadge] = useState(0);
  useEffect(() => { const off = bridge.on("approval_badge", (b) => setBadge(b && b.monitor === monitor.id ? b.count : 0)); return () => { off.then((f) => f()); }; }, [monitor.id]);
  useEffect(() => {
    if (!fs) { setEdge(false); return; }
    let t: ReturnType<typeof setTimeout> | undefined;
    const move = (e: MouseEvent) => { if (e.clientY < 4) { clearTimeout(t); setEdge(true); } else if (e.clientY > 140) { clearTimeout(t); t = setTimeout(() => setEdge(false), 500); } };
    addEventListener("mousemove", move);
    return () => { removeEventListener("mousemove", move); clearTimeout(t); };
  }, [fs]);
  const dropping = surf.dropStripMs !== null && surf.approvals.length > 0;
  const shift = useSpring(fs && !edge && !dropping && !openPanel ? -(30 + 60) : 0, SPRINGS.bar); // the strip stays put while a panel is open (O18)
  const slide = Math.abs(shift) > 0.05 ? `translateY(${shift}px)` : undefined;
  // when the island page says "open notifications" (a click on the task-done strip), the clock panel opens
  useEffect(() => listenLine((m) => { if (m.k === "notif" && openPanel !== "notif") onPanel("notif"); }), [openPanel, onPanel]);
  const islandHidden = useIslandHidden();
  // Tab order across windows: Tab from the last left control goes to the island, Shift+Tab from the first right control to the island's end; focus lands here when the island hands it back
  const bar = useRef<HTMLElement>(null);
  const crossTab = monitor.primary && !center && !islandHidden;
  useEffect(() => onX((m) => {
    if (m.t !== "to-strip" || !bar.current) return;
    const { left, right } = stripSides(bar.current);
    focusViaKeys(m.side === "right" ? right[0] : left[left.length - 1]);
  }), []);
  const crossKey = (e: React.KeyboardEvent) => {
    if (!crossTab || !bar.current) return;
    const { left, right } = stripSides(bar.current);
    if (tabLeaves(e, left, document.activeElement) && !e.shiftKey) { e.preventDefault(); bridge.call("focus_island").then(() => sendX({ t: "to-island" }), () => undefined); }
    else if (tabLeaves(e, right, document.activeElement) && e.shiftKey) { e.preventDefault(); bridge.call("focus_island").then(() => sendX({ t: "to-island", end: true }), () => undefined); }
  };
  // hit area: tabs fit left of the island (half width ~170); if they don't, they shrink together via flex (instead of overlapping the island by 10-36 px)
  const tabsBox = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = tabsBox.current, bar = document.querySelector("header.bar");
    if (!el || !bar) return;
    const fit = () => { el.style.maxWidth = Math.max(40, window.innerWidth / 2 - ISLAND_HALF - el.getBoundingClientRect().left) + "px"; };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [tabs.length, pinned.length, monitor.primary]);
  const trigger = (k: PanelKind) => ({ "data-panel-trigger": k, "aria-expanded": openPanel === k, onClick: () => onPanel(k) });

  return (
    <>
    <header ref={bar} className="bar" data-hit aria-label="Peeka strip" onKeyDown={crossKey} style={slide ? { transform: slide } : undefined}
      onContextMenu={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).closest(".empty")) { e.preventDefault(); onMenu({ kind: "strip", x: e.clientX }); } }}>
      {monitor.primary && <div className="glowHost"><GlowField monitor={monitor.id} /></div>}{/* the strip's slice of the Drift glow (the island window draws the rest) */}
      {!monitor.primary && badge > 0 && <span className="approvalBadge" role="status" aria-label={`${badge} awaiting approval`}>{badge > 9 ? "9+" : badge} {badge === 1 ? "approval" : "approvals"}</span>}
      <div className="side" ref={left}>
        <SelectionPill host={left} watch={activeKey} />
        {monitor.primary && priv && <span className="privacyDot" role="img" aria-label={priv} title={priv} data-only={privacy.screen ? undefined : "camera"} />}
        <button className={"key keyIcon" + (openPanel === "start" ? " shown" : "")} title="Start" aria-label="Start" aria-haspopup="dialog" {...trigger("start")}><WinLogo /></button>
        <button className={"key keyIcon" + (openPanel === "search" ? " shown" : "")} title="Search (Ctrl+K)" aria-label="Search" aria-haspopup="dialog" {...trigger("search")}><Search /></button>
        {monitor.primary && <Pins items={pinned} pins={pins} onReorder={onReorder} onHover={hover} onPick={pickByKey} onMenu={(appId, x) => onMenu({ kind: "app", appId, x })} />}
        {tabs.length > 0 && <span className="divider" />}
        <div className="tabs" ref={tabsBox} role="tablist" aria-label="Windows on this display">
          {tabs.map((t) => (
            <button key={t.appId} className={"tabA" + stateOf(t)} role="tab" aria-selected={t.active} aria-label={ariaOf(t)} data-app={t.appId}
              onPointerEnter={(e) => hover(t, e.currentTarget)} onPointerLeave={() => hover(undefined)} onPointerDown={() => hover(null)}
              onFocus={(e) => hover(t, e.currentTarget, true)} onBlur={() => hover(null, undefined, true)}
              onKeyDown={(e) => pickKeys(e, t, e.currentTarget, pickByKey)} onKeyUp={(e) => { if (e.key === " " && t.windows.length > 1) e.preventDefault(); }}
              onClick={() => activate(t)} onContextMenu={(e) => { e.preventDefault(); onMenu({ kind: "app", appId: t.appId, x: e.currentTarget.getBoundingClientRect().left }); }}>
              <ItemLabel item={t} />
            </button>
          ))}
        </div>
      </div>
      {/* center gap: the island window */}
      <div className="empty" style={{ flex: 1, alignSelf: "stretch" }}>
        {/* the island page is a separate window: when it's hidden the strip page draws the eye icon; in preview `center` (the island) draws its own */}
        {center ?? (monitor.primary && islandHidden ? <div style={{ display: "grid", placeItems: "center", height: "100%" }}><IslandHiddenGlyph /></div> : null)}
      </div>
      <div className="side">
        {monitor.primary && (
          <>
            <PromotedTray monitor={monitor.id} />
            <button className={"key keyIcon" + (openPanel === "tray" ? " shown" : "")} title="Hidden icons" aria-label="Hidden icons" aria-haspopup="dialog" {...trigger("tray")}><ChevronDown /></button>
            <button className={"key statusGroup" + (openPanel === "status" ? " shown" : "")} aria-haspopup="dialog" aria-label={statusLabel(status)} title="Volume, network, battery and more" {...trigger("status")}>
              {status?.dnd && <Moon />}
              {status?.muted ? <VolumeX /> : <Volume2 />}
              {status?.network === "none" ? <WifiOff /> : <Wifi />}
              {status?.battery && batteryIcon(status.battery)}
            </button>
          </>
        )}
        <button className={"key" + (openPanel === "calendar" ? " shown" : "")} title="Calendar" aria-label={`${label}, Calendar`} aria-haspopup="dialog" {...trigger("calendar")}>
          <span className="l2">{date}</span><span className="b6 num">{time}</span>
        </button>
      </div>
      {monitor.primary && <Waves />}
    </header>
    {monitor.primary && <StripLine shift={slide ? shift : 0} />}
    {tip && !(pv && live) && <span className="stripTip" data-paint role="tooltip" style={{ left: tip.x }}>{tip.name}</span>}
    {pv && live && <WindowPreview item={live} x={pv.x} onEnter={() => clearTimeout(pvTimer.current)} onLeave={() => hover(undefined)} onPick={(w) => { setPv(null); bridge.call("activate_window", { hwnd: w.hwnd }); }} />}
    </>
  );
}

/** Plain name for the connection level (the status card uses it too). */
export const NET_LABEL: Record<Status["network"], string> = { internet: "Connected to the internet", local: "Local network only", constrained: "Limited connection", none: "No network connection", unknown: "Network status unknown" };

function statusLabel(s: Status | null) {
  if (!s) return "Status";
  const parts = [s.volume === null ? "No audio" : `Volume ${s.muted ? "muted" : s.volume + "%"}`, NET_LABEL[s.network]];
  if (s.battery) parts.push(`Battery${s.battery.percent === null ? "" : " " + s.battery.percent + "%"}${s.battery.charging ? ", charging" : ""}`);
  return parts.join(", ") + ". Open status card";
}
