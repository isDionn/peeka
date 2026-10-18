// The ONLY place the Peeka UI talks to the back end (Rust/Tauri). Command and event names live here; the Rust side follows them.
// Outside Tauri (browser preview, tests) bridge.fake.ts takes over.
import { fakeBridge } from "./bridge.fake";
import type { COMMAND_NAMES, EVENT_NAMES } from "./commands.generated";
import type { PluginCommands, PluginEvents } from "./plugin-api";
import type { PluginRef } from "./plugin-api";
export * from "./plugin-api";

/* ---------- data types ---------- */
/** One monitor's strip. `id` is the stable id Rust gives; the page URL carries `?monitor=<id>`. */
export interface MonitorInfo {
  id: string;
  primary: boolean;
  hasBattery: boolean;
  /** 'denied' when Windows.Devices.Radios refuses access to Wi-Fi/Bluetooth: the button opens ms-settings instead. */
  radios: "ok" | "denied";
  /** Whether brightness can be controlled (usually not on desktop monitors). */
  brightness: boolean;
  /** Account name shown in the Start panel. */
  user: string;
  /** Monitor refresh rate (0 = Windows didn't say). */
  hz: number;
}
/** Monochrome icon: data URL (SVG or PNG). The UI paints it only as an alpha mask. */
export interface AppRef { appId: string; name: string; icon: string; /** Wave 5: color icon; Rust sends it only while `colorIcons` is on. */ colorIcon?: string | null }
export interface WindowInfo extends AppRef { hwnd: number; title: string; active: boolean; monitor: string; /** Elevated (admin) window: Peeka can't close it, the menu suggests Task Manager. */ elevated?: boolean }
export type PinnedApp = AppRef;
/** On/off and what it's connected to. `name` (Wi-Fi network, Bluetooth device) isn't read yet: it comes as null and the UI shows "On". */
export interface Radio { on: boolean; name: string | null }
/** Connection level (as Windows reports it; Wi-Fi vs. cable isn't known yet). */
export type NetworkLevel = "unknown" | "none" | "local" | "internet" | "constrained";
/** The single Rust `Status` type (notch-core status.rs). Every field Windows can't provide is null: no made-up values. */
export interface Status {
  volume: number | null; // 0..100, null without speakers
  muted: boolean;
  brightness: number | null; // 0..100, null if not controllable
  wifi: Radio | null; // null if this machine has no such radio
  bluetooth: Radio | null;
  dnd: boolean; // Peeka's own Do Not Disturb mode
  /** When Do Not Disturb ends ("until 6:00 PM"); Rust has no end time, so always null (the UI shows no end). */
  dndUntil: string | null;
  network: NetworkLevel;
  battery: { percent: number | null; charging: boolean; /** Plugged in (at 100% charging turns false). */ plugged: boolean; remaining: string | null } | null; // null on machines without a battery
}
/** Shortcut names (Rust `ShortcutId`). */
export type ShortcutId = "search" | "ask" | "focus_island" | "hide_island" | "emergency";
/** Command error (Rust `CmdError`): in Tauri, `call` rejects with this string. */
/** `ignored`: a click caught by the ~300 ms guard (the prompt stays open); `not_connected`: no main assistant connected. */
export type CmdError = "unknown" | "refused" | "invalid" | "io" | "unsupported" | "denied" | "missing" | "not_yet" | "ignored" | "not_connected";
export interface ShortcutException { appId: string; name: string; icon: string; keys: string }
export interface Settings extends ClipSettings {
  /** Idle mascot pranks (once every 45-90 min, at most 6 a day). On by default. */
  mascotPranks: boolean;
  /** The mascot celebrates finished jobs (on by default; the page applies it at most 3 times an hour). */
  celebrate: boolean;
  /** The Downloads folder is watched and `download_done` fires for finished files (name and size only; content isn't read and never goes to plugins). On by default. */
  watchDownloads: boolean;
  /** Color app icons (decision 14: off by default, monochrome). */
  colorIcons: boolean;
  /** Starts with Windows (HKCU Run, on by default). */
  autostart: boolean;
  /** Windows taskbar state (read-only here; changed with `taskbar_set_mode`): fully hidden / auto-hide / keep Windows' own. */
  taskbarHide: "full" | "auto" | "off";
  secondaryStrips: boolean;
  shortcuts: Record<ShortcutId, string>;
  shortcutExceptions: ShortcutException[];
  /** Volume keys are swallowed; only Peeka's indicator appears. */
  captureVolumeKeys: boolean;
  /** Simple HTTP alert adapter, off by default. */
  alertsApi: boolean;
  /** `notch --demo`: nothing is saved; the strip shows a "Demo" badge and some commands return `unsupported`. Never in the file. */
  demo?: boolean;
}
/** `paint`: visible but not clickable (shadow, bubble); Rust opens the window region for it too. */
export interface Rect { x: number; y: number; w: number; h: number; paint?: true }
export type PowerAction = "lock" | "sleep" | "restart" | "shutdown";
/** Now playing (Rust `notch_core::media::Media`). The position is the value at `positionAt` (Unix ms): the UI advances it while playing. `durationMs` 0 = the player gives no duration. */
export interface Media {
  title: string; artist: string; album: string; /** "Spotify", "Chrome" */ app: string; /** Cover data URL or null. */ art: string | null;
  playing: boolean; positionMs: number; positionAt: number; durationMs: number; canNext: boolean; canPrevious: boolean; canSeek: boolean;
}
/** A row in Peeka's alert list (Rust `notch_core::alerts::Alert`). Text is plain; links open only through `open_alert`. */
export interface Alert {
  id: string; title: string; subtitle: string | null; icon: string | null; color: string | null; progress: number | null;
  priority: number; /** http/https link or `"task_manager"` (Rust opens Task Manager its own way). */ action: string | null; style: "standard" | "level"; expand: boolean; kind: "alert" | "approval";
  source: string; /** Unix ms; null = stays until removed. */ expiresAt: number | null; /** Unix ms. */ updatedAt: number;
  /** Not sent by Rust yet (plugin wave): approval card content for a plugin that asks for "Review". */
  review?: { title: string; detail: string; items: { name: string; size: string }[] } | null;
}
/** Payload of `list_alerts` and `alerts_changed` (Rust `AlertsView`): sorted list, the one alert that may open the island now, and how long to bring down a hidden strip. */
export interface AlertsView { items: Alert[]; top: string | null; dropStripMs: number | null }
/** System monitor sample (Rust `SysmonTick`); unreadable fields are null (nothing made up). Memory in bytes, network in bytes/s. */
export interface SysmonTick { cpu: number | null; gpu: number | null; memUsed: number | null; memTotal: number | null; down: number | null; up: number | null; /** Program using the most CPU (exe name without ".exe"; all processes of a program are summed); null until the first sample or if nothing passes 1%. Refreshed every ~10 s while the card is open. */ topCpu: string | null }
/** Volume key or volume change: our own volume indicator only. */
export interface VolumeOsd { percent: number; muted: boolean; device?: string | null }

