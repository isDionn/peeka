// Fake back end used outside Tauri: realistic data, in-memory state, the same event path. Used by the preview and tests.
import type { AgentBridge, TrayIconX, CalendarNext, Alert, AssistantCounts, BridgeState, PermissionEvent, RecentItem, AlertsView, AllCommands, AllEvents, CallArgs, CommandName, Commands, ClipChange, ClipItem, ClipPlain, ComposerEvent, ConsentAnswer, LockState, MirrorState, MirrorView, Notice, TrayIcon, ShelfItem, TimerState, PrivacyState, ConsentRequest, ModuleEntry, PluginCommands, PluginInfo, SurfacesView, Media, MonitorInfo, PinnedApp, SearchResult, Settings, Status, SysmonTick, VolumeOsd, WindowInfo } from "./bridge";
import { APP_NAMES, iconOf } from "./fakeIcons";
import { EMPTY_SURFACES, MODULES, PLUGINS } from "./plugin.fixtures";

const DEFAULT_CALENDAR: CalendarNext = { detail: "2:45 PM, 30 min, video call", next: [{ time: "4:00 PM", title: "Weekly planning", source: "Calendar" }, { time: "6:00 PM", title: "Evening recap", source: "Assistant routine" }] };
const ref = (appId: string) => ({ appId, name: APP_NAMES[appId] ?? appId, icon: iconOf(appId) });
const ALL_APPS = ["explorer", "chrome", "vscode", "terminal", "spotify", "discord", "snip", "steam", "settings", "notepad", "calc", "word", "onedrive", "nvidia"];
// The 13 apps from ADR-0062 §2; those without an icon show a generic tile.
const EXCEPTION_APPS = ["word", "outlook", "outlook-new", "chrome", "edge", "firefox", "brave", "opera", "vivaldi", "slack", "discord", "vscode", "teams"];
const EXCEPTION_NAMES: Record<string, string> = { outlook: "Outlook", "outlook-new": "New Outlook", edge: "Edge", firefox: "Firefox", brave: "Brave", opera: "Opera", vivaldi: "Vivaldi", slack: "Slack", teams: "Teams" };

// drawn sample thumbnails (the real product gets real images)
const shot = (a: string, b: string, c: string) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><rect width="160" height="100" fill="${a}"/><rect width="160" height="10" fill="rgba(0,0,0,.35)"/><rect x="10" y="20" width="60" height="6" rx="3" fill="${c}"/><rect x="10" y="32" width="90" height="4" rx="2" fill="rgba(255,255,255,.35)"/><rect x="10" y="40" width="80" height="4" rx="2" fill="rgba(255,255,255,.2)"/><rect x="10" y="58" width="48" height="32" rx="5" fill="${b}"/><rect x="64" y="58" width="48" height="32" rx="5" fill="rgba(255,255,255,.12)"/></svg>`);
const art = (a: string, b: string, c: string) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="160" height="100" fill="url(#g)"/><circle cx="62" cy="34" r="22" fill="${c}" opacity=".8"/><path d="M0 74 Q40 56 80 70 T160 66 V100 H0Z" fill="rgba(20,10,60,.55)"/></svg>`);
/** Fake password for the preview and tests: only `clip_reveal` returns it; no list, event or log carries it. */
export const FAKE_SECRET = "Kd9!mPq2-zR7v";
const FILES: [string, string][] = [["screen-recording.mp4", "Desktop, 38 MB"], ["screenshot-1016.png", "Pictures"], ["q3-report.xlsx", "Documents"], ["presentation-draft.pdf", "Downloads"]];
const SETTINGS: [string, string][] = [["Display: scale and layout", "System"], ["Screen saver", "Personalization"], ["Notifications", "System"], ["Sound", "System"]];
const BRAIN: [string, string][] = [["Screen reader notes", "projects"], ["Meeting notes, October", "meetings"], ["October goals", "plans"]];

const lower = (s: string) => s.toLocaleLowerCase("en-US");
import { sortAlerts } from "./lib/alerts";

