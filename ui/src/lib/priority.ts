/**
 * The single ranking of what sits on the island's main strip and what goes to the side bubble (owner decision 2026-10-17; doc notch-50-senaryo.md row 2).
 * Pure function: no clock, bridge or React; the input is the list of current live jobs.
 *
 * Order (lower first): approval > copy strip (reply to the owner's own action, ~4 s) > battery 10% > assistant/Claude live job > meeting > network lost/back > alert > notification burst > quota reached > battery 20% > CPU busy > timer's last 60 s > job done > "while you were away" summary > music stopped > download done > music > timer > other plugin.
 * - Battery: "battery" at 20% (alert tier), "batteryCrit" at 10% (above live jobs too); each tier once (lib/notes.ts).
 * - Alert (critical battery rank, doc item 4): already filtered by Rust's attention budget; doesn't displace a live job or meeting but sits above music and timer.
 * - Job done keeps today's relation (before music): a short 3 s strip.
 * - Edit: Claude Code's last file edit from Peeka's own hook (`cc_edit`); it is the hook's live job, so it ranks with "live" (pushed after it).
 * - Download: fed by Rust `download_done` (Downloads folder, name and size only); a short (8 s) peek, so it goes ahead of playing music (the owner's "download last" order was written before there was a source).
 */
export type ActivityKind = "approval" | "clip" | "batteryCrit" | "live" | "edit" | "meeting" | "net" | "alert" | "burst" | "rateLimit" | "battery" | "cpu" | "timerEnd" | "done" | "summary" | "musicStopped" | "download" | "music" | "timer" | "other";

export const RANK: Readonly<Record<ActivityKind, number>> = { approval: 0, clip: 1, batteryCrit: 2, live: 3, edit: 3, meeting: 4, net: 5, alert: 6, burst: 7, rateLimit: 8, battery: 9, cpu: 10, timerEnd: 11, done: 12, summary: 13, musicStopped: 14, download: 15, music: 16, timer: 17, other: 18 };

/** In its last this-many seconds the timer goes ahead of music. */
export const TIMER_END_S = 60;

/** A running (or finished) timer in its last 60 s is "timerEnd"; paused or longer is "timer". */
export const timerKind = (running: boolean, leftS: number): "timerEnd" | "timer" => (leftS <= TIMER_END_S && (running || leftS <= 0) ? "timerEnd" : "timer");

export interface Plan<T> { primary: T | null; secondary: T[] }

/**
 * `acts`: live jobs (at most one per kind). `pinned`: the kind the user brought forward from the bubble; ignored while an approval exists
 * (an approval never drops to the bubble). The returned `secondary` is ordered: the first shows in the bubble, the rest in the "+N" list (N = secondary.length - 1; when there are more than 2 jobs).
 */
export function pickPrimary<T extends { kind: ActivityKind }>(acts: readonly T[], pinned: ActivityKind | null = null): Plan<T> {
  const sorted = [...acts].sort((a, b) => RANK[a.kind] - RANK[b.kind]); // Array.prototype.sort is stable
  const i = pinned && sorted[0]?.kind !== "approval" ? sorted.findIndex((a) => a.kind === pinned) : -1;
  if (i > 0) sorted.unshift(...sorted.splice(i, 1));
  return { primary: sorted[0] ?? null, secondary: sorted.slice(1) };
}
