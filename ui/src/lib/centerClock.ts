import { useEffect, useState } from "react";

// Ada sayfası ortada saati gösteriyorsa şerit sayfası sağdaki saatte yalnız tarihi yazar (bir bilgi bir kez).
// İki ayrı pencere: aynı kökenli BroadcastChannel. Kanal yoksa ya da ada hiç konuşmazsa sağdaki saat tam kalır.
const NAME = "notch-center-clock";
let chan: BroadcastChannel | null = null;
let current = false;
// Ada tarafı: son değeri tutar ve "?" isteğine yanıt verir (şerit sayfası ada konuşmadan sonra açılmış olabilir).
const open = () => {
  if (!chan && typeof BroadcastChannel !== "undefined") {
    chan = new BroadcastChannel(NAME);
    chan.onmessage = (e) => { if (e.data === "?") chan?.postMessage(current); };
  }
  return chan;
};

export function announceCenterClock(on: boolean) { current = on; try { open()?.postMessage(on); } catch { /* kanal yok */ } }

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
