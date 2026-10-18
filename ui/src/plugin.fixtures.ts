// Sample plugin data: the fake bridge, the browser preview and tests share these records (mockup states c1, c2, c2r, c3, j, eo, aye).
import type { ApprovalItem, CardBlock, ConsentRequest, MeterBlock, ModuleEntry, ModuleTab, PluginInfo, PluginRef, ProtrusionItem, SurfacesView } from "./plugin-api";

export const COMPASS: PluginRef = { id: "dev.example.compass", name: "Compass", main: true };
export const OTHER: PluginRef = { id: "com.example.assistant", name: "Sample Assistant", main: false };

export const EMPTY_SURFACES: SurfacesView = { protrusion: null, approvals: [], approvalTop: null, dropStripMs: null, tabs: [], summary: [], composer: null };

export const APPROVAL_LOW: ApprovalItem = {
  plugin: COMPASS, id: "ap-1", source: "Claude Code", title: "api-server needs approval", risk: "low", kind: "command",
  command: "npm run test -- --coverage", cwd: "~/projects/api-server", detail: "Opus, 38% of session quota",
  options: ["allow", "always", "deny"], alwaysLabel: "Bash(npm run test:*)", expiresS: 300,
};
export const APPROVAL_HIGH: ApprovalItem = {
  ...APPROVAL_LOW, id: "ap-2", title: "api-server wants to run a high-risk command", risk: "high",
  command: "git push --force origin main", detail: "Overwrites the remote branch history. Can't be undone.",
};
export const APPROVAL_CHOICE: ApprovalItem = {
  plugin: COMPASS, id: "ap-3", source: "Claude Code", title: "website is waiting for a choice", risk: "low", kind: "plan",
  detail: "Which way for the header? Approve the plan and I'll start.", options: ["allow", "deny"],
  choices: [{ id: "extend", label: "Extend the existing component" }, { id: "new", label: "Write a new component" }], freeText: true, expiresS: 600,
};

export const PROTRUSION: ProtrusionItem = {
  plugin: COMPASS, title: "Design review", subtitle: "2:45 PM, in 13 min", icon: "calendar", state: "info", mascot: "ready",
  actions: [{ id: "join", label: "Join", style: "primary" }],
};

/** Mockup dik / tik / kay: dictation, ticket and recording chips from a plugin (only `live_text`, `timer`, plain fields). */
export const DICTATION: ProtrusionItem = { plugin: COMPASS, title: "Dictation", state: "info", mascot: "listening", liveText: { streamId: "dictation-1" }, actions: [{ id: "finish", label: "Finish" }] };
export const TICKET: ProtrusionItem = { plugin: COMPASS, title: "New ticket", subtitle: "2 tickets in queue", icon: "ticket", state: "attention", actions: [{ id: "open", label: "Open draft", style: "primary" }, { id: "later", label: "Later" }] };
export const RECORDING: ProtrusionItem = {
  plugin: COMPASS, title: "Recording", subtitle: "Full screen, sound off", state: "danger", timer: { startedAt: "2026-10-16T14:30:00Z" },
  actions: [{ id: "pause", label: "Pause" }, { id: "stop", label: "Stop", style: "destructive" }],
};

export const SURFACES_FULL: SurfacesView = {
  protrusion: null,
  approvals: [APPROVAL_LOW],
  approvalTop: "ap-1",
  dropStripMs: null,
  tabs: [
    { plugin: COMPASS, id: "compass", title: "Compass", icon: "ghost", blocks: [
      { type: "heading", text: "Working on the desktop" },
      { type: "list", rows: [{ title: "Moving invoices to a folder", sub: "step 3/5", value: null }, { title: "3 note suggestions", sub: "Review" }] },
      { type: "progress", label: "Step 3/5", value: 0.6 },
      { type: "buttons", buttons: [{ id: "stop", label: "Stop", style: "destructive" }] },
    ] },
    { plugin: COMPASS, id: "claude", title: "Claude Code", icon: "terminal", blocks: [
      { type: "kv", rows: [{ k: "Session, 5h", v: "38%" }, { k: "Week", v: "61%" }] },
      { type: "text", text: "Today 1.2M tokens, 84 replies" },
    ] },
  ],
  summary: [{ plugin: COMPASS, rows: [{ title: "Working on the desktop", sub: "Moving invoices to a folder" }, { title: "1 job queued", value: "Team: 2 agents" }] }],
  composer: { ...COMPASS, voice: true },
};

export const CONSENT: ConsentRequest = {
  requestId: "rq-1", plugin: { id: "dev.example.compass", name: "Compass", publisher: "Example", version: "2.1" },
  program: { path: "C:\\Program Files\\Compass\\compass.exe", signedBy: null },
  lookalike: "Compass Core (connected plugin)",
  scopes: ["island.protrusion", "approvals.prompt", "composer.handler", "windows.read"],
  why: {
    "island.protrusion": "To show meeting and job status", "approvals.prompt": "For Claude Code approvals",
    "composer.handler": "For chat", "windows.read": "To know which app you're in",
  },
  expiresAt: 0, // the fake bridge writes Date.now()+112 s on open (the mockup's "1:52")
};

