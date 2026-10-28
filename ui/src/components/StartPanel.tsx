import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Brain, Calculator, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FolderOpen, Lock, Moon, PanelBottom, Pencil, Pin, PinOff, Power, RotateCcw, Search, Settings, ShieldCheck, SlidersHorizontal, Trash2, Ungroup } from "lucide-react";
import { bridge, type AppRef, type MonitorInfo, type PinnedApp, type RecentItem, type SearchResult, type StartItem } from "../bridge";
import { derive, hasApp, keyOf, pinApp, ungroup, withoutApp } from "../lib/startItems";
import { StartGrid } from "./StartGrid";
import { ContextMenu, type ListMenu, type MenuItem } from "./Menus";
import { useWindows } from "../hooks";
import { fileKind } from "../lib/clip";
import { initial } from "../lib/plugin";
import { AppIcon, HoldButton, Kbd } from "./common";
import { FileIcon } from "./Pano";
import { useSettings } from "../hooks";
import { parseSearchAnswer } from "../lib/search";
import "../fidelity-settings.css";

const PIN_COUNT = 12;
/** The last lists, so a reopened Start paints its grid at once instead of growing in after the calls. */
let lastApps: AppRef[] = [], lastRecent: RecentItem[] = [];

/** Start's pinned grid: the saved one with folders (`settings.startItems`), or, until the owner first arranges it, the strip's pins +
 *  the next apps (Peeka's own list; Windows's Start pins are not readable). Also every app's ref by id, for the cells. */
function useStartItems(pins: PinnedApp[], apps: AppRef[], saved: StartItem[] | null | undefined) {
  const [mine, setMine] = useState<StartItem[] | null>(null); // shown at once while Rust saves
  const refs = useMemo(() => new Map([...apps, ...pins].map((a) => [a.appId, a as AppRef])), [pins, apps]);
  const items = useMemo(() => {
    if (mine ?? saved) return (mine ?? saved)!;
    const seen = new Set<string>();
    return derive([...pins, ...apps].filter((a) => !seen.has(a.appId) && !!seen.add(a.appId)).slice(0, PIN_COUNT).map((a) => a.appId));
  }, [mine, saved, pins, apps]);
  const save = (next: StartItem[]) => { setMine(next); bridge.call("set_start_items", { items: next }).catch(() => undefined); };
  useEffect(() => { setMine(null); }, [saved]); // Rust's cleaned copy (settings_changed) wins
  return { items, refs, save };
}

/** Left icon of a Recommended row: a colored tile by type for files, a monochrome icon for apps. */
function RecentTile({ r }: { r: RecentItem }) {
  if (r.kind === "app") return r.icon ? <span className="tip"><AppIcon src={r.icon} size={18} /></span> : null;
  return <span className={"tip tip2 k-" + fileKind(r.name)}><FileIcon name={r.name} /></span>;
}

function ResultIcon({ r }: { r: SearchResult }) {
  if (r.kind === "app" || r.kind === "window") return <AppIcon src={r.icon} />;
  if (r.kind === "file") return <FileIcon name={r.title} />;
  return r.kind === "setting" ? <SlidersHorizontal /> : <Brain />;
}

