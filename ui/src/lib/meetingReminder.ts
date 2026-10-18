import type { CalendarNext, PluginRef, ProtrusionItem } from "../bridge";
import { flat } from "./plugin";

/** Meeting reminder (plan row 22): for the next meeting from the assistant's calendar (`calendar_next`), a peek 5 min before, the main strip 1 min before. No sound. */
export const SOON_S = 300, NOW_S = 60, GRACE_S = 60;
export const REMINDER_GENERIC = "Meeting coming up";
/** The reminder doesn't come from a plugin; it's Peeka's own record (not the main assistant, no mascot). */
export const REMINDER_PLUGIN: PluginRef = { id: "peeka.calendar", name: "Calendar", main: false };
export type ReminderItem = ProtrusionItem & { link?: string };

/** `generic`: lock or presentation; no title and no link at all. The first row starting in ≤ 5 min or started ≤ 1 min ago; otherwise null. */
export function meetingReminder(cal: CalendarNext | null, nowMs: number, generic: boolean): ReminderItem | null {
  for (const e of cal?.next ?? []) {
    const startMs = e.start ? Date.parse(e.start) : NaN;
    const left = (startMs - nowMs) / 1000; // NaN: the row never enters the countdown
    if (!(left <= SOON_S && left > -GRACE_S)) continue;
    const now = left <= NOW_S;
    const when = left <= 0 ? "Started" : `In ${now ? 1 : Math.ceil(left / 60)} min`;
    const link = !generic && e.link ? e.link : undefined;
    return {
      plugin: REMINDER_PLUGIN, state: "attention", title: generic ? REMINDER_GENERIC : `${when}: ${flat(e.title, 60)}`,
      icon: now ? "calendar" : "clock", // "calendar" = the island's "meeting" rank (priority.ts); at 5 min an ordinary peek
      actions: link ? [{ id: "join", label: "Join", style: "primary" }] : [], link,
    };
  }
  return null;
}

/** "Join": Peeka has no page command that opens links (the shell opens only fixed settings URIs and alert links); once Rust gets `calendar_join`, this one line hooks into it. */
export let openJoinLink: (url: string) => Promise<void> = () => Promise.reject(new Error("open-url command missing"));
export const setOpenJoinLink = (f: typeof openJoinLink) => { openJoinLink = f; };
