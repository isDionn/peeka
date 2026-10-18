import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, Clipboard, LayoutGrid, Lock, Search, Settings as SettingsIcon, ShieldCheck, Volume2, VolumeX, X } from "lucide-react";
import { bridge, UNSUPPORTED_EVENT, type Alert, type ApprovalItem, type AssistantCounts, type BluetoothEvent, type ClipPlain, type CpuHigh, type DownloadDone, type Media, type MusicStopped, type ProtrusionItem, type Status, type TimerState, type VolumeOsd } from "../bridge";
import { timerLeft, useAlerts, useBluetooth, useComposer, useConsent, useHitRects, useInput, useLock, useMainAssistant, useMedia, useMirror, useNow, usePlugins, useMeetingReminder, useSecond, useSettings, useShelf, useShelfDrag, useStatus, useSurfaces, useSysmon, useTimer } from "../hooks";
import { pickProtrusion } from "../lib/alerts";
import { addHitProvider } from "../lib/hitRects";
import { cap99, flat, pluginName } from "../lib/plugin";
import { Kbd } from "./common";
import { Mascot, createIdlePrank, type Mood, type MascotHandle } from "../mascot";
import { firstRunDone, markFirstRun } from "../lib/firstRun";
import { focusViaKeys, onX, sendX, tabLeaves } from "../lib/xwin";
import { ambientMood } from "../mascot/ambient";
import { createCcMood } from "../mascot/ccMood";
import { BtBump, BtCenter, ChargeBump, ChargeCenter, LowBatteryBump, LowBatteryCenter, ShelfBump, ShelfCard, ShelfCenter, TimerBump, TimerCenter, TimerDoneBump, TimerDoneCenter, NetBump, NetCenter, AwayBump, AwayCenter } from "./Extras";
import { announceCenterClock } from "../lib/centerClock";
import { clockParts } from "../lib/clock";
import { coverColors } from "../lib/coverColor";
import { fly } from "../lib/flight";
import { trackKey, trackTitle } from "../lib/media";
import { focusables, useFocusTrap } from "../lib/useFocusTrap";
import { SPRINGS } from "../motion/spring";
import { AWAY_IDLE_MS, awayLabel, createAway, SUMMARY_MS, type AwayCounts } from "../lib/away";
import { useNetNotice, type NetNote } from "../lib/netNotice";
import { pickPrimary, timerKind, type ActivityKind } from "../lib/priority";
import { bubbleItem, LOCK_ALERT, LOCK_MUSIC, SideBubble } from "./SideBubble";
import { createBatteryTiers, createBurst, createCcSessions, type Burst, type CcSession } from "../lib/notes";
import { BurstBump, BurstCenter, CpuBump, CpuCenter, DownloadBump, DownloadCenter, MusicStoppedBump, MusicStoppedCenter, QuotaBump, QuotaCenter, resumeMusic, SessionChip } from "./Notes";

/** Keep the card shadow (notch-extra.css: 0 28px 72px) from being clipped by the window region: this much room at the sides and bottom (CSS px). */
const SHADOW_SIDE = 72, SHADOW_BOTTOM = 110;
import { useSpring } from "../motion/useSpring";
import { ApprovalBump, ApprovalCard, ApprovalCenter, ApprovalShort, ComposerCard, Lead, ProtrusionBump, ProtrusionCenter, type Suggestion } from "./Plugin";
import { LockCard, LockCenter, ClipboardCenter, ClipboardView, ShotBump, ShotCenter, STRIP_TXT, stripKind } from "./Pano";
import { Bars, FirstRunCard, ModulesCard, modulesKw, MusicBump, MusicCard, OsdBump } from "./IslandCards";
import { IslandLine, AlertBumpFid, AlertCenter, AssistantOfflineCard, DndRest, LoadingBody, HiddenCenter, JobDoneCenter, MeetingCard, MeetingCenter, OfflineRest, ShelfOpenCenter, ShelfSuggestRow } from "./Fidelity";
import { announceLine, announceNotif, announceWave } from "../lib/lineChan";
import { AMBER, CYAN, lineOf } from "../lib/line";
import { installKbModality } from "../lib/kbModality";
import { useFirstConnect, useIslandHidden } from "../hooks.fidelity";
import { EmptyBoard, ErrorCard, ErrorCenter, FirstConnectCard, FirstConnectCenter, LoadingCenter } from "./CardsExtra";

/** Cards the user opens. Peeks that appear on their own (volume, alert, new track) stay below these. */
export type IslandView = "music-card" | "modules" | "noassistant" | "welcome" | "approval-card" | "composer" | "clipboard" | "shelf" | "meeting" | "firstconnect" | "error";
export interface IslandInit {
  view?: IslandView | null;
  /** Preview: self-closing peeks (volume, new track) stay open so screenshots are stable. */
  pin?: boolean;
  /** Preview: open the new-track peek on load. */
  autoMusic?: boolean;
  /** Preview: volume indicator on load. */
  osd?: VolumeOsd;
  /** Preview: as if the pointer were over it. */
  hover?: boolean;
  /** Preview: send this question to Ctrl+Space on load. */
  ask?: string;
  /** Preview: screenshot peek on load (mockup h1); doesn't close by itself. */
  shot?: boolean;
  /** Preview: charging / Bluetooth peek on load (doesn't close by itself) and the shelf peek while a file is dragged. */
  charge?: boolean;
  bt?: { name: string; battery: number | null };
  shelfDrag?: boolean;
  /** Preview: like the strip's center label ("Search", "Peeka settings"). */
  panel?: "search" | "settings";
  /** Preview (mockup ky, kh, kb): the Clipboard card's loading / error / empty state. */
  card?: "ky" | "kh" | "kb";
  /** Preview (mockup mz): play a mascot prank on load. */
  prank?: boolean;
  /** Preview (mockup cev, bit): assistant offline / task done strip. */
  offline?: boolean;
  done?: { title: string; took: string };
  /** Preview: timer done card ("Time's up"). */
  timerDone?: string;
  /** Preview: connection lost / back peek. */
  net?: NetNote;
  /** Preview: "While you were away" summary. */
  away?: AwayCounts;
  /** Preview: notification burst peek; error text for the "Why?" card. */
  burst?: Burst;
  err?: string;
  /** Preview: "Music paused" peek. */
  stopped?: MusicStopped;
  /** Preview: "Downloaded" peek. */
  dl?: DownloadDone;
  /** Preview: CPU busy peek. */
  cpu?: CpuHigh;
}

/** When it starts with Windows, Rust opens the page with `?autostart=1`: no welcome card (it shows on a manual start). */
const autoStarted = () => new URLSearchParams(location.search).get("autostart") === "1";

type Kind = "rest" | "hov" | "music" | "alert" | "osd" | "approval" | "plugin" | "shot" | "lock" | "charge" | "lowbat" | "burst" | "quota" | "musicstop" | "download" | "cpu" | "bt" | "timer" | "timerdone" | "net" | "away" | "shelfdrag" | "panel" | "jobdone" | "ky" | "kh" | "kb" | IslandView;
interface Spec { key: string; mode: "peek" | "bump" | "card"; kw?: number; label: string; node: ReactNode }

const HOVER_SPRING = { response: 0.3, damping: 1 };
const OSD_MS = 1800;
// clicking the mascot: the slap shows first, the ask box/Modules opens ~180 ms later (squash peak + spring back)
const SLAP_OPEN_MS = 180;
const DONE_MS = 3200; // task done strip (mockup bit)
const SHOT_MS = 4200; // screenshot peek (mockup h1: about 4 s)
const MUSIC_MS = 6000;

/** Keeps the last content so it can fade out over 140 ms when the shape switches key (content enter 380, exit 130 ms, §0i item 8). */
function useOld(key: string, node: ReactNode, width?: number) {
  const last = useRef({ key, node, width });
  const [old, setOld] = useState<{ node: ReactNode; width?: number } | null>(null);
  if (last.current.key !== key) { setOld({ node: last.current.node, width: last.current.width }); last.current = { key, node, width }; } else last.current = { key, node, width };
  useEffect(() => { if (old === null) return; const t = setTimeout(() => setOld(null), 140); return () => clearTimeout(t); }, [old]);
  return old;
}

/** Card layer: focus moves in on open, Tab cycles inside, Esc calls `onClose`, focus returns to the opener on unmount. Peeks don't take focus (they appear on their own). */
const NO_MODULES_BTN = new Set(["modules", "lock", "welcome", "firstconnect", "ky"]);
function Layer({ spec, onClose, onModules, measure }: { spec: Spec; onClose: () => void; onModules: () => void; measure: (el: HTMLDivElement | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onClose, spec.mode === "card", () => document.querySelector<HTMLElement>(".islandCenter"));
  const set = useCallback((el: HTMLDivElement | null) => { ref.current = el; measure(el); }, [measure]);
  const isCard = spec.mode === "card";
  const mods = spec.key === "modules";
  // A visible exit on every card: × (works with the mouse, even in an unfocused window); cards without a tab bar also get "Modules". Last in the DOM (so focus stays on the first control), visually on top.
  const close = <button className="close" title="Close (Esc)" aria-label="Close" onClick={onClose}><X /></button>;
  return (
    <div ref={set} className={"islandInner m" + spec.mode + (isCard && !mods ? " conBar" : "")} role={isCard ? "dialog" : "group"} aria-label={spec.label} style={{ width: isCard ? spec.kw : "max-content" }}>
      {spec.node}
      {isCard && !mods && (<div className="cardBar">{!NO_MODULES_BTN.has(spec.key) && <button className="close modGo" onClick={onModules}><LayoutGrid />Modules</button>}{close}</div>)}
    </div>
  );
}

function useSize(): [HTMLElement | null, (el: HTMLElement | null) => void, { w: number; h: number }] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!el) { setSize((s) => (s.w || s.h ? { w: 0, h: 0 } : s)); return; }
    const read = () => setSize((s) => (s.w === el.offsetWidth && s.h === el.offsetHeight ? s : { w: el.offsetWidth, h: el.offsetHeight }));
    const ro = new ResizeObserver(read);
    ro.observe(el);
    read();
    return () => ro.disconnect();
  }, [el]);
  return [el, setEl, size];
}

