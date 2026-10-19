// M1: when the ghost shows more often (pure, tested). Short reactions ride only on calm moods and never while locked or presenting.
import type { Mood } from "./moods";

/** Every new reaction (greeting, message face, glance) lasts this long, then the real mood returns. */
export const REACT_MS = 1200;
/** Wink after listening ends. */
export const WINK_MS = 500;
/** The one-mascot cross-fade: the outgoing ghost fades out while the incoming one fades in (mascot.css uses the same number). */
export const FADE_MS = 160;

/** Moods a reaction may cover; anything that asks for the user (approval, question, error, quota...) or shows work is never covered. */
const CALM: ReadonlySet<Mood> = new Set(["idle", "drowsy", "tired", "sleeping"]);

/** The strip ghost's mood: `reaction` (hello, message) over a calm base; locked/presenting = never (no face may hint at content).
 *  The one exception is "shy" (a hand over the eyes as presentation mode turns on): it says nothing about content and is itself the privacy gesture. */
export function withReaction(base: Mood, reaction: Mood | null, priv: boolean): Mood {
  return reaction && (!priv || reaction === "shy") && CALM.has(base) ? reaction : base;
}

/** The ghost's mood in a strip event center (40 px). Locked/presenting = neutral idle. */
const EVENT_MOOD: Partial<Record<string, Mood>> = { download: "done", shot: "attention", jobdone: "done", cpu: "hot" };
export function eventMood(kind: string, priv: boolean): Mood | null {
  const m = EVENT_MOOD[kind];
  return m === undefined ? null : priv ? "idle" : m;
}

/** Listening just ended into a calm or working mood: a single wink (never into an alerting mood). */
const NO_WINK: ReadonlySet<Mood> = new Set(["approval", "question", "error", "ratelimit", "attention", "serious", "dizzy"]);
export const winkAfter = (prev: Mood, next: Mood) => prev === "listening" && next !== "listening" && !NO_WINK.has(next);

/** Late at night (23:00-05:59) a calm ghost gets sleepy. */
export const isNight = (hour: number) => hour >= 23 || hour < 6;

/** New ids in `next` that weren't in `seen` (a glance per new notification; the first list is silent). */
export const newIds = (seen: ReadonlySet<string> | null, next: readonly string[]) => (seen ? next.filter((id) => !seen.has(id)) : []);
