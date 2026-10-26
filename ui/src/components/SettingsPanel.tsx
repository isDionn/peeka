import { useEffect, useState, type CSSProperties } from "react";
import { ChevronRight, Clipboard, FileText, Ghost, Info, Keyboard, LayoutGrid, LayoutPanelTop, Lock, Plus, Puzzle, Trash2, X } from "lucide-react";
import { bridge, type AppRef, type MirrorBlocker, type MirrorState, type Settings, type ShortcutId } from "../bridge";
import { formatCombo } from "../lib/shortcut";
import { resetFirstRun } from "../lib/firstRun";
import { sendX } from "../lib/xwin";
import { AppIcon, HoldButton, Kbd, NO_INDENT, radioKeys, Row, Switch } from "./common";
import { Modules, Plugins } from "./PluginSettings";
import { PluginExtras } from "./PluginExtras";
import "../fidelity-settings.css";

export type SettingsPage = "appearance" | "shortcuts" | "plugins" | "modules" | "clipboard" | "mascot";
const NAV: [SettingsPage, string, typeof Keyboard][] = [["appearance", "Appearance", LayoutPanelTop], ["shortcuts", "Shortcuts", Keyboard], ["plugins", "Plugins", Puzzle], ["modules", "Modules", LayoutGrid], ["clipboard", "Clipboard", Clipboard], ["mascot", "Mascot", Ghost]];

const TASKBAR_MODES: [Settings["taskbarHide"], string][] = [["full", "Always hide"], ["auto", "Auto-hide"], ["off", "Keep Windows taskbar"]];
/** Windows taskbar mode: read from Rust (`taskbarHide`), written with `taskbar_set_mode`; the choice is also kept locally until the change event arrives. */
function TaskbarMode({ value }: { value: Settings["taskbarHide"] }) {
  const [mode, setMode] = useState(value);
  useEffect(() => setMode(value), [value]);
  return (
    <div className="seg glass segSmall" role="radiogroup" aria-label="Windows taskbar" onKeyDown={radioKeys}>
      {TASKBAR_MODES.map(([m, title]) => (
        <button key={m} className={"segb" + (mode === m ? " on" : "")} role="radio" aria-checked={mode === m} tabIndex={mode === m ? 0 : -1} onClick={() => { setMode(m); bridge.call("taskbar_set_mode", { mode: m }).catch(() => setMode(value)); }}>{title}</button>
      ))}
    </div>
  );
}

/** Blocker reason: the row, the Windows setting (only addresses on Rust's allowlist open) and a manual path if that fails. */
const BLOCKERS: Record<MirrorBlocker, { text: string; uri: string | null; link: string; manual: string }> = {
  access_denied: { text: "Windows didn't allow it", uri: "ms-settings:privacy-notifications", link: "Open notification permissions", manual: "Windows Settings › Privacy & security › Notifications" },
  unavailable: { text: "Windows notifications can't be read on this PC", uri: null, link: "", manual: "" },
};

/** Settings › Appearance › Windows notifications (optional, off by default). The switch calls `mirror_enable` / `mirror_disable`; any blocker shows below it. */
function MirrorSetting() {
  const [st, setSt] = useState<MirrorState | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => { bridge.call("mirror_state").then(setSt).catch(() => undefined); }, []);
  const toggle = (v: boolean) => { setHint(null); bridge.call(v ? "mirror_enable" : "mirror_disable").then(setSt).catch(() => undefined); };
  const b = st?.enabled && st.blocker ? BLOCKERS[st.blocker] : null;
  const open = (uri: string, manual: string) => bridge.call("open_windows_settings", { uri }).then(() => setHint(null)).catch(() => setHint(manual));
  return (
    <>
      <Row title="Windows notifications" sub="Shown as cards in the Notifications list at top right. They stay on this PC and are never sent anywhere">
        <Switch on={!!st?.enabled} label="Windows notifications" onChange={toggle} />
      </Row>
      {b && (
        <div className="row mWarning" role="status" data-blocker={st!.blocker}>
          <div className="t12 l2">{b.text}</div>
          {b.uri && <button className="btn kk glass" style={{ alignSelf: "flex-start" }} onClick={() => open(b.uri!, b.manual)}>{b.link}</button>}
          {hint && <div className="t12 l3">Couldn't open settings. Go to: {hint}</div>}
        </div>
      )}
    </>
  );
}