/* ---------- search ---------- */
export type SearchKind = "app" | "window" | "file" | "setting" | "plugin";
/** `app`/`window`: `icon` is a monochrome data URL. Other kinds send an empty `icon` (the UI picks one by kind). `plugin`: drawn with a `plugin` + `group` ("Notes") name prefix. On an empty query Rust returns mixed-kind "recents". */
export interface SearchResult {
  id: string; kind: SearchKind; title: string; subtitle: string | null; appId: string; icon: string; hwnd: number | null;
  plugin?: PluginRef | null; group?: string | null;
}
export interface SearchIndexState { files: "on" | "off" }

/* ---------- clipboard ---------- */
export type ClipHint = "link" | "color" | "command";
interface ClipBase { id: string; createdAt: number; pinned: boolean; /** Source app name. */ source: string | null }
/** Text, image or file. `text`: the text value or file name; null for images. `thumb`: image thumbnail (data URL). */
export interface ClipPlain extends ClipBase {
  kind: "text" | "image" | "file"; text: string | null; hint?: ClipHint | null; sub: string | null; thumb: string | null;
  /** Screen snip taken with Win+Shift+S. */ screenshot: boolean; /** File no longer exists: row is dimmed. */ missing?: boolean;
}
/** Password class: content is in no list, event or log. `expiresAt` (Unix ms) is when it expires. */
export interface ClipPassword extends ClipBase { kind: "password"; expiresAt: number }
export type ClipItem = ClipPlain | ClipPassword;
export type ClipChange = { reason: "added" | "removed" | "updated" | "expired" | "cleared"; item: ClipItem | null };
export interface ClipReveal { text: string; /** Reveal duration given by Rust; the UI caps it at 5000 ms. */ ttlMs: number }
export interface LockState { locked: boolean; reason: "windows" | "manual" | "plugin" | null }
/** Settings › Clipboard (merged into Settings). */
export interface ClipSettings { clipHistory: boolean; clipMedia: boolean; clipPasswordMin: 5 | 15 | 30 | 60 }

