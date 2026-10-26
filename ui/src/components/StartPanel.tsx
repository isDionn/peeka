import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Brain, ChevronLeft, ChevronRight, Lock, Moon, PanelBottom, Power, RotateCcw, Search, Settings, SlidersHorizontal } from "lucide-react";
import { bridge, type AppRef, type MonitorInfo, type PinnedApp, type RecentItem, type SearchResult, type StartItem } from "../bridge";
import { derive } from "../lib/startItems";
import { StartGrid } from "./StartGrid";
import { fileKind } from "../lib/clip";
import { initial } from "../lib/plugin";
import { AppIcon, HoldButton, Kbd } from "./common";
import { FileIcon } from "./Pano";
import { useSettings } from "../hooks";
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
  useEffect(() => {
    bridge.call("list_apps").then((a) => { lastApps = a; setApps(a); });
    bridge.call("recent_files").then((r) => { lastRecent = r.slice(0, 12); setRecent(lastRecent); }).catch(() => undefined);
  }, []);
  const t = q.trim();
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

  return (
    <div className="body">
      <div className="inputBox glass">
        <Search className="l3" />
        <input data-autofocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search apps, windows, files and settings" aria-label="Search in Start"
          onKeyDown={(e) => {
            if (e.key === "Enter" && found[sel]) openFound(found[sel]);
            else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(0, Math.min(found.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))); }
          }} />
        <span style={{ margin: "0 6px 0 4px" }}><Kbd keys="Ctrl+K" /></span>
      </div>
      <div className="startCenter">
      {t ? (
        <div className="list glass startResult" role="group" aria-label="Search results" style={{ "--indent": "36px" } as React.CSSProperties}>
          {found.map((r, i) => (
            <button key={r.id} className={"row" + (i === sel ? " selected" : "")} onMouseMove={() => setSel(i)} onClick={() => openFound(r)}>
              <ResultIcon r={r} /><span className="text" style={{ textAlign: "left" }}>{r.title}</span>{r.subtitle && r.kind !== "app" && <span className="t12 l3">{r.subtitle}</span>}
            </button>
          ))}
          {!found.length && <div className="noResults">No results for “{t}”.</div>}
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
                <button key={a.appId} className="row" onClick={() => launch(a.appId)}>
                  <AppIcon src={a.icon} color={a.colorIcon} /><span className="text" style={{ textAlign: "left" }} title={a.name}>{a.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              <StartGrid items={start.items} apps={start.refs} onChange={start.save} onLaunch={launch} />
              {recent.length > 0 && (
                <>
                  <div className="sectionHead"><span>Recommended</span>{recent.length > 4 && <button className="btn kk glass" aria-expanded={more} onClick={() => setMore(!more)}>{more ? "Show less" : "Show more"}<ChevronRight /></button>}</div>
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
    </div>
  );
}
