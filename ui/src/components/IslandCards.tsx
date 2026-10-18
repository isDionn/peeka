import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, Bell, Calendar, Clipboard, Cpu, Inbox, LayoutGrid, Music, PanelTop, Pause, Play, SkipBack, SkipForward, Timer, X, type LucideIcon } from "lucide-react";
import { bridge, type Alert, type TimerState, type Media, type TabExt, type ModuleEntry, type PluginInfo, type ProtrusionItem, type ShelfItem, type SurfacesView, type SysmonTick, type VolumeOsd } from "../bridge";
import { capTabs, flat, MASCOT_STATES } from "../lib/plugin";
import { AlertIcon } from "../lib/alertIcon";
import { ageLabel } from "../lib/alerts";
import { actionLabel } from "../lib/alerts";
import { useAlerts, useClips, useMainAssistant } from "../hooks";
import { Lead, SummaryBoxes, TabBlocks, TabGlyph, tabLabel } from "./Plugin";
import { MeetingCard, ShelfSuggestRow } from "./Fidelity";
import { WaveMascot } from "./CardsExtra";
import "./cards.css";
import { durationSec, fmtTime, timeSlot, trackTitle } from "../lib/media";
import { ClipboardView } from "./Pano";
import { ShelfCard, TimerBump, TimerCenter } from "./Extras";

/* ---- peek rows (.cik): strip-colored, thin ---- */

export const Bars = () => <span className="seen" aria-hidden="true"><i /><i /><i /><i /></span>;

const PlayIcon = ({ playing }: { playing: boolean }) => (playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />);
const ctl = (action: "play_pause" | "next" | "previous") => () => bridge.call("media_control", { action }).catch(() => undefined);
const prev = ctl("previous"), next = ctl("next"), toggle = ctl("play_pause");

export function MusicBump({ media, pos }: { media: Media; pos: number }) {
  const d = durationSec(media);
  return (
    <div className="peekBar">
      <span className="t11 l3 num" style={{ minWidth: timeSlot(d) + "ch", textAlign: "right" }}>{fmtTime(pos)}</span>
      <span className="miniProgress" style={{ "--y": d ? Math.min(1, pos / d) : 0 } as CSSProperties}><b /></span>
      <span className="t11 l3 num" style={{ minWidth: timeSlot(d) + 1 + "ch" }}>{d ? "-" + fmtTime(d - pos) : "live"}</span>
      <button className="mini filled" title="Previous" aria-label="Previous track" disabled={!media.canPrevious} onClick={prev}><SkipBack fill="currentColor" /></button>
      <button className="mini filled" title={media.playing ? "Pause" : "Play"} aria-label={media.playing ? "Pause" : "Play"} onClick={toggle}><PlayIcon playing={media.playing} /></button>
      <button className="mini filled" title="Next" aria-label="Next track" disabled={!media.canNext} onClick={next}><SkipForward fill="currentColor" /></button>
    </div>
  );
}

export function AlertBump({ alert, onLater }: { alert: Alert; onLater: () => void }) {
  const level = alert.style === "level" && alert.progress !== null;
  return (
    <div className="peekBar">
      {level && <><span className="hudTrack"><b style={{ "--s": alert.progress } as CSSProperties} /></span><span className="num b6 t12">{Math.round((alert.progress ?? 0) * 100)}</span></>}
      {!level && alert.progress !== null && <span className="miniProgress" style={{ "--y": alert.progress } as CSSProperties}><b /></span>}
      {alert.subtitle && <span className="t12 l2" title={alert.subtitle}>{alert.subtitle}</span>}
      {alert.action && <button className="btn kk primary" onClick={() => bridge.call("open_alert", { id: alert.id }).catch(() => undefined)}>{actionLabel(alert)}</button>}
      {!level && <button className="btn kk gray" onClick={onLater}>Later</button>}
    </div>
  );
}