/* ---------- timer (Peeka's own timer; mockup zam) ---------- */
export interface TimerState {
  label: string;
  /** Total duration (s). */ totalS: number;
  /** Remaining (s); frozen while paused. */ remainingS: number;
  running: boolean;
  /** When Rust wrote the state (Unix ms): while running, the UI counts down from this moment. */ at: number;
}
export type TimerAction = "pause" | "resume" | "add5" | "stop";

/* ---------- shelf (mockup g0, g) ---------- */
export interface ShelfItem { id: string; name: string; sub: string; kind: "pdf" | "video" | "sheet" | "image" | "other" }

/* ---------- Bluetooth earbuds (mockup bt): no case battery ---------- */
export interface CcEdit { sid: string | null; file: string | null; add: number | null; del: number | null }
export interface CcDiff { file: string; add: number; del: number; lines: string[]; more: number }
export interface DownloadDone { id: string; name: string; size: number }
export interface FullscreenScreens { island: boolean; strips: string[] }
export interface ApprovalBadge { monitor: string; count: number }
export interface CpuHigh { app: string | null }
export interface MusicStopped { name: string; app: string | null }
export interface BluetoothEvent { name: string; /** 0..100; null if the device doesn't report it (just "connected"). */ battery: number | null }

/* ---------- mic and camera privacy dot ---------- */
export interface PrivacyState { mic: string[]; camera: string[] }

/* ---------- input (mascot pranks and eye tracking) ---------- */
export interface InputTick {
  lastInputAgoMs: number; cursor: { x: number; y: number } | null;
  /** Windows presentation mode (QUNS_PRESENTATION_MODE): no pranks. */ presentation?: boolean;
  /** Windows busy (QUNS_BUSY, fullscreen D3D or Store app): no pranks. */ busy?: boolean;
}


/* ---------- Wave 6: tray list, Windows notification mirror ---------- */
export interface TrayIcon { id: string; name: string; exe: string; promoted: boolean; /** PNG data URL (alpha painted monochrome); "" = none. */ icon: string }
export type MirrorBlocker = "dev_mode_off" | "not_registered" | "access_denied";
export interface MirrorState { devMode: boolean; registered: boolean; access: string; enabled: boolean; on: boolean; blocker: MirrorBlocker | null }
/** Windows notification. Card only in the top right; no strip ripple (`ripple` always false); `tile` is an alpha mask, `tileMono` always true. */
export interface Notice { id: string; app: string; title: string; body: string | null; tile: string; tileMono: boolean; ripple: boolean; openLabel: string; canOpen: boolean; at: number; /** The notification has a one-time verification code (show "Copy code"; Rust always sends this, old fakes don't). The code itself never reaches the page as a SEPARATE field; only `notif_copy_code` puts it on the clipboard. The notification mirror is off by default; while off there are no notifications, and so no codes. */ hasCode?: boolean }
/** `quiet`: do not disturb / fullscreen / presentation: no card opens by itself. */
export interface MirrorView { items: Notice[]; quiet: boolean }