/** Settings › Appearance (mockup ayg): two cards. Settings outside the mockup (volume keys, script endpoint, Windows notifications, autostart, taskbar mode) are the only UI for owner decisions; they live under "More settings". */
function Appearance({ settings }: { settings: Settings }) {
  const [more, setMore] = useState(false);
  const mode = settings.taskbarHide;
  return (
    <>
      <div className="t17 b6">Appearance</div>
      <div className="list glass" style={NO_INDENT}>
        <Row title="Strip" sub="Always visible, hidden in full screen. Reserves the top 30 px of the screen"><span className="t12 l2">Always</span></Row>
        <Row title="Hide island for now" sub="For 1 hour or until you press it again. Approvals still come through"><Kbd keys={settings.shortcuts.hide_island} /></Row>
        <Row title="Color app icons" sub="Show the real color icon on hover">
          <Switch on={settings.colorIcons} label="Color app icons" onChange={(v) => bridge.call("set_settings", { patch: { colorIcons: v } })} />
        </Row>
        <Row title="Strip on other displays" sub="Start, Search, windows and clock">
          <Switch on={settings.secondaryStrips} label="Strip on other displays" onChange={(v) => bridge.call("set_settings", { patch: { secondaryStrips: v } })} />
        </Row>
      </div>
      <div className="list glass" style={NO_INDENT}>
        <Row title="Windows taskbar" sub={`${mode === "off" ? "Windows taskbar is on" : mode === "auto" ? "Auto-hiding" : "Hidden"}. Emergency shortcut: ${settings.shortcuts.emergency}`}>
          {mode === "off"
            ? <button className="btn kk glass" onClick={() => bridge.call("taskbar_set_mode", { mode: "full" }).catch(() => undefined)}>Hide taskbar</button>
            : <button className="btn kk glass" onClick={() => bridge.call("restore_taskbar")}>Restore taskbar</button>}
        </Row>
        <Row title="Lock Peeka" sub="Hides Clipboard and plugin cards">
          <button className="btn kk glass" onClick={() => bridge.call("lock_now").catch(() => undefined)}><Lock />Lock</button>
        </Row>
      </div>
      <button className="btn kk glass otherSettings" aria-expanded={more} onClick={() => setMore(!more)}><ChevronRight />More settings</button>
      {more && (
        <div className="list glass" style={NO_INDENT}>
          <Row title="Taskbar mode" sub="Always hide, auto-hide, or keep Windows'"><TaskbarMode value={mode} /></Row>
          <Row title="Handle volume keys" sub="Show Peeka's volume indicator instead of Windows'">
            <Switch on={settings.captureVolumeKeys} label="Handle volume keys" onChange={(v) => bridge.call("set_settings", { patch: { captureVolumeKeys: v } })} />
          </Row>
          <Row title="Alert endpoint for scripts" sub="Simple alert HTTP on 127.0.0.1. The key is in the Peeka folder">
            <Switch on={settings.alertsApi} label="Alert endpoint for scripts" onChange={(v) => bridge.call("set_settings", { patch: { alertsApi: v } })} />
          </Row>
          <MirrorSetting />
          <Row title="Download complete alert" sub="Watches the Downloads folder. Reads only name and size, never contents">
            <Switch on={settings.watchDownloads} label="Download complete alert" onChange={(v) => bridge.call("set_settings", { patch: { watchDownloads: v } })} />
          </Row>
          <Row title="Start with Windows" sub="Peeka starts when you sign in">
            <Switch on={settings.autostart} label="Start with Windows" onChange={(v) => bridge.call("set_settings", { patch: { autostart: v } })} />
          </Row>
        </div>
      )}
    </>
  );
}