export function OsdBump({ osd }: { osd: VolumeOsd }) {
  const v = osd.percent;
  return (
    <div className="peekBar">
      <span className="hudTrack"><b style={{ "--s": osd.muted ? 0 : v / 100 } as CSSProperties} /></span>
      <span className="num b6 t12 l2" style={{ minWidth: 40, textAlign: "right" }}>{osd.muted ? "Muted" : v}</span>
    </div>
  );
}

/* ---- cards (.govde) ---- */

export function MusicCard({ media, pos }: { media: Media; pos: number }) {
  const d = durationSec(media) ?? 0;
  const [scrub, setScrub] = useState<number | null>(null);
  const val = scrub ?? pos;
  const sub = [media.artist, media.album].filter(Boolean).join(", ");
  const commit = () => { if (scrub !== null) { bridge.call("media_control", { action: "seek", positionMs: Math.round(scrub * 1000) }).catch(() => undefined); setScrub(null); } };
  return (
    <div className="body">
      <div className="player">
        {media.art ? <img className="cover" data-share="cover" src={media.art} alt="" /> : <span className="cover notchIcon" data-share="cover"><Music /></span>}
        <div style={{ minWidth: 0 }}>
          <div className="t20 b6" data-share="title" title={trackTitle(media)} style={{ width: "max-content", maxWidth: "100%" }}>{trackTitle(media)}</div>
          <div className="t15 b4 l2 queue" title={sub}>{sub}</div>
          <div className="progress t11 l2 num queue">
            <span style={{ minWidth: timeSlot(d) + "ch" }}>{fmtTime(val)}</span>
            <input type="range" min={0} max={d || 1} step={1} value={Math.min(val, d || 1)} disabled={!media.canSeek || !d} aria-label="Track position" aria-valuetext={`${fmtTime(val)} of ${fmtTime(d)}`}
              style={{ "--y": d ? (Math.min(val, d) / d) * 100 + "%" : "0%" } as CSSProperties}
              onChange={(e) => setScrub(+e.target.value)} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
            <span style={{ textAlign: "right", minWidth: timeSlot(d) + 1 + "ch" }}>{d ? "-" + fmtTime(d - val) : ""}</span>
          </div>
          <div className="controls queue">
            <button className="filled" title="Previous" aria-label="Previous track" disabled={!media.canPrevious} onClick={prev}><SkipBack fill="currentColor" /></button>
            <button className="large filled" title={media.playing ? "Pause" : "Play"} aria-label={media.playing ? "Pause" : "Play"} onClick={toggle}><PlayIcon playing={media.playing} /></button>
            <button className="filled" title="Next" aria-label="Next track" disabled={!media.canNext} onClick={next}><SkipForward fill="currentColor" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

const dash = "—";
function Meter({ label, text, ratio }: { label: string; text: string; ratio: number | null }) {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}><span>{label}</span><span className="num b6">{text}</span></div>
      {ratio !== null && <div className="meter" style={{ "--o": Math.round(ratio * 100) + "%", "--color": "var(--cyan)" } as CSSProperties}><b /></div>}
    </>
  );
}

/** Start a timer: minutes (1-1440) and an optional name. A new one replaces a running one; the countdown shows on the strip. */
export function TimerStart({ timer = null }: { timer?: TimerState | null }) {
  const [min, setMin] = useState("5");
  const [label, setLabel] = useState("");
  const [started, setStarted] = useState(false); // brief confirmation after pressing Start: focus and fields stay put
  useEffect(() => { if (!started) return; const t = setTimeout(() => setStarted(false), 1400); return () => clearTimeout(t); }, [started]);
  const m = Math.floor(Number(min));
  const ok = m >= 1 && m <= 1440;
  const go = (e: React.FormEvent) => { e.preventDefault(); if (ok) bridge.call("timer_start", { label: label.trim() || "Timer", seconds: m * 60 }).then(() => setStarted(true)).catch(() => undefined); };
  return (
    <>
    {timer && (
      <div className="box glass runningTimer" aria-label="Running timer">
        <h4><Timer />Running</h4>
        <div className="runningRow"><TimerCenter t={timer} /><TimerBump t={timer} /></div>
      </div>
    )}
    <form className="box glass" onSubmit={go}>
      <h4><Timer />{timer ? "New timer" : "Timer"}</h4>
      <div className="timeRow">
        <input className="min num" type="number" min={1} max={1440} inputMode="numeric" aria-label="Minutes" value={min} onChange={(e) => setMin(e.target.value)} />
        <span className="t12 l3">min</span>
        <input className="name" type="text" maxLength={40} aria-label="Timer name" placeholder="Name (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button className="btn kk primary" type="submit" disabled={!ok} aria-live="polite">{started ? "Started" : "Start"}</button>
      </div>
    </form>
    </>
  );
}

