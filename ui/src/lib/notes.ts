/** Pure logic for the small peeks (used by Island.tsx): battery tiers, notification burst, Claude Code session count. No clock, no React. */
import type { CcEvent } from "../mascot/ccMood";
import type { CcEdit } from "../bridge";
import { flat } from "./plugin";

/** Battery: 20 once on reaching 20%, 10 once on reaching 10%. Resets when plugged in. A direct drop to 8% gives only 10 (20 counts as spent too). */
export function createBatteryTiers() {
  const fired = new Set<number>();
  return {
    feed(percent: number | null, powered: boolean): 10 | 20 | null {
      if (powered) { fired.clear(); return null; }
      if (percent === null) return null;
      const t = percent <= 10 ? 10 : percent <= 20 ? 20 : null;
      if (!t || fired.has(t)) return null;
      fired.add(t); if (t === 10) fired.add(20);
      return t;
    },
  };
}

export interface Burst { n: number; apps: string[] }
/** If `n` or more NEW notifications arrive within `windowMs`: the count and app names (unique, in arrival order). The first list silently becomes the baseline. */
export function createBurst(n = 6, windowMs = 5000) {
  let seen: Set<string> | null = null;
  let recent: { t: number; app: string }[] = [];
  return {
    feed(items: readonly { id: string; app: string }[], now: number): Burst | null {
      if (seen === null) { seen = new Set(items.map((i) => i.id)); return null; }
      for (const i of items) if (!seen.has(i.id)) { seen.add(i.id); recent.push({ t: now, app: i.app }); }
      recent = recent.filter((r) => now - r.t <= windowMs);
      if (recent.length < n) return null;
      const out = { n: recent.length, apps: [...new Set(recent.map((r) => r.app))] };
      recent = [];
      return out;
    },
  };
}
/** "6 new notifications: Discord, Outlook…" (at most 2 names; "…" for more). `generic`: lock or presentation, no names. */
export const burstLabel = (count: number, apps: readonly string[], generic = false) =>
  generic ? "New notifications" : `${count} new notifications: ${apps.slice(0, 2).join(", ")}${apps.length > 2 ? "…" : ""}`;

/**
 * Claude plan limit, from Peeka's own hook: on with `stop_failure`+`rate_limit`, off with the next successful `stop` or Claude Code's
 * `quota_auto_resume_fired` notification. Hooks carry no fill level or reset time (only the status line JSON does), so this is on/off only.
 */
export const ccLimit = (on: boolean, e: { kind: string; reason?: string | null }) =>
  e.kind === "stop_failure" && e.reason === "rate_limit" ? true : e.kind === "stop" || (e.kind === "notification" && e.reason === "quota_auto_resume_fired") ? false : on;

export interface CcSession { sid: string; agent: string; tool: string | null; at: number; /** `cc_event` `origin`; the last one seen is kept. */ origin?: string | null }

/** Each coding agent's name and accent (a dot in the sessions list; the mascot stays one ghost). Unknown ids fall back to Claude Code's. */
export const AGENTS: Record<string, { name: string; color: string }> = {
  claude: { name: "Claude Code", color: "#d97757" },
  codex: { name: "Codex", color: "#10a37f" },
  cursor: { name: "Cursor", color: "#9aa4b2" },
  gemini: { name: "Gemini", color: "#4f8df5" },
  copilot: { name: "Copilot", color: "#a371f7" },
  opencode: { name: "OpenCode", color: "#e5c07b" },
};
export const agentOf = (id?: string | null) => AGENTS[id ?? "claude"] ?? AGENTS.claude;
/** A session's subtle origin label; a terminal (the usual case) and anything unknown show none. */
export const originLabel = (o?: string | null) => ({ desktop: "Desktop", cursor: "Cursor", vscode: "VS Code" } as Record<string, string>)[o ?? ""] ?? null;

/**
 * Open Claude Code sessions, from Peeka's own hook (`cc_event`). The hook sends not the session id but a salted 8-character hash
 * (`sid`): events with a `sid` are tracked by hash (with each session's last tool), `session_end` removes the session, and a session
 * quiet for `quietMs` drops (re-added if a new event arrives). Events without a `sid` (main assistant) use the old counter: session_start +1, session_end -1,
 * shortcut: a crashed session inflates the count and sessions started before Peeka aren't counted; it resets after `staleMs` without events.
 */
export function createCcSessions(staleMs = 3_600_000, quietMs = 1_800_000) {
  let anon = 0, last = 0;
  const known = new Map<string, CcSession>();
  const prune = (now: number) => {
    for (const [k, v] of known) if (now - v.at > quietMs) known.delete(k);
    if (anon > 0 && now - last > staleMs) anon = 0;
  };
  return {
    feed(e: CcEvent, now: number): number {
      prune(now);
      if (e.sid) {
        if (e.kind === "session_end") known.delete(e.sid);
        else known.set(e.sid, { sid: e.sid, agent: e.agent ?? "claude", tool: e.tool ?? known.get(e.sid)?.tool ?? null, at: now, origin: e.origin ?? known.get(e.sid)?.origin ?? null }); // re-setting keeps the order: "Session 1" stays in place
      } else {
        last = now;
        if (e.kind === "session_start") anon++;
        else if (e.kind === "session_end") anon = Math.max(0, anon - 1);
      }
      return known.size + anon;
    },
    /** Current count after dropping timed-out sessions (even without new events). */
    count(now: number): number { prune(now); return known.size + anon; },
    /** Sessions with a known id, in first-seen order. */
    list(now: number): CcSession[] { prune(now); return [...known.values()]; },
  };
}

/** Claude Code's last edit (Rust `cc_edit`): file name and +N −M. `generic` (locked or presenting; Rust then sends no name either): one label, no name, no counts. */
export const editLabel = (e: CcEdit, generic: boolean) =>
  generic || e.file === null ? "Claude Code is editing" : `${flat(e.file.split("/").pop() ?? e.file, 40)} +${e.add ?? 0} −${e.del ?? 0}`;
