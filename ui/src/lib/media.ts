import type { Media } from "../bridge";

/** 84 -> "1:24". */
/** "3:05"; bir saati aşınca "1:03:25" (podcast, film: "83:25" okunmaz). */
export const fmtTime = (s: number) => {
  const t = Math.max(0, Math.floor(s)), sn = String(t % 60).padStart(2, "0");
  return t >= 3600 ? `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, "0")}:${sn}` : `${Math.floor(t / 60)}:${sn}`;
};
/** Zaman yuvası genişliği (ch): parçanın en uzun yazısı kadar; süre ilerlerken komşular kaymaz (9:59 -> 10:00). */
export const timeSlot = (durationSec: number | null): number => (durationSec ? fmtTime(durationSec).length : 4);

/** Parça süresi (sn); oynatıcı vermiyorsa null (çubuk yok). */
export const durationSec = (m: Media): number | null => (m.durationMs > 0 ? m.durationMs / 1000 : null);

/** Konum (sn): `positionAt` anındaki değere çalarken geçen süre eklenir, süreyi aşmaz (Rust `media::project` ile aynı kural). */
export function livePosition(m: Media, nowMs: number): number {
  const p = m.playing && m.positionAt > 0 && m.positionAt < nowMs ? m.positionMs + (nowMs - m.positionAt) : m.positionMs;
  return (m.durationMs > 0 ? Math.min(p, m.durationMs) : p) / 1000;
}

/** Aynı parça mı (yeni parçada çıkıntı kendiliğinden açılır, aynı parçanın konum güncellemesinde açılmaz). */
export const trackKey = (m: Media | null) => (m ? `${m.app}|${m.title}|${m.artist}` : "");

/** Oynatıcı adı vermezse (reklam, canlı yayın, bazı tarayıcı sekmeleri) boş satır yerine bu yazılır. */
export const trackTitle = (m: { title: string }): string => m.title.trim() || "Bilinmeyen parça";
