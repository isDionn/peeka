/** "While you were away" summary (row 38): when Do Not Disturb ends or you return from a long idle, counts what arrived meanwhile. Nothing is made up: only ids newly seen during the absence count. */
export const AWAY_IDLE_MS = 600_000; // 10 min (mascot sleeps after 2 min: mascot/ambient.ts IDLE_SLEEP_MS)
export const SUMMARY_MS = 8000;
export interface AwayCounts { notif: number; approval: number; done: number }

export function createAway() {
  let was = false;
  let seen = new Set<string>();
  let c: AwayCounts = { notif: 0, approval: 0, done: 0 };
  return {
    /** Called on every change. While `on` it counts new ids; when `on` turns off it returns the counts (if anything arrived). */
    sync(on: boolean, notif: readonly string[], approval: readonly string[]): AwayCounts | null {
      const ids = [...notif.map((i) => "n:" + i), ...approval.map((i) => "a:" + i)];
      if (on && !was) { was = true; seen = new Set(ids); c = { notif: 0, approval: 0, done: 0 }; return null; } // what already existed at the start doesn't count
      if (on) { for (const i of ids) if (!seen.has(i)) { seen.add(i); c[i[0] === "n" ? "notif" : "approval"]++; } return null; }
      if (!was) return null;
      was = false;
      return c.notif + c.approval + c.done > 0 ? c : null;
    },
    /** A job-done event (counted if it happens during the absence). */
    done() { if (was) c.done++; },
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** "While you were away: 3 notifications, 1 approval, 2 jobs done"; `generic` (lock or presentation) gives no counts. */
export function awayLabel(c: AwayCounts, generic = false): string {
  if (generic) return "While you were away: new activity";
  const p = [c.notif && plural(c.notif, "notification", "notifications"), c.approval && plural(c.approval, "approval", "approvals"), c.done && plural(c.done, "job done", "jobs done")].filter(Boolean);
  return "While you were away: " + p.join(", ");
}
