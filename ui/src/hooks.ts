import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bridge, type Alert, type CalendarNext, type Media, type MonitorInfo, type PinnedApp, type Rect, type Settings, type Status, type SysmonTick, type WindowInfo } from "./bridge";
import { liveAlerts, nextExpiry, sortAlerts } from "./lib/alerts";
import { livePosition } from "./lib/media";
import { meetingReminder, type ReminderItem } from "./lib/meetingReminder";
import { collectHitRects, sameRects } from "./lib/hitRects";

/** The strip draws nothing until its monitor is known: a failed query is asked again, 3 tries in all (250, 500 ms apart). */
export function useMonitor(monitor: string) {
  const [info, setInfo] = useState<MonitorInfo | null>(null);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = (left: number, wait: number): void => {
      bridge.call("get_monitor", { monitor }).then(
        (m) => { if (live) setInfo(m); },
        () => { if (live && left > 1) timer = setTimeout(() => ask(left - 1, wait * 2), wait); },
      );
    };
    ask(3, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [monitor]);
  return info;
}

export function useWindows(monitor: string) {
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  useEffect(() => {
    const load = () => bridge.call("list_windows", { monitor }).then(setWindows);
    load();
    const off = bridge.on("windows_changed", (e) => { if (e.monitor === monitor) load(); });
    return () => { off.then((f) => f()); };
  }, [monitor]);
  return windows;
}

export function usePins() {
  const [pins, setPins] = useState<PinnedApp[]>([]);
  useEffect(() => {
    const load = () => bridge.call("get_pins").then(setPins);
    load();
    const off = bridge.on("pins_changed", load);
    return () => { off.then((f) => f()); };
  }, []);
  return [pins, setPins] as const;
}

export function useStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    bridge.call("get_status").then(setStatus);
    const off = bridge.on("status_changed", setStatus);
    return () => { off.then((f) => f()); };
  }, []);
  return [status, setStatus] as const;
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    const take = (s: Settings) => { setSettings(s); document.documentElement.toggleAttribute("data-color", !!s.colorIcons); };
    bridge.call("get_settings").then(take);
    const off = bridge.on("settings_changed", take);
    return () => { off.then((f) => f()); };
  }, []);
  return settings;
}

/** Current time, refreshed every 15 s (so the minute flips on time). */
export function useNow() {
  const [now, setNow] = useState(() => bridge.now());
  useEffect(() => { const t = setInterval(() => setNow(bridge.now()), 15_000); return () => clearInterval(t); }, []);
  return now;
}

/** Reports `[data-hit]` rectangles to Rust (on change, at most once per frame). */
export function useHitRects(page: "strip" | "island", monitor: string) {
  const last = useRef<Rect[]>([]);
  const send = useCallback(() => {
    const rects = collectHitRects();
    if (sameRects(rects, last.current)) return;
    last.current = rects;
    bridge.call("report_hit_rects", { page, monitor, rects });
  }, [page, monitor]);
  useEffect(() => {
    let raf = 0;
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(send); };
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(document.body);
    window.addEventListener("resize", schedule);
    schedule();
    return () => { mo.disconnect(); ro.disconnect(); window.removeEventListener("resize", schedule); cancelAnimationFrame(raf); };
  }, [send]);
}

/** Now playing; `position()` advances on the local clock while playing. */
export function useMedia() {
  const [media, setMedia] = useState<Media | null>(null);
  const [ready, setReady] = useState(false); // has the first read arrived: no peek opens for a track already playing at launch
  useEffect(() => {
    const set = (m: Media | null) => { setMedia(m); setReady(true); };
    bridge.call("get_media").then(set);
    const off = bridge.on("media_changed", set);
    return () => { off.then((f) => f()); };
  }, []);
  const position = useCallback(() => (media ? livePosition(media, Date.now()) : 0), [media]);
  return { media, ready, position };
}

