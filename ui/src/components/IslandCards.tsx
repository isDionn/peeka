import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, BatteryLow, BatteryMedium, Bell, Calendar, ChevronRight, Clipboard, Cpu, Inbox, LayoutGrid, MessageCircle, Music, PanelTop, Settings as Gear, Pause, Play, SkipBack, SkipForward, Timer, X, type LucideIcon } from "lucide-react";
import { bridge, type Alert, type TimerState, type Media, type TabExt, type ModuleEntry, type PluginInfo, type ProtrusionItem, type ShelfItem, type Status, type SurfacesView, type SysmonTick, type VolumeOsd } from "../bridge";
import type { ApprovalItem } from "../plugin-api";
import type { CcSession } from "../lib/notes";
import { SessionList } from "./Notes";
import { LOCK_MUSIC } from "./SideBubble";
import { capTabs, flat, MASCOT_STATES, riskOf } from "../lib/plugin";
import { AlertIcon } from "../lib/alertIcon";
import { ageLabel } from "../lib/alerts";
import { actionLabel } from "../lib/alerts";
import { timerLeft, useAlerts, useClips, useMainAssistant, useSecond } from "../hooks";
import { answer, GuardBtn, Lead, SummaryBoxes, TabBlocks, TabGlyph, tabLabel } from "./Plugin";
import { MeetingCard, ShelfSuggestRow } from "./Fidelity";
import { WaveMascot } from "./CardsExtra";
import { Mascot } from "../mascot";
import "./cards.css";
import { durationSec, fmtTime, timeSlot, trackTitle } from "../lib/media";
import { ClipboardView } from "./Pano";
import { ShelfCard, TimerBump, TimerCenter } from "./Extras";
import { ClaudeChatTab } from "./ClaudeChat";
import { sendX } from "../lib/xwin";

/* ---- peek rows (.cik): strip-colored, thin ---- */

export { Bars } from "./Bars";

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

/** Arrow keys on the track: 5 s back / forward (the range's own step is 1 s, for dragging). */
const SEEK_KEYS: Record<string, number> = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5 };