/** Settings › Mascot (mockup ays): pranks and celebration on/off, show the first-run intro again. */
function MascotSettings({ settings }: { settings: Settings }) {
  return (
    <>
      <div className="t17 b6">Mascot</div>
      <div className="list glass" style={NO_INDENT}>
        <Row title="Mascot pranks" sub="Every 45–90 min, up to 6 a day. Never in full screen, Do not disturb or meetings">
          <Switch on={settings.mascotPranks} label="Mascot pranks" onChange={(v) => bridge.call("set_settings", { patch: { mascotPranks: v } })} />
        </Row>
        <Row title="Celebrate finished tasks" sub="Up to 3 an hour">
          <Switch on={settings.celebrate} label="Celebrate finished tasks" onChange={(v) => bridge.call("set_settings", { patch: { celebrate: v } })} />
        </Row>
        <Row title="Show intro again" sub="Introduces Peeka and the main assistant">
          <button className="btn kk glass" onClick={() => { resetFirstRun(); sendX({ t: "firstrun" }); }}>Show</button>
        </Row>
      </div>
      <div className="t12 l3 b4">The mascot is Peeka's own character. It sleeps while the main assistant is disconnected and hides when there isn't one.</div>
    </>
  );
}

const LIFETIMES = [5, 15, 30, 60] as const;
/** Settings › Clipboard (mockup ayp, ADR-0063 §3): password lifetime can only be shortened (60 min max); "Delete all" on press and hold. */
function ClipboardSettings({ settings }: { settings: Settings }) {
  const set = (patch: Partial<Settings>) => bridge.call("set_settings", { patch });
  return (
    <>
      <div className="t17 b6">Clipboard</div>
      <div className="list glass" style={NO_INDENT}>
        <Row title="Clipboard history" sub="Last 24 hours, up to 50 items, on this PC only"><Switch on={settings.clipHistory} label="Clipboard history" onChange={(v) => set({ clipHistory: v })} /></Row>
        <Row title="Keep images and files" sub="Stores the file's location, not a copy"><Switch on={settings.clipMedia} label="Keep images and files" onChange={(v) => set({ clipMedia: v })} /></Row>
        <Row title="Password lifetime" sub="Stored encrypted (DPAPI), then deleted">
          <div className="seg glass segSmall segEqual" role="radiogroup" aria-label="Password lifetime" onKeyDown={radioKeys}>
            {LIFETIMES.map((m) => <button key={m} className={"segb" + (settings.clipPasswordMin === m ? " on" : "")} role="radio" aria-checked={settings.clipPasswordMin === m} tabIndex={settings.clipPasswordMin === m ? 0 : -1} onClick={() => set({ clipPasswordMin: m })}>{m} min</button>)}
          </div>
        </Row>
        <Row title="Delete all" sub="Can't be undone"><HoldButton label="Delete all" icon={<Trash2 />} danger onDone={() => { bridge.call("clip_clear", {}).catch(() => undefined); }} /></Row>
      </div>
    </>
  );
}

const SHORTCUT_ROWS: [ShortcutId, string][] = [["search", "Search"], ["ask", "Ask the assistant"], ["focus_island", "Go to approval"], ["hide_island", "Hide island for now"], ["emergency", "Restore taskbar (emergency)"]];