/* ---------- Fidelity 3 (Rust `fidelity.rs`, `plugins/host/assistant.rs`) ---------- */
export type RecentKind = "pdf" | "video" | "sheet" | "image" | "other" | "app";
/** Start "Recommended": recently used files (Windows Recent). `sub`: "Just now", "3h ago", "Yesterday". Rust sends no app rows. */
export interface RecentItem { id: string; name: string; sub: string; kind: RecentKind; icon?: string }
/** Counts on the main assistant's status card. `memory`: "Notes" count; `approvals`: "Waiting for approval" count (Rust always sends it, 0 on the old bridge). */
export interface AssistantCounts { jobs: number; memory: number; approvals?: number }
/** Claude Code hook bridge (as reported by the main assistant). `lastEventAgoS`: seconds since the last event, null if none yet. */
export interface BridgeState { installed: boolean; healthy: boolean; lastEventAgoS: number | null }
/** One other coding agent's hook row (Rust `agent_bridges`): `file` is the config Install changes (`~` = user folder); `present` = the agent's own folder exists. */
export interface AgentBridge extends BridgeState { id: string; name: string; file: string; present: boolean }
/** Permission history row (newest first): who got or gave up which scope, and when. `at` is Unix ms. */
export interface PermissionEvent { at: number; plugin: string; scope: string; granted: boolean }
/** `open_tray` result + color icon (while `colorIcons` is on). Rust gives NO badge count: without `badge` no badge is drawn. */
export interface TrayIconX extends TrayIcon { badge?: number; colorIcon?: string | null }
/** `start`: ISO time (absent on all-day rows); `link`: https only on meeting hosts (Rust filters). Both absent on the old bridge. */
export interface CalendarNext { detail: string | null; next: { time: string; title: string; source: string; start?: string; link?: string }[] }
export interface ShelfSuggestion { id: string; text: string }
/** Ctrl+Space attachment kinds; the page sends only the kind, Rust resolves the path. `window_image` is `not_yet` in Rust. */
export type ComposerKind = "window_image" | "screen_image" | "file" | "clipboard_link" | "shelf";
export interface Attached { kind: ComposerKind; label: string }

