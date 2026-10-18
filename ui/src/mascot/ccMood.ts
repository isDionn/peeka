// Claude Code kancası olayı -> maskot hali (saf). Olay Peeka'ya ana asistanın `cc.event` çağrısıyla gelir (Rust: `cc_event`).
// Gerekçe ve tablo: notch/docs/eklenti-api.md `cc.event`. Düşme süreleri: kanca bazen susar (kesilen tur Stop göndermez), yüz takılı kalmasın.
import type { Mood } from "./moods";

export interface CcEvent { kind: string; tool?: string | null; reason?: string | null; /** Oturum etiketi: Claude Code oturum kimliğinin tuzlu 8 onaltılık özeti (Rust). Ana asistan göndermezse yok. */ sid?: string | null }

const SEARCH_TOOLS = /^(WebSearch|WebFetch|Grep|Glob)$|search/i;
const QUESTION_TOOLS = /^(AskUserQuestion|ExitPlanMode)$/;

/** Olayın istediği hal; null = değişiklik yok (örn. alt ajan bitti). `idle` = temizle. */
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

/** Hal ne kadar sürer, sonra idle (ms). Bitti 5 sn (sahip kararı); çalışma halleri 2 dk sessizlikten sonra düşer. */
export const CC_HOLD_MS: Partial<Record<Mood, number>> = {
  done: 5_000, error: 5_000, ratelimit: 30_000, attention: 60_000, approval: 300_000, question: 300_000, thinking: 120_000, searching: 120_000,
};

/** Olayları hale çevirir, süre dolunca `set(null)` (idle'a dön). `set(null)` = Claude Code'dan kaynaklı hal yok. */
// Sarmalama şart: `timer.clear(t)` this=timer ile çağrılınca tarayıcıda "Illegal invocation" verir (gerçek pencerede kanca olayları hata atıyordu).
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
