import { useCallback, useEffect, useRef, useState } from "react";
import { justPressed, isTextEntry } from "../lib/justPressed";
import { bridge, inTauri, type Alert, type Notice } from "../bridge";
import { useClips, useHitRects, useLock, useMirror, useMonitor, usePins, useSettings, useStatus, useWindows } from "../hooks";
import { ContextMenu, QuitConfirm } from "./Menus";
import { NoticeReply, NoticeToast, NotificationList, ReviewCard } from "./Notifications";
import { SetupPanel, setupDone } from "./SetupWizard";
import { Panel } from "./common";
import { SearchPanel } from "./SearchPanel";
import { SettingsPanel, type SettingsPage } from "./SettingsPanel";
import { StartPanel } from "./StartPanel";
import { StatusCard } from "./StatusCard";
import { TrayList } from "./TrayList";
import "../panel-surface.css";
import { onX, sendX } from "../lib/xwin";
import { Strip, type MenuState, type PanelKind } from "./Strip";

export interface ShellInit { panel?: PanelKind | null; menu?: MenuState | null; review?: Alert | null; /** Preview: Ctrl+K opens with this text and this selected row (mockup ara1, ara2). */ query?: string; sel?: number; /** Preview: setup wizard at this step (0-based). */ setupStep?: number; /** Preview: the setup wizard opens by itself on first run (in the product, only in Tauri). */ setup?: boolean }
const SETTINGS_PAGES: (PanelKind | null)[] = ["appearance", "shortcuts", "plugins", "modules", "clipboard", "mascot"];