/** Shortcut row: "Change" records the next key combo (Esc cancels); the backend rejects conflicts and the reason shows here. */
function ShortcutRow({ id, title, keys }: { id: ShortcutId; title: string; keys: string }) {
  const [rec, setRec] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!rec) return;
    const onKey = async (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Escape") return setRec(false);
      const combo = formatCombo(e);
      if (!combo) return;
      setRec(false);
      const r = await bridge.call("set_settings", { patch: { shortcuts: { [id]: combo } as Settings["shortcuts"] } });
      setErr(r.ok ? null : r.error ?? "This shortcut can't be used.");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [rec, id]);
  return (
    <div className="row">
      <span className="text">{title}{err && <span className="consentWarning" role="alert">{err}</span>}</span>
      {rec ? <span className="t12 l2">Press keys… (Esc to cancel)</span> : <Kbd keys={keys} />}
      <button className="btn kk glass" aria-label={`Change ${title} shortcut`} onClick={() => { setErr(null); setRec(true); }}>Change</button>
    </div>
  );
}

const HEAD = 3;
/** Exception row: app icon, name, shortcut (can be an app-specific list like "Ctrl+K, Ctrl+Space"); the remove button appears on hover. */
function ExceptionRow({ e, onRemove }: { e: Settings["shortcutExceptions"][number]; onRemove: () => void }) {
  return (
    <div className="row">
      <span className="app"><AppIcon src={e.icon} size={13} /></span>
      <span className="text">{e.name}</span>
      <span className="t12 l3">{e.keys}</span>
      <button className="mini" aria-label={`Remove ${e.name} exception`} onClick={onRemove}><X /></button>
    </div>
  );
}

function Shortcuts({ settings }: { settings: Settings }) {
  const [adding, setAdding] = useState(false);
  const [apps, setApps] = useState<AppRef[]>([]);
  useEffect(() => { if (adding) bridge.call("list_apps").then(setApps); }, [adding]);
  // rule: apps with a non-default shortcut come first (one per row); those using the default are grouped into one row at the end
  const def = settings.shortcuts.search;
  const ex = [...settings.shortcutExceptions].sort((a, b) => +(b.keys !== def) - +(a.keys !== def));
  const save = (list: Settings["shortcutExceptions"]) => bridge.call("set_settings", { patch: { shortcutExceptions: list } });
  const free = apps.filter((a) => !ex.some((e) => e.appId === a.appId));
  const [grouped, setGrouped] = useState(true); // beyond the first three they're grouped into one row; clicking expands them
  const rest = ex.slice(HEAD);
  return (
    <>
      <div className="t17 b6">Shortcuts</div>
      <div className="list glass" style={NO_INDENT}>
        {SHORTCUT_ROWS.map(([id, title]) => <ShortcutRow key={id} id={id} title={title} keys={settings.shortcuts[id]} />)}
      </div>
      <div className="sectionHead">
        <span>When these apps are in front, shortcuts go to the app</span>
        <button className="btn kk glass" aria-expanded={adding} onClick={() => setAdding(!adding)}><Plus />Add</button>
      </div>
      {adding && (
        <div className="list glass addException" role="group" aria-label="Apps you can add" style={{ "--indent": "36px" } as CSSProperties}>
          {free.map((a) => (
            <button key={a.appId} className="row" onClick={() => { save([...ex, { ...a, keys: settings.shortcuts.search }]); setAdding(false); }}>
              <AppIcon src={a.icon} /><span className="text" style={{ textAlign: "left" }}>{a.name}</span>
            </button>
          ))}
          {!free.length && <div className="noResults">No more apps to add.</div>}
        </div>
      )}
      <div className="list glass exceptions" style={{ "--indent": "36px" } as CSSProperties}>
        {ex.slice(0, HEAD).map((e) => <ExceptionRow key={e.appId} e={e} onRemove={() => save(ex.filter((x) => x.appId !== e.appId))} />)}
        {rest.length > 0 && !grouped && rest.map((e) => <ExceptionRow key={e.appId} e={e} onRemove={() => save(ex.filter((x) => x.appId !== e.appId))} />)}
        {rest.length > 0 && grouped && (
          <button className="row exceptionGroup" aria-expanded={false} aria-label={`${rest.length} more apps: ${rest.map((e) => e.name).join(", ")}. Show each`} onClick={() => setGrouped(false)}>
            <span className="app"><FileText /></span><span className="text" title={rest.map((e) => e.name).join(", ")}>{rest.map((e) => e.name).join(", ")}</span>
            <span className="t12 l3">{rest.every((e) => e.keys === rest[0].keys) ? rest[0].keys : "various"}</span>
          </button>
        )}
      </div>
    </>
  );
}