/* ---------- commands: Rust #[tauri::command] name = key ---------- */
export interface Commands {
  get_monitor: { args: { monitor: string }; ret: MonitorInfo };
  list_windows: { args: { monitor: string }; ret: WindowInfo[] };
  get_pins: { args: void; ret: PinnedApp[] };
  /** Order of pinned apps; pin / unpin / drag-reorder all call this. */
  set_pins: { args: { appIds: string[] }; ret: PinnedApp[] };
  activate_window: { args: { hwnd: number }; ret: void };
  close_window: { args: { hwnd: number }; ret: void };
  new_window: { args: { appId: string }; ret: void };
  launch_app: { args: { appId: string }; ret: void };
  list_apps: { args: void; ret: AppRef[] };
  /** Wave 4: file, setting and plugin results too; empty query = recents (wave4-api.ts). */
  search: { args: { query: string }; ret: SearchResult[] };
  /** Open a search result: launch the app or bring the window forward. */
  open_result: { args: { id: string }; ret: void };
  get_status: { args: void; ret: Status };
  set_volume: { args: { value: number }; ret: void };
  set_brightness: { args: { value: number }; ret: void };
  /** Access refusal returns a `denied` error: the UI then opens the ms-settings page. */
  set_radio: { args: { kind: "wifi" | "bluetooth"; on: boolean }; ret: void };
  set_dnd: { args: { on: boolean }; ret: void };
  /** Windows settings link. Rust accepts only a fixed list: ms-settings:, :network-wifi, :bluetooth, :quiethours. */
  open_windows_settings: { args: { uri: string }; ret: void };
  /** Read hidden icons: read-only tray list (fallback for Wave 0 test 4). */
  open_tray: { args: { monitor: string }; ret: TrayIcon[] };
  power: { args: { action: PowerAction }; ret: void };
  restore_taskbar: { args: void; ret: void };
  /** Quit Peeka (after the UI asks its own confirmation). */
  quit: { args: void; ret: void };
  /** Settings > About: restart Peeka in demo mode (`on`) or normally. Peeka quits right after; Err = nothing happened. */
  demo_restart: { args: { on: boolean }; ret: void };
  get_settings: { args: void; ret: Settings };
  set_settings: { args: { patch: Partial<Settings> }; ret: { ok: boolean; error: string | null } };
  /** Clickable rectangles (CSS pixels inside the window). Clicks outside pass through to the window below. Shared by the strip and island pages. */
  report_hit_rects: { args: { page: "strip" | "island"; monitor: string; rects: Rect[] }; ret: void };
  get_media: { args: void; ret: Media | null };
  /** `seek` needs `positionMs`. */
  media_control: { args: { action: "play_pause" | "next" | "previous" | "seek"; positionMs?: number }; ret: void };
  /** Highest priority first, newest first on ties (Rust sorts; the UI sorts anyway). */
  list_alerts: { args: void; ret: AlertsView };
  dismiss_alert: { args: { id: string }; ret: void };
  /** Rust opens the alert's `action` link (checked http/https only). */
  open_alert: { args: { id: string }; ret: void };
  clear_alerts: { args: void; ret: void };
  /** Starts when the system monitor card opens and stops when it closes; samples arrive via the `sysmon_tick` event. */
  sysmon_start: { args: void; ret: void };
  sysmon_stop: { args: void; ret: void };
  /** Manual taskbar mode (also clears the emergency shortcut's "off"). No button in the UI yet. */
  taskbar_set_mode: { args: { mode: "full" | "auto" | "off" }; ret: void };
  /* Wave 4: search, clipboard, lock */
  search_index_state: { args: void; ret: SearchIndexState };
  /** Open a search result (app, window, file, setting, plugin; Rust knows the kind from the id). */
  search_open: { args: { id: string }; ret: void };
  /** "Ask the assistant": `not_connected` if no main assistant. Rust opens the Ctrl+Space chat on the island card with this text. */
  search_ask: { args: { query: string }; ret: { turn: number } };
  clip_list: { args: void; ret: ClipItem[] };
  /** Copy back. Works on passwords without revealing them; Peeka puts it on the clipboard with "don't track" flags. `denied` while locked. */
  clip_copy: { args: { id: string }; ret: void };
  clip_pin: { args: { id: string; on: boolean }; ret: void };
  clip_delete: { args: { id: string }; ret: void };
  /** `passwords: true` = passwords only (Settings › Clipboard "Delete all passwords"); missing or false = everything ("Delete all"). */
  clip_clear: { args: { passwords?: boolean }; ret: void };
  /** Password plain text, for at most 5 s. `denied` while locked. */
  clip_reveal: { args: { id: string }; ret: ClipReveal };
  /** One-time share with the main assistant. `denied` for passwords, `not_connected` if not connected. */
  clip_share: { args: { id: string }; ret: void };
  /** Open a screen snip in the Windows editor. */
  clip_edit: { args: { id: string }; ret: void };
  /** Start a drag out (Windows' native drag image, for images and files). */
  clip_drag: { args: { id: string }; ret: void };
  /** Open an image or file item with its default app (images from a temp copy). `denied` while locked, for passwords and executables; `missing` if the file is gone; `invalid` for text. */
  clip_open: { args: { id: string }; ret: void };
  /** Put an image or file item on the shelf (`shelf_changed` fires). `denied` while locked and for passwords, `invalid` for text. */
  clip_to_shelf: { args: { id: string }; ret: void };
  /** Large preview of an image item: PNG data URL, long edge at most 1024 px (as is if smaller). `denied` while locked, `invalid` if not an image. */
  clip_preview: { args: { id: string }; ret: string };
  /** Open a finished download with its default app. `denied` while locked and for executables (exe, bat, ps1, lnk...); `missing` for an id Rust never reported or a deleted file. */
  download_open: { args: { id: string }; ret: void };
  /** Show a finished download selected in Explorer. `denied` while locked, `missing` if the id/file is gone. */
  download_show_in_folder: { args: { id: string }; ret: void };
  /** Clipboard card or Clipboard tab visible/closed: Rust turns on `WDA_EXCLUDEFROMCAPTURE` for the island window and removes it on close. The page waits for the `on: true` reply BEFORE the first frame; the return value says whether the island is now excluded from capture. `false`, an error or no reply = not excluded: the page draws the card but NEVER draws password rows (safe side). */
  clip_visible: { args: { on: boolean }; ret: boolean };
  lock_state: { args: void; ret: LockState };
  lock_now: { args: void; ret: void };
  /** The owner's "Unlock" click on Peeka's lock card: clears "Lock" and the plugin lock; the Windows lock lifts when Windows unlocks. */
  lock_release: { args: void; ret: void };
  /* Wave 5 */
  /** Window snapshot (PrintWindow, PW_RENDERFULLCONTENT) as a PNG data URL; cached for minimized windows. */
  window_preview: { args: { hwnd: number }; ret: string };
  /** Open the Windows share sheet (no separate Nearby Share). With a file id on the shelf. */
  share_open: { args: { id: string }; ret: void };
  shelf_list: { args: void; ret: ShelfItem[] };
  /** Ask the main assistant about a shelf file (one-time share); `not_connected` if not connected. */
  shelf_ask: { args: { id: string }; ret: void };
  timer_get: { args: void; ret: TimerState | null };
  timer_control: { args: { action: TimerAction }; ret: void };
  privacy_get: { args: void; ret: PrivacyState };
  /* Wave 6 */
  /** New timer (replaces a running one). 0 s or over 24 hours is `invalid`. */
  timer_start: { args: { label: string; seconds: number }; ret: TimerState };
  /** Tray list (fallback until Wave 0 test 4 lands). */
  tray_open: { args: { id: string }; ret: void };
  mirror_state: { args: void; ret: MirrorState };
  mirror_enable: { args: void; ret: MirrorState };
  mirror_disable: { args: void; ret: MirrorState };
  mirror_list: { args: void; ret: MirrorView };
  mirror_dismiss: { args: { id: string }; ret: void };
  mirror_open_app: { args: { id: string }; ret: void };
  /** "Let the assistant reply": main assistant only, one-time. `denied` while locked, `not_connected` without an assistant. */
  mirror_ask: { args: { id: string }; ret: { turn: number } };
  /** "Copy code": puts the notification's one-time code on the clipboard (with the same "no history/cloud/tracking" flags as passwords; it doesn't enter Peeka's own clipboard); cleared after 60 s if the clipboard still holds that code. `denied` while locked; `missing` without an id or code. The code never returns to the page and is never logged. */
  notif_copy_code: { args: { id: string }; ret: void };
  /* Fidelity 3 */
  /** Start "Recommended" (at most 8; the page shows 4). */
  recent_files: { args: void; ret: RecentItem[] };
  open_recent: { args: { id: string }; ret: void };
  /** Start pins. Windows 11 doesn't expose the list: Rust always returns EMPTY, and empty = the page falls back to its own list (strip pins + apps). */
  start_pins: { args: void; ret: AppRef[] };
  /** Open the Windows Start menu (Win key). */
  open_start_menu: { args: void; ret: void };
  /** "Quit app": sends close to all of that app's windows (never force-kills). */
  quit_app: { args: { appId: string }; ret: void };
  /** Hide the island for 1 hour (`on: true`) or bring it back. */
  island_hide: { args: { on: boolean }; ret: void };
  island_hidden: { args: void; ret: boolean };
  /** `open_tray` + color icon; no badge count. */
  tray_icons: { args: { monitor: string }; ret: TrayIconX[] };
  /** Latest counts reported by the main assistant; `not_yet` before that. */
  assistant_counts: { args: void; ret: AssistantCounts };
  assistant_open: { args: { kind: "approval" | "jobs" | "memory" }; ret: void };
  calendar_next: { args: void; ret: CalendarNext };
  claude_bridge_state: { args: void; ret: BridgeState };
  /** "Install" in Settings: Peeka's own Claude Code hook (`peeka.exe --cc-hook`) is merged into settings.json; only on a manual click, `refused` in demo mode. The failure reason arrives via `notch://notice`. */
  claude_bridge_install: { args: void; ret: BridgeState };
  /** "Remove": only Peeka's own entries go. */
  claude_bridge_remove: { args: void; ret: BridgeState };
  /** Codex CLI, Cursor, Gemini CLI, GitHub Copilot CLI: Peeka's status-only hook per agent (Claude Code has its own row). */
  agent_bridges: { args: void; ret: AgentBridge[] };
  /** Same rules as `claude_bridge_install` (backup, merge, `refused` in demo mode), for one agent `id`. */
  agent_bridge_install: { args: { agent: string }; ret: AgentBridge };
  agent_bridge_remove: { args: { agent: string }; ret: AgentBridge };
  permission_history: { args: void; ret: PermissionEvent[] };
  /** Whether the main assistant has connected for the first time (once ever); cleared by `first_connect_ack`. */
  first_connect_get: { args: void; ret: boolean };
  first_connect_ack: { args: void; ret: void };
  /** The main assistant's suggestion for a shelf file; null if there is none (or it doesn't arrive within 3 s). */
  shelf_suggest: { args: { id: string }; ret: ShelfSuggestion | null };
  /** "Add to Notes": hands the shelf file to the main assistant (one-time). */
  shelf_memory: { args: { id: string }; ret: void };
  /** "Launch": Rust opens the `launch` exe from the main assistant's manifest (only on the owner's click); `missing` without a main assistant, `launch` or file. */
  assistant_start: { args: void; ret: void };
  /** Attachment kinds Rust accepts in `composer_submit`. */
  composer_kinds: { args: void; ret: ComposerKind[] };
  /** "Open terminal": brings Claude Code's terminal window forward using the row's `session` id. Errors: `unknown` | `not_connected` | `missing` | `refused` | `unsupported` (demo). */
  cc_focus_terminal: { args: { sessionId: string }; ret: void };
  /** The last Edit/Write of hook session `sid` (`cc_edit.sid`), read on demand from the hook's local cache: at most 200 lines (`more` = lines past that). `denied` while locked or presenting, `missing` when nothing is cached (or it is older than 30 min). */
  cc_diff: { args: { sid: string }; ret: CcDiff };
  /** "Open in editor": that file with its default app. `denied` while locked/presenting or for a runnable file, `missing` when it's gone. */
  cc_diff_open: { args: { sid: string }; ret: void };
  /** Elevated window menu and alert button: opens Task Manager. */
  open_task_manager: { args: void; ret: void };
  /** Tab order across windows: granted only while focus is already in a Peeka window (focus is never stolen from another app); otherwise `refused`. When the island leaves its last control, to the `monitor` strip. */
  focus_strip: { args: { monitor: string }; ret: void };
  /** When the strip hands focus back with Tab, focus goes to the island window (one for all screens). */
  focus_island: { args: void; ret: void };
  /** `on` true when a typing panel (Search, Ask box) opens: only now may the window take keyboard focus; false on close: focus returns to the previous app. `label` = "island" | "strip-<monitor>". Errors: `unknown` (no other label/window) or `refused`. */
  typing_focus: { args: { label: string; on: boolean }; ret: void };
  /** Take a screenshot; cancel = null. */
  composer_scan: { args: void; ret: Attached | null };
  /** File picker; cancel = null. */
  composer_attach_file: { args: void; ret: Attached | null };
}
export type CommandName = keyof Commands;
// Must match Rust's list (commands.generated.ts) exactly: tsc stops here if one is missing or extra. Plugin commands and
// events (plugin-api.ts) are in Rust too (Wave 3); the check covers both.
type GeneratedName = (typeof COMMAND_NAMES)[number];
const _sameCommands: [Exclude<keyof AllCommands, GeneratedName>, Exclude<GeneratedName, keyof AllCommands>] extends [never, never] ? true : never = true;
void _sameCommands;
type GeneratedEvent = (typeof EVENT_NAMES)[number];
const _sameEvents: [Exclude<keyof AllEvents, GeneratedEvent>, Exclude<GeneratedEvent, keyof AllEvents>] extends [never, never] ? true : never = true;
void _sameEvents;
export type AllCommands = Commands & PluginCommands;
export type AllEvents = Events & PluginEvents;
type ArgsOf<K extends keyof AllCommands> = AllCommands[K]["args"];
export type CallArgs<K extends keyof AllCommands> = ArgsOf<K> extends void ? [] : [args: ArgsOf<K>];

