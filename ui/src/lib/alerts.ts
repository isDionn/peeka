import type { Alert } from "../bridge";

/** Highest priority first, newest first on ties, then id (same order as Rust). System alerts (100) stay above scripts (0..99). */
export const sortAlerts = (list: Alert[]): Alert[] => [...list].sort((a, b) => b.priority - a.priority || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));

/** Drops expired ones (`expiresAt` Unix ms). */
export const liveAlerts = (list: Alert[], now: number): Alert[] => list.filter((a) => a.expiresAt === null || a.expiresAt > now);

/** The alert that opens a peek: the highest-priority unseen one with `expand`. Takes a sorted list. */
export const pickProtrusion = (sorted: Alert[], seen: ReadonlySet<string>): Alert | null => sorted.find((a) => a.expand && !seen.has(a.id)) ?? null;

/** ms until the earliest alert expires (timer for refiltering); null if none expires. */
export function nextExpiry(list: Alert[], now: number): number | null {
  let best: number | null = null;
  for (const a of list) if (a.expiresAt !== null) { const t = a.expiresAt - now; if (t > 0 && (best === null || t < best)) best = t; }
  return best;
}


/** "now", "3m", "2h", "4d". */
export function ageLabel(seconds: number): string {
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/** Primary button label: if Rust sends `action: "task_manager"` it opens Task Manager; for a link just "Open". */
export const actionLabel = (a: { action: string | null }): string => (a.action === "task_manager" ? "Open Task Manager" : "Open");