/** Alert list: sorted, expired ones drop out by themselves. */
export function useAlerts() {
  const [raw, setRaw] = useState<Alert[]>([]);
  const [top, setTop] = useState<string | null>(null);
  const take = (v: { items: Alert[]; top: string | null }) => { setRaw(v.items); setTop(v.top); };
  const [tick, setTick] = useState(0);
  useEffect(() => {
    bridge.call("list_alerts").then(take);
    const off = bridge.on("alerts_changed", take);
    return () => { off.then((f) => f()); };
  }, []);
  useEffect(() => {
    const wait = nextExpiry(raw, Date.now());
    if (wait === null) return;
    const t = setTimeout(() => setTick((n) => n + 1), wait + 20);
    return () => clearTimeout(t);
  }, [raw, tick]);
  // tick: refilter when something expires
  const alerts = useMemo(() => sortAlerts(liveAlerts(raw, Date.now())), [raw, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { alerts, top };
}

/** System monitor: starts while the card is open (`active`), stops when it closes or unmounts. The last 16 CPU samples feed the sparkline. */
export function useSysmon(active: boolean) {
  const [tick, setTick] = useState<SysmonTick | null>(null);
  const [cpu, setCpu] = useState<number[]>([]);
  useEffect(() => {
    if (!active) return;
    let off: Promise<() => void> | null = bridge.on("sysmon_tick", (t) => { setTick(t); if (t.cpu !== null) setCpu((h) => [...h, t.cpu as number].slice(-16)); });
    bridge.call("sysmon_start").catch(() => undefined);
    return () => { bridge.call("sysmon_stop").catch(() => undefined); off?.then((f) => f()); off = null; };
  }, [active]);
  return { tick, cpu };
}

/* ---- plugin surfaces (plugin-api.ts) ---- */
import { EMPTY_SURFACES } from "./plugin.fixtures";
import type { ComposerEvent, ConsentRequest, PluginInfo, SurfacesView } from "./plugin-api";

/** What plugins show on screen: peek, approvals, Modules tabs, the Ctrl+Space owner. */
export function useSurfaces(): SurfacesView {
  const [s, setS] = useState<SurfacesView>(EMPTY_SURFACES);
  useEffect(() => {
    bridge.call("plugin_surfaces").then(setS).catch(() => undefined);
    const off = bridge.on("plugin_surfaces_changed", setS);
    return () => { off.then((f) => f()); };
  }, []);
  return s;
}

/** Reminder peek for the next meeting on the main assistant's calendar (lib/meetingReminder.ts). The calendar is read every minute, the clock checked every 15 s. */
export function useMeetingReminder(generic: boolean): ReminderItem | null {
  const [cal, setCal] = useState<CalendarNext | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true;
    const load = () => bridge.call("calendar_next").then((c) => { if (alive) { setCal(c); setNow(Date.now()); } }).catch(() => { if (alive) setCal(null); });
    load();
    const tick = setInterval(() => setNow(Date.now()), 15_000), reload = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(tick); clearInterval(reload); };
  }, []);
  return useMemo(() => meetingReminder(cal, now, generic), [cal, now, generic]);
}

/** Latest text of the `live_text` / `voice.transcript` stream (Rust merges every 50 ms) and the speaker label, if any. */
export function useStream(streamId: string | undefined): { text: string; speaker: string } {
  const [s, setS] = useState({ text: "", speaker: "" });
  useEffect(() => {
    if (!streamId) return;
    const off = bridge.on("plugin_stream", (e) => { if (e.streamId === streamId) setS({ text: e.text, speaker: e.speaker ?? "" }); });
    return () => { off.then((f) => f()); setS({ text: "", speaker: "" }); };
  }, [streamId]);
  return s;
}

/** Current time refreshed every second (counters). Stops while `on` is false. */
export function useSecond(on = true): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => { if (!on) return; const i = setInterval(() => setT(Date.now()), 1000); return () => clearInterval(i); }, [on]);
  return t;
}

const firstSeen = new Map<string, number>();
/** Seconds left. Rust sends `expiresS` as the original duration; the counter runs from when the item was first seen (by id) and doesn't restart on surface updates. */
export function useDeadline(id: string, seconds: number | null | undefined): number | null {
  const now = useSecond(!!seconds);
  if (!seconds) return null;
  if (!firstSeen.has(id)) firstSeen.set(id, now);
  return Math.max(0, Math.ceil(seconds - (now - firstSeen.get(id)!) / 1000));
}

/** Pending plugin consent request (consent window page). */
export function useConsent(): ConsentRequest | null {
  const [c, setC] = useState<ConsentRequest | null>(null);
  useEffect(() => {
    const load = () => bridge.call("consent_get").then(setC).catch(() => undefined);
    load();
    const off = bridge.on("consent_changed", load);
    return () => { off.then((f) => f()); };
  }, []);
  return c;
}

