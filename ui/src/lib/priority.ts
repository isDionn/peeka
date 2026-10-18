/**
 * Adada neyin ana şeritte, neyin yan baloncukta duracağının tek sırası (sahip kararı 2026-10-17; belge notch-50-senaryo.md 2. satır).
 * Saf işlev: saat, köprü ya da React yok; girdisi o anki canlı işlerin listesi.
 *
 * Sıra (küçük önce): onay > kopya şeridi (sahibin kendi hareketine yanıt, ~4 sn) > pil %10 > asistan/Claude canlı iş > toplantı > ağ koptu/geldi > uyarı > bildirim yağmuru > kota doldu > pil %20 > işlemci yoğun > zamanlayıcının son 60 sn'si > iş bitti > "sen yokken" özeti > müzik durdu > indirme bitti > müzik > zamanlayıcı > diğer eklenti.
 * - Pil: %20'de "battery" (uyarı katmanında), %10'da "batteryCrit" (canlı işin de üstünde); her kademe bir kez (lib/notes.ts).
 * - Uyarı (kritik pil sırası, belge 4. madde): Rust'ın dikkat bütçesi süzdü; canlı işi ve toplantıyı yerinden etmez ama müzik ve zamanlayıcının üstünde durur.
 * - İş bitti, bugünkü ilişkisini korur (müzikten önce): 3 sn'lik kısa şerit.
 * - İndirme: Rust `download_done` besler (İndirilenler klasörü, yalnız ad ve boyut); kısa (8 sn) çıkıntı olduğu için çalan müziğin önünde (sahip sırası "indirme sonda" kaynak yokken yazılmıştı).
 */
export type ActivityKind = "approval" | "clip" | "batteryCrit" | "live" | "meeting" | "net" | "alert" | "burst" | "rateLimit" | "battery" | "cpu" | "timerEnd" | "done" | "summary" | "musicStopped" | "download" | "music" | "timer" | "other";

export const RANK: Readonly<Record<ActivityKind, number>> = { approval: 0, clip: 1, batteryCrit: 2, live: 3, meeting: 4, net: 5, alert: 6, burst: 7, rateLimit: 8, battery: 9, cpu: 10, timerEnd: 11, done: 12, summary: 13, musicStopped: 14, download: 15, music: 16, timer: 17, other: 18 };

/** Zamanlayıcı son bu kadar saniyede müziğin önüne geçer. */
export const TIMER_END_S = 60;

/** Çalışan (ya da süresi dolmuş) zamanlayıcı son 60 sn'de "timerEnd"; duraklatılmışsa ya da daha uzunsa "timer". */
export const timerKind = (running: boolean, leftS: number): "timerEnd" | "timer" => (leftS <= TIMER_END_S && (running || leftS <= 0) ? "timerEnd" : "timer");

export interface Plan<T> { primary: T | null; secondary: T[] }

/**
 * `acts`: canlı işler (her türden en çok biri). `pinned`: kullanıcının baloncuktan öne aldığı tür; onay varken yok sayılır
 * (onay hiçbir zaman baloncuğa inmez). Dönen `secondary` sıralıdır: ilki baloncukta görünür, kalanı "+N" listesinde (N = secondary.length - 1; toplam iş 2'den fazlaysa).
 */
export function pickPrimary<T extends { kind: ActivityKind }>(acts: readonly T[], pinned: ActivityKind | null = null): Plan<T> {
  const sorted = [...acts].sort((a, b) => RANK[a.kind] - RANK[b.kind]); // Array.prototype.sort kararlı
  const i = pinned && sorted[0]?.kind !== "approval" ? sorted.findIndex((a) => a.kind === pinned) : -1;
  if (i > 0) sorted.unshift(...sorted.splice(i, 1));
  return { primary: sorted[0] ?? null, secondary: sorted.slice(1) };
}
