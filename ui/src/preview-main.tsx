import { createRoot } from "react-dom/client";
import { fakeBridge } from "./bridge.fake";
import type { ClipPlain } from "./bridge";
import { Island, type IslandInit } from "./components/Island";
import { Shell, type ShellInit } from "./components/Shell";
import { ConsentWindow } from "./components/Consent";
import { SURFACES_J, VOICE_ASSISTANT, VOICE_YOU, VOICE_SPEAKING, VOICE_THINKING, withRecommended } from "./plugin.fixtures";
import { setClipboardDrag } from "./components/Pano";
import { param } from "./main-common";
import { MODULES, PLUGINS, APPROVAL_CHOICE, APPROVAL_HIGH, APPROVAL_LOW, COMPASS, CONSENT, DICTATION, RECORDING, PROTRUSION, SURFACES_FULL, TICKET } from "./plugin.fixtures";
import { ext } from "./ext";
import "./preview.css";

// Preview URL params: ?state=<id> picks the mockup state; ?locked=1, ?time=2026-10-16T14:32, ?noplugins=1, ?mic=1, ?previewDelay=<ms>,
// ?index=off, ?notice=1, ?mirror=ok|dev|reg|denied, ?monitor=<id>. State ids (b1, yb, kl...) are the mockup's frame ids.
const disk = (await fakeBridge.call("list_alerts")).items.find((a) => a.id === "disk");
const SHELL_STATES: Record<string, ShellInit> = {
  a: {}, aye: { panel: "plugins" }, aym: { panel: "modules" }, m: { panel: "notif" }, mt: { panel: "cleanup", review: disk }, o: { panel: "status" }, w2: { panel: "start" }, ara0: { panel: "search" }, ara1: { panel: "search", query: "screen", sel: 1 }, ara2: { panel: "search", query: "xqz" }, ayp: { panel: "clipboard" }, ays: { panel: "mascot" }, ayg: { panel: "appearance" }, tepsi: { panel: "tray" }, takvim: { panel: "calendar" }, ayk: { panel: "shortcuts" }, y: { panel: "quit" },
  // Fidelity 3: sr strip menu, p1 app menu (kur, y1, y2, gz below with a special layout)
  kur: { panel: "setup", setup: true, setupStep: 1 }, y1: { panel: "tray" },
  sr: { menu: { kind: "strip", x: 960 } }, p1: { menu: { kind: "app", appId: "discord", x: 626 } },
  // M1: m0 empty Notifications panel (the 96 px ghost sleeps there; the strip's ghost steps aside)
  m0: { panel: "notif" },
};
// island states (mockup ids): b1 music peek, b2 player, e volume indicator, hov hover, x0 assistant not connected (resting), x1 Ctrl+Space, ilk first run, u alert, j System card
const ISLAND_STATES: Record<string, IslandInit> = {
  b1: { autoMusic: true, pin: true }, b2: { view: "music-card" }, e: { osd: { percent: 64, muted: false, device: "Buds Pro" }, pin: true }, hov: { hover: true },
  x1: { view: "noassistant" }, ilk2: {}, ky: { view: "clipboard", card: "ky" }, kh: { view: "clipboard", card: "kh" }, kb: { view: "clipboard", card: "kb" }, h: { view: "clipboard" }, h2: { view: "clipboard" }, h3: { view: "clipboard" }, h1: { shot: true, pin: true }, kl: { view: "modules" }, ilk: { view: "welcome" }, j: { view: "modules" },
  c2: { view: "approval-card" }, c2r: { view: "approval-card" }, c3: { view: "approval-card" }, s: { view: "composer" },
  d2: { view: "composer", ask: "Remind me about tomorrow morning's meeting, and get the notes ready." },
  // Wave 5: charging, low battery, Bluetooth, timer, dictation, ticket, recording, meeting, shelf (while dragging / card), Search label
  mz: { prank: true }, e0: { osd: { percent: 0, muted: true, device: null }, pin: true }, f: { view: "meeting" }, bit: { done: { title: "Weekly summary ready", took: "Took 4 min" }, pin: true }, cev: { offline: true }, x0: {},
  // copy strip: k1 image, k1b image + cursor on it (large preview), k2 file, k3 link (a fake copy event on load)
  k1: { pin: true }, k1b: { pin: true, hover: true }, k2: { pin: true }, k3: { pin: true },
  // timer: zs last 60 s (music in the bubble), sd "Time's up"
  zs: { autoMusic: true, pin: true }, sd: { timerDone: "Focus", pin: true },
  // network: ag lost, ag2 back
  ag: { net: "lost", pin: true }, ag2: { net: "back", pin: true },
  // "While you were away" summary
  sy: { away: { notif: 3, approval: 1, done: 2 }, pin: true },
  // notification burst (by), two Claude Code sessions (os: two session_start), error card + "Why?" (hn)
  by: { burst: { n: 6, apps: ["Discord", "Outlook", "Teams"] }, pin: true }, os: { pin: true }, hn: { view: "error", err: "Bash" },
  // F8 weekly recap card ("Your week"; the fake bridge offers last week's counts)
  rc: {},
  // M1 (mascot more often; gr/ms/nt run without an assistant so the ghost is calm): gr launch greeting (waves once, 1.2 s), ms a new Windows notification at a calm rest (eyes turn top right, raised brows),
  // dl download done (the 40 px ghost cheers in the strip center), nt calm rest for the time-of-day mood: open with &time=2026-10-19T23:47 (sleepy) or T14:00 (awake).
  // b2 music card (the 56 px ghost sways in the player), kb empty Clipboard (96 px, searching), bit task done (40 px ghost cheers), k2 copy catch (40 px ghost spots the item).
  // Wink after listening: mascot-demo.html?mood=listening&then=idle&after=1000 (the engine winks once when listening ends, any size from 28 px).
  gr: { greet: true }, ms: {}, dl: { pin: true }, nt: {},
  // M1b (more reactions from the unused parts): cpu "CPU is very busy" bump (the 40 px ghost overheats: red heat waves, sweat; neutral when locked),
  // pr presentation mode turns on 1.5 s after load (the strip ghost covers its eyes for 1.2 s, then stays neutral). Idle tuft/tail fidgets, the sly prank face
  // and the 96 px ground light: mascot-demo.html?view=fidget. Pin daytime with &time=2026-10-19T14:00.
  cpu: { cpu: { app: "Chrome" }, pin: true }, pr: {},
  sarj: { charge: true, pin: true }, pil: {}, bt: { bt: { name: "Buds Pro", battery: 80 }, pin: true }, zam: {}, dik: {}, tik: {}, kay: {}, f0: {}, g0: { shelfDrag: true, pin: true }, g: { view: "shelf" },
};
// Claude chat tab (ClaudeChat.tsx): its own page, claude-chat-demo.html?state=empty|chat|thinking|streaming|long|missing|signin|error (&still for a still ghost).
const state = param("state", "a");
// plugin states (mockup ids): c1/c1r approval peek, c2/c2r/c3 approval card, t3 strip dropping down in fullscreen, s Ctrl+Space, d2 chat, j Modules, eo consent window
const APPROVALS = { c1: APPROVAL_LOW, c2: APPROVAL_LOW, t3: APPROVAL_LOW, c1r: APPROVAL_HIGH, c2r: APPROVAL_HIGH, c3: APPROVAL_CHOICE } as const;
if (state in APPROVALS) { const a = APPROVALS[state as keyof typeof APPROVALS]; fakeBridge.setSurfaces({ approvals: [a], approvalTop: a.id, dropStripMs: state === "t3" ? 4000 : null }); }
// mockup DINLEN(): "1 approval" count at rest (opens no card or peek: the attention budget didn't move the approval to the peek)
if (["a", "hov", "mz", "i", "m", "n", "n2", "t1", "t2", "dnd"].includes(state)) fakeBridge.setSurfaces({ approvals: [APPROVAL_LOW], approvalTop: null });
if (state === "rc") fakeBridge.setRecap({ startDay: 20_738, sessions: 14, sessionMs: 23_400_000, allowed: 37, denied: 3, files: 58, clips: 112, days: [9, 14, 31, 12, 18, 2, 0] });
if (state === "dnd") fakeBridge.setStatus({ dnd: true, dndUntil: "until 6:00 PM" });
// x0: assistant installed but not connected (mascot sleeps); ?noplugins none installed at all
if (state === "x0" || state === "x1") fakeBridge.setPlugins(PLUGINS.map((p) => (p.main ? { ...p, connected: false } : p)));
// fullscreen: t1 strip slides up, t2 cursor at the top edge (strip comes back), t3 approval strip drops down
if (state === "t1" || state === "t2" || state === "t3") setTimeout(() => { fakeBridge.emit("notch://fullscreen", true); fakeBridge.emit("fullscreen_screens", { island: true, strips: ["m1"] }); }, 300);
if (state === "t2") setTimeout(() => dispatchEvent(new MouseEvent("mousemove", { clientX: 900, clientY: 2 })), 700);
if (state === "s" || state === "d2") fakeBridge.setSurfaces({ composer: { ...COMPASS, voice: true } });
if (state === "j") fakeBridge.setSurfaces(SURFACES_FULL);
// Fidelity 2 (addition): j General = assistant | Claude Code | System data, c3 recommended choice, d1/d3 voice peek and live transcript (You, then the assistant)
if (state === "j") fakeBridge.setSurfaces(SURFACES_J);
if (state === "s" || state === "d2") fakeBridge.setShelf([{ id: "f1", name: "presentation-draft.pdf", sub: "2.4 MB, just now", kind: "pdf" }, { id: "f2", name: "screen-recording.mp4", sub: "38 MB, 2m ago", kind: "video" }]); // "2 files on the shelf" chip
if (state === "c3") fakeBridge.setSurfaces({ approvals: [withRecommended(APPROVAL_CHOICE)], approvalTop: APPROVAL_CHOICE.id });
if (state === "d1" || state === "d3") {
  fakeBridge.setSurfaces({ protrusion: state === "d1" ? VOICE_THINKING : VOICE_SPEAKING });
  setTimeout(() => { fakeBridge.emit("plugin_stream", { streamId: "voice", text: VOICE_YOU, speaker: "You" }); if (state === "d3") fakeBridge.emit("plugin_stream", { streamId: "voice", text: VOICE_ASSISTANT, speaker: "Compass" }); }, 300);
}
if (state === "yk") fakeBridge.setSurfaces({ protrusion: { ...PROTRUSION, title: "Uploading backup", subtitle: "2.4 GB / 4 GB", icon: null, mascot: "thinking", progress: 0.6, actions: [] } });
// yb: Claude working (main strip "Claude · Thinking… 0:06") + music playing (side bubble: cover). yb2: plus a timer ("+1" badge). For testing, the fake bridge is exposed on window (this preview page only).
if (state === "yb" || state === "yb2") fakeBridge.setSurfaces({ protrusion: { plugin: COMPASS, title: "Claude · Thinking…", icon: "code", state: "info", mascot: "serious", timer: { startedAt: new Date(Date.now() - 6000).toISOString() } } });
if (state === "yb2") fakeBridge.setTimer({ label: "Focus", totalS: 1500, remainingS: 1452, running: true });
if (state === "os") setTimeout(() => { fakeBridge.emit("cc_event", { kind: "session_start" }); fakeBridge.emit("cc_event", { kind: "session_start" }); fakeBridge.emit("cc_event", { kind: "pre_tool", tool: "Edit" }); }, 400);
// ed: F4 live diff ticker (Claude Code edited "notes.ts +2 −1"); "Show changes" opens the diff card from the fake `cc_diff`.
if (state === "ed") setTimeout(() => fakeBridge.emit("cc_edit", { sid: "1a2b3c4d", file: "src/lib/notes.ts", add: 2, del: 1 }), 400);
Object.assign(window, { fakeBridge });
const CLIP_IMAGE = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5E5CE6"/><stop offset="1" stop-color="#63E6E2"/></linearGradient></defs><rect width="160" height="100" fill="url(#g)"/><circle cx="52" cy="42" r="18" fill="#fff" fill-opacity=".7"/><path d="M0 100 L60 60 L100 84 L130 66 L160 90 V100Z" fill="#000" fill-opacity=".35"/></svg>');
const CLIPS: Record<string, ClipPlain> = {
  k1: { id: "k1", createdAt: Date.now(), pinned: false, source: "Paint", kind: "image", text: null, sub: "Image", thumb: CLIP_IMAGE, screenshot: false },
  k2: { id: "k2", createdAt: Date.now(), pinned: false, source: "File Explorer", kind: "file", text: "q3-report.xlsx", sub: "1.2 MB", thumb: null, screenshot: false },
  k3: { id: "k3", createdAt: Date.now(), pinned: false, source: "Chrome", kind: "text", text: "https://example.com/reports/q3-summary", hint: "link", sub: null, thumb: null, screenshot: false },
};
const clipId = state === "k1b" ? "k1" : state;
if (clipId in CLIPS) setTimeout(() => fakeBridge.addClip(CLIPS[clipId]), 600);
if (state === "ilk2") fakeBridge.setFirstConnect(true);
if (state === "eo") fakeBridge.setConsent(CONSENT);
// Wave 5 mockup states: the fake bridge supplies the data instead of Rust
if (state === "sarj") fakeBridge.setBattery({ percent: 78, charging: true, plugged: true, remaining: "1h" });
if (state === "pil") fakeBridge.setBattery({ percent: 12, charging: false, plugged: false, remaining: "25m" });
if (state === "zs") fakeBridge.setTimer({ label: "Focus", totalS: 1500, remainingS: 45, running: true });
if (state === "zam") { fakeBridge.setMedia(null); fakeBridge.setTimer({ label: "Focus", totalS: 1500, remainingS: 1452, running: true }); } // mockup zam: the timer is the only job (with music playing it drops to the side bubble, see yb2)
if (state === "dik") { fakeBridge.setSurfaces({ protrusion: DICTATION }); setTimeout(() => fakeBridge.emit("plugin_stream", { streamId: "dictation-1", text: "let's meet with the team at nine tomorrow", speaker: "You" }), 300); }
if (state === "tik") fakeBridge.setSurfaces({ protrusion: TICKET });
if (state === "kay") fakeBridge.setSurfaces({ protrusion: { ...RECORDING, timer: { startedAt: new Date(Date.now() - 134_000).toISOString() } } });
if (state === "f0" || state === "f") fakeBridge.setSurfaces({ protrusion: PROTRUSION });
if (state === "g0" || state === "g") fakeBridge.setShelf([{ id: "f1", name: "presentation-draft.pdf", sub: "2.4 MB, just now", kind: "pdf" }, { id: "f2", name: "screen-recording.mp4", sub: "38 MB, 2m ago", kind: "video" }]);
if (param("mic", "") !== "") fakeBridge.setPrivacy({ mic: ["Chrome"], camera: [] });
// ?share: B1 screen share shield (the dot says "Screen is being shared"; Rust's input_tick turns presentation on, generic labels)
if (state === "pr") setTimeout(() => fakeBridge.emit("input_tick", { lastInputAgoMs: 60_000, cursor: null, presentation: true }), 1500);
if (param("share", "") !== "") { fakeBridge.setPrivacy({ mic: [], camera: [], screen: true }); setTimeout(() => fakeBridge.emit("input_tick", { lastInputAgoMs: 0, cursor: null, presentation: true }), 0); }
if (param("previewDelay", "") !== "") fakeBridge.setPreviewDelay(+param("previewDelay", "0"));
// ap: the logos-only strip's states: Discord asks for attention (amber pulsing dot), "Blitz" has no logo from Windows (letter circle)
if (state === "ap") void fakeBridge.call("list_windows", { monitor: "m1" }).then((ws) => fakeBridge.setWindows([...ws.map((w) => (w.appId === "discord" ? { ...w, attention: true } : w)), { appId: "exe:blitz", name: "Blitz", icon: "", hwnd: 90, title: "Blitz", active: false, monitor: "m1" }]));
if (state === "u") fakeBridge.pushAlert({ id: "cpu", title: "Chrome is maxing out the CPU", subtitle: "100% for 30 s", icon: "attention", action: "task_manager", priority: 70 });
if (state === "q1") fakeBridge.pushAlert({ id: "q1", title: "Daily budget at 80%", subtitle: "Automatic jobs paused, your requests still run", icon: "tired", progress: 0.8, priority: 70 });
if (state === "q2") fakeBridge.pushAlert({ id: "q2", title: "Claude quota reached", subtitle: "Available again in 1h 10m", icon: "tired", progress: 1, priority: 70 });
// Wave 4: kl Peeka locked; ?noplugins no main assistant (the ask-the-assistant row goes away); ?index=off Windows Search index off. In h3 the eye button gets pressed (nothing reveals by itself).
if (state === "kl") fakeBridge.setLocked(true, "manual");
if (param("locked", "") !== "") fakeBridge.setLocked(true, "manual"); // any state while locked (music or an alert on the locked strip)
if (param("noplugins", "") !== "") fakeBridge.setPlugins([]);
if (param("index", "") === "off") fakeBridge.setFilesIndex(false);
// RC4 wave 2: takvim = the clock's month calendar panel open (Shell)
// Wave 6: ?notice=1 Windows notification (m), ?mirror=ok|off|denied Settings toggle on plus a blocker (off = no readable notification history: "unavailable") (ayg)
if (param("notice", "") !== "") {
  fakeBridge.pushNotice({ id: "win.1", app: "Teams", title: "Emma Clarke", body: "Meeting moved to 3:00 PM, could you share the deck too?", tile: "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="3"/></svg>') });
  fakeBridge.pushNotice({ id: "win.2", app: "Outlook", title: "Weekly report", body: "Attachment: q3-report.xlsx", canOpen: false });
}
const mirror = param("mirror", "");
if (mirror) { fakeBridge.setMirror({ enabled: true, ...(mirror === "off" ? { history: false } : mirror === "denied" ? { access: "denied" } : {}) }); }
// Fidelity 3: gz hides the island temporarily (only the eye icon in the middle of the strip), h2 a clipboard item being dragged (source dimmed)
// n / n2: an incoming Windows notification becomes the top-right card in Shell; n2 shows the draft view as if "Let the assistant reply" was pressed
if (state === "n" || state === "n2") {
  setTimeout(() => fakeBridge.pushNotice({ id: "win.d", app: "Discord", title: "Sam", body: "Does 8 tonight work?" }), 400);
  if (state === "n2") setTimeout(() => document.querySelector<HTMLElement>(".toast .btn.assistant")?.click(), 1000);
}
if (state === "aye") fakeBridge.setPlugins([PLUGINS[0]]);
if (state === "m0") void fakeBridge.call("clear_alerts");
if (state === "gr" || state === "ms" || state === "nt" || state === "pr") fakeBridge.setPlugins([]); // a calm strip ghost: the fake assistant always reports 2 jobs and 1 approval, which win over reactions
if (state === "ms") setTimeout(() => fakeBridge.pushNotice({ id: "win.ms", app: "Discord", title: "Sam", body: "Does 8 tonight work?" }), 1500);
if (state === "dl") setTimeout(() => fakeBridge.emit("download_done", { id: "d1", name: "q3-report.xlsx", size: 1_200_000 }), 400);
if (state === "aym") fakeBridge.call("modules_set", { order: MODULES.map((m) => m.id), off: ["timer"] });
if (state === "gz") fakeBridge.call("island_hide", { on: true });
if (state === "h2") setClipboardDrag("c2");
const monitor = param("monitor", "m1");

/** The island or, while temporarily hidden, a single eye icon (in production the strip/island page does this with the same hook). */
function Center({ monitor: m, init }: { monitor: string; init: IslandInit }) {
  return <div className="islandWindow"><Island monitor={m} init={init} /></div>;
}
function MultiMonitor() {
  const screen = (id: string, w: number, name: string, desc: string) => {
    const k = w / 1920;
    return (
      <div className="monitor">
        <div className="face" style={{ width: w, height: 1080 * k }}><iframe title={name} src={`?state=a&monitor=${id}&time=${param("time", "")}`} style={{ transform: `scale(${k})` }} /></div>
        <p><b>{name}</b>{desc}</p>
      </div>
    );
  };
  return (
    <div className="multi"><div className="monitors">
      {screen("m1", 1040, "Main screen", "Full strip: Start, pins, this screen's windows, then volume, network, battery and clock on the right.")}
      {screen("m2", 720, "Second screen", "The same thin strip: Start and Search (the panel opens on this screen), this screen's windows and the clock. No island, assistant line or status icons.")}
    </div></div>
  );
}

// Assistant slots (ext.ts): the extension's fake answers and its own extra ?state= keys; none in Peeka itself.
const extPreview = ext()?.preview;
if (extPreview?.answer) fakeBridge.setAnswer(extPreview.answer);
extPreview?.states?.[state]?.(fakeBridge);
createRoot(document.getElementById("root")!).render(
  state === "k" ? <MultiMonitor /> : state === "eo" ? <div className="screen"><div className="wallpaper" /><Shell monitor={monitor} center={<div className="islandWindow"><Island monitor={monitor} init={{ view: null }} /></div>} /><ConsentWindow /></div> : <div className="screen"><div className="wallpaper" /><Shell monitor={monitor} init={SHELL_STATES[state]} center={monitor === "m1" ? <Center monitor={monitor} init={{ view: null, ...ISLAND_STATES[state] }} /> : undefined} /></div>,
);