const SystemBox = ({ sys, cpu }: { sys: SysmonTick | null; cpu: number[] }) => {
  const gb = (n: number | null) => (n === null ? dash : (n / 1024 ** 3).toLocaleString("en-US", { maximumFractionDigits: 1 }));
  return (
    <div className="box glass">
      <h4><Cpu />System</h4>
      <div style={{ display: "flex", justifyContent: "space-between" }}><span>CPU</span><span className="num b6">{sys?.cpu == null ? dash : Math.round(sys.cpu) + "%"}</span></div>
      <div className="t12 l3" style={{ display: "flex", justifyContent: "space-between" }}><span>Top app</span><span className="num">{sys?.topCpu ? flat(sys.topCpu, 24) : dash}</span></div>{/* the row is always there: the card doesn't shift when a reading arrives */}
      <div className="spark" aria-hidden="true">{Array.from({ length: 16 }, (_, i) => cpu[cpu.length - 16 + i]).map((v, i) => <i key={i} className={v === undefined ? "empty" : undefined} style={{ height: v === undefined ? "4%" : Math.max(4, v * 2) + "%" }} />)}</div>
      <Meter label="Memory" text={sys?.memUsed == null || sys.memTotal == null ? dash : `${gb(sys.memUsed)} / ${gb(sys.memTotal)} GB`} ratio={sys?.memUsed == null || !sys.memTotal ? null : sys.memUsed / sys.memTotal} />
      <Meter label="GPU" text={sys?.gpu == null ? dash : Math.round(sys.gpu) + "%"} ratio={sys?.gpu == null ? null : sys.gpu / 100} />
    </div>
  );
};

/** General's overview (owner): one same-size tile per enabled core module, each one click into its tab; an empty module shows a short line, it never disappears.
 *  Clipboard shows count, kind and source only: its text and images stay behind the capture exclusion of the Clipboard tab (ADR-0063 §7). */
const TILES: [string, string, LucideIcon][] = [["music", "Music", Music], ["clipboard", "Clipboard", Clipboard], ["calendar", "Calendar", Calendar], ["timer", "Timer", Timer], ["notifications", "Notifications", Bell], ["system", "System", Cpu]];
function GeneralTiles({ ids, go, media, meeting, timer, sys }: { ids: string[]; go: (id: string) => void; media: Media | null; meeting: ProtrusionItem | null; timer: TimerState | null; sys: SysmonTick | null }) {
  const clips = useClips().filter((c) => c.kind !== "password"), { alerts } = useAlerts(); // no capture exclusion here: password items are never counted or named (ADR-0063 §7)
  const now = bridge.now().getTime(), c = clips[0], a = alerts[0];
  const line: Record<string, [ReactNode, string]> = {
    music: media ? [trackTitle(media), (media.playing ? "" : "Paused · ") + (media.artist || media.app)] : ["Nothing playing", "Music from any player shows here"],
    clipboard: c ? [`${clips.length} item${clips.length === 1 ? "" : "s"}`, `Latest: ${c.kind}${c.source ? " from " + flat(c.source, 20) : ""} · ${ageLabel((now - c.createdAt) / 1000)}`] : ["Clipboard is empty", "Things you copy show up here"],
    calendar: meeting ? [flat(meeting.title, 40), meeting.subtitle ? flat(meeting.subtitle, 40) : "Next meeting"] : ["No upcoming meetings", "From a calendar plugin"],
    timer: timer ? [<TimerCenter key="t" t={timer} />, timer.running ? "Running" : "Paused"] : ["No timer running", "Start one in the Timer tab"],
    notifications: a ? [flat(a.title, 40), alerts.length > 1 ? `+${alerts.length - 1} more` : ageLabel((now - a.updatedAt) / 1000)] : ["No notifications", "You're all caught up"],
    system: [`CPU ${sys?.cpu == null ? dash : Math.round(sys.cpu) + "%"} · GPU ${sys?.gpu == null ? dash : Math.round(sys.gpu) + "%"}`, sys?.memUsed == null || sys.memTotal == null ? "Memory " + dash : `Memory ${Math.round((sys.memUsed / sys.memTotal) * 100)}%`],
  };
  return (
    <div className="genTiles">
      {TILES.filter(([id]) => ids.includes(id)).map(([id, title, Icon]) => (
        <button key={id} type="button" className="box glass genTile" aria-label={`${title}: open tab`} onClick={() => go(id)}>
          <h4><Icon />{title}</h4>
          <div className="b6 genMain">{line[id][0]}</div>
          <div className="t12 l3 genSub">{line[id][1]}</div>
        </button>
      ))}
    </div>
  );
}

