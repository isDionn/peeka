// asistan çizgisi, şerit dalgası ve "Bildirimleri aç" ada sayfasından şerit sayfasına gider (ayrı pencereler; centerClock.ts ile aynı yöntem).
// Ada son çizgi durumunu tutar ve şerit "?" diye sorunca yanıtlar (şerit sonradan açılmış olabilir).
export type LineMod = "bos" | "bekle" | "dinle" | "konus" | "yok";
export interface LineState { color: string; mod: LineMod; /** Çıkıntı/kart genişliğinin yarısı + omuz: çizgi orada kesilir (0 = kesik yok). */ gap: number }
export type LineMsg = ({ k: "line" } & LineState) | { k: "wave"; color: string } | { k: "notif" } | { k: "?" };

const NAME = "notch-line";
export const LINE_IDLE: LineState = { color: "#8E8E93", mod: "bos", gap: 0 };
let chan: BroadcastChannel | null = null;
let current: LineState | null = null;

const open = () => {
  if (!chan && typeof BroadcastChannel !== "undefined") {
    chan = new BroadcastChannel(NAME);
    chan.onmessage = (e) => { if (e.data?.k === "?" && current) chan?.postMessage({ k: "line", ...current }); };
  }
  return chan;
};
const post = (m: LineMsg) => { try { open()?.postMessage(m); } catch { /* kanal yok */ } };

export const announceLine = (s: LineState) => { if (current && current.color === s.color && current.mod === s.mod && current.gap === s.gap) return; current = s; post({ k: "line", ...s }); };
export const announceWave = (color: string) => post({ k: "wave", color });
export const announceNotif = () => post({ k: "notif" });

/** Şerit tarafı: dinleyici (ilk iş son durumu sorar); dönen işlev kanalı kapatır. */
export function listenLine(cb: (m: LineMsg) => void): () => void {
  let c: BroadcastChannel | null = null;
  try { c = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(NAME); } catch { return () => undefined; }
  if (!c) return () => undefined;
  c.onmessage = (e) => { if (e.data && typeof e.data.k === "string") cb(e.data as LineMsg); };
  c.postMessage({ k: "?" });
  return () => c.close();
}