export function StartPanel({ monitor, pins, onClose, onSettings }: { monitor: MonitorInfo; pins: PinnedApp[]; onClose: () => void; onSettings?: () => void }) {
  const settings = useSettings();
  const taskbarShown = settings?.taskbarHide === "off";
  const [apps, setApps] = useState<AppRef[]>(lastApps);
  const [recent, setRecent] = useState<RecentItem[]>(lastRecent);
  const [q, setQ] = useState("");
  const [more, setMore] = useState(false); // "Show more": reveal recommendations beyond the first four
  const [all, setAll] = useState(false); // "All apps": full list instead of the pinned grid
  const [found, setFound] = useState<SearchResult[]>([]);
  const [sel, setSel] = useState(0); // selected search row: show which row Enter will open (O7)
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    bridge.call("list_apps").then((a) => { lastApps = a; setApps(a); });
    bridge.call("recent_files").then((r) => { lastRecent = r.slice(0, 12); setRecent(lastRecent); }).catch(() => undefined);
  }, []);
  const t = q.trim();
  const answer = useMemo(() => parseSearchAnswer(q), [q]);
  // search covers apps, windows, files and settings (same command as Ctrl+K); the grid shows when empty
  useEffect(() => {
    if (!t) { setFound([]); return; }
    let live = true;
    bridge.call("search", { query: t }).then((r) => { if (live) { setFound(r); setSel(0); } }).catch(() => undefined);
    return () => { live = false; };
  }, [t]);
  const start = useStartItems(pins, apps, settings?.startItems);
  const launch = (appId: string) => { bridge.call("launch_app", { appId }); onClose(); };
  const openFound = (r: SearchResult) => { bridge.call("search_open", { id: r.id }).catch(() => undefined); onClose(); };
  const openRecent = (r: RecentItem) => { bridge.call("open_recent", { id: r.id }).catch(() => undefined); onClose(); };
  const copy = () => { if (answer) bridge.call("clipboard_write", { text: answer.text }).then(() => setCopied(true)).catch(() => undefined); };
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1200); return () => clearTimeout(timer); }, [copied]);

  // Right-click / Shift+F10 / Menu key on an app or folder (Windows 11 Start's menu, minus "Move to front" and app jump lists)
  const windows = useWindows(monitor.id);
  const body = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<ListMenu | null>(null);
  useEffect(() => { body.current?.querySelector(".startResult .selected")?.scrollIntoView?.({ block: "nearest" }); }, [sel]); // arrow keys past the list's 300 px
  useEffect(() => {
    if (!menu) return;
    const down = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest(".context")) setMenu(null); };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [menu]);
  const show = (at: { x: number; y: number }, title: string, icon: React.ReactNode, items: MenuItem[]) =>
    setMenu({ kind: "list", x: at.x, y: at.y, bounds: body.current?.closest("[data-panel]")?.getBoundingClientRect(), title, icon, items });
  const away = (fn: () => Promise<unknown>) => () => { fn().catch(() => undefined); onClose(); };
  const appItems = (appId: string): MenuItem[] => {
    const ids = pins.map((p) => p.appId), onStrip = ids.includes(appId);
    // the strip takes only its own ids (a pin, or an app with a window); a Start Menu shortcut can't be pinned there yet
    const strip = onStrip || windows.some((w) => w.appId === appId);
    const file = !appId.startsWith("aumid:"); // a Store app has no file to show or elevate
    return [
      hasApp(start.items, appId)
        ? { label: "Unpin from Start", icon: <PinOff />, run: () => start.save(withoutApp(start.items, appId)) }
        : { label: "Pin to Start", icon: <Pin />, run: () => start.save(pinApp(start.items, appId)) },
      ...(strip ? [{ label: onStrip ? "Unpin from strip" : "Pin to strip", icon: <PanelBottom />, run: () => { bridge.call("set_pins", { appIds: onStrip ? ids.filter((i) => i !== appId) : [...ids, appId] }).catch(() => undefined); } }] : []),
      "hr",
      ...(file ? [
        { label: "Open file location", icon: <FolderOpen />, run: away(() => bridge.call("app_show_in_folder", { appId })) },
        { label: "Run as administrator", icon: <ShieldCheck />, run: away(() => bridge.call("launch_app_admin", { appId })) },
      ] : []),
      // never uninstalls by itself: Windows's Installed apps page, where the owner picks the app
      { label: "Uninstall", icon: <Trash2 />, run: away(() => bridge.call("open_windows_settings", { uri: "ms-settings:appsfeatures" })) },
    ];
  };
  const appMenu = (appId: string, name: string, icon: React.ReactNode) => ({
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); show({ x: e.clientX, y: e.clientY }, name, icon, appItems(appId)); },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (!(e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      show({ x: r.left, y: r.bottom }, name, icon, appItems(appId));
    },
  });
  const gridMenu = (it: StartItem, at: { x: number; y: number }, rename: () => void) => {
    if (it.kind === "folder") {
      show(at, it.name, null, [
        { label: "Rename", icon: <Pencil />, run: rename },
        { label: "Ungroup", icon: <Ungroup />, run: () => start.save(ungroup(start.items, keyOf(it))) },
      ]);
      return;
    }
    const a = start.refs.get(it.appId);
    show(at, a?.name ?? "App", a && <AppIcon src={a.icon} color={a.colorIcon} />, appItems(it.appId));
  };

  return (
    <div className="body" ref={body}>
      <div className="inputBox glass">
        <Search className="l3" />
        <input data-autofocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search apps, windows, files and settings" aria-label="Search in Start"
          onKeyDown={(e) => {
            if (e.key === "Enter") { if (answer && sel === 0) copy(); else if (found[sel - (answer ? 1 : 0)]) openFound(found[sel - (answer ? 1 : 0)]); }
            else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(0, Math.min(found.length + (answer ? 1 : 0) - 1, i + (e.key === "ArrowDown" ? 1 : -1)))); }
          }} />
        <span style={{ margin: "0 6px 0 4px" }}><Kbd keys="Ctrl+K" /></span>
      </div>
      <div className="startCenter">
      {t ? (
        <div className="list glass startResult" role="group" aria-label="Search results" style={{ "--indent": "34px" } as React.CSSProperties}>
          {answer && <button className={"row" + (sel === 0 ? " selected" : "")} onMouseMove={() => setSel(0)} onClick={copy}><Calculator /><span className="text" style={{ textAlign: "left" }}><b>{answer.text}</b></span><span className="t12 l3">{copied ? "Copied" : "Copy"}</span></button>}
          {found.map((r, i) => (
            <button key={r.id} className={"row" + (i + (answer ? 1 : 0) === sel ? " selected" : "")} onMouseMove={() => setSel(i + (answer ? 1 : 0))} onClick={() => openFound(r)} {...(r.kind === "app" ? appMenu(r.appId, r.title, <AppIcon src={r.icon} />) : null)}>
              <ResultIcon r={r} /><span className="text" style={{ textAlign: "left" }}>{r.title}</span>{r.subtitle && r.kind !== "app" && <span className="t12 l3">{r.subtitle}</span>}
            </button>
          ))}
          {!found.length && !answer && <div className="noResults">No results for “{t}”.</div>}
        </div>
      ) : (
        <>
          <div className="sectionHead">
            <span>{all ? "All apps" : "Pinned"}</span>
            <button className="btn kk glass" aria-expanded={all} onClick={() => setAll(!all)}>{all ? <><ChevronLeft />Pinned</> : <>All apps<ChevronRight /></>}</button>
          </div>
          {all ? (
            <div className="suggestionGrid allApps" role="group" aria-label="All apps">
              {apps.map((a) => (
                <button key={a.appId} className="row" onClick={() => launch(a.appId)} {...appMenu(a.appId, a.name, <AppIcon src={a.icon} color={a.colorIcon} />)}>
                  <AppIcon src={a.icon} color={a.colorIcon} /><span className="text" style={{ textAlign: "left" }} title={a.name}>{a.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              <StartGrid items={start.items} apps={start.refs} onChange={start.save} onLaunch={launch} onMenu={gridMenu} />
              {recent.length > 0 && (
                <>
                  <div className="sectionHead"><span>Recommended</span>{recent.length > 4 && <button className="btn kk glass" aria-expanded={more} onClick={() => setMore(!more)}>{more ? <>Show less<ChevronUp /></> : <>Show more<ChevronDown /></>}</button>}</div>
                  <div className="suggestionGrid">
                    {(more ? recent : recent.slice(0, 4)).map((r) => (
                      <button key={r.id} className="row" onClick={() => openRecent(r)}>
                        <RecentTile r={r} /><div className="sub"><div className="text" title={r.name}>{r.name}</div><div className="t12 l3" title={r.sub}>{r.sub}</div></div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
      </div>
      <div className="headSub">
        <span className="avatar" aria-hidden="true">{initial(monitor.user)}</span>
        <span className="b6 userName" title={monitor.user}>{monitor.user}</span>
        <span style={{ flex: 1 }} />
        <div className="power">
          <button className="btn kk glass" onClick={() => { bridge.call("power", { action: "lock" }); onClose(); }}><Lock />Lock</button>
          <button className="btn kk glass" onClick={() => { bridge.call("power", { action: "sleep" }); onClose(); }}><Moon />Sleep</button>
          <HoldButton label="Restart" icon={<RotateCcw />} onDone={() => bridge.call("power", { action: "restart" })} />
          <HoldButton label="Shut down" icon={<Power />} danger onDone={() => bridge.call("power", { action: "shutdown" })} />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ display: "flex", gap: 14 }}>
          {onSettings && <button className="smallLink" onClick={onSettings}><Settings />Peeka settings</button>}
          {taskbarShown
            ? <button className="smallLink" onClick={() => { bridge.call("taskbar_set_mode", { mode: "full" }).catch(() => undefined); onClose(); }}><PanelBottom />Hide taskbar</button>
            : <button className="smallLink" onClick={() => { bridge.call("restore_taskbar"); onClose(); }}><PanelBottom />Restore taskbar</button>}
        </span>
        <button className="smallLink" onClick={() => { bridge.call("open_start_menu").catch(() => undefined); onClose(); }}>Open Windows Start<ArrowUpRight /></button>
      </div>
      {menu && createPortal(<ContextMenu menu={menu} pins={pins} windows={windows} onClose={() => setMenu(null)} onPins={() => undefined} />, document.body)}
    </div>
  );
}
