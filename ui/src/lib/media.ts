import type { Media } from "../bridge";

/** 84 -> "1:24". */
/** "3:05"; past an hour "1:03:25" (podcast, film: "83:25" is unreadable). */
export const fmtTime = (s: number) => {
  const t = Math.max(0, Math.floor(s)), ss = String(t % 60).padStart(2, "0");
  return t >= 3600 ? `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, "0")}:${ss}` : `${Math.floor(t / 60)}:${ss}`;
};
/** Time slot width (ch): as wide as the track's longest text; neighbors don't shift as time advances (9:59 -> 10:00). */
export const timeSlot = (durationSec: number | null): number => (durationSec ? fmtTime(durationSec).length : 4);

/** Track duration (s); null if the player doesn't give one (no bar). */
export const durationSec = (m: Media): number | null => (m.durationMs > 0 ? m.durationMs / 1000 : null);

/** Position (s): while playing, time elapsed since `positionAt` is added, capped at the duration (same rule as Rust `media::project`). */
export function livePosition(m: Media, nowMs: number): number {
  const p = m.playing && m.positionAt > 0 && m.positionAt < nowMs ? m.positionMs + (nowMs - m.positionAt) : m.positionMs;
  return (m.durationMs > 0 ? Math.min(p, m.durationMs) : p) / 1000;
}

/** Same track? (a new track opens the peek by itself; a position update of the same track doesn't). */
export const trackKey = (m: Media | null) => (m ? `${m.app}|${m.title}|${m.artist}` : "");

/** Shown instead of an empty row when the player gives no title (ads, live streams, some browser tabs). */
export const trackTitle = (m: { title: string }): string => m.title.trim() || "Unknown track";