/** b2 player card. M1: the ghost rides in at 56 px (swaying to the beat while playing; idle when paused or `calm` = locked/presenting); the strip's ghost steps aside (one mascot). */
export function MusicCard({ media, pos, calm = false }: { media: Media; pos: number; calm?: boolean }) {
  const main = useMainAssistant();
  const d = durationSec(media) ?? 0;
  const [scrub, setScrub] = useState<number | null>(null);
  const [held, setHeld] = useState(false); // sent: the new time stays until Rust's next timeline (players lag), a refusal, or 2 s
  const drop = () => { setScrub(null); setHeld(false); };
  useEffect(() => { if (held) drop(); }, [media.positionAt]); // eslint-disable-line react-hooks/exhaustive-deps -- only a fresh timeline ends the hold
  useEffect(() => { if (!held) return; const t = setTimeout(drop, 2000); return () => clearTimeout(t); }, [held]);
  const val = scrub ?? pos;
  const sub = [media.artist, media.album].filter(Boolean).join(", ");
  const move = (v: number) => { setHeld(false); setScrub(Math.max(0, Math.min(d, v))); };
  const commit = () => { if (scrub === null || held) return; setHeld(true); bridge.call("media_control", { action: "seek", positionMs: Math.round(scrub * 1000) }).catch(drop); };
  return (
    <div className="body">
      <div className={"player" + (main ? " rider" : "")} data-scrub={scrub !== null ? "" : undefined}>
        {media.art ? <img className="cover" data-share="cover" src={media.art} alt="" /> : <span className="cover notchIcon" data-share="cover"><Music /></span>}
        <div style={{ minWidth: 0 }}>
          <div className="t20 b6" data-share="title" title={trackTitle(media)} style={{ width: "max-content", maxWidth: "100%" }}>{trackTitle(media)}</div>
          <div className="t15 b4 l2 queue" title={sub}>{sub}</div>
          <div className="controls queue">
            <button className="filled" title="Previous" aria-label="Previous track" disabled={!media.canPrevious} onClick={prev}><SkipBack fill="currentColor" /></button>
            <button className="large filled" title={media.playing ? "Pause" : "Play"} aria-label={media.playing ? "Pause" : "Play"} onClick={toggle}><PlayIcon playing={media.playing} /></button>
            <button className="filled" title="Next" aria-label="Next track" disabled={!media.canNext} onClick={next}><SkipForward fill="currentColor" /></button>
          </div>
          {/* the progress row opens under the controls on hover / keyboard focus: at rest the card is shorter, and the controls never move (cards.css) */}
          <div className="progWrap">
            <div className="progress t11 l2 num queue">
              <span style={{ minWidth: timeSlot(d) + "ch" }}>{fmtTime(val)}</span>
              <input type="range" min={0} max={d || 1} step={1} value={Math.min(val, d || 1)} disabled={!media.canSeek || !d} aria-label="Track position" aria-valuetext={`${fmtTime(val)} of ${fmtTime(d)}`}
                style={{ "--y": d ? (Math.min(val, d) / d) * 100 + "%" : "0%" } as CSSProperties}
                onChange={(e) => move(+e.target.value)} onKeyDown={(e) => { const k = SEEK_KEYS[e.key]; if (k) { e.preventDefault(); move(val + k); } }}
                onPointerDown={(e) => e.currentTarget.setPointerCapture?.(e.pointerId) /* the release lands here even off the track; the island keeps its hover */}
                onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
              <span style={{ textAlign: "right", minWidth: timeSlot(d) + 1 + "ch" }}>{d ? "-" + fmtTime(d - val) : ""}</span>
            </div>
          </div>
        </div>
        {main && <Lead plugin={{ id: main.id, name: main.name, main: true }} mascot={media.playing && !calm ? "music" : "ready"} size={56} />}
      </div>
    </div>
  );
}

const dash = "—";
function Meter({ label, text, ratio }: { label: string; text: string; ratio: number | null }) {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}><span>{label}</span><span className="num b6">{text}</span></div>
      <div className="meter" style={{ "--o": Math.round(Math.max(0, Math.min(1, ratio ?? 0)) * 100) + "%", "--color": "var(--cyan)" } as CSSProperties}><b /></div>
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

const SystemBox = ({ sys, cpu, battery }: { sys: SysmonTick | null; cpu: number[]; battery: Status["battery"] }) => {
  const gb = (n: number | null) => (n === null ? dash : (n / 1024 ** 3).toLocaleString("en-US", { maximumFractionDigits: 1 }));
  const speed = (n: number | null) => n === null ? dash : `${(n / 1024 ** 2).toLocaleString("en-US", { maximumFractionDigits: 1 })} MB/s`;
  const uptime = (n: number | null) => {
    if (n === null) return dash;
    const d = Math.floor(n / 86_400), h = Math.floor(n % 86_400 / 3_600), m = Math.floor(n % 3_600 / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
  };
  const charge = `${battery?.percent}%${battery?.charging ? " charging" : battery?.plugged ? " plugged in" : ""}`;
  return (
    <div className="box glass">
      <h4><Cpu />System</h4>
      <div style={{ display: "flex", justifyContent: "space-between" }}><span>CPU</span><span className="num b6">{sys?.cpu == null ? dash : Math.round(sys.cpu) + "%"}</span></div>
      <div className="t12 l3" style={{ display: "flex", justifyContent: "space-between" }}><span>Top app</span><span className="num">{sys?.topCpu ? flat(sys.topCpu, 24) : dash}</span></div>{/* the row is always there: the card doesn't shift when a reading arrives */}
      <div className="spark" aria-hidden="true">{Array.from({ length: 16 }, (_, i) => cpu[cpu.length - 16 + i]).map((v, i) => <i key={i} className={v === undefined ? "empty" : undefined} style={{ height: v === undefined ? "4%" : Math.max(4, v * 2) + "%" }} />)}</div>
      <Meter label="Memory" text={sys?.memUsed == null || sys.memTotal == null ? dash : `${gb(sys.memUsed)} / ${gb(sys.memTotal)} GB`} ratio={sys?.memUsed == null || !sys.memTotal ? null : sys.memUsed / sys.memTotal} />
      <Meter label="GPU" text={sys?.gpu == null ? dash : Math.round(sys.gpu) + "%"} ratio={sys?.gpu == null ? null : sys.gpu / 100} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}><span>Network</span><span className="num b6">{`↓ ${speed(sys?.down ?? null)} · ↑ ${speed(sys?.up ?? null)}`}</span></div>
      <Meter label="C: drive" text={sys?.diskUsed == null || sys.diskTotal == null ? dash : `${gb(sys.diskUsed)} / ${gb(sys.diskTotal)} GB`} ratio={sys?.diskUsed == null || !sys.diskTotal ? null : sys.diskUsed / sys.diskTotal} />
      {battery?.percent != null && <Meter label="Battery" text={charge} ratio={battery.percent / 100} />}{/* owner: no battery, no row */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}><span>Uptime</span><span className="num b6">{uptime(sys?.uptimeS ?? null)}</span></div>
    </div>
  );
};

