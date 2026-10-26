// The island page says whether it shows the clock in the middle (a same-origin BroadcastChannel). Since RC4 the strip's
// right-hand clock shows date and time always (owner), so nothing listens in the app; tests still read the channel.
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