/** A monitor's strip page: strip + panels hanging below it + right-click menu. The window is taller than the strip; clickable areas are reported with `data-hit`. */
export function Shell({ monitor: monitorId, init, center }: { monitor: string; init?: ShellInit; center?: React.ReactNode }) {
  const monitor = useMonitor(monitorId);
  const windows = useWindows(monitorId);
  const [pins, setPins] = usePins();
  const [status, setStatus] = useStatus();
  const settings = useSettings();
  const [panel, setPanel] = useState<PanelKind | null>(init?.panel ?? null);
  const [menu, setMenu] = useState<MenuState | null>(init?.menu ?? null);
  const [review, setReview] = useState<Alert | null>(init?.review ?? null);
  const lock = useLock();
  const [toast, setToast] = useState<{ n: Notice; turn?: number } | null>(null);
  const [hoverToast, setHoverToast] = useState(false);
  const [trayRight, setTrayRight] = useState(8);
  useHitRects("strip", monitorId);
  // a Windows notification opens the top-right card by itself: only on the main strip, and not when quiet (do not disturb / full screen / presenting), locked, or another panel is open
  const mirror = useMirror();
  const seenNotices = useRef<Set<string> | null>(null);
  const panelRef = useRef<PanelKind | null>(null);
  const primary = !!monitor?.primary;
  useEffect(() => {
    if (!mirror.ready) return;
    const ids = new Set(mirror.items.map((n) => n.id));
    const prev = seenNotices.current;
    seenNotices.current = ids;
    // new Windows notification: brief top-right card (6 s); not shown when quiet, locked, or another panel is open
    const fresh = prev ? mirror.items.find((n) => !prev.has(n.id)) : undefined;
    if (fresh && primary && !mirror.quiet && !lock.locked) setToast((t) => (t || panelRef.current !== null ? t : { n: fresh }));
  }, [mirror, primary, lock.locked]);
  useEffect(() => { if (panel !== null || lock.locked) setToast(null); }, [panel, lock.locked]); // locking also closes an open notification card
  // newly copied text / file: since no screenshot peek shows, "Copied" appears below the strip for 1.6 s (R2-O1). Passwords and screenshots don't count.
  const clips = useClips();
  const seenClips = useRef<Set<string> | null>(null);
  const [clipNote, setClipNote] = useState(false);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const prev = seenClips.current;
    seenClips.current = new Set(clips.map((c) => c.id));
    const now = bridge.now().getTime();
    if (prev && primary && clips.some((c) => !prev.has(c.id) && c.kind !== "password" && !(c.kind === "image" && c.screenshot) && now - c.createdAt < 5000)) {
      setClipNote(true);
      clearTimeout(noteTimer.current);
      noteTimer.current = setTimeout(() => setClipNote(false), 1600);
    }
  }, [clips, primary]);
  useEffect(() => () => clearTimeout(noteTimer.current), []);
  useEffect(() => {
    if (!toast || toast.turn !== undefined || hoverToast) return; // the draft view doesn't close by itself
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast, hoverToast]);
  useEffect(() => {
    if (!toast) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setToast(null); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [toast]);
  // the gear on the island page: Settings › Modules
  useEffect(() => onX((m) => { if (m.t === "open-panel" && m.panel === "modules" && primary) setPanel("modules"); }), [primary]);
  // setup wizard on first run (only in the real app or when a preview asks; once)
  // The island page's welcome card comes first; when it closes (Skip / Start / Esc) the wizard opens. If the island doesn't answer (2 s), don't wait.
  const [welcome, setWelcome] = useState<boolean | null>(null);
  useEffect(() => {
    const off = onX((m) => { if (m.t === "welcome") setWelcome(m.open); });
    sendX({ t: "welcome?" });
    const t = setTimeout(() => setWelcome((w) => w ?? false), 2000);
    return () => { off(); clearTimeout(t); };
  }, []);
  const setupAsked = useRef(false);
  useEffect(() => { if (primary && welcome === false && !setupAsked.current && (inTauri || init?.setup) && !setupDone()) { setupAsked.current = true; setPanel((p) => p ?? "setup"); } }, [primary, init?.setup, welcome]);
  // the island window shows the short label in the strip center ("say it once"): tell it which panel is open
  panelRef.current = panel;
  useEffect(() => { if (monitor?.primary) sendX({ t: "panel", panel: panel === "search" ? "search" : SETTINGS_PAGES.includes(panel) ? "settings" : panel === "status" || panel === "start" || panel === "cleanup" || panel === "notif" ? panel : null }); if (monitor?.primary && panel) sendX({ t: "panel-open", panel }); }, [panel, monitor?.primary]);
  useEffect(() => {
    if (panel !== "tray") return;
    const el = document.querySelector('[data-panel-trigger="tray"]'); // the panel sits under the arrow, right edges aligned
    if (el) setTrayRight(Math.max(8, Math.round(window.innerWidth - el.getBoundingClientRect().right)));
  }, [panel, monitor]);

  // while Search is open or focus is in a text field (the Start box, Settings) the strip window keeps focus; afterwards it hands it back to the previous app (ADR-0062 §1)
  const [inText, setInText] = useState(false);
  useEffect(() => {
    const fin = (e: FocusEvent) => { if (isTextEntry(e.target)) setInText(true); };
    const fout = (e: FocusEvent) => { if (!isTextEntry(e.relatedTarget)) setInText(false); };
    document.addEventListener("focusin", fin);
    document.addEventListener("focusout", fout);
    return () => { document.removeEventListener("focusin", fin); document.removeEventListener("focusout", fout); };
  }, []);
  const searching = panel === "search" || (inText && panel !== null); // a hidden field that kept focus in a closed panel doesn't count
  useEffect(() => {
    if (!searching) return;
    const arg = { label: `strip-${monitorId}` };
    bridge.call("typing_focus", { ...arg, on: true }).catch(() => undefined);
    return () => { bridge.call("typing_focus", { ...arg, on: false }).catch(() => undefined); };
  }, [searching, monitorId]);

  const closeAll = useCallback(() => { setPanel(null); setMenu(null); }, []);
  const toggle = useCallback((k: PanelKind) => { setMenu(null); setPanel((p) => (p === k ? null : k)); }, []);

  useEffect(() => {
    const down = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest("[data-panel],.context,[data-panel-trigger]")) closeAll(); };
    document.addEventListener("pointerdown", down);
    const onBlur = () => { setMenu(null); setPanel((p) => (p === "setup" ? p : null)); }; // switching to another window closes panels; the setup wizard hands off to Windows via "Open settings" and stays open (O8)
    const onWinBlur = () => { if (!justPressed()) onBlur(); }; // handing focus back after a click doesn't close the panel
    // Shift+F10 / Menu key: the Peeka menu (lock, quit, restore taskbar) from any strip button. App tabs open their own menu via the native contextmenu event (F-06)
    const strip = (e: KeyboardEvent) => {
      if (!(e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) return;
      const t = e.target as HTMLElement;
      if (!t.closest("header.bar") || t.closest(".pin,.tabA")) return;
      e.preventDefault();
      setPanel(null);
      setMenu({ kind: "strip", x: t.getBoundingClientRect().left });
    };
    document.addEventListener("keydown", strip);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) closeAll(); }; // one Esc closes the top panel even if focus has left it
    window.addEventListener("blur", onWinBlur);
    document.addEventListener("keydown", esc);
    const off = bridge.on("shortcut", (e) => { if (e.name === "search" && e.monitor === monitorId) toggle("search"); });
    // in the real window, clicks outside (another app, the island, the other strip) never reach this page and the strip doesn't get focus: Rust reports them and they close like a blur
    const offPress = bridge.on("notch://outside_press", (m) => { if (m !== monitorId) onBlur(); });
    return () => { document.removeEventListener("pointerdown", down); window.removeEventListener("blur", onWinBlur); document.removeEventListener("keydown", esc); document.removeEventListener("keydown", strip); off.then((f) => f()); offPress.then((f) => f()); };
  }, [closeAll, toggle, monitorId]);

  const reorder = (ids: string[]) => {
    setPins((cur) => ids.map((id) => cur.find((p) => p.appId === id)!).filter(Boolean));
    bridge.call("set_pins", { appIds: ids }).then(setPins);
  };
  if (!monitor) return null;
  const close = () => setPanel(null);

  return (
    <>
      <Strip monitor={monitor} windows={windows} pins={pins} status={status} openPanel={panel} onPanel={toggle} onMenu={(m) => { setPanel(null); setMenu(m); }} onReorder={reorder} center={center} />
      <Panel side="left" width={600} label="Start" dataKind="start" open={panel === "start"} onClose={close}>
        <StartPanel monitor={monitor} pins={pins} onClose={close} onSettings={() => setPanel("appearance")} />
      </Panel>
      {monitor.primary && (
        <Panel side="right" width={360} label="Status" dataKind="status" open={panel === "status"} onClose={close}>
          {status && <StatusCard monitor={monitor} status={status} setStatus={setStatus} onQuit={() => setPanel("quit")} />}
        </Panel>
      )}
      {monitor.primary && (
        <Panel side="right" width={188} offset={trayRight} label="Hidden icons" dataKind="tray" open={panel === "tray"} onClose={close}>
          <TrayList monitor={monitor.id} onClose={close} />
        </Panel>
      )}
      <Panel side="right" width={400} label="Notifications" dataKind="notif" open={panel === "notif"} onClose={close}>
        <NotificationList onReview={(a) => { setReview(a); setPanel("cleanup"); }} onClose={close} />
      </Panel>
      <Panel side="center" width={520} amb="#FF9F0A" label="Cleanup approval" dataKind="cleanup" open={panel === "cleanup" && !!review} onClose={close}>
        {review && <ReviewCard alert={review} onClose={close} />}
      </Panel>
      <Panel side="center" width={640} label="Search" dataKind="search" open={panel === "search"} onClose={close}>
        <SearchPanel onClose={close} initialQuery={init?.query} initialSel={init?.sel} />
      </Panel>
      <Panel side="center" width={780} label="Peeka settings" dataKind="settings" open={SETTINGS_PAGES.includes(panel)} onClose={close}>
        {settings && <SettingsPanel page={panel === "shortcuts" || panel === "plugins" || panel === "modules" || panel === "clipboard" || panel === "mascot" ? panel : "appearance"} onPage={(p: SettingsPage) => setPanel(p)} settings={settings} onQuit={() => setPanel("quit")} />}
      </Panel>
      <Panel side="center" width={400} label="Quit Peeka" dataKind="quit" open={panel === "quit"} onClose={close}>
        <QuitConfirm onCancel={close} />
      </Panel>
      <SetupPanel open={panel === "setup"} onClose={close} startStep={init?.setupStep} />
      {clipNote && panel === null && <div className="clipNote" data-paint role="status">Copied</div>}
      {toast && (
        <div style={{ display: "contents" }} onPointerEnter={() => setHoverToast(true)} onPointerLeave={() => setHoverToast(false)}>
          {toast.turn === undefined
            ? <NoticeToast n={toast.n} onClose={() => setToast(null)} onAsk={(turn) => setToast({ n: toast.n, turn })} />
            : <NoticeReply n={toast.n} turn={toast.turn} onClose={() => setToast(null)} />}
        </div>
      )}
      {menu && (
        <ContextMenu menu={{ ...menu, x: Math.max(8, Math.min(menu.x, window.innerWidth - 248)) }} pins={pins} windows={windows} locked={lock.locked} onClose={() => setMenu(null)}
          onPins={reorder} onQuit={() => setPanel("quit")} />
      )}
    </>
  );
}