interface CenterOpts {
  time: string; media: Media | null; alert: Alert | null; osd: VolumeOsd | null; approval: ApprovalItem | null; plug: ProtrusionItem | null; composerLabel: string | null;
  net: NetNote | null; shot: ClipPlain | null; timerDone: string | null; main: ReturnType<typeof useMainAssistant>; locked: boolean; alertsN: number; done: { title: string; took: string } | null; meeting: ProtrusionItem | null; burst: Burst | null; stopped: MusicStopped | null; dl: DownloadDone | null; cpu: CpuHigh | null;
  /** Resting center (mascot, "Compass ready", counts or the clock); Island picks which piece shows for which card. */
  rest: ReactNode; battery: Status["battery"]; bt: BluetoothEvent | null; timer: TimerState | null; shelfCount: number; panel: "search" | "settings" | "status" | "start" | "cleanup" | null;
}
/* While locked, the strip and bubble show generic labels instead of content: LOCK_MUSIC, LOCK_ALERT (SideBubble.tsx). */
const centerOf = (kind: Kind, o: CenterOpts): ReactNode => {
  const { media, alert, osd, approval, plug, composerLabel, main, rest } = o;
  switch (kind) {
    case "clipboard": return <ClipboardCenter />;
    case "lock": return <LockCenter />;
    case "shot": return <ShotCenter main={main} item={o.shot ?? undefined} />;
    case "approval": return approval && <ApprovalCenter a={approval} />;
    case "approval-card": return <ApprovalShort />;
    case "plugin": return plug && <ProtrusionCenter item={plug} />;
    case "charge": return o.battery && <ChargeCenter b={o.battery} />;
    case "lowbat": return o.battery && <LowBatteryCenter b={o.battery} />;
    case "burst": return o.burst && <BurstCenter b={o.burst} generic={o.locked} />;
    case "quota": return <QuotaCenter />;
    case "cpu": return o.cpu && <CpuCenter app={o.cpu.app} generic={o.locked} />;
    case "download": return o.dl && <DownloadCenter name={o.dl.name} generic={o.locked} />;
    case "musicstop": return o.stopped && <MusicStoppedCenter name={o.stopped.name} generic={o.locked} />;
    case "error": return <ErrorCenter />;
    case "bt": return o.bt && <BtCenter name={o.bt.name} />;
    case "timer": return o.timer && <TimerCenter t={o.timer} />;
    case "away": return <AwayCenter />;
    case "net": return <NetCenter lost={o.net !== "back"} />;
    case "timerdone": return <TimerDoneCenter label={o.locked ? null : o.timerDone} />;
    case "shelfdrag": return <ShelfCenter main={main} count={o.shelfCount} />;
    case "shelf": return <ShelfOpenCenter />;
    case "jobdone": return o.done && <JobDoneCenter title={o.done.title} took={o.done.took} />;
    case "meeting": return <MeetingCenter main={main} />;
    case "firstconnect": return <FirstConnectCenter />;
    case "ky": return <LoadingCenter title="Clipboard" />;
    case "kb": return <LoadingCenter title="Clipboard" icon={<Clipboard />} />;
    case "kh": return <ErrorCenter />;
    case "panel": return o.panel === "cleanup" ? <ApprovalShort /> : o.panel === "search"
      ? <span className="ms"><Search /><span className="b6">Search</span><Kbd keys="Ctrl+K" /></span>
      : <span className="ms"><SettingsIcon /><span className="b6">Peeka settings</span></span>;
    case "composer": return <><span className="ms">{composerLabel ? <span className="l2">{composerLabel}</span> : <Kbd keys="Ctrl+Space" />}</span>{composerLabel && o.alertsN > 0 && <span className="t12 l3 num">{cap99(o.alertsN)} {o.alertsN === 1 ? "notification" : "notifications"}</span>}</>;
    case "music": return media && (
      <span className="ms">
        {main && <Lead plugin={{ id: main.id, name: main.name, main: true }} mascot="music" />}
        {o.locked ? <span className="b6">{LOCK_MUSIC}</span> : <>{media.art ? <img className="cover" data-share="cover" src={media.art} alt="" style={{ width: 18, height: 18, borderRadius: 5 }} /> : null}
        <span className="b6" data-share="title" title={trackTitle(media)}>{trackTitle(media)}</span><span className="l3" title={media.artist}>{media.artist}</span></>}<Bars />
      </span>
    );
    case "music-card": return <span className="ms">{main && <Lead plugin={{ id: main.id, name: main.name, main: true }} mascot="music" />}<Bars /><span className="l2">{media?.playing ? "Playing" : "Paused"}</span></span>;
    case "alert": return alert && <AlertCenter alert={alert} main={main} />;
    case "osd": return <span className="ms">{osd?.muted ? <VolumeX /> : <Volume2 />}{osd?.muted ? <span className="b6">Muted</span> : <><span className="b6">Volume</span>{osd?.device && <span className="l3">{osd.device}</span>}</>}</span>;
    case "welcome": return <span className="ms"><span className="b6">Peeka</span></span>;
    default: return rest;
  }
};

/**
 * Island window (760x620, transparent, fixed size; the window never resizes): the strip's center content, the peek below it, and cards.
 * The shape springs in CSS; clickable areas are reported to Rust with `data-hit`. With no assistant connected (always so until Wave 3, decision 10):
 * clock and any playing music in the center, no assistant line.
 */