export function usePlugins(): PluginInfo[] {
  const [p, setP] = useState<PluginInfo[]>([]);
  useEffect(() => {
    const load = () => bridge.call("plugin_list").then(setP).catch(() => undefined);
    load();
    const off = bridge.on("plugins_changed", load);
    return () => { off.then((f) => f()); };
  }, []);
  return p;
}

export interface Turn { id: number; ask: string; answer: string; chips: { label: string; kind: string }[]; state: "wait" | "done" | "error"; error?: string }
/** Ctrl+Space chat: sent questions and streaming answers. Answer chunks may arrive before `composer_submit` returns; the turn is created then. */
export function useComposer() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const upd = useCallback((id: number, f: (t: Turn) => Turn) => setTurns((cur) => {
    const has = cur.some((t) => t.id === id);
    const base = has ? cur : [...cur, { id, ask: "", answer: "", chips: [], state: "wait" as const }];
    return base.map((t) => (t.id === id ? f(t) : t));
  }), []);
  useEffect(() => {
    const off = bridge.on("composer_event", (e: ComposerEvent) => upd(e.turn, (t) => {
      if (e.kind === "delta") return { ...t, answer: t.answer + (e.text ?? "") };
      if (e.kind === "chip") return { ...t, chips: [...t.chips, { label: e.label ?? "", kind: e.chipKind ?? "source" }] };
      if (e.kind === "done") return { ...t, state: "done" };
      return { ...t, state: "error", error: e.message ?? "" };
    }));
    return () => { off.then((f) => f()); };
  }, [upd]);
  const send = useCallback(async (text: string, attachments: { kind: "window_image" }[]) => {
    const { turn } = await bridge.call("composer_submit", { text, attachments });
    upd(turn, (t) => ({ ...t, ask: text }));
  }, [upd]);
  return { turns, send };
}

/* ---- Wave 4: lock, main assistant, clipboard (bridge.ts) ---- */
import { alive } from "./lib/clip";
import type { ClipItem, LockState, MirrorView } from "./bridge";

/** Peeka's own lock. If the read fails (no Rust yet) it counts as unlocked. */
export function useLock(): LockState {
  const [l, setL] = useState<LockState>({ locked: false, reason: null });
  useEffect(() => {
    bridge.call("lock_state").then(setL).catch(() => undefined);
    const off = bridge.on("lock_changed", setL);
    return () => { off.then((f) => f()); };
  }, []);
  return l;
}

/** The connected main assistant ("Ask" rows show only while it exists); otherwise null. */
export function useMainAssistant(): PluginInfo | null {
  return usePlugins().find((p) => p.main && p.connected) ?? null;
}

/** "Ask <name>" label, with the main assistant's name. */
export const askLabel = (main: Pick<PluginInfo, "name">) => `Ask ${main.name}`;

/** Clipboard list. While locked there are no password rows (Rust doesn't send them, the UI filters too); expired passwords drop out. */
export function useClips(): ClipItem[] {
  const [raw, setRaw] = useState<ClipItem[]>([]);
  const lock = useLock();
  const [now, setNow] = useState(() => bridge.now().getTime());
  useEffect(() => { const t = setInterval(() => setNow(bridge.now().getTime()), 15_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    let live = true;
    const load = () => bridge.call("clip_list").then((l) => { if (live) setRaw(l); }).catch(() => undefined);
    load();
    const offs = [bridge.on("clip_changed", load), bridge.on("lock_changed", load)];
    return () => { live = false; offs.forEach((o) => o.then((f) => f())); };
  }, []);
  return useMemo(() => raw.filter((c) => (!lock.locked || c.kind !== "password") && alive(c, now)), [raw, lock.locked, now]);
}

/* ---- Wave 5 (bridge.ts): timer, shelf, privacy, Bluetooth, input ---- */
import type { BluetoothEvent, InputTick, PrivacyState, ShelfItem, TimerState } from "./bridge";

/** Peeka's timer; the component drawing the time left computes it every second. */
export function useTimer(): TimerState | null {
  const [t, setT] = useState<TimerState | null>(null);
  useEffect(() => {
    bridge.call("timer_get").then(setT).catch(() => undefined);
    const off = bridge.on("timer_changed", setT);
    return () => { off.then((f) => f()); };
  }, []);
  return t;
}
/** Seconds left: counts down from `at` while running. */
export const timerLeft = (t: TimerState, nowMs: number) => Math.max(0, t.running ? t.remainingS - (nowMs - t.at) / 1000 : t.remainingS);

export function useShelf(): ShelfItem[] {
  const [l, setL] = useState<ShelfItem[]>([]);
  useEffect(() => {
    const load = () => bridge.call("shelf_list").then(setL).catch(() => undefined);
    load();
    const off = bridge.on("shelf_changed", load);
    return () => { off.then((f) => f()); };
  }, []);
  return l;
}

export function useShelfDrag(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => { const off = bridge.on("shelf_drag", setOn); return () => { off.then((f) => f()); }; }, []);
  return on;
}