/* ---------- events: Rust emit name = key ---------- */
export interface Events {
  windows_changed: { monitor: string };
  pins_changed: null;
  status_changed: Status;
  settings_changed: Settings;
  /** Global shortcut pressed; `monitor` is the screen with the cursor, only that screen's strip reacts. */
  shortcut: { name: Exclude<ShortcutId, "emergency">; monitor: string };
  media_changed: Media | null;
  alerts_changed: AlertsView;
  sysmon_tick: SysmonTick;
  volume_osd: VolumeOsd;
  /** Whether the strips are hidden because of fullscreen (Rust). */
  "notch://fullscreen": boolean;
  /** Short plain-text notice from Rust. */
  "notch://notice": string;
  /** Mouse pressed outside the strip (real window): monitor of the pressed strip, "" = not a strip. */
  "notch://outside_press": string;
  /* Wave 4 */
  clip_changed: ClipChange;
  lock_changed: LockState;
  /* Wave 5 */
  /** No separate battery/charging/bluetooth event: charging and low battery derive from `status_changed`. */
  bluetooth_connected: BluetoothEvent;
  /** Headphones disconnected and playing music was paused ("Music stopped" + "Resume": `media_control` play_pause). `app`: player app name, null if unknown. Doesn't fire if music keeps playing from the speakers. */
  music_stopped: MusicStopped;
  /** CPU stayed at 95% or more for at least 60 s (one cheap background read every 15 s; measured cost ~0.001% of a core). `app`: exe name of the top program (no ".exe"), null if unclear. At most once every 10 min. */
  cpu_high: CpuHigh;
  /** What a fullscreen app hides, per monitor (39): a fullscreen video on the second screen hides only that screen's strip, the main island stays. `island`: whether the island is hidden (same value as `notch://fullscreen`); `strips`: monitor ids of hidden strips. A strip page can read its own monitor from this list. */
  fullscreen_screens: FullscreenScreens;
  /** While an approval waits and the mouse is on another monitor (40): an "N approvals" badge on that monitor's secondary strip (the island window stays on the primary screen only; opening the card on that screen isn't part of this event, it's UI work). `null` = no badge. Doesn't fire for a monitor without a strip or one hidden by fullscreen. */
  approval_badge: ApprovalBadge | null;
  /** A new file finished in Downloads (size unchanged across two looks; .crdownload/.part/.tmp don't count). No path: use `id` with `download_open` / `download_show_in_folder`. Doesn't fire while `watchDownloads` is off or while locked. */
  download_done: DownloadDone;
  privacy_changed: PrivacyState;
  input_tick: InputTick;
  timer_changed: TimerState | null;
  shelf_changed: null;
  /** A dragged file reached / left the island (Windows drag event in Rust); while on, the shelf peek shows two drop targets. */
  shelf_drag: boolean;
  notifications_changed: MirrorView;
  /* Fidelity 3 */
  island_hidden_changed: boolean;
  /** Clipboard drag ended (dropped or cancelled): the source thumbnail shows again. */
  clip_drag_end: null;
  /** The main assistant connected for the first time. */
  first_connect: null;
  /** Job done (while `celebrate` is on; the mascot hops on the strip, at most 3 times an hour). */
  job_done: { title: string; took: string; /** Duration in seconds (for the 2-minute rule); null if the main assistant didn't send it. */ seconds?: number | null };
  /** The main assistant's offline mode. */
  assistant_offline: boolean;
  /** Whether there's a meeting (main assistant `meeting.set`): mascot pranks go quiet. */
  meeting_changed: boolean;
  /** The main assistant's `cc.event`: a Claude Code hook event (drives the mascot state). `tool` is the tool name, `reason` the error class; no free text. */
  /** `agent`: claude | codex | cursor | gemini | copilot | opencode (absent = claude). */
  cc_event: { agent?: string | null; kind: string; tool?: string | null; reason?: string | null; sid?: string | null };
  /** Peeka's own hook only: an Edit/Write inside the session folder. `file` is relative to it; `file`/`add`/`del` are null while locked or presenting (generic label only). The diff itself comes only from `cc_diff`. */
  cc_edit: CcEdit;
}
export type EventName = keyof Events;

export interface Bridge {
  call<K extends keyof AllCommands>(cmd: K, ...args: CallArgs<K>): Promise<AllCommands[K]["ret"]>;
  on<E extends keyof AllEvents>(evt: E, cb: (payload: AllEvents[E]) => void): Promise<() => void>;
  /** Clock: `new Date()` for real; the fake can freeze it for previews. */
  now(): Date;
}

/* ---------- real (Tauri) app ---------- */
const tauriBridge: Bridge = {
  async call(cmd, ...args) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke(cmd, args[0] as Record<string, unknown> | undefined) as never;
  },
  async on(evt, cb) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen(evt, (e) => cb(e.payload as never));
  },
  now: () => new Date(),
};

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const base: Bridge = inTauri ? tauriBridge : fakeBridge;
/** For every command that returns `unsupported` in demo mode, the island shows a short notice ("Not available in demo mode"). */
export const UNSUPPORTED_EVENT = "notch-unsupported";
export const bridge: Bridge = {
  ...base,
  call: (cmd, ...args) => base.call(cmd, ...args).catch((e) => { if (e === "unsupported" && typeof window !== "undefined") window.dispatchEvent(new Event(UNSUPPORTED_EVENT)); throw e; }),
};
