import { useEffect, useState } from "react";

// If the island page shows the clock in the middle, the strip page's right-hand clock shows only the date (each fact once).
// Two separate windows: a same-origin BroadcastChannel. Without a channel, or if the island never speaks, the right clock stays complete.
const NAME = "notch-center-clock";
let chan: BroadcastChannel | null = null;
let current = false;
// Island side: keeps the last value and answers a "?" request (the strip page may have opened after the island spoke).
const open = () => {
  if (!chan && typeof BroadcastChannel !== "undefined") {
    chan = new BroadcastChannel(NAME);
    chan.onmessage = (e) => { if (e.data === "?") chan?.postMessage(current); };
  }
  return chan;
};

export function announceCenterClock(on: boolean) { current = on; try { open()?.postMessage(on); } catch { /* no channel */ } }

export function useCenterClock(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let c: BroadcastChannel | null = null;
    try { c = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(NAME); } catch { return; }
    if (!c) return;
    c.onmessage = (e) => { if (typeof e.data === "boolean") setOn(e.data); };
    c.postMessage("?");
    return () => c.close();
  }, []);
  return on;
}