/** General home "Places" (owner chose B, ui/concepts/overview.*): every module keeps a fixed spot (cards.css grid areas) so the eye learns where things are.
 *  The big Now box speaks only for what needs you (a plugin approval waiting, low battery); music, Claude Code and the clipboard show in their own spots,
 *  and a spot lights up when there's news there. A spot's name opens its tab ("Claude Code" opens the strip's sessions list). 264 px tall in every state.
 *  One mascot: the 56 px ghost outranks the strip's 40 px and the Compass box's 24 px in the single-mascot registry (as M1's MusicCard does).
 *  `generic` (locked, presenting, screen shared): no titles, names or tools. Clipboard shows count, kind and age only, never content (ADR-0063 §7). */
const CLIP_FRESH_MS = 15_000; // useClips re-renders every 15 s, so the wash fades on its next tick without a timer of its own
const QUICK = [5, 15, 25];
const ago = (s: number) => { const l = ageLabel(s); return l === "now" ? "just now" : l + " ago"; };
const TimerLeft = ({ t }: { t: TimerState }) => <span className="num">{fmtTime(Math.ceil(timerLeft(t, useSecond(t.running))))}</span>;
const Head = ({ name, go }: { name: string; go: () => void }) => <button type="button" className="genHead" aria-label={`${name}: open tab`} onClick={go}>{name}<ChevronRight aria-hidden="true" /></button>;
const NO_SESS: CcSession[] = [];
export type CcSessions = { n: number; list: CcSession[]; last: { tool: string | null; at: number } | null; limited: boolean };