// drawn sample covers (the real product gets the SMTC cover)
const cover = (a: string, b: string, c: string) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="120" height="120" fill="url(#g)"/><circle cx="60" cy="52" r="20" fill="${c}"/><path d="M0 92 Q30 74 60 88 T120 84 V120 H0Z" fill="rgba(80,20,110,.7)"/></svg>`);
const TRACKS = [
  { title: "Night Train", artist: "Lowtide", album: "Shoreline", durationMs: 232_000, art: cover("#ffb347", "#ff5e62", "#fff1d6") },
  { title: "Blue Hour", artist: "June Avery", album: "Harbor", durationMs: 198_000, art: cover("#0b2a4a", "#0e7c86", "#9be3c4") },
];

type W4Names = "search_index_state" | "search_open" | "search_ask" | "clip_list" | "clip_copy" | "clip_pin" | "clip_delete" | "clip_clear" | "clip_reveal" | "clip_share" | "clip_edit" | "clip_drag" | "clip_visible" | "lock_state" | "lock_now" | "lock_release";
type W5Names = "window_preview" | "share_open" | "shelf_list" | "shelf_ask" | "timer_get" | "timer_start" | "timer_control" | "privacy_get" | "tray_open" | "mirror_state" | "mirror_enable" | "mirror_disable" | "mirror_list" | "mirror_dismiss" | "mirror_open_app" | "mirror_ask";
type W7Names = "recent_files" | "open_recent" | "start_pins" | "open_start_menu" | "quit_app" | "island_hide" | "island_hidden" | "tray_icons" | "assistant_counts" | "assistant_open" | "calendar_next" | "claude_bridge_state" | "claude_bridge_install" | "claude_bridge_remove" | "agent_bridges" | "agent_bridge_install" | "agent_bridge_remove" | "permission_history" | "first_connect_get" | "first_connect_ack" | "shelf_suggest" | "shelf_memory" | "assistant_start" | "composer_kinds" | "composer_scan" | "composer_attach_file" | "cc_focus_terminal" | "cc_diff" | "cc_diff_open" | "open_task_manager" | "focus_strip" | "focus_island" | "typing_focus";
/** Peeka Phase C: clipboard, download and copy-code commands; Settings > About demo restart. */
type W8Names = "demo_restart" | "notif_copy_code" | "clip_open" | "clip_to_shelf" | "clip_preview" | "download_open" | "download_show_in_folder";
const svg = (inner: string) => "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</g></svg>`);
const GLYPH = {
  bluetooth: svg('<path d="m7 7 10 10-5 5V2l5 5L7 17"/>'),
  shield: svg('<path d="M12 3 5 6v5c0 4.4 2.9 8.2 7 10 4.1-1.8 7-5.6 7-10V6z"/><path d="m9 12 2 2 4-4"/>'),
  usb: svg('<circle cx="10" cy="19" r="2"/><path d="M10 17V7m0 0-3 3m3-3 3 3M12 12h5v-2"/><rect x="15" y="7" width="4" height="3"/>'),
};
/** Rust gives no badge count; the fake puts one on Discord so badge drawing (when `badge` exists) can be tested. */
const trayX = (id: string, name: string, icon: string, promoted = false, badge?: number): TrayIconX => ({ id: "exe:c:/apps/" + id + ".exe", name, exe: "C:/apps/" + id + ".exe", promoted, icon, ...(badge ? { badge } : null) });
const TRAY_X: TrayIconX[] = [
  trayX("discord", "Discord", iconOf("discord"), true, 3), trayX("steam", "Steam", iconOf("steam")), trayX("onedrive", "OneDrive", iconOf("onedrive"), true),
  trayX("nvidia", "NVIDIA", iconOf("nvidia")), trayX("spotify", "Spotify", iconOf("spotify")),
  trayX("bluetooth", "Bluetooth", GLYPH.bluetooth), trayX("security", "Windows Security", GLYPH.shield), trayX("usb", "Safely Remove Hardware", GLYPH.usb),
];
const RECENT: RecentItem[] = [
  { id: "r0", name: "presentation-draft.pdf", sub: "Just now", kind: "pdf" }, { id: "r1", name: "q3-report.xlsx", sub: "Yesterday", kind: "sheet" },
  { id: "r2", name: "screen-recording.mp4", sub: "2m ago", kind: "video" }, { id: "r3", name: "meeting-notes.docx", sub: "3h ago", kind: "other" },
  { id: "r4", name: "cover-draft.png", sub: "4d ago", kind: "image" },
];
const TRAY: TrayIcon[] = [
  { id: "exe:c:/apps/discord.exe", name: "Discord", exe: "C:/apps/Discord.exe", promoted: true, icon: "" },
  { id: "exe:c:/apps/steam.exe", name: "Steam", exe: "C:/apps/Steam.exe", promoted: false, icon: "" },
  { id: "exe:c:/apps/onedrive.exe", name: "OneDrive", exe: "C:/apps/OneDrive.exe", promoted: false, icon: "" },
];

