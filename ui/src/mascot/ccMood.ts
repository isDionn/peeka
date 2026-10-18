// Claude Code hook event -> mascot mood (pure). The event reaches Peeka via the main assistant's `cc.event` call (Rust: `cc_event`).
// Rationale and table: notch/docs/plugin-api.md `cc.event`. Drop timeouts: the hook sometimes goes quiet (an interrupted turn sends no Stop), so the face doesn't get stuck.
import type { Mood } from "./moods";

export interface CcEvent { kind: string; tool?: string | null; reason?: string | null; /** Session tag: a salted 8-hex-digit hash of the Claude Code session id (Rust). Absent if the main assistant doesn't send it. */ sid?: string | null }

const SEARCH_TOOLS = /^(WebSearch|WebFetch|Grep|Glob)$|search/i;
const QUESTION_TOOLS = /^(AskUserQuestion|ExitPlanMode)$/;

/** The mood the event asks for; null = no change (e.g. a subagent finished). `idle` = clear. */
export function ccMoodOf(e: CcEvent): Mood | null {
  switch (e.kind) {
    case "session_start": case "session_end": return "idle";
    case "prompt": case "post_tool": case "subagent_start": return "thinking";
    case "pre_tool": return QUESTION_TOOLS.test(e.tool ?? "") ? "question" : SEARCH_TOOLS.test(e.tool ?? "") ? "searching" : "thinking";
    case "permission": return "approval";
    case "tool_failed": return "error";
    case "notification": return e.reason === "permission_prompt" ? "approval" : e.reason === "elicitation_dialog" ? "question" : e.reason === "idle_prompt" ? "attention" : null;
    case "stop": return "done";
    case "stop_failure": return e.reason === "rate_limit" ? "ratelimit" : "error";
    default: return null;
  }
}

/** How long a mood lasts before idle (ms). Done 5 s (owner decision); working moods drop after 2 min of silence. */
export const CC_HOLD_MS: Partial<Record<Mood, number>> = {
  done: 5_000, error: 5_000, ratelimit: 30_000, attention: 60_000, approval: 300_000, question: 300_000, thinking: 120_000, searching: 120_000,
};

/** Turns events into moods, `set(null)` (back to idle) when time runs out. `set(null)` = no mood from Claude Code. */
// The wrapping is required: calling `timer.clear(t)` with this=timer throws "Illegal invocation" in the browser (hook events were throwing in the real window).
export function createCcMood(set: (m: Mood | null) => void, timer: { set: typeof setTimeout; clear: typeof clearTimeout } = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t) }) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return {
    feed(e: CcEvent) {
      const m = ccMoodOf(e);
      if (m === null) return;
      timer.clear(t);
      if (m === "idle") { set(null); return; }
      set(m);
      const ms = CC_HOLD_MS[m];
      if (ms) t = timer.set(() => set(null), ms);
    },
    dispose() { timer.clear(t); },
  };
}