/** Music tab: same as the b2 player card (MusicCard); a short note when nothing is playing. */
function MusicTab({ media, pos }: { media: Media | null; pos: number }) {
  if (!media) return <div className="box glass"><h4><Music />Music</h4><div className="t13 l2 b4">Nothing playing right now.</div></div>;
  return <MusicCard media={media} pos={pos} />;
}

/** Notifications tab (mockup m): title + "Clear all", plain alert rows below. The "Review" cleanup approval stays in the strip panel; here the age is shown. */
function AlertsTab() {
  const { alerts } = useAlerts();
  const main = useMainAssistant();
  const nowMs = bridge.now().getTime();
  return (
    <div className="body">
      <div style={{ display: "flex", alignItems: "center" }}>
        <span className="t17 b6" style={{ flex: 1 }}>Notifications</span>
        <button className="btn kk glass" disabled={alerts.length === 0} onClick={() => bridge.call("clear_alerts").catch(() => undefined)}>Clear all</button>
      </div>
      {alerts.length === 0 ? <div className="noResults">No notifications</div> : (
        <div className="notifs" role="list">
          {alerts.map((a) => (
            <div key={a.id} role="listitem" className="notif plat glass">
              {main && a.icon && MASCOT_STATES.has(a.icon) ? <Lead plugin={{ id: main.id, name: main.name, main: true }} mascot={a.icon} size={24} /> : <span className="app"><AlertIcon name={a.icon} /></span>}
              <div style={{ flex: 1, minWidth: 0 }}><div className="b6">{a.title}</div>{a.subtitle && <div className="t12 l2 b4">{a.subtitle}</div>}</div>
              <span className="t12 l3">{ageLabel((nowMs - a.updatedAt) / 1000)}</span>
              {a.action && <button className="mini" title="Open link" aria-label={`${a.title}, open link`} onClick={() => bridge.call("open_alert", { id: a.id }).catch(() => undefined)}><ArrowUpRight /></button>}
              <button className="mini" title="Remove" aria-label={`${a.title}, remove`} onClick={() => bridge.call("dismiss_alert", { id: a.id }).catch(() => undefined)}><X /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The Modules card width follows the tab (mockup: j draws only General in 3 columns; the others are as wide as their single card).
 * Music b2, Clipboard h, Shelf g, Calendar f, Notifications m; Timer and System are small; `plugin` = a regular plugin card.
 */
/** Wide for General's 3 columns; every other tab is the SAME width (owner decision: Calendar and Timer mustn't differ). 620 = same width class as the Clipboard/Shelf/Ask cards; fits 11 tabs + gear + ×. */
export const MOD_NARROW = 620;
export const modulesKw = (page: string, screenW: number) => (page === "general" ? Math.min(1056, Math.round(screenW * 0.55)) : MOD_NARROW);

/** Core tabs (mockup j): Peeka's own; then a divider and plugin tabs. `id` matches the Settings › Modules id (wire name, stays Turkish). */
const CORE: [string, string, LucideIcon][] = [["general", "General", LayoutGrid], ["music", "Music", Music], ["clipboard", "Clipboard", Clipboard], ["shelf", "Shelf", Inbox], ["calendar", "Calendar", Calendar], ["timer", "Timer", Timer], ["system", "System", Cpu], ["notifications", "Notifications", Bell]];

/** Modules card (mockup j): 11 tabs + gear; General = assistant | Claude Code | System. System monitoring runs while the card is open (Island starts it). */
export const ModulesCard = memo(ModulesCardImpl); // Island re-renders every frame during the spring; the card only re-renders when its props change
function ModulesCardImpl({ media, pos, sys, cpu, surf, shelf, main, meeting, onPage, onClose, onApproval, start, timer = null }: { start?: string; timer?: TimerState | null; meeting: ProtrusionItem | null; onPage: (page: string, title: string) => void; onClose: () => void; media: Media | null; pos: number; sys: SysmonTick | null; cpu: number[]; surf: SurfacesView; shelf: ShelfItem[]; main: PluginInfo | null; onApproval: (id: string) => void }) {
  // Settings › Modules: disabled ones are hidden, plugin tabs follow the saved order (all on until the list arrives)
  const [mods, setMods] = useState<ModuleEntry[] | null>(null);
  useEffect(() => { bridge.call("modules_get").then(setMods).catch(() => undefined); }, []);
  const on = (id: string) => mods?.find((m) => m.id === id)?.on ?? true;
  const rank = (t: { title: string }) => { const i = mods?.findIndex((m) => m.id === t.title.toLowerCase()) ?? -1; return i < 0 ? 999 : i; };
  const tabs = capTabs(surf.tabs).filter((t) => on(t.title.toLowerCase())).sort((a, b) => rank(a) - rank(b));
  const core = CORE.filter(([id]) => on(id));
  const [tab, setTab] = useState(start ?? "general");
  const cur = tabs.find((t) => t.plugin.id + "/" + t.id === tab);
  const page = cur ? "plugin" : core.some(([id]) => id === tab) ? tab : (core[0]?.[0] ?? "general");
  const pageTitle = cur ? tabLabel(cur) : (CORE.find(([id]) => id === page)?.[1] ?? "General");
  useEffect(() => onPage(page, pageTitle), [page, pageTitle, onPage]);
  // until the Clipboard tab is ready (clip_visible answer) the old tab stays visible: the card doesn't empty and regrow
  const want = page === "plugin" ? tab : page;
  const [clipReady, setClipReady] = useState(false);
  const shownRef = useRef(want);
  const waiting = want === "clipboard" && !clipReady && shownRef.current !== "clipboard";
  const shown = waiting ? shownRef.current : want;
  shownRef.current = shown;
  useEffect(() => { if (want !== "clipboard") setClipReady(false); }, [want]);
  const segRef = useRef<HTMLDivElement>(null);
  // keep the active tab visible in the row on a narrow card
  useEffect(() => { (segRef.current?.querySelector(".segb.on") as HTMLElement | null)?.scrollIntoView?.({ inline: "nearest", block: "nearest" }); }, [tab, page]);
  // tabs are icon-only at every width, fixed size: nothing shifts on click. A sliding pill marks the active one; the name shows in a tooltip after 400 ms.
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => { const e = segRef.current?.querySelector(".segb.on") as HTMLElement | null; setPill(e ? { x: e.offsetLeft, w: e.offsetWidth } : null); }, [tab, page, tabs.length, core.length]);
  const [tip, setTip] = useState<{ text: string; x: number } | null>(null);
  const tipTimer = useRef<number | undefined>(undefined);
  const hideTip = () => { window.clearTimeout(tipTimer.current); setTip(null); };
  const tipOn = (text: string) => (e: { currentTarget: HTMLElement }) => { const b = e.currentTarget, u = b.closest(".modTop") as HTMLElement; window.clearTimeout(tipTimer.current); tipTimer.current = window.setTimeout(() => setTip({ text, x: b.getBoundingClientRect().left - u.getBoundingClientRect().left + b.offsetWidth / 2 }), 400); };
  useEffect(() => () => window.clearTimeout(tipTimer.current), []);
  // focus tooltip only for keyboard users (focus goes to the first tab programmatically on open; opening with the mouse shouldn't pop the tooltip)
  const tipProps = (text: string) => ({ "aria-label": text, onMouseEnter: tipOn(text), onFocus: (e: React.FocusEvent<HTMLElement>) => { if (document.documentElement.hasAttribute("data-kb")) tipOn(text)(e); }, onMouseLeave: hideTip, onBlur: hideTip });
  // tab bar: one Tab stop (the active tab); Left/Right/Home/End move and select (F-04)
  const order = [...core.map(([id]) => id), ...tabs.map((t) => t.plugin.id + "/" + t.id)];
  const idOf = (k: string) => "modtab-" + k.replace(/[^\p{L}\p{N}_-]/gu, "_");
  const onTabKey = (e: React.KeyboardEvent<HTMLElement>) => {
    const btns = [...(segRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])], i = btns.indexOf(e.currentTarget), n = btns.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (i < 0 || to < 0 || !order[to]) return;
    e.preventDefault(); hideTip(); setTab(order[to]); btns[to].focus();
  };
  const generalTabs = tabs.filter((t) => (t as typeof t & TabExt).general);
  const hasSummary = surf.summary.length > 0 || surf.approvals.length > 0;
  const boxes = (hasSummary ? 1 : 0) + generalTabs.length;
  const body = (p: string) => {
    const t = tabs.find((x) => x.plugin.id + "/" + x.id === p);
    return t ? <TabBlocks tab={t} />
      : p === "shelf" ? <><ShelfCard items={shelf} main={main} /><ShelfSuggestRow items={shelf} main={main} /></>
      : p === "music" ? <MusicTab media={media} pos={pos} />
      : p === "calendar" ? (meeting ? <MeetingCard item={meeting} /> : <div className="box glass"><h4><Calendar />Calendar</h4><div className="t13 l2 b4">No upcoming meetings. Meetings come from a calendar plugin.</div></div>)
      : p === "timer" ? <TimerStart timer={timer} />
      : p === "system" ? <SystemBox sys={sys} cpu={cpu} />
      : p === "notifications" ? <AlertsTab />
      : <>
        <GeneralTiles ids={core.map(([id]) => id)} go={(id) => { hideTip(); setTab(id); }} media={media} meeting={meeting} timer={timer} sys={sys} />
        {boxes > 0 && <div className="grid module general3" style={{ gridTemplateColumns: boxes >= 3 ? "1.3fr 1fr .9fr" : `repeat(${boxes}, 1fr)` }}>
          <SummaryBoxes surf={surf} onDetail={onApproval} />
          {generalTabs.map((x) => <TabBlocks key={x.plugin.id + "/" + x.id} tab={x} />)}
        </div>}
      </>;
  };
  return (
    <div className="body modRoot">
      <div className="modTop">
        <div className="seg glass" ref={segRef} role="tablist" aria-label="Modules" onScroll={hideTip} onWheel={(e) => { if (e.deltaY) e.currentTarget.scrollLeft += e.deltaY; }}>
          {pill && <span className="segPill" aria-hidden="true" style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} />}
          {core.map(([id, title, Icon]) => <button key={id} id={idOf(id)} className={"segb" + (page === id ? " on" : "")} role="tab" aria-selected={page === id} tabIndex={page === id ? 0 : -1} {...tipProps(title)} onKeyDown={onTabKey} onClick={() => { hideTip(); setTab(id); }}><Icon /></button>)}
          {tabs.length > 0 && <span className="segDivider" aria-hidden="true" />}
          {tabs.map((t) => {
            const key = t.plugin.id + "/" + t.id, sel = cur === t;
            return <button key={key} id={idOf(key)} className={"segb" + (sel ? " on" : "")} role="tab" aria-selected={sel} tabIndex={sel ? 0 : -1} {...tipProps(tabLabel(t))} onKeyDown={onTabKey} onClick={() => { hideTip(); setTab(key); }}><TabGlyph name={t.icon} /></button>;
          })}
        </div>
        {tip && <span className="segTip" role="tooltip" style={{ left: tip.x }}>{tip.text}</span>}
        <button className="close" title="Close (Esc)" aria-label="Close" onClick={onClose}><X /></button>
      </div>
      {shown !== "clipboard" && <div className="modBody" key={shown} role="tabpanel" aria-labelledby={idOf(shown)}>{body(shown)}</div>}
      {want === "clipboard" && <div className={"modBody" + (waiting ? " waiting" : "")} key="clipboard" role="tabpanel" aria-labelledby={idOf("clipboard")}><ClipboardView bare onReady={() => setClipReady(true)} /></div>}
    </div>
  );
}

const Center = ({ children }: { children: ReactNode }) => <div className="body"><div className="mkCenter">{children}</div></div>;

export const NotchIcon = ({ size }: { size: number }) => <span className="notchIcon" style={{ width: size, height: size }}><PanelTop /></span>;

const TITLE = "Welcome to Peeka";
const STRIP = "This strip replaces the taskbar: your apps on the left, the island in the middle, the clock and status on the right.";
const SEARCH = "Press Ctrl+K to search apps, windows, files and settings.";
const STEPS: { d: string; note?: string }[] = [
  { d: STRIP },
  { d: SEARCH + " Press Ctrl+Shift+Enter to reach an alert in the island from the keyboard." },
  { d: STRIP + " " + SEARCH, note: "To go back to the Windows taskbar: Settings › Appearance › Restore taskbar" },
];

/**
 * Peeka's first run (`welcome`): three pages; the last has the mockup's full text and the way back to the taskbar; the first two have "Skip".
 * Hero: the waving mascot at 96 if an assistant is connected (FPV §19; the mockup draws a neutral icon, a deliberate deviation), otherwise the neutral Peeka icon. `?step=3` starts the preview on the last page.
 */
export function FirstRunCard({ onDone, mascot = false }: { onDone: () => void; mascot?: boolean }) {
  const [i, setI] = useState(() => { const n = Number(new URLSearchParams(location.search).get("step")); return n >= 1 && n <= STEPS.length ? n - 1 : 0; });
  const last = i === STEPS.length - 1;
  return (
    <Center>
      {mascot ? <WaveMascot /> : <NotchIcon size={72} />}
      <div className="t20 b6">{TITLE}</div>
      <div className="frText"><div className="t13 l2 b4">{STEPS[i].d}</div>{STEPS[i].note && <div className="t12 l3 b4">{STEPS[i].note}</div>}</div>
      <div className="steps" aria-label={`Step ${i + 1} of ${STEPS.length}`}>{STEPS.map((_, k) => <i key={k} className={k === i ? "on" : ""} />)}</div>
      <div className="buttons frBtn" style={{ marginTop: 2 }}>
        {/* fixed slots: no button shifts when the page changes (an unused slot is just hidden) */}
        <button className="btn glass" style={{ visibility: i > 0 ? "visible" : "hidden" }} tabIndex={i > 0 ? 0 : -1} aria-hidden={i === 0} onClick={() => setI(i - 1)}>Back</button>
        <button className="btn glass" style={{ visibility: last ? "hidden" : "visible" }} tabIndex={last ? -1 : 0} aria-hidden={last} onClick={onDone}>Skip</button>
        <button className="btn primary" data-autofocus onClick={() => (last ? onDone() : setI(i + 1))}>{last ? "Start" : "Next"}</button>
      </div>
    </Center>
  );
}