/** Apps using the mic and camera (from the Windows ConsentStore, via Rust). */
export function usePrivacy(): PrivacyState {
  const [p, setP] = useState<PrivacyState>({ mic: [], camera: [] });
  useEffect(() => {
    bridge.call("privacy_get").then(setP).catch(() => undefined);
    const off = bridge.on("privacy_changed", setP);
    return () => { off.then((f) => f()); };
  }, []);
  return p;
}

/** Bluetooth headphones connected: after the event, returns it for `ms` (3 s by default), then null. `pin` keeps it open in the preview. */
export function useBluetooth(pin = false, ms = 3000, initial: BluetoothEvent | null = null) {
  const [b, setB] = useState<BluetoothEvent | null>(initial);
  useEffect(() => { const off = bridge.on("bluetooth_connected", setB); return () => { off.then((f) => f()); }; }, []);
  useEffect(() => { if (!b || pin) return; const t = setTimeout(() => setB(null), ms); return () => clearTimeout(t); }, [b, pin, ms]);
  return [b, () => setB(null)] as const;
}

/**
 * Last input and cursor. Rust sends `input_tick` (GetLastInputInfo + cursor); until it arrives, and in the browser preview, the page's own mouse/keyboard
 * events stand in. `cursor` undefined = Rust isn't feeding it (Mascot listens to its own pointermove).
 */
export function useInput() {
  const last = useRef({ at: Date.now(), tickAgo: null as number | null, tickAt: 0 });
  const [cursor, setCursor] = useState<InputTick["cursor"] | undefined>(undefined);
  // Windows presentation mode / busy: Rust sends only on change, the last value sticks
  const [calm, setCalm] = useState({ presentation: false, busy: false });
  useEffect(() => {
    const local = () => { last.current.at = Date.now(); };
    for (const e of ["pointermove", "keydown", "pointerdown"]) addEventListener(e, local, true);
    const off = bridge.on("input_tick", (t) => { last.current.tickAgo = t.lastInputAgoMs; last.current.tickAt = Date.now(); setCursor(t.cursor); const presentation = !!t.presentation, busy = !!t.busy; setCalm((c) => (c.presentation === presentation && c.busy === busy ? c : { presentation, busy })); });
    return () => { for (const e of ["pointermove", "keydown", "pointerdown"]) removeEventListener(e, local, true); off.then((f) => f()); };
  }, []);
  const lastInputAgoMs = useCallback(() => {
    const { at, tickAgo, tickAt } = last.current, now = Date.now();
    return tickAgo === null ? now - at : Math.min(now - at, tickAgo + (now - tickAt));
  }, []);
  return { lastInputAgoMs, cursor, presentation: calm.presentation, busy: calm.busy };
}

/** Windows notification mirror (Wave 6): cards and `quiet` (while quiet no card opens by itself). */
export function useMirror(): MirrorView & { /** The first list arrived (anything after counts as "new"). */ ready: boolean } {
  const [v, setV] = useState<MirrorView & { ready: boolean }>({ items: [], quiet: false, ready: false });
  useEffect(() => {
    let live = true;
    const take = (l: MirrorView) => { if (live) setV({ ...l, ready: true }); };
    bridge.call("mirror_list").then(take).catch(() => undefined);
    const off = bridge.on("notifications_changed", take);
    return () => { live = false; off.then((f) => f()); };
  }, []);
  return v;
}
