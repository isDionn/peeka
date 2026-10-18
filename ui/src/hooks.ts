import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bridge, type Alert, type CalendarNext, type Media, type MonitorInfo, type PinnedApp, type Rect, type Settings, type Status, type SysmonTick, type WindowInfo } from "./bridge";
import { liveAlerts, nextExpiry, sortAlerts } from "./lib/alerts";
import { livePosition } from "./lib/media";
import { meetingReminder, type ReminderItem } from "./lib/meetingReminder";
import { collectHitRects, sameRects } from "./lib/hitRects";
import { dative } from "./lib/cardsText";

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
    const take = (s: Settings) => { setSettings(s); document.documentElement.toggleAttribute("data-renkli", !!s.colorIcons); };
    bridge.call("get_settings").then(take);
    const off = bridge.on("settings_changed", take);
    return () => { off.then((f) => f()); };
  }, []);
  return settings;
}

/** Şimdiki zaman, dakikada bir tazelenir. */
export function useNow() {
  const [now, setNow] = useState(() => bridge.now());
  useEffect(() => { const t = setInterval(() => setNow(bridge.now()), 15_000); return () => clearInterval(t); }, []);
  return now;
}

/** `[data-hit]` dikdörtgenlerini Rust'a bildirir (değişince, kare başına en çok bir kez). */
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

/** Çalan parça; `position()` çalarken yerel saatle ilerler. */
export function useMedia() {
  const [media, setMedia] = useState<Media | null>(null);
  const [ready, setReady] = useState(false); // ilk okuma geldi mi: açılışta çalan parça için çıkıntı açılmaz
  useEffect(() => {
    const set = (m: Media | null) => { setMedia(m); setReady(true); };
    bridge.call("get_media").then(set);
    const off = bridge.on("media_changed", set);
    return () => { off.then((f) => f()); };
  }, []);
  const position = useCallback(() => (media ? livePosition(media, Date.now()) : 0), [media]);
  return { media, ready, position };
}

/** Uyarı listesi: sıralı, süresi dolanlar kendiliğinden düşer. */
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
  // tick: süre dolunca yeniden süzmek için
  const alerts = useMemo(() => sortAlerts(liveAlerts(raw, Date.now())), [raw, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { alerts, top };
}

/** Sistem izleme: kart açıkken (`active`) başlar, kapanınca ya da söküldüğünde durur. Son 16 işlemci örneği sparkline için. */
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

/* ---- eklenti yüzeyleri (plugin-api.ts) ---- */
import { EMPTY_SURFACES } from "./plugin.fixtures";
import type { ComposerEvent, ConsentRequest, PluginInfo, SurfacesView } from "./plugin-api";

/** Eklentilerin ekrandaki hali: çıkıntı, onaylar, Modüller sekmeleri, Ctrl+Space sahibi. */
export function useSurfaces(): SurfacesView {
  const [s, setS] = useState<SurfacesView>(EMPTY_SURFACES);
  useEffect(() => {
    bridge.call("plugin_surfaces").then(setS).catch(() => undefined);
    const off = bridge.on("plugin_surfaces_changed", setS);
    return () => { off.then((f) => f()); };
  }, []);
  return s;
}

/** Ana asistanın takvimindeki sıradaki toplantı için hatırlatma çıkıntısı (lib/meetingReminder.ts). Takvim dakikada bir okunur, saat 15 sn'de bir kontrol edilir. */
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

/** `live_text` / `voice.transcript` akışının son metni (Rust 50 ms'de birleştirir) ve varsa konuşanın etiketi. */
export function useStream(streamId: string | undefined): { text: string; speaker: string } {
  const [s, setS] = useState({ text: "", speaker: "" });
  useEffect(() => {
    if (!streamId) return;
    const off = bridge.on("plugin_stream", (e) => { if (e.streamId === streamId) setS({ text: e.text, speaker: e.speaker ?? "" }); });
    return () => { off.then((f) => f()); setS({ text: "", speaker: "" }); };
  }, [streamId]);
  return s;
}

/** Saniyede bir tazelenen şimdiki zaman (sayaçlar). `on` false iken durur. */
export function useSecond(on = true): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => { if (!on) return; const i = setInterval(() => setT(Date.now()), 1000); return () => clearInterval(i); }, [on]);
  return t;
}

const firstSeen = new Map<string, number>();
/** Kalan saniye. Rust `expiresS`i özgün süre olarak yollar; sayaç öğenin ilk görüldüğü andan (kimliğe göre) sayar, yüzey güncellemesinde başa dönmez. */
export function useDeadline(id: string, seconds: number | null | undefined): number | null {
  const now = useSecond(!!seconds);
  if (!seconds) return null;
  if (!firstSeen.has(id)) firstSeen.set(id, now);
  return Math.max(0, Math.ceil(seconds - (now - firstSeen.get(id)!) / 1000));
}