function GeneralTiles({ ids, go, media, meeting, timer, sys, approvals, onApproval, generic, battery, cc }: { ids: string[]; go: (id: string) => void; media: Media | null; meeting: ProtrusionItem | null; timer: TimerState | null; sys: SysmonTick | null; approvals: ApprovalItem[]; onApproval: (id: string) => void; generic: boolean; battery: Status["battery"]; cc: CcSessions }) {
  const clips = useClips().filter((c) => c.kind !== "password"); // password items are never counted or named (ADR-0063 §7)
  const [sessOpen, setSessOpen] = useState(false);
  const ccHead = useRef<HTMLButtonElement>(null), closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (sessOpen) closeRef.current?.focus(); }, [sessOpen]);
  const closeSess = () => { setSessOpen(false); ccHead.current?.focus(); };
  const now = bridge.now().getTime(), c = clips[0], a = approvals[0], on = (id: string) => ids.includes(id);
  const low = battery?.percent != null && battery.percent < 20 && !battery.charging && !battery.plugged;
  // Allow / Deny here only where the strip's peek offers Allow (ApprovalBump): low risk, a plain yes/no. Anything else opens the approval card.
  const direct = !!a && riskOf(a.risk) !== "high" && !a.choices?.length && !a.freeText && a.options.includes("allow");
  const box = a ? { key: "appr:" + a.id, tone: " attn", head: generic ? "Waiting for your approval" : `${flat(a.plugin.name, 24)} needs your approval`, sub: generic || approvals.length > 1 ? `${approvals.length} waiting` : flat(a.title, 60),
      act: direct ? <>{a.options.includes("deny") && <button type="button" className="btn kk glass" onClick={() => answer(a, "deny")}>Deny</button>}<GuardBtn className="btn kk primary" onClick={() => answer(a, "allow")}>Allow</GuardBtn></>
        : <button type="button" className="btn kk primary" onClick={() => onApproval(a.id)}>Details</button> }
    : low ? { key: "batt", tone: " warn", head: `Battery at ${battery!.percent}%`, sub: "Not charging. Plug in soon.",
      act: <button type="button" className="btn kk glass" onClick={() => bridge.call("open_windows_settings", { uri: "ms-settings:batterysaver" }).catch(() => undefined)}>Battery saver settings</button> }
    : { key: "idle", tone: "", head: "Nothing needs you", sub: "All quiet right now", act: null };
  const mood = a ? "approval" : low ? "tired" : media?.playing && !generic ? "music" : "idle";
  const fresh = !!c && now - c.createdAt < CLIP_FRESH_MS;
  const pct = battery?.percent ?? null, cpu = sys?.cpu == null ? dash : Math.round(sys.cpu) + "%";
  const startTimer = (m: number) => bridge.call("timer_start", { label: "Timer", seconds: m * 60 }).catch(() => undefined);
  return (
    <div className="genHome">
      <div className={"genTile genNow" + box.tone} role="status">
        {/* always drawn, like the strip's rest ghost it replaces (owner rule): not gated on a connected assistant; outside the keyed text so it never remounts */}
        <span className="genGhost"><Mascot size={56} mood={mood} isMainAssistant /></span>
        <div className="genText genIn" key={box.key}>
          <div className="t17 b6 genLine">{box.head}</div>
          <div className="t13 l3 genLine">{box.sub}</div>
          {box.act && <div className="genActs">{box.act}</div>}
        </div>
      </div>
      {on("music") && (
        <div className="genTile genMusic">
          <Head name="Music" go={() => go("music")} />
          <div className="genMusicRow">
            {media?.art && !generic ? <img className="genArt" src={media.art} alt="" /> : <span className="genArt notchIcon"><Music aria-hidden="true" /></span>}
            <div className="genText">
              <div className="t13 b6 genLine">{!media ? "Nothing playing" : generic ? (media.playing ? LOCK_MUSIC : "Music paused") : trackTitle(media)}</div>
              <div className={"t12 genLine " + (media?.playing ? "genLive" : "l3")}>{!media ? "Play in any app" : media.playing ? "Playing" : "Paused"}</div>
            </div>
          </div>
          <div className="genTransport">
            <button type="button" className="mini filled" title="Previous" aria-label="Previous track" disabled={!media?.canPrevious} onClick={prev}><SkipBack fill="currentColor" /></button>
            <button type="button" className="mini filled" title={media?.playing ? "Pause" : "Play"} aria-label={media?.playing ? "Pause" : "Play"} disabled={!media} onClick={toggle}><PlayIcon playing={!!media?.playing} /></button>
            <button type="button" className="mini filled" title="Next" aria-label="Next track" disabled={!media?.canNext} onClick={next}><SkipForward fill="currentColor" /></button>
          </div>
        </div>
      )}
      <div className="genTile" style={{ gridArea: "cc" }}>
        {cc.n ? <button ref={ccHead} type="button" className="genHead" aria-label="Claude Code sessions, show list" aria-expanded={sessOpen} onClick={() => setSessOpen(true)}>Claude Code<ChevronRight aria-hidden="true" /></button>
          : <span className="genHead">Claude Code</span> /* no sessions: nothing to list, a plain label (owner) */}
        <div className={"t13 b6 genLine" + (cc.n ? " genLive" : "")}>{cc.n ? `${cc.n} session${cc.n === 1 ? "" : "s"} open` : "No open sessions"}</div>
        <div className="t12 l3 genLine">{cc.last ? `Last activity ${ago((Date.now() - cc.last.at) / 1000)}` : "Nothing yet"}</div>
      </div>
      {on("clipboard") && (
        <div className={"genTile" + (fresh ? " info" : "")} style={{ gridArea: "clip" }}>
          <Head name="Clipboard" go={() => go("clipboard")} />
          <div className="t13 b6 genLine genIn" key={c?.id ?? "none"}>{c ? `${c.kind[0].toUpperCase() + c.kind.slice(1)}, ${ago((now - c.createdAt) / 1000)}` : "Empty"}</div>
          <div className="t12 l3 genLine">{clips.length} item{clips.length === 1 ? "" : "s"}</div>
        </div>
      )}
      {on("calendar") && (
        <div className="genTile" style={{ gridArea: "cal" }}>
          <Head name="Calendar" go={() => go("calendar")} />
          <div className="t13 b6 genLine">{!meeting ? "No upcoming meetings" : generic ? "Upcoming meeting" : flat(meeting.title, 40)}</div>
          <div className="t12 l3 genLine">{!meeting ? "From a calendar plugin" : !generic && meeting.subtitle ? flat(meeting.subtitle, 40) : "Next"}</div>
        </div>
      )}
      {on("timer") && (
        <div className="genTile genBar" style={{ gridArea: "timer" }}>
          <Timer aria-hidden="true" /><Head name="Timer" go={() => go("timer")} />
          {timer && <span className="t13 b6"><TimerLeft t={timer} /> left</span>}
          <span className="genChips">{QUICK.map((m) => <button key={m} type="button" className="btn kk glass" aria-label={`Start a ${m} minute timer`} onClick={() => startTimer(m)}>{m} min</button>)}</span>
        </div>
      )}
      <button type="button" className={"genTile genBar" + (low ? " warn" : "")} style={{ gridArea: "power" }} disabled={!on("system")} aria-label={`System: ${pct === null ? "" : `battery ${pct}%, `}CPU ${cpu}, open tab`} onClick={() => go("system")}>
        {pct !== null && <>{low ? <BatteryLow className="genWarnIc" aria-hidden="true" /> : <BatteryMedium aria-hidden="true" />}<span className={"t13 b6 num" + (low ? " genWarnTx" : "")}>{pct}%</span></>}
        {pct === null && <Cpu aria-hidden="true" />}<span className="t12 l3 num">CPU {cpu}</span>
      </button>
      {sessOpen && (
        <div className="genSessions" onKeyDownCapture={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeSess(); } /* Esc closes the list, not the card: capture, because the card's focus trap listens natively on the card and would close it first */ }}>
          <SessionList n={cc.n} list={cc.list} last={cc.last} locked={generic} limited={cc.limited} />
          <button ref={closeRef} type="button" className="mini genClose" title="Close" aria-label="Close sessions list" onClick={closeSess}><X /></button>
        </div>
      )}
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

