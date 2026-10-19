import { focusables } from "./useFocusTrap";
// The strip page and the island page are separate windows: their only link is a same-origin BroadcastChannel (same method as centerClock.ts).
// Strip -> island: which panel is open (short label in the middle), "show first run again", "open the reply view" (let the assistant reply in the notification mirror). Without a channel the message is silently dropped.
export type XMsg = { t: "panel"; panel: "search" | "settings" | "status" | "start" | "cleanup" | "notif" | null } | { t: "firstrun" } | { t: "ask" } | { t: "open-panel"; panel: "modules" }
  /** Strip -> island: a strip panel opened (Ctrl+K, gear, Start...). The island closes its open card, so one Esc closes the top surface. */
  | { t: "panel-open"; panel: string }
  /** Island -> strip: a click inside the island; the open strip panel closes. */
  | { t: "island-click" }
  /** Rust -> island: a click on the transparent area (outside the card); the open card closes. */
  | { t: "outside" }
  /** Tab order across windows (tabs -> island -> right group): strip -> island, focus to the island's first (or, with `end`, last) control. */
  | { t: "to-island"; end?: boolean }
  /** Island -> strip: focus to the first control of the right group or the last of the left group. */
  | { t: "to-strip"; side: "left" | "right" }
  /** Island -> strip: is the welcome card open (on launch, on every change and in reply to "welcome?"). While open the setup wizard waits. */
  | { t: "welcome"; open: boolean }
  /** Strip -> island: is the welcome card open? */
  | { t: "welcome?" };
const NAME = "notch-xwin";

export function sendX(m: XMsg) {
  try { if (typeof BroadcastChannel === "undefined") return; const c = new BroadcastChannel(NAME); c.postMessage(m); c.close(); } catch { /* no channel */ }
}

/** Listener; the returned function closes the channel. */
export function onX(cb: (m: XMsg) => void): () => void {
  let c: BroadcastChannel | null = null;
  try { c = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(NAME); } catch { return () => undefined; }
  if (!c) return () => undefined;
  c.onmessage = (e) => { if (e.data && typeof e.data.t === "string") cb(e.data as XMsg); };
  return () => c.close();
}

/** Is Tab/Shift+Tab leaving the window's last (first) control? If so the caller hands focus to the other window. */
export const tabLeaves = (e: { key: string; shiftKey: boolean; defaultPrevented?: boolean }, list: HTMLElement[], active: Element | null) =>
  e.key === "Tab" && !e.defaultPrevented && list.length > 0 && active === list[e.shiftKey ? 0 : list.length - 1];

/** Strip controls left and right of the middle gap (`.empty`). */
export function stripSides(header: HTMLElement) {
  const gap = header.querySelector(".empty"), all = focusables(header);
  const left = all.filter((el) => !gap || !!(el.compareDocumentPosition(gap) & Node.DOCUMENT_POSITION_FOLLOWING));
  return { left, right: all.filter((el) => !left.includes(el)) };
}

/** Focus arrived from another window via keyboard: show the focus ring. */
export const focusViaKeys = (el: HTMLElement | undefined) => { if (!el) return; document.documentElement.setAttribute("data-kb", ""); el.focus(); };
