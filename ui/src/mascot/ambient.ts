import type { Mood } from "./moods";

export const IDLE_SLEEP_MS = 120_000;
export const BATTERY_TIRED = 20;
export const BATTERY_DOZE = 10;

export interface AmbientIn {
  /** Temel hal; ortam halleri yalnız sakin "idle" üstüne biner (onay, iş, uyarı hiçbir zaman örtülmez). */
  base: Mood;
  batteryPercent: number | null;
  /** Prizde ya da şarj oluyor: düşük pil halleri kalkar. */
  powered: boolean;
  /** Prize yeni takıldı (kısa neşe). */
  justPlugged: boolean;
  idleMs: number;
}

/** CouCou ortam halleri (analiz §4.2). Veri kaynağı olmayan CPU teri bilerek yok: sysmon yalnız Modüller açıkken çalışır. */
export function ambientMood(i: AmbientIn): Mood {
  if (i.base !== "idle") return i.base;
  if (i.justPlugged) return "done";
  if (i.idleMs >= IDLE_SLEEP_MS) return "sleeping";
  if (!i.powered && i.batteryPercent !== null) {
    if (i.batteryPercent < BATTERY_DOZE) return "drowsy";
    if (i.batteryPercent < BATTERY_TIRED) return "tired";
  }
  return "idle";
}