/** Every Modules tab is the SAME width, General included (owner: Calendar and Timer mustn't differ; Places is drawn for 620). Fits 11 tabs + gear + ×. */
export const MOD_NARROW = 620;

/** Core tabs (mockup j): Peeka's own; then a divider and plugin tabs. `id` matches the Settings › Modules id (wire name, stays Turkish). */
const CORE: [string, string, LucideIcon][] = [["general", "General", LayoutGrid], ["music", "Music", Music], ["clipboard", "Clipboard", Clipboard], ["shelf", "Shelf", Inbox], ["calendar", "Calendar", Calendar], ["timer", "Timer", Timer], ["system", "System", Cpu], ["notifications", "Notifications", Bell], ["claude", "Claude", MessageCircle]];

/** Modules card (mockup j): 11 tabs + gear; General = assistant | Claude Code | System. System monitoring runs while the card is open (Island starts it). */
export const ModulesCard = memo(ModulesCardImpl); // Island re-renders every frame during the spring; the card only re-renders when its props change
function ModulesCardImpl({ media, pos, sys, cpu, surf, shelf, main, meeting, onPage, onClose, onApproval, start, timer = null, generic = false, battery = null, sessN = 0, sessList = NO_SESS, lastCc = null, limited = false }: { /** Locked, presenting or screen shared (Island `priv`). */ generic?: boolean; battery?: Status["battery"]; sessN?: number; sessList?: CcSession[]; lastCc?: CcSessions["last"]; limited?: boolean; start?: string; timer?: TimerState | null; meeting: ProtrusionItem | null; onPage: (page: string, title: string) => void; onClose: () => void; media: Media | null; pos: number; sys: SysmonTick | null; cpu: number[]; surf: SurfacesView; shelf: ShelfItem[]; main: PluginInfo | null; onApproval: (id: string) => void }) {
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
  const tipProps = (text: string) => ({ "aria-label": text, onMouseEnter: tipOn(text), onFocus: (e: React.FocusEvent<HTMLElement>) => { if (document.documentElement.hasAttribute("data-kb") && !segRef.current?.matches(":hover")) tipOn(text)(e); }, onMouseLeave: hideTip, onBlur: hideTip });
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
  const rest = surf.approvals.slice(1); // the first approval is in the Now box (GeneralTiles): not again in its plugin's box
  const hasSummary = surf.summary.length > 0 || rest.length > 0;
  const boxes = (hasSummary ? 1 : 0) + generalTabs.length;
  const body = (p: string) => {
    const t = tabs.find((x) => x.plugin.id + "/" + x.id === p);
    return t ? <TabBlocks tab={t} />
      : p === "shelf" ? <><ShelfCard items={shelf} main={main} generic={generic} />{!generic && <ShelfSuggestRow items={shelf} main={main} />}</>
      : p === "music" ? <MusicTab media={media} pos={pos} />
      : p === "calendar" ? (meeting ? <MeetingCard item={meeting} /> : <div className="box glass"><h4><Calendar />Calendar</h4><div className="t13 l2 b4">No upcoming meetings. Meetings come from a calendar plugin.</div></div>)
      : p === "timer" ? <TimerStart timer={timer} />
      : p === "system" ? <SystemBox sys={sys} cpu={cpu} battery={battery} />
      : p === "notifications" ? <AlertsTab />
      : p === "claude" ? <ClaudeChatTab />
      : <>
        <GeneralTiles ids={core.map(([id]) => id)} go={(id) => { hideTip(); setTab(id); }} media={media} meeting={meeting} timer={timer} sys={sys} approvals={surf.approvals} onApproval={onApproval} generic={generic} battery={battery} cc={{ n: sessN, list: sessList, last: lastCc, limited }} />
        {boxes > 0 && <div className="grid module general3" style={{ gridTemplateColumns: boxes >= 3 ? "1.3fr 1fr .9fr" : `repeat(${boxes}, 1fr)` }}>
          <SummaryBoxes surf={{ ...surf, approvals: rest }} onDetail={onApproval} />
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
        <button className="mini" title="Modules settings" aria-label="Modules settings" onClick={() => sendX({ t: "open-panel", panel: "modules" })}><Gear /></button>
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
