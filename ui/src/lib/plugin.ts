// Pure rules that filter plugin data before drawing (ADR-0062 §4.6). A plugin can't send HTML, links or icons; all text is plain text.
import type { PluginRef } from "../bridge";
import type { Mood } from "../mascot";

/** Accidental click guard: a button ignores clicks for its first 300 ms on screen. */
export const GUARD_MS = 300;

// control, zero-width and bidi formatting characters are dropped
// eslint-disable-next-line no-control-regex
const HIDDEN = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;
// separator lookalikes (faking a prefix like "assistant › Claude Code") become a plain character
const SEPARATORS = /[›»❯▸▶→>|]/g;

/** Plain text: hidden and direction control characters are dropped, cut to `max` units; a cut emoji isn't left half (a trailing lone high surrogate is dropped). Non-strings become empty text. */
export const plain = (v: unknown, max = 400): string => {
  if (typeof v !== "string") return "";
  const t = v.replace(HIDDEN, "").slice(0, max);
  return /[\ud800-\udbff]$/.test(t) ? t.slice(0, -1) : t;
};
/** Counter text: "99+" past 99 (badge and strip text don't widen). */
export const cap99 = (n: number): string => (n > 99 ? "99+" : String(n));
/** Initial letter (uppercased; emoji aren't split). */
export const initial = (v: string): string => Array.from(v)[0]?.toLocaleUpperCase("en-US") ?? "";
/** For titles and names: separators become plain characters too. */
export const flat = (v: unknown, max = 200): string => plain(v, max).replace(SEPARATORS, "-").trim();

/** The plugin's display name (from Peeka's own record); a generic name if empty. */
export const pluginName = (p: Pick<PluginRef, "name">): string => flat(p.name, 64) || "Plugin";

/** The name prefix at the start of every item. Peeka prints the prefix: whatever title the plugin sends, the name always comes first. */
export function prefixed(p: Pick<PluginRef, "name">, title: unknown): string {
  const n = pluginName(p), t = flat(title);
  return t && t.toLocaleLowerCase("en-US") !== n.toLocaleLowerCase("en-US") ? `${n} › ${t}` : n;
}

/** Risk: only exactly "low" is low; a missing or unknown field is high. */
export const riskOf = (risk: unknown): "low" | "high" => (risk === "low" ? "low" : "high");

/** Peeka's mascot state table (§0i); a plugin can't send other names. The names are plugin wire values. */
export const MASCOT_STATES = new Set(["ready", "listening", "thinking", "speaking", "approval", "serious", "error", "done", "music", "drowsy", "sleeping", "quiet", "tired", "attention", "searching", "question", "ratelimit", "dizzy", "happy", "surprised"]);   // "ratelimit".."dizzy" are Peeka's own states; Rust's plugin set is items.rs MASCOT_STATES
/** Plugin state name -> mascot mood (src/mascot/moods.ts). */
export const STATE_MOOD: Record<string, Mood> = {
  ready: "idle", listening: "listening", thinking: "thinking", speaking: "speaking", approval: "approval", serious: "serious", error: "error",
  done: "done", music: "music", drowsy: "drowsy", sleeping: "sleeping", quiet: "quiet", tired: "tired", attention: "attention",
  searching: "searching", question: "question", ratelimit: "ratelimit", dizzy: "dizzy",
  happy: "done", surprised: "attention", // plugin states without their own pose yet
};
export const moodOf = (state: string): Mood => STATE_MOOD[state] ?? "idle";
/** Mascot only for the main assistant and only in a table state; otherwise null (Peeka's initial tile is drawn). */
export const mascotOf = (p: Pick<PluginRef, "main">, state: unknown): string | null => (p.main && typeof state === "string" && MASCOT_STATES.has(state) ? state : null);

/** Only a PNG/JPEG `data:` image, at most ~256 KB (350,000 base64 characters); anything else is null. */
export const safeImage = (src: unknown): string | null =>
  typeof src === "string" && src.length <= 350_000 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(src) ? src : null;

/** Counter: 83 s -> "01:23", past an hour "1:02:03". */
export function elapsed(startedAt: string, nowMs: number): string {
  const t = Date.parse(startedAt);
  const s = Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 1000)) : 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}

/** At most 3 tabs per plugin (Rust cuts too; the page caps anyway). */
export const MAX_TABS = 3;
export function capTabs<T extends { plugin: { id: string } }>(tabs: T[]): T[] {
  const seen = new Map<string, number>();
  return tabs.filter((t) => { const n = (seen.get(t.plugin.id) ?? 0) + 1; seen.set(t.plugin.id, n); return n <= MAX_TABS; });
}
/** At most 3 rows per plugin in the "General" summary. */
export const MAX_SUMMARY = 3;
