import type { Mood } from "./moods";
import { isNight } from "./react";

export const IDLE_SLEEP_MS = 120_000;
export const BATTERY_TIRED = 20;
export const BATTERY_DOZE = 10;

export interface AmbientIn {
  /** Base mood; ambient moods only ride on a calm "idle" (approvals, jobs and alerts are never covered). */
  base: Mood;
  batteryPercent: number | null;
  /** Plugged in or charging: low-battery moods go away. */
  powered: boolean;
  /** Just plugged in (a short burst of joy). */
  justPlugged: boolean;
  idleMs: number;
  /** Local hour (0-23); late at night a calm ghost is drowsy. Absent = no time-of-day mood. */
  hour?: number;
}

/** Ambient moods. CPU sweat is left out on purpose for lack of a data source: sysmon only runs while Modules is open. */
export function ambientMood(i: AmbientIn): Mood {
  if (i.base !== "idle") return i.base;
  if (i.justPlugged) return "done";
  if (i.idleMs >= IDLE_SLEEP_MS) return "sleeping";
  if (!i.powered && i.batteryPercent !== null) {
    if (i.batteryPercent < BATTERY_DOZE) return "drowsy";
    if (i.batteryPercent < BATTERY_TIRED) return "tired";
  }
  if (i.hour !== undefined && isNight(i.hour)) return "drowsy";
  return "idle";
}
