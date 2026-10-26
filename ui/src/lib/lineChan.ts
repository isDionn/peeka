// The assistant line, the strip ripple and "Open notifications" go from the island page to the strip page (separate windows; same method as centerClock.ts).
// The island keeps the last line state and answers when the strip asks "?" (the strip may have opened later).
export type LineMod = "idle" | "wait" | "listen" | "speak" | "off";
export interface LineState { color: string; mod: LineMod; /** Half the peek/card width + shoulder: the line breaks there (0 = no break). */ gap: number }
export type LineMsg = ({ k: "line" } & LineState) | { k: "wave"; color: string } | { k: "notif" } | { k: "?" };

const NAME = "notch-line";
export const LINE_IDLE: LineState = { color: "#8E8E93", mod: "idle", gap: 0 };
let chan: BroadcastChannel | null = null;
let current: LineState | null = null;

const open = () => {
  if (!chan && typeof BroadcastChannel !== "undefined") {
    chan = new BroadcastChannel(NAME);
    chan.onmessage = (e) => { if (e.data?.k === "?" && current) chan?.postMessage({ k: "line", ...current }); };
  }
  return chan;
};
const post = (m: LineMsg) => { try { open()?.postMessage(m); } catch { /* no channel */ } };

export const announceLine = (s: LineState) => { if (current && current.color === s.color && current.mod === s.mod && current.gap === s.gap) return; current = s; post({ k: "line", ...s }); };
export const announceWave = (color: string) => post({ k: "wave", color });
export const announceNotif = () => post({ k: "notif" });

/** Surfaces hanging from the strip in this window (panels, context menus): the line breaks over each [left, right] (client px), as it does over the island. */
const gaps = new Map<string, readonly [number, number]>();
const gapSubs = new Set<() => void>();
export function setStripGap(id: string, g: readonly [number, number] | null) {
  const o = gaps.get(id);
  if (g ? o?.[0] === g[0] && o?.[1] === g[1] : !o) return;
  if (g) gaps.set(id, g); else gaps.delete(id);
  gapSubs.forEach((f) => f());
}
export function listenStripGaps(cb: (g: (readonly [number, number])[]) => void): () => void {
  const f = () => cb([...gaps.values()]);
  gapSubs.add(f); f();
  return () => { gapSubs.delete(f); };
}

/** Strip side: listener (first asks for the last state); the returned function closes the channel. */
export function listenLine(cb: (m: LineMsg) => void): () => void {
  let c: BroadcastChannel | null = null;
  try { c = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(NAME); } catch { return () => undefined; }
  if (!c) return () => undefined;
  c.onmessage = (e) => { if (e.data && typeof e.data.k === "string") cb(e.data as LineMsg); };
  c.postMessage({ k: "?" });
  return () => c.close();
}