export function Island({ monitor, init }: { monitor: string; init?: IslandInit }) {
  const now = useNow();
  const { media, ready, position } = useMedia();
  const { alerts, top } = useAlerts();
  const [user, setUser] = useState<IslandView | null>(init?.view !== undefined ? init.view : firstRunDone() || autoStarted() ? null : "welcome");
  const [modStart, setModStart] = useState<string | undefined>(); // music peek/center: Modules opens on the Music tab
  const [modPage, setModPage] = useState("general"); // the Modules card's active tab: the card width follows it
  const [modName, setModName] = useState("General"); // active tab name: the card's accessible name (F-03)
  const onModPage = useCallback((p: string, n: string) => { setModPage(p); setModName(n); }, []);
  const lock = useLock();
  const main = useMainAssistant();
  const plugins = usePlugins();
  const [status] = useStatus();
  const settings = useSettings();
  const timer = useTimer();
  const shelf = useShelf();
  const input = useInput();
  const [shot, setShot] = useState<ClipPlain | null>(null);
  const [hover, setHover] = useState(!!init?.hover);
  const [pinned, setPinned] = useState<ActivityKind | null>(null); // the activity the user brought forward from the bubble
  const [more, setMore] = useState(false); // the bubble's "+N" list
  const [bubbleHover, setBubbleHover] = useState(false);
  const [mkHover, setMkHover] = useState(false); // pointer on the strip mascot: the thin "hov" peek mustn't cover the body; show the counts bubble instead
  const [kbIn, setKbIn] = useState(false); // auto-close pauses while keyboard focus is inside the peek (WCAG 2.2.1)
  const hold = hover || kbIn;
  const [netNote, dismissNet] = useNetNotice(status?.network, !!init?.pin || hold, init?.net ?? null);
  const [summary, setSummary] = useState<AwayCounts | null>(init?.away ?? null); // "While you were away" summary (row 38)
  const away = useRef(createAway()).current;
  const [osd, setOsd] = useState<VolumeOsd | null>(init?.osd ?? null);
  const [musicAuto, setMusicAuto] = useState(!!init?.autoMusic);
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const [tint, setTint] = useState<[string, string] | null>(null);
  const surf0 = useSurfaces();
  // meeting reminder from the assistant's calendar (row 22): stands in when there's no plugin peek; generic text when locked or presenting
  const reminder = useMeetingReminder(lock.locked || input.presentation);
  const surf = useMemo(() => (reminder && !surf0.protrusion ? { ...surf0, protrusion: reminder } : surf0), [surf0, reminder]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const composer = useComposer();
  // while the chat is open the strip says what's really happening (Peeka's text, name from Peeka's records): "replying" while answering, else "ready"
  const last = composer.turns.at(-1);
  const composerLabel = last && surf.composer ? `${pluginName(surf.composer)} ${last.state === "wait" ? "is replying" : "ready"}` : null;
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const seeded = useRef(false);
  useEffect(() => { if (init?.ask && !seeded.current) { seeded.current = true; composer.send(init.ask, []); } }, [init?.ask, composer]);
  const pin = !!init?.pin;
  const [bt, dismissBt] = useBluetooth(pin || hold, 3000, init?.bt ?? null); // auto-close pauses while the pointer is over it (O2)
  const shelfDrag = useShelfDrag() || !!init?.shelfDrag;
  const [fullscreen, setFullscreen] = useState(false);
  const hidden = useIslandHidden(); // Ctrl+Shift+A / right-click: the island hides for 1 hour or until pressed again (Rust manages it); approvals and security still open peeks
  const [offline, setOffline] = useState(!!init?.offline);
  const [done, setDone] = useState<{ title: string; took: string } | null>(init?.done ?? null);
  const doneAt = useRef<number[]>([]);
  const [panelLabel, setPanelLabel] = useState<"search" | "settings" | "status" | "start" | "cleanup" | null>(init?.panel ?? null);
  // the assistant connected for the first time (ilk2, once ever)
  const [fc, ackFc] = useFirstConnect();
  useEffect(() => { if (fc) setUser((u) => (u === null ? "firstconnect" : u)); }, [fc]);
  const consent = useConsent();
  // Clipboard card loading state (ky: never shows if under 800 ms, kh: error, kb: empty); the preview pins it with `init.card`
  const forced = !!init?.card;
  const [probe, setProbe] = useState<"ok" | "loading" | "error" | "empty">(init?.card === "ky" ? "loading" : init?.card === "kh" ? "error" : init?.card === "kb" ? "empty" : "ok");
  const [probeErr, setProbeErr] = useState(init?.card === "kh" ? { title: "Can't reach Claude Code", detail: "The hook bridge isn't responding (timed out)." } : { title: "Couldn't open Clipboard", detail: "" });
  const [tryN, setTryN] = useState(0);
  useEffect(() => {
    if (forced || user !== "clipboard") return;
    let live = true;
    setProbe((p) => (p === "error" ? "ok" : p));
    const slow = setTimeout(() => { if (live) setProbe((p) => (p === "ok" ? "loading" : p)); }, 800); // skeleton only if loading really takes a while
    bridge.call("clip_list").then(() => { clearTimeout(slow); if (live) setProbe("ok"); }).catch((e) => { clearTimeout(slow); if (live) { setProbeErr({ title: "Couldn't open Clipboard", detail: String(e) }); setProbe("error"); } });
    return () => { live = false; clearTimeout(slow); };
  }, [user, forced, tryN]);
  // charging: 3 s when plugged in; low battery: below the threshold while unplugged, quiet once seen (Esc / Later) until it charges
  const batt = status?.battery ?? null;
  const [charge, setCharge] = useState(!!init?.charge);
  const prevCharging = useRef<boolean | undefined>(undefined);
  useEffect(() => { if (!batt) return; if (prevCharging.current === false && batt.charging) setCharge(true); prevCharging.current = batt.charging; }, [batt]);
  useEffect(() => { if (!charge || pin || hold) return; const t = setTimeout(() => setCharge(false), 3000); return () => clearTimeout(t); }, [charge, pin, hold]);
  // low battery (row 26): the 20% and 10% tiers once each, reset when plugged in; clears after 15 s (unless the pointer is over it)
  const tiers = useRef(createBatteryTiers()).current;
  const [battTier, setBattTier] = useState<10 | 20 | null>(null);
  useEffect(() => { if (!batt) return; const powered = batt.charging || batt.plugged, t = tiers.feed(batt.percent, powered); if (powered) setBattTier(null); else if (t) setBattTier(t); }, [batt, tiers]);
  useEffect(() => { if (!battTier || pin || hold) return; const t = setTimeout(() => setBattTier(null), 15_000); return () => clearTimeout(t); }, [battTier, pin, hold]);
  // notification burst (33): 6 new notifications in 5 s become one peek. Usage limit reached (15): Claude Code `stop_failure`+`rate_limit`, 30 s.
  const mir = useMirror();
  const burstFeed = useRef(createBurst()).current;
  const [burst, setBurst] = useState<Burst | null>(init?.burst ?? null);
  useEffect(() => { if (!mir.ready) return; const b = burstFeed.feed(mir.items, Date.now()); if (b && !mir.quiet) setBurst(b); }, [mir, burstFeed]);
  useEffect(() => { if (!burst || pin || hold) return; const t = setTimeout(() => setBurst(null), 8000); return () => clearTimeout(t); }, [burst, pin, hold]);
  const [quota, setQuota] = useState(false);
  // headphones disconnected, music paused (Rust `music_stopped`): "Resume" for a few seconds
  // download finished (Rust `download_done`): "Downloaded: name", Open / Show in folder; 8 s
  // CPU above 95% for a long time (Rust `cpu_high`; Rust decides, no timer on the page): 10 s
  const [cpuHigh, setCpuHigh] = useState<CpuHigh | null>(init?.cpu ?? null);
  useEffect(() => { if (!cpuHigh || pin || hold) return; const t = setTimeout(() => setCpuHigh(null), 10_000); return () => clearTimeout(t); }, [cpuHigh, pin, hold]);
  const [dl, setDl] = useState<DownloadDone | null>(init?.dl ?? null);
  useEffect(() => { if (!dl || pin || hold) return; const t = setTimeout(() => setDl(null), 8000); return () => clearTimeout(t); }, [dl, pin, hold]);
  const [stopped, setStopped] = useState<MusicStopped | null>(init?.stopped ?? null);
  useEffect(() => { if (!stopped || pin || hold) return; const t = setTimeout(() => setStopped(null), 8000); return () => clearTimeout(t); }, [stopped, pin, hold]);
  useEffect(() => { if (!quota || pin || hold) return; const t = setTimeout(() => setQuota(false), 30_000); return () => clearTimeout(t); }, [quota, pin, hold]);
  // Claude Code session count (13) and last error (43): from Peeka's own hook (cc_event)
  const sessCount = useRef(createCcSessions()).current;
  const [nSess, setNSess] = useState(0);
  const [sessList, setSessList] = useState<CcSession[]>([]);
  const [lastCc, setLastCc] = useState<{ tool: string | null; at: number } | null>(null);
  const [ccErr, setCcErr] = useState<{ tool: string | null; reason: string | null } | null>(init?.err ? { tool: init.err, reason: null } : null);
  const [, setTickSecond] = useState(0);
  // a silent Claude Code session drops out even without events (once a minute)
  useEffect(() => { if (nSess === 0) return; const t = setInterval(() => { setNSess(sessCount.count(Date.now())); setSessList(sessCount.list(Date.now())); }, 60_000); return () => clearInterval(t); }, [nSess > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  useHitRects("island", monitor);

  // Rust's attention budget decides `top` (do not disturb, full screen, meeting); the page only filters out ones already seen.
  const alertRaw = pickProtrusion(alerts.filter((a) => a.id === top), seen);
  // Presentation mode (row 37): no automatic peeks, content always uses generic labels (same path as lock: `priv`). The count stays on the strip as "N notifications".
  const priv = lock.locked || input.presentation;
  const alert = alertRaw && input.presentation ? null : alertRaw && lock.locked ? { ...alertRaw, title: LOCK_ALERT, subtitle: null } : alertRaw; // while locked, a generic label instead of the alert text; the buttons (Open/Later) still work
  // Plugins: approval (highest priority) > volume > alert > plugin peek > music. Rust's attention budget decided which one shows (`approvalTop`, `protrusion`).
  const approvalTop = surf.approvals.find((a) => a.id === surf.approvalTop) ?? null;
  const approvalCard = surf.approvals.find((a) => a.id === detailId) ?? approvalTop ?? surf.approvals[0] ?? null;
  // while Peeka is locked, the Clipboard and Modules cards don't open; the lock card stands in (ADR-0063 §6); no screenshot peek either
  const view: IslandView | "lock" | null = lock.locked && (user === "clipboard" || user === "modules" || user === "music-card") ? "lock" : user === "meeting" && !surf.protrusion ? null : user;
  // presentation mode / busy (Windows, `input_tick`): automatic peeks (screenshot, Bluetooth, charging, music) stay quiet; Rust's attention budget already filters approvals, volume and alerts
  const calm = input.presentation || input.busy;
  const shotNow = shot && !lock.locked && !calm ? shot : null;
  const viewK: Kind | null = view === "clipboard" ? (probe === "error" ? "kh" : probe === "empty" ? "kb" : probe === "loading" ? "ky" : "clipboard") : view;
  // Live activity order lives in one place (lib/priority.ts): the top one on the main strip, the next in the side bubble. Brief transient peeks (volume, screenshot, battery, Bluetooth, shelf) borrow the center and leave the bubble alone.
  const tickS = useSecond(!!timer?.running); // the timer's last 60 s changes the order
  const leftS = timer ? timerLeft(timer, tickS) : null;
  // Time's up (no sound): the card appears when the countdown hits 0 or Rust removes the timer near zero; it stays until Close / +5 min / Esc.
  const [timerDone, setTimerDone] = useState<{ label: string } | null>(init?.timerDone !== undefined ? { label: init.timerDone } : null);
  const lastTimer = useRef<{ label: string; left: number } | null>(null);
  const ackedAt = useRef(-1); // `at` of the dismissed finished timer: the same state doesn't reopen the card
  if (timer && leftS !== null) lastTimer.current = { label: timer.label, left: leftS };
  useEffect(() => {
    if (timer) { if (leftS !== null && leftS <= 0 && timer.at !== ackedAt.current) setTimerDone({ label: timer.label }); else if (leftS !== null && leftS > 0) setTimerDone(null); return; }
    const l = lastTimer.current; lastTimer.current = null;
    if (l && l.left <= 2) setTimerDone({ label: l.label }); // the timer vanished within 2 s of the end: it finished (a manual Stop happens with more time left)
  }, [timer, leftS === null ? null : leftS <= 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const closeTimerDone = useCallback(() => { ackedAt.current = timer?.at ?? -1; setTimerDone(null); }, [timer]);
  const prot = surf.protrusion;
  const acts: { kind: ActivityKind }[] = [];
  if (approvalTop) acts.push({ kind: "approval" });
  if (prot && (!input.presentation || prot === reminder)) acts.push({ kind: prot.icon === "calendar" ? "meeting" : prot.plugin.main ? "live" : "other" });
  if (alert) acts.push({ kind: "alert" });
  if (timerDone) acts.push({ kind: "timerEnd" });
  else if (timer && leftS !== null) acts.push({ kind: timerKind(timer.running, leftS) });
  if (netNote && !calm) acts.push({ kind: "net" });
  if (battTier) acts.push({ kind: battTier === 10 ? "batteryCrit" : "battery" });
  if (burst && !calm) acts.push({ kind: "burst" });
  if (quota) acts.push({ kind: "rateLimit" });
  if (stopped && !calm) acts.push({ kind: "musicStopped" });
  if (dl) acts.push({ kind: "download" });
  if (cpuHigh && !calm) acts.push({ kind: "cpu" });
  if (summary && !calm) acts.push({ kind: "summary" });
  if (shotNow) acts.push({ kind: "clip" });
  if (done && !calm) acts.push({ kind: "done" });
  if (media && (media.playing || musicAuto)) acts.push({ kind: "music" });
  // nothing swaps places on its own while the pointer is over the island or bubble (doc row 9): the last main activity is held; approvals still jump ahead
  const frozen = hold || bubbleHover;
  const autoTop = useRef<ActivityKind | null>(null);
  const plan = pickPrimary(acts, pinned ?? (frozen ? autoTop.current : null));
  if (!frozen) autoTop.current = plan.primary?.kind ?? null;
  const pk = plan.primary?.kind;
  const planK: Kind | null = pk === "approval" ? "approval" : pk === "alert" ? "alert" : pk === "timerEnd" && timerDone ? "timerdone" : pk === "timer" || pk === "timerEnd" ? "timer" : pk === "net" ? "net" : pk === "battery" || pk === "batteryCrit" ? "lowbat" : pk === "burst" ? "burst" : pk === "rateLimit" ? "quota" : pk === "musicStopped" ? "musicstop" : pk === "download" ? "download" : pk === "cpu" ? "cpu" : pk === "summary" ? "away" : pk === "done" ? "jobdone"
    : pk === "music" ? (pinned === "music" || (musicAuto && !calm) ? "music" : null) : pk === "live" || pk === "meeting" || pk === "other" ? "plugin" : null;
  const transient: Kind | null = osd ? "osd" : pk === "clip" ? "shot" : shelfDrag ? "shelfdrag" : bt && !calm ? "bt" : charge && !calm ? "charge" : null;
  const base: Kind = viewK ?? (pk === "approval" ? "approval" : transient ?? planK ?? (hover && !mkHover ? "hov" : "rest"));
  const pinnedLive = pinned !== null && acts.some((a) => a.kind === pinned);
  useEffect(() => { if (pinned !== null && !pinnedLive) setPinned(null); }, [pinned, pinnedLive]); // the brought-forward activity ended: the order returns on its own
  // while Search / Settings is open on the strip page, a short label in the center (say it once); if something else is in the peek, it stays
  const kind: Kind = (panelLabel === "search" || panelLabel === "settings" || panelLabel === "cleanup") && (base === "rest" || base === "hov") ? "panel" : base;
  const plainPanel = panelLabel === "status" || panelLabel === "start"; // no mascot in the center while Status / Start is open (one mascot, in the card or panel)
  const meetingItem = surf.protrusion?.icon === "calendar" ? surf.protrusion : null;
  const sys = useSysmon(kind === "modules");
  useEffect(() => { if (kind !== "modules") { setModPage("general"); setModName("General"); setModStart(undefined); } }, [kind]);
  const owner = useRef(surf.composer);
  owner.current = surf.composer;

  /* ---- events ---- */
  const userRef = useRef(user);
  userRef.current = user;
  /** Ctrl+Space: any open strip panel (Ctrl+K...) closes, the ask box opens on top and takes focus (friction 2 / R2-Y3). */
  const openAsk = (to: IslandView) => {
    sendX({ t: "island-click" });
    setUser(to);
    setTimeout(() => stage.current?.querySelector<HTMLElement>("[data-composer] input, [data-autofocus]")?.focus(), 90);
  };
  const [meetingOn, setMeetingOn] = useState(false);
  const [ccMood, setCcMood] = useState<Mood | null>(null);
  const ccFeed = useRef<ReturnType<typeof createCcMood> | null>(null);
  useEffect(() => { const f = createCcMood(setCcMood); ccFeed.current = f; return () => { f.dispose(); ccFeed.current = null; }; }, []);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hoverIntent = (on: boolean) => { if (hidden) on = false; clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => setHover(on), on ? 120 : 200); };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  useEffect(() => {
    const offs = [
      bridge.on("volume_osd", setOsd),
      bridge.on("notch://fullscreen", setFullscreen),
      bridge.on("music_stopped", setStopped),
      bridge.on("download_done", setDl),
      bridge.on("cpu_high", setCpuHigh),
      bridge.on("assistant_offline", setOffline),
      bridge.on("meeting_changed", setMeetingOn),
      bridge.on("cc_event", (e) => {
        ccFeed.current?.feed(e);
        setNSess(sessCount.feed(e, Date.now())); setSessList(sessCount.list(Date.now())); setLastCc({ tool: e.tool ?? null, at: Date.now() });
        if (e.kind === "stop_failure" && e.reason === "rate_limit") setQuota(true);
        if (e.kind === "tool_failed" || e.kind === "stop_failure") setCcErr({ tool: e.tool ?? null, reason: e.reason ?? null });
      }),
      // task done: up to 3 an hour (mascot celebration, §0i item 19)
      bridge.on("job_done", (e) => { away.done(); const t = Date.now(); doneAt.current = doneAt.current.filter((x) => t - x < 3_600_000); if (doneAt.current.length >= 3) return; doneAt.current.push(t); setDone(e); }),
      bridge.on("clip_changed", (c) => { if (c.reason === "added" && c.item && c.item.kind !== "password" && stripKind(c.item)) setShot(c.item); }), // every image, file and link; plain text and passwords don't open it
      bridge.on("shortcut", (e) => {
        if (e.name === "ask") { const to = owner.current ? "composer" : "noassistant"; if (userRef.current === to) setUser(null); else openAsk(to); }
        else if (e.name === "focus_island") { const t = stage.current?.querySelector<HTMLElement>(".dangling"); (t && focusables(t)[0]) ? focusables(t)[0].focus() : center.current?.focus(); }
      }),
    ];
    return () => { offs.forEach((o) => o.then((f) => f())); };
  }, []);
  useEffect(() => { if (!done || pin || hold) return; const t = setTimeout(() => setDone(null), DONE_MS); return () => clearTimeout(t); }, [done, pin, hold]);
  useEffect(() => { if (!shot || pin || hold) return; const t = setTimeout(() => setShot(null), SHOT_MS); return () => clearTimeout(t); }, [shot, pin, hold]);
  useEffect(() => { if (init?.shot) bridge.call("clip_list").then((l) => setShot((l.find((c): c is ClipPlain => c.kind === "image" && c.screenshot) ?? null))).catch(() => undefined); }, [init?.shot]);
  useEffect(() => { if (!osd || pin || hold) return; const t = setTimeout(() => setOsd(null), OSD_MS); return () => clearTimeout(t); }, [osd, pin, hold]);
  // from the strip page: open panel label and "show intro again"
  // panel-open: opening a strip panel closes the open card (Y5)
  useEffect(() => onX((m) => { if (m.t === "panel") setPanelLabel(m.panel); else if (m.t === "panel-open") setUser((u) => { if (u === "welcome") markFirstRun(); return null; }); else if (m.t === "firstrun") setUser("welcome"); else if (m.t === "welcome?") sendX({ t: "welcome", open: userRef.current === "welcome" }); else if (m.t === "ask") openAsk(owner.current ? "composer" : "noassistant"); else if (m.t === "to-island") { const l = tabStops(); focusViaKeys(m.end ? l[l.length - 1] : l[0]); } }), []);
  // while the welcome card is open the strip doesn't open the setup wizard (one thing at a time): open/closed is sent to the strip on every change
  const welcomeOpen = user === "welcome";
  useEffect(() => { sendX({ t: "welcome", open: welcomeOpen }); }, [welcomeOpen]);
  // Tab order across windows: the island's visible controls; Tab from the last goes to the strip's right group, Shift+Tab from the first to the left group (an open card's focus trap keeps Tab)
  const tabStops = () => (stage.current ? focusables(stage.current).filter((el) => el.checkVisibility?.({ visibilityProperty: true }) ?? true) : []);
  const crossKey = (e: React.KeyboardEvent) => { if (tabLeaves(e, tabStops(), document.activeElement)) { e.preventDefault(); const side = e.shiftKey ? "left" : "right"; bridge.call("focus_strip", { monitor }).then(() => sendX({ t: "to-strip", side }), () => undefined); } }; // if refused (focus isn't in Peeka) it stays put

  /* ---- mascot: the 20 px one in the resting center, idle pranks (polled every second) ---- */
  const mascotRef = useRef<MascotHandle>(null);
  useEffect(() => { installKbModality(); }, []);
  useEffect(() => { if (!init?.prank) return; const t = setTimeout(() => mascotRef.current?.prank(), 800); return () => clearTimeout(t); }, [init?.prank]);
  const prankEnv = useRef({ on: false, dnd: false, presentation: false, meeting: false, music: false, cardOpen: false, fullscreen: false });
  const mainP = plugins.find((p) => p.main) ?? null;
  const assistantUp = !!main;
  // when the assistant connects, the "assistant not connected" card closes on its own (R2-O3)
  const prevUp = useRef(assistantUp);
  useEffect(() => { if (assistantUp && !prevUp.current) setUser((u) => (u === "noassistant" ? null : u)); prevUp.current = assistantUp; }, [assistantUp]);
  const asleep = !!mainP && !mainP.connected;
  const lastTurn = composer.turns.at(-1);
  const [justDone, setJustDone] = useState(false);
  useEffect(() => { if (lastTurn?.state !== "done") return; setJustDone(true); const t = setTimeout(() => setJustDone(false), 3000); return () => clearTimeout(t); }, [lastTurn?.id, lastTurn?.state]);
  // the assistant's counts: the strip mascot's state and the bubble on hover
  const [counts, setCounts] = useState<AssistantCounts | null>(null);
  const loadCounts = useCallback(() => { if (assistantUp) bridge.call("assistant_counts").then(setCounts).catch(() => undefined); }, [assistantUp]);
  useEffect(loadCounts, [loadCounts, surf.approvals.length]);
  const jobsN = counts?.jobs ?? 0, waitN = counts?.approvals ?? surf.approvals.length;
  const mood: Mood = justDone ? "done" : lastTurn?.state === "wait" ? (lastTurn.answer ? "speaking" : "thinking") : lastTurn?.state === "error" ? "error" : waitN > 0 ? "approval" : jobsN > 0 ? "thinking" : "idle";
  // the 40 px hanging mascot is always in the same spot; it's Peeka itself: calm idle when there's no assistant or it's disconnected, the real state when connected; sleep only from idle/battery (ambient states)
  const [idleMs, setIdleMs] = useState(0);
  useEffect(() => { const t = setInterval(() => setIdleMs(input.lastInputAgoMs()), 5000); return () => clearInterval(t); }, [input.lastInputAgoMs]);
  // "While you were away": do not disturb on, or no input for 10 min, counts as away. When it ends, notifications, approvals and finished tasks from that time become one summary.
  const mirrorIds = mir.items.map((n) => n.id).join("|");
  const alertIds = alerts.map((a) => a.id).join("|"), approvalIds = surf.approvals.map((a) => a.id).join("|");
  const awayOn = !!status?.dnd || idleMs >= AWAY_IDLE_MS;
  useEffect(() => {
    const ids = (s: string) => (s ? s.split("|") : []);
    const r = away.sync(awayOn, [...ids(alertIds), ...ids(mirrorIds)], ids(approvalIds));
    if (r) { setSummary({ ...r }); setDone(null); } // finished tasks are counted in the summary: the old "task done" strip makes way for it
  }, [awayOn, alertIds, mirrorIds, approvalIds, away]);
  useEffect(() => { if (!summary || calm || pin || hold) return; const t = setTimeout(() => setSummary(null), SUMMARY_MS); return () => clearTimeout(t); }, [summary, calm, pin, hold]);
  const awayText = summary ? awayLabel(summary, priv) : "";
  const openNotifs = () => { setSummary(null); announceNotif(); };
  const openBurst = () => { setBurst(null); announceNotif(); };
  // "Why?" card (43): the error text is what exists (a chat turn error, or the hook's tool and reason); details are hidden when locked or presenting (so paths and secrets don't leak)
  const errTitle = lastTurn?.state === "error" ? "Couldn't get an answer" : "Claude Code hit an error";
  const errRaw = lastTurn?.state === "error" && lastTurn.error ? lastTurn.error : ccErr ? `${ccErr.tool ?? "A tool"} failed${ccErr.reason ? ` (${ccErr.reason})` : ""}.` : "";
  const errDetail = priv ? "Details are hidden while locked." : errRaw || undefined;
  // Claude Code events (cc_event) ride on top of the calm state; the assistant's approval, work and error always come first
  // with no assistant / while it sleeps, assistant states stay calm; Claude Code events (Peeka's own hook) still drive the mascot. When connected, the assistant's own approval/work/error comes first.
  const baseMood: Mood = mainP && !asleep && mood !== "idle" ? mood : ccMood ?? "idle";
  const moodShown = ambientMood({ base: baseMood, batteryPercent: batt?.percent ?? null, powered: !!batt && (batt.charging || batt.plugged), justPlugged: charge, idleMs });
  // mascot: click = ask box; dropping a file = it swallows it and the box opens with the Shelf files attached; hover shows counts
  const [autoShelf, setAutoShelf] = useState(false);
  const feed = () => { if (!owner.current) return; setAutoShelf(true); openAsk("composer"); };
  useEffect(() => { if (user !== "composer") setAutoShelf(false); }, [user]);
  // while the Ask box is open the island takes keyboard focus; on close it hands it back to the previous app (ADR-0062 §1)
  const asking = user === "composer";
  useEffect(() => {
    if (!asking) return;
    bridge.call("typing_focus", { label: "island", on: true }).catch(() => undefined);
    return () => { bridge.call("typing_focus", { label: "island", on: false }).catch(() => undefined); };
  }, [asking]);
  useEffect(() => addHitProvider(() => mascotRef.current?.hitRect() ?? null), []);
  // in Tauri the drop goes to Rust (copied to the Shelf): if the Shelf grew and the pointer is on the mascot, the mascot swallows it
  const shelfN = useRef(shelf.length);
  useEffect(() => {
    const grew = shelf.length > shelfN.current; shelfN.current = shelf.length;
    const h = mascotRef.current?.hitRect(), c = input.cursor;
    if (grew && h && c && c.x >= h.x && c.x <= h.x + h.width && c.y >= h.y && c.y <= h.y + h.height) { mascotRef.current?.swallow(); feed(); }
  }, [shelf.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // a command that returns `unsupported` in demo mode: brief notice
  const [demoNot, setDemoNot] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const on = () => { setDemoNot(true); clearTimeout(t); t = setTimeout(() => setDemoNot(false), 2500); };
    addEventListener(UNSUPPORTED_EVENT, on);
    return () => { removeEventListener(UNSUPPORTED_EVENT, on); clearTimeout(t); };
  }, []);
  const restShown = kind === "rest" || kind === "hov";
  prankEnv.current = { on: (settings?.mascotPranks ?? true) && restShown, dnd: !!status?.dnd || input.busy, presentation: input.presentation, meeting: meetingOn || surf.protrusion?.icon === "calendar", music: !!media?.playing, cardOpen: !restShown, fullscreen };
  const lastInputAgoMs = input.lastInputAgoMs;
  useEffect(() => {
    const prank = createIdlePrank({
      now: Date.now, random: Math.random, enabled: () => prankEnv.current.on, lastInputAgoMs, fullscreen: () => prankEnv.current.fullscreen, dnd: () => prankEnv.current.dnd,
      presentation: () => prankEnv.current.presentation, meeting: () => prankEnv.current.meeting, cardOpen: () => prankEnv.current.cardOpen, musicPlaying: () => prankEnv.current.music,
    }, () => mascotRef.current?.prank());
    const t = setInterval(prank.poll, 1000);
    return () => clearInterval(t);
  }, [lastInputAgoMs]);

  // Ctrl+Space chips: suggestions only; added on click (only "This window" here; Clipboard and Shelf in later waves)
  useEffect(() => {
    if (user !== "composer") return;
    bridge.call("list_windows", { monitor }).then((ws) => { const w = ws.find((x) => x.active); setSuggestions(w ? [{ id: "window_image", label: `This window: ${w.name}` }] : []); }).catch(() => undefined);
  }, [user, monitor]);
  // the open approval card closes once the approval is answered (or expires)
  const hadApproval = useRef(false); // surfaces load async: the card only closes if the approval disappears after having been seen once
  if (approvalCard) hadApproval.current = true;
  useEffect(() => { if (user === "approval-card" && hadApproval.current && !approvalCard) setUser(null); }, [user, approvalCard]);

  // new track or playback start: the peek opens on its own. The first read is silent.
  const prevTrack = useRef<string | undefined>(undefined);
  const prevPlaying = useRef(false);
  useEffect(() => {
    if (!ready) return;
    const k = trackKey(media), first = prevTrack.current === undefined;
    if (media?.playing && !first && (k !== prevTrack.current || !prevPlaying.current)) setMusicAuto(true);
    prevTrack.current = k; prevPlaying.current = !!media?.playing;
  }, [media, ready]);
  useEffect(() => { if (!musicAuto || pin || hold) return; const t = setTimeout(() => setMusicAuto(false), MUSIC_MS); return () => clearTimeout(t); }, [musicAuto, pin, media, hold]);
  useEffect(() => { if (ready && !media) setMusicAuto(false); }, [media, ready]);
  // if playback disappears while the player card is open (the app closed), "Paused" doesn't get stuck on the strip
  useEffect(() => { if (ready && !media && user === "music-card") setUser(null); }, [media, ready, user]);

  // while the card is open, elapsed and remaining time tick every second
  useEffect(() => {
    if (!media?.playing || (kind !== "music" && kind !== "music-card" && kind !== "modules")) return;
    const t = setInterval(() => setTickSecond((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [media?.playing, kind]);

  // cover colors only on the card (ambient layer, halo)
  const cover = media?.art ?? null;
  useEffect(() => { let live = true; coverColors(cover).then((c) => { if (live) setTint(c); }); return () => { live = false; }; }, [cover]);

  /* ---- Esc: one step back per press (card → its peek → resting) ---- */
  const back = useCallback(() => {
    if (more) return setMore(false);
    if (user === "music-card") { setUser(null); if (media) setMusicAuto(true); return; }
    if (user === "welcome") markFirstRun(); // Esc / × / clicking outside counts as "Skip": the card shouldn't come back on every launch
    if (user) return setUser(null);
    if (osd) return setOsd(null);
    if (done) return setDone(null);
    if (shot) return setShot(null);
    if (timerDone && kind === "timerdone") return closeTimerDone();
    if (netNote && kind === "net") return dismissNet();
    if (summary && kind === "away") return setSummary(null);
    if (alert) return setSeen((s) => new Set(s).add(alert.id));
    if (battTier) return setBattTier(null);
    if (burst) return setBurst(null);
    if (quota) return setQuota(false);
    if (stopped) return setStopped(null);
    if (dl) return setDl(null);
    if (cpuHigh) return setCpuHigh(null);
    if (bt) return dismissBt();
    if (charge) return setCharge(false);
    if (musicAuto) return setMusicAuto(false);
    if (pinned) return setPinned(null);
  }, [user, osd, done, alert, shot, timerDone, closeTimerDone, netNote, dismissNet, summary, kind, musicAuto, media, battTier, burst, quota, stopped, dl, cpuHigh, bt, charge, dismissBt, more, pinned]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) back(); };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [back]);

  /* ---- content ---- */
  const { time, label } = clockParts(now);
  const pos = Math.floor(position()); // seconds: so the card's props don't change on spring frames
  const musicCard = useMemo(() => media && <MusicCard media={media} pos={pos} />, [media, pos]);
  const openApproval = useCallback((id: string) => { setDetailId(id); setUser("approval-card"); }, []);
  const spec: Spec | null = (() => {
    switch (kind) {
      case "hov": return { key: "hov", mode: "peek", label: "Open card", node: <button className="peek" tabIndex={-1} aria-label="Open card" onClick={() => setUser("modules")}><i /></button> };
      case "music": return media && { key: "music", mode: "bump", label: "Music", node: <MusicBump media={media} pos={pos} /> };
      case "alert": return alert && { key: "alert:" + alert.id, mode: "bump", label: alert.title, node: <AlertBumpFid alert={alert} onLater={() => setSeen((s) => new Set(s).add(alert.id))} onDetail={() => setUser("modules")} /> };
      case "osd": return osd && { key: "osd", mode: "bump", label: "Volume", node: <OsdBump osd={osd} /> };
      case "shot": return shotNow && { key: "shot:" + shotNow.id, mode: "bump", label: shotNow.screenshot ? "Screenshot" : STRIP_TXT[stripKind(shotNow) ?? "image"], node: <ShotBump item={shotNow} main={main} big={hover} /> };
      case "lowbat": return batt && { key: "lowbat", mode: "bump", label: "Battery low", node: <LowBatteryBump b={batt} /> };
      case "burst": return burst && { key: "burst", mode: "bump", label: priv ? "New notifications" : `${burst.n} new notifications`, node: <BurstBump onOpen={openBurst} /> };
      case "cpu": return cpuHigh && { key: "cpu", mode: "bump", label: priv || !cpuHigh.app ? "CPU is very busy" : `${flat(cpuHigh.app, 28)} is using a lot of CPU`, node: <CpuBump /> };
      case "download": return dl && { key: "download", mode: "bump", label: priv ? "Download complete" : `Downloaded: ${flat(dl.name, 40)}`, node: <DownloadBump id={dl.id} generic={priv} /> };
      case "musicstop": return stopped && { key: "musicstop", mode: "bump", label: priv ? "Music paused" : `Music paused, ${stopped.name} disconnected`, node: <MusicStoppedBump onResume={() => { resumeMusic(); setStopped(null); }} /> };
      case "quota": return { key: "quota", mode: "bump", label: "Usage limit reached", node: <QuotaBump onOk={() => setQuota(false)} /> };
      case "error": return { key: "error", mode: "card", kw: 520, label: "Error", node: <ErrorCard title={errTitle} hint="Something went wrong." detail={errDetail} retry="OK" onRetry={() => setUser(null)} /> };
      case "charge": return batt && { key: "charge", mode: "bump", label: "Charging", node: <ChargeBump b={batt} /> };
      case "bt": return bt && bt.battery !== null ? { key: "bt", mode: "bump", label: "Bluetooth", node: <BtBump battery={bt.battery} /> } : null; // devices that don't report battery only get "connected" on the strip
      case "timer": return timer && { key: "timer", mode: "bump", label: "Timer", node: <TimerBump t={timer} /> };
      case "away": return summary && { key: "away", mode: "bump", label: awayText, node: <AwayBump text={awayText} onOpen={openNotifs} /> };
      case "net": return { key: "net:" + netNote, mode: "bump", label: netNote === "back" ? "Back online" : "Connection lost", node: <NetBump lost={netNote !== "back"} /> };
      case "timerdone": return timerDone && { key: "timerdone", mode: "bump", label: "Time's up", node: <TimerDoneBump label={priv ? "" : timerDone.label} onDone={closeTimerDone} /> };
      case "shelfdrag": return { key: "shelfdrag", mode: "bump", label: "Shelf", node: <ShelfBump main={main} /> };
      case "shelf": return { key: "shelf", mode: "card", kw: 620, label: "Shelf", node: <><ShelfCard items={shelf} main={main} /><ShelfSuggestRow items={shelf} main={main} /></> };
      case "clipboard": return { key: "clipboard", mode: "card", kw: 620, label: "Clipboard", node: <ClipboardView /> };
      case "lock": return { key: "lock", mode: "card", kw: 520, label: "Peeka locked", node: <LockCard lock={lock} /> };
      case "approval": return approvalTop && { key: "approval:" + approvalTop.id, mode: "bump", label: approvalTop.title, node: <ApprovalBump a={approvalTop} dropMs={surf.dropStripMs} onlyDetail={surf.dropStripMs !== null} onDetail={() => { setDetailId(approvalTop.id); setUser("approval-card"); }} /> };
      case "plugin": return surf.protrusion && { key: "plugin:" + surf.protrusion.plugin.id, mode: "bump", label: surf.protrusion.title, node: <ProtrusionBump item={surf.protrusion} /> };
      case "approval-card": return approvalCard && { key: "approval-card:" + approvalCard.id, mode: "card", kw: 620, label: approvalCard.title, node: <ApprovalCard a={approvalCard} /> };
      case "composer": return surf.composer && { key: "composer", mode: "card", kw: 620, label: "Ask", node: <ComposerCard owner={surf.composer} turns={composer.turns} send={composer.send} suggestions={suggestions} autoShelf={autoShelf} /> };
      case "music-card": return musicCard && { key: "music-card", mode: "card", kw: 520, label: "Music", node: musicCard };
      case "modules": return { key: "modules", mode: "card", kw: modPage === "general" && !surf.tabs.length && !surf.summary.length ? 620 : modulesKw(modPage, innerWidth), label: "Modules: " + modName, node: <ModulesCard start={modStart} meeting={meetingItem} onPage={onModPage} onClose={back} media={media} pos={pos} sys={sys.tick} cpu={sys.cpu} surf={surf} shelf={shelf} main={main} onApproval={openApproval} timer={timer} /> };
      case "meeting": return meetingItem && { key: "meeting", mode: "card", kw: 520, label: "Meeting", node: <MeetingCard item={meetingItem} /> };
      case "firstconnect": return { key: "firstconnect", mode: "card", kw: 520, label: `${mainP ? pluginName(mainP) : "Assistant"} connected`, node: <FirstConnectCard onDone={() => { ackFc(); setUser(null); }} /> };
      case "ky": return { key: "ky", mode: "card", kw: 620, label: "Reading clipboard", node: <LoadingBody what="Reading clipboard" /> };
      case "kb": return { key: "kb", mode: "card", kw: 620, label: "Clipboard", node: <div className="body"><EmptyBoard /></div> };
      case "kh": return { key: "kh", mode: "card", kw: 520, label: "Error", node: <ErrorCard title={probeErr.title} detail={probeErr.detail || undefined} onRetry={() => { if (!forced) { setProbe("loading"); setTryN((n) => n + 1); } }} /> };
      case "noassistant": return { key: "noassistant", mode: "card", kw: 520, label: mainP ? `${pluginName(mainP)} isn't connected` : "Assistant not connected", node: <AssistantOfflineCard main={mainP} /> };
      case "welcome": return { key: "welcome", mode: "card", kw: 520, label: "Welcome to Peeka", node: <FirstRunCard mascot={!!mainP} onDone={() => { markFirstRun(); setUser(null); }} /> };
      default: return null;
    }
  })();
  const centerKey = kind === "alert" ? "alert:" + alert?.id : kind === "approval" ? "approval:" + approvalTop?.id : kind === "plugin" ? "plugin:" + surf.protrusion?.title : kind === "rest" || kind === "hov" || kind === "modules" || kind === "noassistant" ? "rest" + (plainPanel ? "-plain" : "") + (consent ? "-consent" : "") + (hidden ? "-hidden" : offline ? "-offline" : status?.dnd ? "-dnd" : "") : kind === "panel" ? "panel:" + panelLabel : kind;
  // resting center: with an assistant connected, mascot + "Compass ready" + counts (a); otherwise clock and music (x0), with a sleeping mascot if the assistant is installed but not connected
  const approvalsN = surf.approvals.length;
  const rest = ((): ReactNode => {
    const lockIcon = lock.locked && <Lock aria-label="Peeka locked" />;
    if (hidden && restShown) return <HiddenCenter />;
    if (consent && restShown) return <span className="ms"><ShieldCheck /><span className="b6">Plugin permission</span></span>;
    if (assistantUp && mainP && restShown && offline) return <OfflineRest />;
    if (assistantUp && mainP && restShown && status?.dnd) return <DndRest approvals={approvalsN} until={status.dndUntil} lock={lockIcon} />;
    if (assistantUp && kind !== "noassistant" && mainP) {
      const card = kind === "modules" || plainPanel; // while a card is open, counts and mascot live in the card (say it once)
      return (
        <>
          <span className="ms">{lockIcon}{!card && <Mascot ref={mascotRef} size={40} mood={moodShown} isMainAssistant cursor={input.cursor} onFileDrop={feed} />}<span className="l2" title={composerLabel ?? `${pluginName(mainP)} ready`}>{composerLabel ?? `${pluginName(mainP)} ready`}</span></span>
          {!card && approvalsN > 0 && <span className="t12 b6 approvalCount num">{cap99(approvalsN)} {approvalsN === 1 ? "approval" : "approvals"}</span>}
          {alerts.length > 0 && <span className="t12 l3 num">{cap99(alerts.length)} {alerts.length === 1 ? "notification" : "notifications"}</span>}
        </>
      );
    }
    return (
      <>
        <span className="ms">{lockIcon}{restShown && !plainPanel && <Mascot ref={mascotRef} size={40} mood={moodShown} isMainAssistant cursor={input.cursor} />}<span className="b6 num">{time}</span></span>
        {approvalsN > 0 && <span className="t12 b6 approvalCount num">{cap99(approvalsN)} {approvalsN === 1 ? "approval" : "approvals"}</span>}{/* pending approvals are counted on the strip even when the connection is lost */}
        {media && (priv
          ? <span className="ms"><span className="l2">{LOCK_MUSIC}</span>{media.playing && <Bars />}</span>
          : <span className="ms">{media.art && <img className="cover" src={media.art} alt="" style={{ width: 18, height: 18, borderRadius: 5 }} />}<span className="l2" title={trackTitle(media)}>{trackTitle(media)}</span>{media.playing && <Bars />}</span>)}
      </>
    );
  })();
  const centerNode = centerOf(kind, { time, media, alert, osd, approval: kind === "approval" ? approvalTop : null, plug: surf.protrusion, composerLabel: composerLabel, net: netNote, shot: shotNow, timerDone: timerDone?.label ?? null, main, locked: priv, alertsN: alerts.length, done, meeting: meetingItem, burst, stopped, dl, cpu: cpuHigh, rest, battery: batt, bt, timer, shelfCount: shelf.length, panel: panelLabel });

  const centerOld = useOld(centerKey, centerNode);
  const shapeOld = useOld(spec?.key ?? "none", spec?.node ?? null, spec?.mode === "card" ? spec.kw : undefined);

  /* ---- measurement and springs ---- */
  const [, setCenterEl, cSize] = useSize();
  const [, setShapeEl, sSize] = useSize();
  // R1-9: while a panel (Search, Settings, Start, Status, consent) opens or closes, the center island width stays at its resting value; it only changes on its own events
  const panelOpen = panelLabel !== null || !!consent;
  const restW = useRef(0);
  if (!panelOpen && (kind === "rest" || kind === "hov") && cSize.w > 0) restW.current = cSize.w;
  const holdW = panelOpen && restW.current > 0 && (kind === "panel" || kind === "rest" || kind === "hov") ? restW.current : 0;
  const mw = Math.max(cSize.w, holdW);
  const mode = spec?.mode ?? "none";
  const tw = mode === "none" ? mw : mode === "peek" ? mw + 40 : mode === "card" ? spec!.kw! : Math.max(mw + 24, sSize.w);
  const th = mode === "none" ? 0 : mode === "peek" ? 14 : sSize.h;
  const W = Math.max(0, useSpring(tw, SPRINGS.card));
  const H = Math.max(0, useSpring(th, SPRINGS.card));
  const bumpHover = hover && mode === "bump";
  const hv = useSpring(kind === "hov" || bumpHover ? 1 : 0, HOVER_SPRING);
  // assistant line: announced to the strip page (cut under the peek); the island line sits on the peek's bottom edge
  const ls = lineOf({ assistantUp, hidden: hidden && restShown, kind, mascot: surf.protrusion?.plugin.main ? surf.protrusion.mascot : null });
  const lineGap = mode === "none" ? 0 : Math.round(tw / 2 + Math.min(16, 8 + th * 0.12, th * 0.8));
  useEffect(() => { announceLine({ color: ls.color, mod: ls.mod, gap: lineGap }); }, [ls.color, ls.mod, lineGap]);
  // new approval, alert or meeting peek: a short wave along the strip (Windows notifications don't make a wave)
  useEffect(() => {
    const c = kind === "approval" || kind === "alert" ? AMBER : kind === "plugin" && meetingItem ? CYAN : null;
    if (!c) return;
    const t = setTimeout(() => announceWave(c), 120);
    return () => clearTimeout(t);
  }, [centerKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = Math.min(H * 0.6, 34, 15 + Math.max(0, H - 40) * 0.3), f = Math.min(16, 8 + H * 0.12, H * 0.8);
  // card color: from the cover for music, orange for the approval card (mockup c2)
  const ambient: [string, string] | null = kind === "music-card" ? tint : kind === "approval-card" ? ["#FF9F0A", "#FF9F0A"] : kind === "modules" ? ["#5E5CE6", "#5E5CE6"] : kind === "composer" ? ["#63E6E2", "#63E6E2"] : null;
  const glow = (kind === "modules" && modPage === "music" && tint) || ambient; // the card color stays fixed across tabs; only the cover light follows the cover
  const shapeStyle = {
    left: "50%", transform: "translateX(-50%)", width: W, height: H, visibility: mode !== "none" || H >= 0.4 ? "visible" : "hidden",
    "--r": r + "px", "--f": f + "px", "--vis": Math.min(1, H / 80), "--cardMix": Math.max(0, 1 - H / 70),
    ...(ambient ? { "--amb1": ambient[0], "--amb2": ambient[1], "--ambO": 1, "--t1": (glow ?? ambient)[0], "--t2": (glow ?? ambient)[1] } : { "--ambO": 0 }),
  } as unknown as CSSProperties;

  // clickable box: target size right away when growing, old size until the spring ends when shrinking (so clicks aren't lost and the transparent area doesn't swallow them)
  const box = useRef({ w: 0, h: 0 });
  const settled = Math.abs(W - tw) < 1 && Math.abs(H - th) < 1;
  box.current = settled ? { w: tw, h: th } : { w: Math.max(box.current.w, tw), h: Math.max(box.current.h, th) };

  // clicking inside the island closes any open strip panel (the strip listens for this message)
  useEffect(() => {
    const down = (e: PointerEvent) => { if ((e.target as Element | null)?.closest?.("#island, .islandCenter, .sideBubble, .sessionChip")) sendX({ t: "island-click" }); };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, []);
  // clicking outside closes the card (even with the window unfocused; Rust reports clicks on other windows via "notch://outside_press")
  const cardOpen = mode === "card" && kind !== "welcome" && kind !== "firstconnect";
  useEffect(() => {
    if (!cardOpen) return;
    const down = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.("#island, .islandCenter, .sideBubble, .sessionChip")) back(); };
    document.addEventListener("pointerdown", down);
    const off = onX((m) => { if (m.t === "outside") back(); });
    // the main path: the island window never sees outside clicks (the transparent area passes them through); Rust's pointer polling reports them, "island" is the card itself
    const offPress = bridge.on("notch://outside_press", (m) => { if (m !== "island") back(); });
    return () => { document.removeEventListener("pointerdown", down); off(); offPress.then((f) => f()); };
  }, [cardOpen, back]);

  /* ---- shared element flight: from its spot in the old layer to the new one ---- */
  const stage = useRef<HTMLDivElement>(null);
  const center = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const st = stage.current;
    if (!st) return;
    const olds = new Map<string, HTMLElement>();
    st.querySelectorAll<HTMLElement>("[data-leaving] [data-share]").forEach((e) => olds.set(e.dataset.share!, e));
    if (!olds.size) return;
    st.querySelectorAll<HTMLElement>("[data-share]").forEach((e) => {
      if (e.closest("[data-leaving]")) return;
      const o = olds.get(e.dataset.share!);
      if (o) { fly(e, o.getBoundingClientRect()); o.style.visibility = "hidden"; }
    });
  }, [centerKey, spec?.key]);

  useEffect(() => { announceCenterClock(kind === "noassistant" || ((kind === "rest" || kind === "hov" || kind === "modules") && !assistantUp)); }, [kind, assistantUp]);

  const openMod = (tab?: string) => { setModStart(tab); setUser("modules"); };
  /** One rule (Y1/Y3/O11): clicking a peek opens Modules on its own tab; clicking the center with a card open closes the card. */
  const onCenter = () => {
    if (hidden && restShown) bridge.call("island_hide", { on: false }).catch(() => undefined);
    else if (kind === "rest" || kind === "hov") setUser(asleep ? "noassistant" : "modules");
    else if (kind === "panel") return;
    else if (kind === "jobdone") { setDone(null); announceNotif(); }
    else if (kind === "away") openNotifs();
    else if (kind === "burst") openBurst();
    else if (kind === "quota") setQuota(false);
    else if (kind === "musicstop") setStopped(null);
    else if (kind === "download") setDl(null);
    else if (kind === "cpu") setCpuHigh(null);
    else if (kind === "plugin" && meetingItem) openMod("calendar");
    else if (kind === "music") openMod("music");
    else if (kind === "shot") { setShot(null); openMod("clipboard"); }
    else if (kind === "timer" || kind === "timerdone") openMod("timer");
    else if (kind === "shelfdrag") openMod("shelf");
    else if (user) back();
    else openMod();
  };
  /** From a card without a tab bar to Modules, on that card's own tab. */
  const toModules = () => openMod(user === "clipboard" ? "clipboard" : user === "shelf" ? "shelf" : user === "meeting" ? "calendar" : user === "music-card" ? "music" : undefined);
  const assistantRest = assistantUp && mainP && (kind === "rest" || kind === "hov" || kind === "modules");
  const ariaOverride = hidden && restShown ? "Island hidden. Press Ctrl+Shift+A to show it" : asleep && restShown ? `${mainP ? pluginName(mainP) : "Assistant"} isn't connected. Open to launch it` : null;
  const parts = assistantRest ? [`${pluginName(mainP)} ready`, approvalsN ? `${cap99(approvalsN)} ${approvalsN === 1 ? "approval" : "approvals"}` : null, alerts.length ? `${cap99(alerts.length)} ${alerts.length === 1 ? "notification" : "notifications"}` : null].filter(Boolean)
    : [label.split(",")[1]?.trim(), media?.playing ? (priv ? LOCK_MUSIC : `Playing ${trackTitle(media)}`) : null].filter(Boolean);
  // a shown peek is announced to screen readers (approval: immediately, others: in turn) and the island button's name carries the peek (F-01, F-28)
  const bump = mode === "bump" && !!spec;
  useEffect(() => { if (!stage.current?.contains(document.activeElement)) setKbIn(false); }, [kind, spec?.key]); // blur may not fire when the focused element unmounts
  const say = !bump ? "" : kind === "approval" && approvalTop ? `${pluginName(approvalTop.plugin)} is asking for approval: ${flat(approvalTop.title, 120)}`
    : kind === "alert" && alert ? [alert.title, alert.subtitle].filter(Boolean).join(", ") : kind === "music" && media ? (priv ? LOCK_MUSIC : `Playing: ${trackTitle(media)}`) : spec!.label;
  // side bubble: activities after the main strip. None while a card is open, presenting/busy, or the island is hidden. While locked, only a generic icon.
  const bubbleCtx = { away: summary ? awayText : null, net: netNote, media, timer, alert, prot, done, locked: priv, battery: batt, burst, stopped, dl, cpu: cpuHigh };
  const sideItems = calm || mode === "card" || (hidden && restShown) ? [] : plan.secondary.map((a) => bubbleItem(a.kind, bubbleCtx));
  const centerMax = Math.max(360, Math.min(424, Math.round(innerWidth * 0.4))); // center content is never wider than ~40% of the screen or 424 px (R2-Y1; strip tabs fit up to 176 px left of the island, at most 36 px overlap); overflow gets an ellipsis

  return (
    <div className="islandStage" ref={stage} onKeyDown={crossKey} data-spring={settled ? undefined : ""}
      onFocus={() => { if (document.documentElement.hasAttribute("data-kb")) setKbIn(true); }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKbIn(false); }}>
      <div className="srOnly" role="status" aria-live="polite" aria-atomic="true">{kind === "approval" ? "" : say}</div>
      <div className="srOnly" role="alert" aria-live="assertive" aria-atomic="true">{kind === "approval" ? say : ""}</div>
      {ambient && <div id="halo" style={{ width: W * 1.1, height: H * 1.15, ["--amb1" as string]: ambient[0], ["--ambO" as string]: 1 }} />}
      <button ref={center} className="islandCenter" data-hit aria-expanded={mode === "card" ? true : bump ? undefined : false} aria-label={ariaOverride ?? (bump ? `${say}. Open Modules` : `${parts.join(", ")}${mode === "card" ? "" : ". Open card"}`)}
        style={{ width: mw + 24, transform: `translateX(-50%) translateY(${hv * 0.5}px)`, filter: hv > 0.001 ? `brightness(${1 + hv * 0.28})` : undefined }}
        title={bumpHover ? "Open Modules" : undefined} onClick={(e) => { if (!(e.target as Element).closest?.(".mascot")) return onCenter(); setTimeout(moodShown === "error" && restShown ? () => setUser("error") : owner.current ? () => openAsk("composer") : onCenter, SLAP_OPEN_MS); }}
        onPointerEnter={() => hoverIntent(true)} onPointerLeave={() => { hoverIntent(false); setMkHover(false); }}
        onPointerOver={(e) => { const on = !!(e.target as Element).closest?.(".mascot-hit"); if (on && !mkHover) loadCounts(); setMkHover(on); }}>
        {centerOld !== null && <span className="islandMascot leaving" data-leaving aria-hidden="true" style={{ maxWidth: centerMax }}>{centerOld.node}</span>}
        <span key={centerKey} className="islandMascot" ref={setCenterEl} style={{ maxWidth: centerMax, minWidth: holdW || undefined, justifyContent: holdW ? "center" : undefined }}>{centerNode}</span>
        {bumpHover && <span className="openIcon" aria-hidden="true"><ArrowUpRight /></span>}
      </button>
      {mkHover && assistantUp && mainP && restShown && <div className="mkBubble" data-paint role="status">{[jobsN > 0 && `${jobsN} running`, waitN > 0 && `${waitN} awaiting approval`].filter(Boolean).join(" · ") || `${pluginName(mainP)} ready`}</div>}
      <SideBubble items={sideItems} edge={Math.max(W, mw + 24) / 2 + 8} open={more} setOpen={setMore} onPick={setPinned} onHover={setBubbleHover} />
      {nSess >= 2 && !calm && mode !== "card" && !(hidden && restShown) && <SessionChip n={nSess} list={sessList} edge={Math.max(W, mw + 24) / 2 + 8} last={lastCc} locked={priv} />}
      {settings?.demo && <span className="demoBadge" data-paint style={{ left: `calc(50% + ${(mw + 24) / 2 + 8}px)` }}>Demo</span>}
      {demoNot && <div className="mkBubble demoNote" data-paint role="status">Not available in demo mode</div>}
      {mode !== "none" || H > 0.4 ? <div className="islandHit" data-hit style={{ width: box.current.w, height: box.current.h }} /> : null}
      {mode !== "none" || H > 0.4 ? <div className="islandHit islandShadow" data-paint style={{ width: box.current.w + 2 * SHADOW_SIDE, height: box.current.h + SHADOW_BOTTOM }} /> : null}
      <div id="island" className="dangling" style={shapeStyle} onPointerEnter={() => hoverIntent(true)} onPointerLeave={() => hoverIntent(false)}>
        <div className="cut">
          <div className="amb" />
          {shapeOld !== null && <div className="islandInner leaving" data-leaving aria-hidden="true" style={{ width: shapeOld.width ?? "max-content" }} ref={(el) => { if (el) el.inert = true; }}>{shapeOld.node}</div>}
          {spec && <Layer key={spec.key} spec={spec} onClose={back} onModules={toModules} measure={setShapeEl} />}
        </div>
        <IslandLine s={ls} hidden={H < 0.4} />
      </div>
    </div>
  );
}