export function createFakeBridge(opts: { now?: Date; battery?: boolean } = {}) {
  const fixed = opts.now;
  const hasBattery = opts.battery ?? true;
  let pins: string[] = [];
  let windows: WindowInfo[] = [];
  let status: Status;
  let settings: Settings;
  const listeners = new Map<string, Set<(p: never) => void>>();
  let track = 0;
  let media: Media | null = null;
  let alerts: Alert[] = [];
  let sysmonTimer: ReturnType<typeof setInterval> | null = null;
  let sysmonRuns = 0;
  let clips: ClipItem[] = [];
  let lock: LockState = { locked: false, reason: null };
  let hidden = false;
  let firstConnect = false;
  let calendar: CalendarNext = structuredClone(DEFAULT_CALENDAR);
  let bridgeState: BridgeState = { installed: true, healthy: true, lastEventAgoS: 120 };
  const AGENTS0: AgentBridge[] = [
    { id: "codex", name: "Codex CLI", file: "~\\.codex\\hooks.json", present: true, installed: false, healthy: false, lastEventAgoS: null },
    { id: "cursor", name: "Cursor", file: "~\\.cursor\\hooks.json", present: false, installed: false, healthy: false, lastEventAgoS: null },
    { id: "gemini", name: "Gemini CLI", file: "~\\.gemini\\settings.json", present: true, installed: false, healthy: false, lastEventAgoS: null },
    { id: "copilot", name: "GitHub Copilot CLI", file: "~\\.copilot\\hooks\\peeka.json", present: false, installed: false, healthy: false, lastEventAgoS: null },
  ];
  let agents = structuredClone(AGENTS0);
  const setAgent = (id: string, on: boolean) => { const a = agents.find((x) => x.id === id); if (!a) throw "unknown"; a.installed = on; a.healthy = on; return { ...a }; };
  const nowMs = () => (fixed ?? new Date()).getTime();

  const reset = () => {
    pins = ["explorer", "chrome", "vscode", "steam"];
    const w = (hwnd: number, appId: string, title: string, active = false, monitor = "m1"): WindowInfo => ({ ...ref(appId), hwnd, title, active, monitor });
    windows = [
      w(1, "explorer", "Screenshots"), w(2, "chrome", "Weather, Seattle", true), w(3, "chrome", "Docs, Q3 report"),
      w(4, "vscode", "Header.tsx, website"), w(5, "terminal", "PowerShell"), w(6, "spotify", "Night Train, Lowtide"), w(7, "discord", "general"),
      w(8, "notepad", "notes.txt", false, "m2"),
    ];
    status = {
      volume: 64, muted: false, brightness: 80,
      wifi: { on: true, name: "Home-5G" }, bluetooth: { on: true, name: "Buds Pro" }, dnd: false,
      dndUntil: null, network: "internet",
      battery: hasBattery ? { percent: 78, charging: false, plugged: false, remaining: "3h 10m" } : null,
    };
    track = 0;
    media = { app: "Spotify", ...TRACKS[0], playing: true, positionMs: 84_000, positionAt: Date.now(), canPrevious: true, canNext: true, canSeek: true };
    const old = (id: string, title: string, subtitle: string, icon: string, ago: number, extra: Partial<Alert> = {}): Alert =>
      ({ id, title, subtitle, icon, color: null, progress: null, priority: 50, action: null, style: "standard", expand: false, kind: "alert", source: "api", expiresAt: null, updatedAt: nowMs() - ago * 1000, review: null, ...extra });
    alerts = [
      old("report", "Report ready", "Weekly summary added to Notes", "done", 180),
      old("disk", "Disk 91% full", "Temporary files can be cleaned up", "warning", 420, { review: { title: "Delete temporary files?", detail: "Frees 4.3 GB; files skip the Recycle Bin", items: [{ name: "Windows temporary files", size: "3.2 GB" }, { name: "Browser cache", size: "1.1 GB" }] } }),
      old("discord", "Sam: Does 8 tonight work?", "Discord, Windows notification", "chat", 720),
      old("recap", "Evening recap at 6:00 PM", "Assistant routine", "clock", 3 * 3600),
    ];
    const MIN = 60_000;
    const plain = (id: string, kind: ClipPlain["kind"], ago: number, x: Partial<ClipPlain>): ClipPlain =>
      ({ id, kind, text: null, sub: null, thumb: null, source: null, createdAt: nowMs() - ago * MIN, pinned: false, screenshot: false, ...x });
    clips = [
      plain("c1", "image", 2, { sub: "Screen snip", thumb: shot("#1d2433", "#3A7BFF", "#FFD60A"), screenshot: true }),
      plain("c2", "image", 18, { sub: "beach.jpg", thumb: art("#0b2a4a", "#0e7c86", "#9be3c4") }),
      plain("c3", "image", 60, { sub: "Screen snip", thumb: shot("#f2f2f4", "#30D158", "#1d1d1f"), screenshot: true }),
      plain("c4", "image", 180, { sub: "cover-draft.png", thumb: art("#ffb347", "#ff5e62", "#fff1d6") }),
      plain("c5", "file", 5, { text: "presentation-draft.pdf", sub: "2.4 MB, Downloads" }),
      { id: "c6", kind: "password", source: "Bitwarden", createdAt: nowMs() - 7 * MIN, expiresAt: nowMs() - 7 * MIN + 60 * MIN, pinned: false },
      plain("c7", "text", 9, { text: "example.com/reports/q3-summary", hint: "link" }),
      plain("c8", "text", 14, { text: "Meeting note: budget gets locked in by Friday" }),
      plain("c9", "file", 40, { text: "screen-recording.mp4", sub: "38 MB, Desktop" }),
      plain("c10", "text", 60, { text: "#3A7BFF", hint: "color" }),
      plain("c11", "text", 180, { text: "git switch -c feature/notch", hint: "command" }),
    ];
    lock = { locked: false, reason: null };
    hidden = false; firstConnect = false; calendar = structuredClone(DEFAULT_CALENDAR); bridgeState = { installed: true, healthy: true, lastEventAgoS: 120 };
    settings = {
      autostart: true, taskbarHide: "full", clipHistory: true, clipMedia: true, clipPasswordMin: 60,
      secondaryStrips: true, captureVolumeKeys: true, alertsApi: false, mascotPranks: true, celebrate: true, watchDownloads: true, colorIcons: false,
      shortcuts: { search: "Ctrl+K", ask: "Ctrl+Space", focus_island: "Ctrl+Shift+Enter", hide_island: "Ctrl+Shift+A", emergency: "Ctrl+Alt+Shift+T" },
      shortcutExceptions: EXCEPTION_APPS.map((appId) => ({ ...ref(appId), name: APP_NAMES[appId] ?? EXCEPTION_NAMES[appId] ?? appId, keys: appId === "vscode" ? "Ctrl+K, Ctrl+Space" : "Ctrl+K" })),
    };
  };
  reset();

  const view = (): AlertsView => { const items = sortAlerts(alerts.filter((a) => a.expiresAt === null || a.expiresAt > Date.now())); return { items, top: items.find((a) => a.expand)?.id ?? null, dropStripMs: null }; };
  const mediaNow = (): Media | null => (media ? { ...media } : null);
  const emit = <E extends keyof AllEvents>(e: E, p: AllEvents[E]) => listeners.get(e)?.forEach((f) => f(p as never));
  const pinned = (): PinnedApp[] => pins.map(ref);
  let nextHwnd = 100;
  const handlers: { [K in Exclude<CommandName, W4Names | W5Names | W7Names | W8Names>]: (a: Commands[K]["args"]) => Commands[K]["ret"] } = {
    get_monitor: ({ monitor }): MonitorInfo => ({ id: monitor, primary: monitor === "m1", hasBattery, radios: "ok", brightness: true, user: "Local account", hz: 144 }),
    list_windows: () => windows.map((w) => ({ ...w })), // like Rust: every strip lists every monitor's windows
    get_pins: pinned,
    set_pins: ({ appIds }) => { pins = [...appIds]; emit("pins_changed", null); return pinned(); },
    activate_window: ({ hwnd }) => { windows.forEach((w) => (w.active = w.hwnd === hwnd)); emit("windows_changed", { monitor: windows.find((w) => w.hwnd === hwnd)?.monitor ?? "m1" }); },
    close_window: ({ hwnd }) => { const m = windows.find((w) => w.hwnd === hwnd)?.monitor ?? "m1"; windows = windows.filter((w) => w.hwnd !== hwnd); emit("windows_changed", { monitor: m }); },
    new_window: ({ appId }) => { windows.push({ ...ref(appId), hwnd: nextHwnd++, title: ref(appId).name, active: false, monitor: "m1" }); emit("windows_changed", { monitor: "m1" }); },
    launch_app: ({ appId }) => { windows.forEach((w) => (w.active = false)); windows.push({ ...ref(appId), hwnd: nextHwnd++, title: ref(appId).name, active: true, monitor: "m1" }); emit("windows_changed", { monitor: "m1" }); },
    list_apps: () => ALL_APPS.map(ref).sort((a, b) => a.name.localeCompare(b.name, "en-US")),
    search: ({ query }) => {
      const t = lower(query.trim());
      const apps: SearchResult[] = ALL_APPS.map(ref).filter((a) => !t || lower(a.name).includes(t)).map((a) => ({ id: "app:" + a.appId, kind: "app", title: a.name, subtitle: "App", appId: a.appId, icon: a.icon, hwnd: null }));
      const wins: SearchResult[] = windows.filter((w) => !t || lower(w.title).includes(t) || lower(w.name).includes(t)).map((w) => ({ id: "win:" + w.hwnd, kind: "window", title: w.title, subtitle: w.name, appId: w.appId, icon: w.icon, hwnd: w.hwnd }));
      const other = (kind: "file" | "setting", rows: [string, string][]): SearchResult[] => rows.map(([title, sub]) => ({ id: kind + ":" + title, kind, title, subtitle: sub, appId: "", icon: "", hwnd: null }));
      const files = other("file", FILES), sets = other("setting", SETTINGS);
      const main = plugins.find((x) => x.main && x.connected);
      const notes: SearchResult[] = main ? BRAIN.map(([title, sub]) => ({ id: "plug:" + main.id + ":" + title, kind: "plugin", title, subtitle: sub, appId: "", icon: "", hwnd: null, plugin: { id: main.id, name: main.name, main: true }, group: "Notes" })) : [];
      if (t) {
        const has = (r: SearchResult) => lower(r.title).includes(t);
        return [...apps.slice(0, 3), ...wins.slice(0, 3), ...(filesIndex ? files.filter(has) : []).slice(0, 3), ...sets.filter(has).slice(0, 3), ...notes.filter(has).slice(0, 3)];
      }
      return [apps.find((a) => a.appId === "vscode"), wins[1], filesIndex ? files[3] : undefined, sets[0]].filter((r): r is SearchResult => !!r);
    },
    open_result: ({ id }) => { if (id.startsWith("win:")) handlers.activate_window({ hwnd: +id.slice(4) }); else handlers.launch_app({ appId: id.slice(4) }); },
    get_status: () => ({ ...status }),
    set_volume: ({ value }) => { status = { ...status, volume: value, muted: value === 0 }; emit("status_changed", status); },
    set_brightness: ({ value }) => { status = { ...status, brightness: value }; emit("status_changed", status); },
    set_radio: ({ kind, on }) => {
      status = kind === "wifi" ? { ...status, wifi: { on, name: on ? "Home-5G" : null } } : { ...status, bluetooth: { on, name: on ? "Buds Pro" : null } };
      emit("status_changed", status);
    },
    set_dnd: ({ on }) => { status = { ...status, dnd: on }; emit("status_changed", status); },
    open_windows_settings: () => undefined,
    open_tray: () => structuredClone(TRAY),
    power: () => undefined,
    restore_taskbar: () => undefined,
    quit: () => undefined,
    get_settings: () => structuredClone(settings),
    set_settings: ({ patch }) => {
      const sc = patch.shortcuts;
      if (sc) { const used = Object.values({ ...settings.shortcuts, ...sc }); if (new Set(used).size !== used.length) return { ok: false, error: "This shortcut is already used for something else." }; }
      settings = { ...settings, ...patch, shortcuts: { ...settings.shortcuts, ...sc } };
      emit("settings_changed", structuredClone(settings));
      return { ok: true, error: null };
    },
    get_media: () => mediaNow(),
    media_control: ({ action, positionMs }) => {
      if (!media) return;
      const at = Date.now(), pos = media.playing ? media.positionMs + (at - media.positionAt) : media.positionMs;
      if (action === "play_pause") media = { ...media, playing: !media.playing, positionMs: pos, positionAt: at };
      else if (action === "seek") media = { ...media, positionMs: positionMs ?? 0, positionAt: at };
      else { track = (track + (action === "next" ? 1 : TRACKS.length - 1)) % TRACKS.length; media = { ...media, ...TRACKS[track], positionMs: 0, positionAt: at }; }
      emit("media_changed", mediaNow());
    },
    list_alerts: () => view(),
    open_alert: () => undefined,
    dismiss_alert: ({ id }) => { alerts = alerts.filter((a) => a.id !== id); emit("alerts_changed", view()); },
    clear_alerts: () => { alerts = []; emit("alerts_changed", view()); },
    sysmon_start: () => {
      sysmonRuns++;
      if (sysmonTimer) return;
      let cpu = 23;
      const GB = 1024 ** 3;
      const tick = () => { cpu = Math.max(8, Math.min(70, cpu + (Math.random() - 0.5) * 14)); emit("sysmon_tick", { cpu: Math.round(cpu), memUsed: 18.2 * GB, memTotal: 32 * GB, gpu: 11, down: 120_000, up: 30_000, topCpu: "chrome" } satisfies SysmonTick); };
      tick(); sysmonTimer = setInterval(tick, 1000);
    },
    sysmon_stop: () => { if (sysmonTimer) clearInterval(sysmonTimer); sysmonTimer = null; },
    report_hit_rects: () => undefined,
    taskbar_set_mode: ({ mode }) => { settings = { ...settings, taskbarHide: mode }; emit("settings_changed", structuredClone(settings)); },
  };

  /* ---- plugin surfaces (plugin-api.ts): in-memory state, the owner's clicks land in `log` ---- */
  let surfaces: SurfacesView = EMPTY_SURFACES;
  let consent: ConsentRequest | null = null;
  let plugins: PluginInfo[] = structuredClone(PLUGINS);
  let modules: ModuleEntry[] = structuredClone(MODULES);
  let turn = 0;
  const log: { cmd: string; args: unknown }[] = [];
  const setSurfaces = (v: Partial<SurfacesView>) => { surfaces = { ...EMPTY_SURFACES, ...v }; emit("plugin_surfaces_changed", surfaces); };
  const plug: { [K in keyof PluginCommands]: (a: PluginCommands[K]["args"]) => PluginCommands[K]["ret"] } = {
    plugin_surfaces: () => surfaces,
    plugin_action: (a) => { log.push({ cmd: "plugin_action", args: a }); },
    approval_answer: (a) => { log.push({ cmd: "approval_answer", args: a }); setSurfaces({ ...surfaces, approvals: surfaces.approvals.filter((x) => x.id !== a.id), approvalTop: null }); },
    composer_submit: (a) => {
      log.push({ cmd: "composer_submit", args: a });
      const t = ++turn;
      const ev = (e: Omit<ComposerEvent, "turn">, ms: number) => setTimeout(() => emit("composer_event", { turn: t, ...e }), ms);
      ev({ kind: "delta", text: "OK. I'll remind you about the 9:30 AM design review " }, 60);
      ev({ kind: "delta", text: "at 9:15." }, 160);
      ev({ kind: "chip", label: "Read 3 notes", chipKind: "source" }, 220);
      ev({ kind: "chip", label: "Reminder 9:15 AM", chipKind: "reminder" }, 260);
      ev({ kind: "done" }, 300);
      return { turn: t };
    },
    composer_voice: () => { log.push({ cmd: "composer_voice", args: null }); },
    consent_get: () => consent,
    consent_answer: (a: ConsentAnswer) => { log.push({ cmd: "consent_answer", args: a }); consent = null; emit("consent_changed", null); },
    plugin_list: () => structuredClone(plugins),
    plugin_set_scope: ({ id, scope, on }) => {
      plugins = plugins.map((p) => (p.id === id ? { ...p, scopes: p.scopes.map((s) => (s.scope === scope ? { ...s, granted: on } : s)) } : p));
      emit("plugins_changed", null);
    },
    plugin_set_main: ({ id }) => { plugins = plugins.map((p) => ({ ...p, main: p.id === id })); emit("plugins_changed", null); },
    plugin_disconnect: ({ id }) => { plugins = plugins.map((p) => (p.id === id ? { ...p, connected: false } : p)); emit("plugins_changed", null); },
    plugin_remove: ({ id }) => { plugins = plugins.filter((p) => p.id !== id); emit("plugins_changed", null); },
    modules_get: () => structuredClone(modules),
    modules_set: ({ order, off }) => {
      modules = order.map((id) => modules.find((m) => m.id === id)).filter((m): m is ModuleEntry => !!m).map((m) => ({ ...m, on: !off.includes(m.id) }));
    },
  };

  /* ---- Wave 4: clipboard, lock, search helpers (bridge.ts) ---- */
  let filesIndex = true;
  const unlocked = () => clips.filter((c) => !lock.locked || c.kind !== "password");
  const find = (id: string) => clips.find((c) => c.id === id);
  const deny = (): never => { throw "denied"; };
  const clipEmit = (c: ClipChange) => emit("clip_changed", c);
  const clip: { [K in W4Names]: (a: Commands[K]["args"]) => Commands[K]["ret"] } = {
    search_index_state: () => ({ files: filesIndex ? "on" : "off" }),
    search_open: ({ id }) => { if (id.startsWith("win:") || id.startsWith("app:")) handlers.open_result({ id }); else log.push({ cmd: "search_open", args: { id } }); },
    search_ask: (a) => { if (!plugins.some((x) => x.main && x.connected)) throw "not_connected"; log.push({ cmd: "search_ask", args: a }); return { turn: ++turn }; },
    clip_list: () => structuredClone(unlocked()).sort((a, b) => +b.pinned - +a.pinned || b.createdAt - a.createdAt),
    clip_copy: (a) => { const c = find(a.id); if (!c || (lock.locked && c.kind === "password")) deny(); log.push({ cmd: "clip_copy", args: a }); },
    clip_pin: (a) => { const c = find(a.id); if (!c || c.kind === "password") deny(); clips = clips.map((x) => (x.id === a.id ? { ...x, pinned: a.on } : x)); log.push({ cmd: "clip_pin", args: a }); clipEmit({ reason: "updated", item: find(a.id) ?? null }); },
    clip_delete: (a) => { const c = find(a.id); clips = clips.filter((x) => x.id !== a.id); log.push({ cmd: "clip_delete", args: a }); clipEmit({ reason: "removed", item: c ?? null }); },
    clip_clear: (a) => { const only = !!a?.passwords; clips = only ? clips.filter((c) => c.kind !== "password") : []; log.push({ cmd: "clip_clear", args: a ?? null }); clipEmit({ reason: "cleared", item: null }); },
    clip_reveal: (a) => { const c = find(a.id); if (!c || c.kind !== "password" || lock.locked) deny(); log.push({ cmd: "clip_reveal", args: a }); return { text: FAKE_SECRET, ttlMs: 5000 }; },
    clip_share: (a) => { const c = find(a.id); if (!c || c.kind === "password") deny(); if (!plugins.some((x) => x.main && x.connected)) throw "not_connected"; log.push({ cmd: "clip_share", args: a }); },
    clip_edit: (a) => { log.push({ cmd: "clip_edit", args: a }); },
    clip_drag: (a) => { log.push({ cmd: "clip_drag", args: a }); },
    clip_visible: (a) => { log.push({ cmd: "clip_visible", args: a }); return a.on; },
    lock_state: () => ({ ...lock }),
    lock_now: () => { lock = { locked: true, reason: "manual" }; emit("lock_changed", { ...lock }); },
    lock_release: () => { log.push({ cmd: "lock_release", args: null }); if (lock.reason !== "windows") { lock = { locked: false, reason: null }; emit("lock_changed", { ...lock }); } },
  };

  /* ---- Wave 5: window preview, share, shelf, timer, privacy (bridge.ts) ---- */
  let shelf: ShelfItem[] = [];
  let timer: TimerState | null = null;
  let privacy: PrivacyState = { mic: [], camera: [] };
  let mirror: MirrorState = { devMode: true, registered: true, access: "allowed", enabled: false, on: false, blocker: null };
  let notices: Notice[] = [];
  let scanDenied = false;
  let quiet = false;
  const mirrorView = (): MirrorView => ({ items: structuredClone(notices), quiet });
  const mirrorEmit = () => emit("notifications_changed", mirrorView());
  const mirrorSet = (p: Partial<MirrorState>) => {
    const m = { ...mirror, ...p };
    mirror = { ...m, blocker: !m.devMode ? "dev_mode_off" : !m.registered ? "not_registered" : m.access === "denied" ? "access_denied" : null };
    mirror.on = mirror.enabled && !mirror.blocker;
    return { ...mirror };
  };
  const w5: { [K in W5Names]: (a: Commands[K]["args"]) => Commands[K]["ret"] | Promise<Commands[K]["ret"]> } = {
    window_preview: async ({ hwnd }) => {
      log.push({ cmd: "window_preview", args: { hwnd } });
      if (previewDelay) await new Promise((r) => setTimeout(r, previewDelay));
      const tones: [string, string, string][] = [["#f3f4f6", "#dfe6f3", "#3A7BFF"], ["#1f2937", "#111827", "#64D2FF"], ["#0b2a4a", "#0e7c86", "#9be3c4"]];
      const [a, b, c] = tones[hwnd % tones.length];
      return shot(a, b, c);
    },
    share_open: (a) => { if (!shelf.some((x) => x.id === a.id)) deny(); log.push({ cmd: "share_open", args: a }); },
    shelf_list: () => structuredClone(shelf),
    shelf_ask: (a) => { if (!plugins.some((x) => x.main && x.connected)) throw "not_connected"; log.push({ cmd: "shelf_ask", args: a }); },
    timer_get: () => (timer ? { ...timer } : null),
    timer_control: ({ action }) => {
      log.push({ cmd: "timer_control", args: { action } });
      if (!timer) return;
      const left = timer.running ? Math.max(0, timer.remainingS - (Date.now() - timer.at) / 1000) : timer.remainingS;
      timer = action === "stop" ? null : { ...timer, remainingS: action === "add5" ? left + 300 : left, running: action === "resume" ? true : action === "pause" ? false : timer.running, at: Date.now() };
      emit("timer_changed", timer ? { ...timer } : null);
    },
    privacy_get: () => ({ mic: [...privacy.mic], camera: [...privacy.camera] }),
    timer_start: ({ label, seconds }) => {
      log.push({ cmd: "timer_start", args: { label, seconds } });
      if (!(seconds >= 1 && seconds <= 86400)) throw "invalid";
      timer = { label: label.trim().slice(0, 40), totalS: seconds, remainingS: seconds, running: true, at: Date.now() };
      emit("timer_changed", { ...timer });
      return { ...timer };
    },
    tray_open: (a) => { if (!TRAY.some((t) => t.id === a.id)) throw "unknown"; log.push({ cmd: "tray_open", args: a }); },
    mirror_state: () => ({ ...mirror }),
    mirror_enable: () => { const s = mirrorSet({ enabled: true }); log.push({ cmd: "mirror_enable", args: null }); return s; },
    mirror_disable: () => { const s = mirrorSet({ enabled: false }); log.push({ cmd: "mirror_disable", args: null }); return s; },
    mirror_list: mirrorView,
    mirror_dismiss: (a) => { notices = notices.filter((n) => n.id !== a.id); log.push({ cmd: "mirror_dismiss", args: a }); mirrorEmit(); },
    mirror_open_app: (a) => { if (!notices.some((n) => n.id === a.id && n.canOpen)) throw "unknown"; log.push({ cmd: "mirror_open_app", args: a }); notices = notices.filter((n) => n.id !== a.id); mirrorEmit(); },
    mirror_ask: (a) => {
      if (lock.locked) throw "denied";
      if (!plugins.some((x) => x.main && x.connected)) throw "not_connected";
      log.push({ cmd: "mirror_ask", args: a });
      const t = ++turn;
      // The assistant drafts a reply: it streams as a chat event (the top-right card's draft view reads it)
      setTimeout(() => { emit("composer_event", { turn: t, kind: "delta", text: "Sure, 8 works. See you then." }); emit("composer_event", { turn: t, kind: "done" }); }, 150);
      return { turn: t };
    },
  };
  let previewDelay = 0;

  /* Fidelity 3 (mirrors Rust `commands.rs`) */
  /** Preview/test: downloads reported by Rust (id -> name). */
  const downloads = new Map<string, string>();
  const w8: { [K in W8Names]: (a: Commands[K]["args"]) => Commands[K]["ret"] } = {
    // The real app restarts; the fake just flips the mode so the preview shows the other state.
    demo_restart: (a) => { log.push({ cmd: "demo_restart", args: a }); settings = { ...settings, demo: a.on }; emit("settings_changed", structuredClone(settings)); },
    notif_copy_code: (a) => { if (lock.locked) throw "denied"; if (!notices.some((n) => n.id === a.id && n.hasCode)) throw "missing"; log.push({ cmd: "notif_copy_code", args: a }); },
    clip_open: (a) => { const c = find(a.id); if (!c || lock.locked || c.kind === "password") throw "denied"; if (c.kind === "text") throw "invalid"; log.push({ cmd: "clip_open", args: a }); },
    clip_to_shelf: (a) => { const c = find(a.id); if (!c || lock.locked || c.kind === "password") throw "denied"; if (c.kind === "text") throw "invalid"; log.push({ cmd: "clip_to_shelf", args: a }); emit("shelf_changed", null); },
    clip_preview: (a) => { const c = find(a.id); if (!c || lock.locked || c.kind === "password") throw "denied"; if (c.kind !== "image") throw "invalid"; log.push({ cmd: "clip_preview", args: a }); return c.thumb ?? ""; },
    download_open: (a) => { if (lock.locked) throw "denied"; if (/\.(exe|bat|cmd|ps1|lnk|msi)$/i.test(downloads.get(a.id) ?? "")) throw "denied"; if (!downloads.has(a.id)) throw "missing"; log.push({ cmd: "download_open", args: a }); },
    download_show_in_folder: (a) => { if (lock.locked) throw "denied"; if (!downloads.has(a.id)) throw "missing"; log.push({ cmd: "download_show_in_folder", args: a }); },
  };

  const w7: { [K in W7Names]: (a: Commands[K]["args"]) => Commands[K]["ret"] } = {
    recent_files: () => structuredClone(RECENT),
    open_recent: (a) => { log.push({ cmd: "open_recent", args: a }); },
    // Windows 11 doesn't expose Start pins: Rust always returns empty and the page falls back to its own list.
    start_pins: () => [],
    open_start_menu: () => { log.push({ cmd: "open_start_menu", args: null }); },
    quit_app: (a) => { log.push({ cmd: "quit_app", args: a }); },
    island_hide: ({ on }) => { log.push({ cmd: "island_hide", args: { on } }); hidden = on; emit("island_hidden_changed", on); },
    island_hidden: () => hidden,
    tray_icons: () => structuredClone(TRAY_X),
    assistant_counts: (): AssistantCounts => ({ jobs: 2, memory: 3, approvals: 1 }),
    assistant_open: (a) => { log.push({ cmd: "assistant_open", args: a }); },
    calendar_next: () => structuredClone(calendar),
    claude_bridge_state: () => ({ ...bridgeState }),
    // Like Rust: `refused` in demo mode; install on a manual click points at this Peeka, remove deletes only Peeka's own entries.
    claude_bridge_install: () => { if (settings.demo) throw "refused"; log.push({ cmd: "claude_bridge_install", args: null }); bridgeState = { ...bridgeState, installed: true, healthy: true }; return { ...bridgeState }; },
    claude_bridge_remove: () => { if (settings.demo) throw "refused"; log.push({ cmd: "claude_bridge_remove", args: null }); bridgeState = { ...bridgeState, installed: false, healthy: false }; return { ...bridgeState }; },
    agent_bridges: () => structuredClone(agents),
    agent_bridge_install: ({ agent }) => { if (settings.demo) throw "refused"; log.push({ cmd: "agent_bridge_install", args: { agent } }); return setAgent(agent, true); },
    agent_bridge_remove: ({ agent }) => { if (settings.demo) throw "refused"; log.push({ cmd: "agent_bridge_remove", args: { agent } }); return setAgent(agent, false); },
    permission_history: (): PermissionEvent[] => {
      const now = Date.now();
      return [
        { at: now - 2 * 60_000, plugin: "Compass", scope: "approvals.prompt", granted: true },
        { at: now - 3 * 3600_000, plugin: "Compass", scope: "windows.read", granted: true },
        { at: now - 26 * 3600_000, plugin: "Compass", scope: "clipboard.read", granted: false },
      ];
    },
    first_connect_get: () => firstConnect,
    first_connect_ack: () => { firstConnect = false; },
    shelf_suggest: ({ id }) => (shelf.find((f) => f.id === id)?.kind === "pdf" ? { id, text: "This looks like a presentation draft. Want me to summarize it into Notes?" } : null),
    shelf_memory: (a) => { log.push({ cmd: "shelf_memory", args: a }); },
    assistant_start: () => { log.push({ cmd: "assistant_start", args: null }); },
    // `window_image` is `not_yet` in Rust: not offered.
    composer_kinds: () => ["screen_image", "file", "clipboard_link", "shelf"],
    composer_scan: () => { if (scanDenied) throw "denied"; return { kind: "screen_image", label: "Screenshot" }; },
    open_task_manager: () => { log.push({ cmd: "open_task_manager", args: undefined }); },
    focus_strip: (a) => { log.push({ cmd: "focus_strip", args: a }); },
    focus_island: () => { log.push({ cmd: "focus_island", args: undefined }); },
    typing_focus: (a) => { log.push({ cmd: "typing_focus", args: a }); },
    cc_focus_terminal: (a) => { if (settings.demo) throw "unsupported"; if (a.sessionId === "none") throw "unknown"; if (!plugins.some((x) => x.main && x.connected)) throw "not_connected"; log.push({ cmd: "cc_focus_terminal", args: a }); },
    composer_attach_file: () => ({ kind: "file", label: "q3-report.xlsx" }),
    cc_diff: (a) => { if (lock.locked) throw "denied"; if (a.sid === "none") throw "missing"; return { file: "src/lib/notes.ts", add: 2, del: 1, lines: [" export const ccLimit = (on: boolean) =>", "-  on;", "+  on && !resumed;", "+// resumes on the next stop"], more: 0 }; },
    cc_diff_open: (a) => { if (lock.locked) throw "denied"; log.push({ cmd: "cc_diff_open", args: a }); },
  };

  const fake = {
    async call<K extends keyof AllCommands>(cmd: K, ...args: CallArgs<K>) {
      const h = (cmd in w8 ? w8 : cmd in w7 ? w7 : cmd in plug ? plug : cmd in clip ? clip : cmd in w5 ? w5 : handlers) as Record<string, (a: unknown) => unknown>;
      return h[cmd]((args[0] ?? undefined) as never) as AllCommands[K]["ret"];
    },
    async on<E extends keyof AllEvents>(evt: E, cb: (p: AllEvents[E]) => void) {
      const set = listeners.get(evt) ?? new Set();
      set.add(cb as never); listeners.set(evt, set);
      return () => { set.delete(cb as never); };
    },
    now: () => fixed ?? new Date(),
    reset: () => { reset(); filesIndex = true; scanDenied = false; surfaces = EMPTY_SURFACES; consent = null; shelf = []; timer = null; privacy = { mic: [], camera: [] }; previewDelay = 0; mirror = { devMode: true, registered: true, access: "allowed", enabled: false, on: false, blocker: null }; notices = []; quiet = false; agents = structuredClone(AGENTS0); plugins = structuredClone(PLUGINS); modules = structuredClone(MODULES); log.length = 0; turn = 0; },
    /** Test and preview hooks: trigger by hand what Rust would do. */
    emit,
    /** Fidelity 3: the main assistant's bridge state and the "first connection" card. */
    setBridge: (s: BridgeState) => { bridgeState = s; },
    setCalendar: (c: CalendarNext) => { calendar = c; },
    setFirstConnect: (v: boolean) => { firstConnect = v; },
    setSurfaces,
    /** Set a consent window request (`expiresAt` defaults to now + 112 s). */
    setConsent: (c: ConsentRequest | null) => { consent = c && { ...c, expiresAt: c.expiresAt || Date.now() + 112_000 }; emit("consent_changed", null); },
    /** The owner's clicks (answers sent to the plugin). */
    log,
    pluginsNow: () => structuredClone(plugins),
    /** Preview/test: window list (many windows, long title measurements). */
    setWindows: (list: WindowInfo[]) => { windows = structuredClone(list); for (const m of new Set(windows.map((w) => w.monitor))) emit("windows_changed", { monitor: m }); },
    setMedia: (m: Media | null) => { media = m; emit("media_changed", mediaNow()); },
    pushAlert: (a: Partial<Alert> & { id: string; title: string }) => {
      alerts = [...alerts.filter((x) => x.id !== a.id), { subtitle: null, icon: null, color: null, progress: null, priority: 50, action: null, style: "standard", expand: true, kind: "alert", source: "api", expiresAt: null, updatedAt: nowMs(), review: null, ...a }];
      emit("alerts_changed", view());
    },
    volumeOsd: (v: VolumeOsd) => emit("volume_osd", v),
    get sysmonRuns() { return sysmonRuns; },
    get sysmonOn() { return sysmonTimer !== null; },
    /** Commands the fake handles (test: same as the Rust list?). */
    commands: Object.keys({ ...handlers, ...plug, ...clip, ...w5, ...w7, ...w8 }) as string[],
    /** Preview and tests: trigger Rust's clipboard, lock and index events by hand. */
    setLocked: (locked: boolean, reason: LockState["reason"] = locked ? "windows" : null) => { lock = { locked, reason: locked ? reason : null }; emit("lock_changed", { ...lock }); },
    setFilesIndex: (on: boolean) => { filesIndex = on; },
    /** Sensitive window: `composer_scan` returns `denied`. */
    setScanDenied: (on: boolean) => { scanDenied = on; },
    setPlugins: (list: PluginInfo[]) => { plugins = structuredClone(list); emit("plugins_changed", null); },
    /** Wave 5 hooks: trigger Rust's timer, shelf and privacy events by hand; `previewDelay` mimics preview load time. */
    /** Fidelity hook: change status fields (quiet, end time) by hand. */
    setStatus: (p: Partial<Status>) => { status = { ...status, ...p }; emit("status_changed", { ...status }); },
    setBattery: (b: Status["battery"]) => { status = { ...status, battery: b }; emit("status_changed", { ...status }); },
    setTimer: (t: Omit<TimerState, "at"> | null) => { timer = t && { ...t, at: Date.now() }; emit("timer_changed", timer ? { ...timer } : null); },
    setShelf: (list: ShelfItem[]) => { shelf = structuredClone(list); emit("shelf_changed", null); },
    setPrivacy: (p: PrivacyState) => { privacy = p; emit("privacy_changed", { mic: [...p.mic], camera: [...p.camera] }); },
    /** Wave 6 hooks: notification mirror state (blockers derive from `devMode`/`registered`/`access`), cards and quiet mode. */
    setMirror: (p: Partial<MirrorState>) => { mirrorSet(p); },
    pushNotice: (n: Partial<Notice> & { id: string; app: string; title: string }) => { notices = [...notices.filter((x) => x.id !== n.id), { body: null, tile: "", tileMono: true, ripple: false, openLabel: "Open app", canOpen: true, at: nowMs(), hasCode: false, ...n }]; mirrorEmit(); },
    /** Preview/test: a download finished (`download_done`). */
    pushDownload: (d: { id: string; name: string; size: number }) => { downloads.set(d.id, d.name); emit("download_done", d); },
    setMirrorQuiet: (q: boolean) => { quiet = q; mirrorEmit(); },
    setPreviewDelay: (ms: number) => { previewDelay = ms; },
    addClip: (c: ClipItem) => { clips = [c, ...clips]; clipEmit({ reason: "added", item: c }); },
    /** Raw list (passwords included): tests use it to check the list carries no plain text. */
    rawClips: () => structuredClone(clips),
  };
  // In the browser, Ctrl+K takes the same path as the shortcut event Rust would send.
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); emit("shortcut", { name: "search", monitor: "m1" }); }
      else if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === " ") { e.preventDefault(); emit("shortcut", { name: "ask", monitor: "m1" }); }
      else if (e.ctrlKey && e.shiftKey && !e.altKey && e.key === "Enter") { e.preventDefault(); emit("shortcut", { name: "focus_island", monitor: "m1" }); }
    });
  }
  return fake;
}

// The preview URL ?time=2026-10-16T14:32 freezes the clock (same minute in every mockup frame).
const frozen = typeof location !== "undefined" ? new URLSearchParams(location.search).get("time") : null;
export const fakeBridge = createFakeBridge({ now: frozen ? new Date(frozen) : undefined });