export const PLUGINS: PluginInfo[] = [
  {
    id: "dev.example.compass", name: "Compass", publisher: "Example", version: "2.1", connected: true, lastSeen: null, main: true, messages24h: 312, approvals24h: 4, lookalike: null, launch: "C:\\Program Files\\Compass\\compass.exe",
    scopes: [
      { scope: "island.protrusion", granted: true, uses24h: 41 }, { scope: "approvals.prompt", granted: true, uses24h: 4 },
      { scope: "composer.handler", granted: true, uses24h: 12 }, { scope: "card.module", granted: true, uses24h: 255 }, { scope: "windows.read", granted: true, uses24h: 0 },
    ],
  },
  {
    id: "com.example.assistant", name: "Sample Assistant", publisher: "Example", version: "1.2.0", connected: false, lastSeen: null, main: false, messages24h: 3, approvals24h: 0, lookalike: "Compass", launch: null,
    scopes: [{ scope: "island.protrusion", granted: true, uses24h: 3 }, { scope: "card.module", granted: false, uses24h: 0 }],
  },
];

// Core module ids are wire names shared with Rust (CORE_MODULES) and stay as they are.
export const MODULES: ModuleEntry[] = [
  ["general", "layout-grid", "General", 1, "Peeka"], ["music", "music", "Music", 1, "Peeka"], ["clipboard", "clipboard", "Clipboard", 1, "Peeka"], ["shelf", "inbox", "Shelf", 1, "Peeka"], ["calendar", "calendar", "Calendar", 1, "Peeka"],
  ["timer", "timer", "Timer", 1, "Peeka"], ["system", "cpu", "System", 1, "Peeka"], ["notifications", "bell", "Notifications", 1, "Peeka"],
  ["compass", "ghost", "Compass", 1, "Compass plugin"], ["claude code", "terminal", "Claude Code", 1, "Compass plugin"], ["team", "users", "Team", 1, "Compass plugin"],
].map(([id, icon, title, on, owner]) => ({ id: String(id), title: String(title), icon: String(icon), owner: String(owner), on: !!on }));

/* ---- sample data: mockup c3, j, d1, d3 ---- */
const meter = (m: Omit<MeterBlock, "type">): CardBlock => ({ type: "meter", ...m }) as unknown as CardBlock;

/** c3: the first choice is recommended (preselected on the card). */
export const withRecommended = (a: ApprovalItem): ApprovalItem => ({ ...a, choices: (a.choices ?? []).map((c, i) => ({ ...c, recommended: i === 0 })) });

const CLAUDE_TAB = {
  plugin: COMPASS, id: "claude", title: "Claude Code", icon: "terminal", general: true, blocks: [
    meter({ label: "Session, 5h", value: 0.38, text: "38%", note: "Resets in 2h 14m" }),
    meter({ label: "Week", value: 0.61, text: "61%", note: "Resets in 3 days", mark: 0.8 }),
    { type: "text", text: "Today 1.2M tokens, 84 replies" },
    { type: "list", rows: [
      { title: "api-server", sub: "waiting for approval", state: "waiting" }, { title: "website", sub: "editing Header.tsx", state: "running" }, { title: "data-cleanup", sub: "done, 10m ago", state: "done" },
    ] },
  ],
} as ModuleTab;
/** j: Compass | Claude Code | System. Summary rows in mockup order (working, notes, queue); the approval row slots in from the approval schema. */
export const SURFACES_J: SurfacesView = {
  protrusion: null, approvals: [{ plugin: COMPASS, id: "ap-j", source: "Claude Code", title: "Upload screen recording to Drive", risk: "low", kind: "other", options: ["allow", "deny"], expiresS: null }], approvalTop: null, dropStripMs: null,
  tabs: [
    { plugin: COMPASS, id: "compass", title: "Compass", icon: "ghost", blocks: [{ type: "heading", text: "Working on the desktop" }, { type: "text", text: "Moving invoices to a folder, step 3/5" }] },
    CLAUDE_TAB,
    { plugin: COMPASS, id: "team", title: "Team", icon: "users", blocks: [{ type: "text", text: "2 agents working, 1 job queued" }] },
  ],
  summary: [{ plugin: COMPASS, rows: [
    { title: "Working on the desktop", sub: "Moving invoices to a folder, step 3/5", icon: "pointer", state: "attention", action: { id: "stop", label: "Stop", style: "destructive" } },
    { title: "3 note suggestions", value: "Review", icon: "brain" },
    { title: "1 job queued", value: "Team: 2 agents working", icon: "list" },
  ] as unknown as SurfacesView["summary"][number]["rows"] }],
  composer: { ...COMPASS, voice: true },
};

/** d1 (thinking) and d3 (speaking): two-line transcript on the peek; the stream arrives via `plugin_stream` (the preview emits "You" and "Compass" lines). */
export const VOICE_THINKING = { plugin: COMPASS, title: "Thinking", state: "info", mascot: "thinking", transcript: { streamId: "voice" } } as ProtrusionItem;
export const VOICE_SPEAKING = { plugin: COMPASS, title: "Speaking", state: "info", mascot: "speaking", transcript: { streamId: "voice" } } as ProtrusionItem;
export const VOICE_YOU = "Remind me about tomorrow morning's meeting, and get the notes ready.";
export const VOICE_ASSISTANT = "Sure, I'll remind you at 9:15. I summarized the last three meeting notes into a new note.";
