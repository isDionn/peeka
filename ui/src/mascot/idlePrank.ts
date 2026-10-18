// Idle prank scheduler (FPV §0i item 19, owner decision 8): once every 45-90 min, at most 6 a day, can be turned off.
// Pure: clock, randomness and "is something blocking right now" are passed in; no timer of its own, the owner calls poll() (~1 s).
export const PRANK_MIN_MS = 45 * 60_000;
export const PRANK_MAX_MS = 90 * 60_000;
export const PRANK_PER_DAY = 6;
export const INPUT_QUIET_MS = 3_000;

export interface PrankEnv {
  now(): number;
  random(): number;
  enabled(): boolean;          // Settings > "Mascot pranks"
  lastInputAgoMs(): number;    // GetLastInputInfo
  fullscreen(): boolean;
  dnd(): boolean;              // Peeka Do Not Disturb or QUNS_BUSY
  presentation(): boolean;     // QUNS_PRESENTATION_MODE
  meeting(): boolean;
  cardOpen(): boolean;
  musicPlaying(): boolean;
}

export type PrankResult = "fired" | "wait" | "off" | "daily-limit" | "input" | "fullscreen" | "dnd" | "presentation" | "meeting" | "card" | "music";

export function createIdlePrank(env: PrankEnv, onPrank: () => void) {
  let nextAt: number | null = null;
  let day = "";
  let today = 0;
  const gap = () => PRANK_MIN_MS + env.random() * (PRANK_MAX_MS - PRANK_MIN_MS);

  function poll(): PrankResult {
    const now = env.now();
    if (!env.enabled()) { nextAt = null; return "off"; }   // turning it on restarts the countdown, no backlog of pranks fires
    if (nextAt === null) nextAt = now + gap();
    if (now < nextAt) return "wait";
    const d = new Date(now).toDateString();
    if (d !== day) { day = d; today = 0; }
    if (today >= PRANK_PER_DAY) { nextAt = now + gap(); return "daily-limit"; }
    const blocked: [boolean, PrankResult][] = [
      [env.lastInputAgoMs() < INPUT_QUIET_MS, "input"], [env.fullscreen(), "fullscreen"], [env.dnd(), "dnd"],
      [env.presentation(), "presentation"], [env.meeting(), "meeting"], [env.cardOpen(), "card"], [env.musicPlaying(), "music"],
    ];
    const hit = blocked.find(([b]) => b);
    if (hit) return hit[1];   // it's due; fires on the first poll after the block lifts; the minimum gap still holds
    today++;
    nextAt = now + gap();
    onPrank();
    return "fired";
  }
  return { poll };
}