/** One local text file to attach to a bug report (also Ctrl+Alt+Shift+D). Nothing is sent; the island shows "Open folder" too. */
function Diagnostics() {
  const [saved, setSaved] = useState<string | null>(null);
  const save = () => bridge.call("save_diagnostics").then(setSaved).catch(() => setSaved(null));
  return (
    <Row title="Diagnostics" sub={saved ? `Saved ${saved}. Nothing was sent` : "Saves a text file for bug reports: versions and screen sizes, no window titles or text. Ctrl+Alt+Shift+D"}>
      {saved
        ? <button className="btn kk glass" onClick={() => bridge.call("diagnostics_open_folder").catch(() => undefined)}>Open folder</button>
        : <button className="btn kk glass" onClick={save}>Save diagnostics</button>}
    </Row>
  );
}

function About({ settings, onQuit }: { settings: Settings; onQuit?: () => void }) {
  return (
    <>
      <div className="t17 b6">About</div>
      <div className="list glass" style={NO_INDENT}>
        <Row title="Peeka" sub="A strip and island that replace the Windows taskbar. Assistants connect to it as plugins." />
        <Row title="Updates" sub="Opens the latest release on GitHub. Peeka never checks on its own"><button className="btn kk glass" onClick={() => bridge.call("open_windows_settings", { uri: "https://github.com/isDionn/peeka/releases/latest" }).catch(() => undefined)}>Check for updates</button></Row>
        <Row title="Emergency shortcut" sub="Restores the taskbar"><Kbd keys={settings.shortcuts.emergency} /></Row>
        <Diagnostics />
        <Row title="Demo mode" sub={settings.demo ? "Sample data, nothing is saved. Peeka restarts normally" : "Try Peeka with sample data. Nothing is saved; Peeka restarts"}><button className="btn kk glass" style={{ width: 92 }} onClick={() => bridge.call("demo_restart", { on: !settings.demo }).catch(() => undefined)}>{settings.demo ? "Stop demo" : "Try demo"}</button></Row>
        {onQuit && <Row title="Quit Peeka" sub="The Windows taskbar comes back. You'll be asked to confirm first"><button className="btn kk glass destructive" onClick={onQuit}>Quit</button></Row>}
      </div>
    </>
  );
}

export function SettingsPanel({ page, onPage, settings, onQuit }: { page: SettingsPage; onPage: (p: SettingsPage) => void; settings: Settings; onQuit?: () => void }) {
  const [about, setAbout] = useState(false); // About has no page id (mockup: empty id); it opens via local state
  return (
    <div className="body">
      <div className="settings">
        <nav className="settingsNav" aria-label="Settings sections">
          {NAV.map(([id, title, Icon]) => (
            <button key={id} className={"settingsItem" + (!about && id === page ? " on" : "")} aria-current={!about && id === page ? "page" : undefined} data-autofocus={id === page ? "" : undefined} onClick={() => { setAbout(false); onPage(id); }}><Icon />{title}</button>
          ))}
          <button className={"settingsItem" + (about ? " on" : "")} aria-current={about ? "page" : undefined} onClick={() => setAbout(true)}><Info />About</button>
        </nav>
        <div className="settingsInner">{about ? <About settings={settings} onQuit={onQuit} /> : page === "appearance" ? <Appearance settings={settings} /> : page === "shortcuts" ? <Shortcuts settings={settings} /> : page === "plugins" ? <><Plugins /><PluginExtras /></> : page === "clipboard" ? <ClipboardSettings settings={settings} /> : page === "mascot" ? <MascotSettings settings={settings} /> : <Modules />}</div>
      </div>
    </div>
  );
}
