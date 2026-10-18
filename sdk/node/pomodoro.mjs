// MIT License (pending owner confirmation) - Copyright (c) Peeka authors.
// Pomodoro example: a focus timer on the island, with an alert when a phase ends. No network, no files.
// Run: POMODORO_WORK_MIN=25 POMODORO_BREAK_MIN=5 node pomodoro.mjs
//
// API gap: the contract's `timer` only counts UP from `started_at`; there is no countdown field. So the title carries the
// minutes left (re-sent once a minute, well inside the rate limits) and `progress` fills as the phase runs; the live
// `timer` shows elapsed time. Island buttons come back as `action {id}` (at most 2 per protrusion).
import { fileURLToPath } from "node:url";
import { runPlugin } from "./plugin-runner.mjs";

export const MANIFEST = {
  id: "com.example.pomodoro", name: "Pomodoro", publisher: "Example", version: "0.1.0", api: 1,
  scopes: ["island.protrusion", "alerts.post"],
  why: { "island.protrusion": "Show the countdown in the island", "alerts.post": "Alert you when a work or break phase ends" },
};

export function config(env = process.env) {
  const mins = (v, d) => (v === undefined ? d : Number(v));
  const work = mins(env.POMODORO_WORK_MIN, 25), rest = mins(env.POMODORO_BREAK_MIN, 5);
  if (!(work > 0 && rest > 0)) throw new Error("POMODORO_WORK_MIN / POMODORO_BREAK_MIN must be positive numbers");
  return { work: work * 60, break: rest * 60 };
}

export const start = (cfg) => ({ phase: "work", left: cfg.work, running: true });

/** Pure state machine: advance `dt` seconds. Returns the new state and the phase that just ended (or null). */
export function tick(s, dt, cfg) {
  if (!s.running) return { s, ended: null };
  const left = s.left - dt;
  if (left > 0) return { s: { ...s, left }, ended: null };
  const phase = s.phase === "work" ? "break" : "work"; // flips and keeps running; leftover time is dropped
  return { s: { phase, left: cfg[phase], running: true }, ended: s.phase };
}

/** Button ids: toggle (pause/resume) and skip (end the phase now). */
export function press(s, id, cfg) {
  if (id === "toggle") return { ...s, running: !s.running };
  if (id === "skip") return tick({ ...s, running: true }, s.left, cfg).s;
  return s;
}

const label = { work: "Work", break: "Break" };

export function protrusion(s, cfg, now = Date.now()) {
  const total = cfg[s.phase], mins = Math.ceil(s.left / 60);
  return {
    title: s.running ? `${label[s.phase]}: ${mins} min left` : `${label[s.phase]} paused: ${mins} min left`,
    icon: "timer", state: s.running ? (s.phase === "work" ? "info" : "done") : "idle",
    progress: 1 - s.left / total,
    // elapsed time as Peeka counts it; omitted while paused so it does not keep running
    ...(s.running && { timer: { started_at: new Date(now - (total - s.left) * 1000).toISOString().replace(/\.\d+Z$/, "Z") } }),
    actions: [{ id: "toggle", label: s.running ? "Pause" : "Resume" }, { id: "skip", label: "Skip" }],
  };
}

export const alert = (ended) => ({
  id: "pomodoro", title: ended === "work" ? "Work done, take a break" : "Break over, back to work",
  icon: ended === "work" ? "check" : "timer", priority: 50,
});

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cfg = config();
  let s = start(cfg), send;
  const render = () => send?.("island.protrusion.set", protrusion(s, cfg));
  const key = () => `${s.phase}${Math.ceil(s.left / 60)}${s.running}`;
  setInterval(() => { // 1 s clock; Peeka is updated only when the minute, phase or running state changes
    const before = key(), r = tick(s, 1, cfg);
    s = r.s;
    if (r.ended) send?.("alerts.post", alert(r.ended));
    if (key() !== before) render();
  }, 1000);
  runPlugin({
    manifest: MANIFEST,
    start(sendFn) { send = sendFn; render(); return () => { send = undefined; }; },
    onNotification(msg) {
      if (msg.method === "action") { s = press(s, msg.params?.id, cfg); render(); }
    },
  });
}