/** Bekleyen eklenti onay isteği (onay penceresi sayfası). */
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
/** Ctrl+Space sohbeti: gönderilen sorular ve akan cevaplar. Cevap parçaları `composer_submit` dönmeden gelebilir; tur o zaman oluşur. */
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

/* ---- Dalga 4: kilit, ana asistan, pano (bridge.ts) ---- */
import { alive } from "./lib/clip";
import type { ClipItem, LockState, MirrorView } from "./bridge";

/** Peeka'nın kendi kilidi. Okuma başarısızsa (Rust henüz yok) kilitsiz sayılır. */
export function useLock(): LockState {
  const [l, setL] = useState<LockState>({ locked: false, reason: null });
  useEffect(() => {
    bridge.call("lock_state").then(setL).catch(() => undefined);
    const off = bridge.on("lock_changed", setL);
    return () => { off.then((f) => f()); };
  }, []);
  return l;
}

/** Bağlı ana asistan ("Sor" satırları yalnız o varken görünür); yoksa null. */
export function useMainAssistant(): PluginInfo | null {
  return usePlugins().find((p) => p.main && p.connected) ?? null;
}

/** "<ad>'a sor" yazısı: ana asistanın adıyla. */
export const askLabel = (main: Pick<PluginInfo, "name">) => `${dative(main.name)} sor`;

/** Pano listesi. Kilitliyken parola satırları listede yoktur (Rust zaten göndermez, arayüz de eler); süresi dolan parola düşer. */
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

/* ---- Dalga 5 (bridge.ts): zamanlayıcı, raf, gizlilik, Bluetooth, girdi ---- */
import type { BluetoothEvent, InputTick, PrivacyState, ShelfItem, TimerState } from "./bridge";

/** Peeka'nın zamanlayıcısı; kalanı çizen bileşen `remaining()` ile saniyede bir hesaplar. */
export function useTimer(): TimerState | null {
  const [t, setT] = useState<TimerState | null>(null);
  useEffect(() => {
    bridge.call("timer_get").then(setT).catch(() => undefined);
    const off = bridge.on("timer_changed", setT);
    return () => { off.then((f) => f()); };
  }, []);
  return t;
}
/** Kalan saniye: çalarken `at` anından geriye sayar. */
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

/** Mikrofon ve kamerayı kullanan uygulamalar (Windows ConsentStore'dan, Rust). */
export function usePrivacy(): PrivacyState {
  const [p, setP] = useState<PrivacyState>({ mic: [], camera: [] });
  useEffect(() => {
    bridge.call("privacy_get").then(setP).catch(() => undefined);
    const off = bridge.on("privacy_changed", setP);
    return () => { off.then((f) => f()); };
  }, []);
  return p;
}

/** Bluetooth kulaklık bağlandı: olay gelince `ms` kadar (varsayılan 3 sn) dolu döner, sonra null. `pin` önizlemede kapanmasın diye. */
export function useBluetooth(pin = false, ms = 3000, initial: BluetoothEvent | null = null) {
  const [b, setB] = useState<BluetoothEvent | null>(initial);
  useEffect(() => { const off = bridge.on("bluetooth_connected", setB); return () => { off.then((f) => f()); }; }, []);
  useEffect(() => { if (!b || pin) return; const t = setTimeout(() => setB(null), ms); return () => clearTimeout(t); }, [b, pin, ms]);
  return [b, () => setB(null)] as const;
}

/**
 * Son girdi ve imleç. Rust `input_tick` yollar (GetLastInputInfo + imleç); gelene dek ve tarayıcı önizlemesinde sayfanın kendi fare/klavye olayları
 * taklit eder. `cursor` undefined = Rust beslemiyor (Mascot kendi pointermove'unu dinler).
 */
export function useInput() {
  const last = useRef({ at: Date.now(), tickAgo: null as number | null, tickAt: 0 });
  const [cursor, setCursor] = useState<InputTick["cursor"] | undefined>(undefined);
  // Windows sunum modu / meşgul: Rust yalnız değişince yollar, son değer kalır
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

/** Windows bildirim aynası (Dalga 6): kartlar ve `quiet` (sessizken hiçbir kart kendiliğinden açılmaz). */
export function useMirror(): MirrorView & { /** İlk liste geldi (sonrası "yeni" sayılır). */ ready: boolean } {
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
