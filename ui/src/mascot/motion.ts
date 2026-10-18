// Maskot hareket sayıları (saf, test edilir). Süre ve değerler: docs/research/2026-10-16-coucou-mochi-analizi.md §7.
// Sayıların kaynağı CouCou (MIT, Louis-CFM/coucou, windows/src/mochi/engine.ts) davranışı; kod değil ilke olarak uyarlandı, bkz. docs/THIRD_PARTY_NOTICES.md.

/** Anahtar kare izi: her adım [hedef değer, süre ms]; başlangıç değeri ayrıca verilir. */
export type Track = readonly (readonly [number, number])[];

export const trackMs = (tr: Track) => tr.reduce((a, [, d]) => a + d, 0);

/** t ms'deki değer: her parça kendi içinde yumuşak (smoothstep), uçlarda hız 0 (titremede yön değişimi doğal). */
export function sample(tr: Track, from: number, t: number): number {
  let v = from, at = 0;
  for (const [to, d] of tr) {
    if (t < at + d) { const u = (t - at) / d; return v + (to - v) * u * u * (3 - 2 * u); }
    v = to; at += d;
  }
  return v;
}

/** Hata titremesi (px, 56 px kart için; büyük kartta size/56 ile ölçeklenir): +4, -4, +2,5, 0 / 50, 70, 70, 90 ms. */
export const SHAKE: Track = [[4, 50], [-4, 70], [2.5, 70], [0, 90]];
export const shakeTrack = (size: number): Track => SHAKE.map(([v, d]) => [v * (size / 56), d] as const);

/** Dosya yutma: sy 1 -> 0,78 -> 1,18 -> 1 (80/130/220 ms); sx tersine. Ağız 460 ms açık. */
export const SWALLOW_Y: Track = [[.78, 80], [1.18, 130], [1, 220]];
export const SWALLOW_X: Track = [[1.28, 80], [.92, 130], [1, 220]];
export const SWALLOW_MOUTH_MS = 460;
/** Yutma sonrası çiğneme: dosya simgesi 320 ms'de ağza küçülür; ağız kapanınca 3 çiğneme (o/gülüş, 120 ms) + hafif ezilme. */
export const SWALLOW_FILE_MS = 320;
export const CHEW = { steps: 3, stepMs: 120 } as const;
export const CHEW_Y: Track = [[.96, 60], [1.02, 60], [.96, 60], [1.02, 60], [.97, 60], [1, 60]];

/** Tıklama ezilmesi (sy 0,78 -> 1,1 -> 1; 70/130/170 ms) + sersem gözler. */
export const POKE_Y: Track = [[.78, 70], [1.1, 130], [1, 170]];
export const POKE_X: Track = [[1.2, 70], [.94, 130], [1, 170]];

export const BADGE = { out: 90, delay: 100, inn: 280 } as const;
export const SPARKLE = { count: 5, startMs: 500, gapMs: 140, lifeMin: 1300, lifeMax: 1800, riseMin: .45, riseMax: .8 } as const;

export const DAZE = { one: 800, triple: 3300, windowMs: 1700, clicks: 3 } as const;
/** Tıklama sayacı: 1,7 sn içinde 3 tıklama = uzun sersemlik, yoksa kısa. Dönen değer sersemlik süresi (ms). */
export function createClickCounter(now: () => number = () => performance.now()) {
  let stamps: number[] = [];
  return () => {
    const t = now();
    stamps = stamps.filter((s) => t - s <= DAZE.windowMs);
    stamps.push(t);
    if (stamps.length >= DAZE.clicks) { stamps = []; return DAZE.triple; }
    return DAZE.one;
  };
}
/** Sersemlik sallanması: ±3° yarım saniyelik adımlar, sonda 0. */
export function swayTrack(ms: number): Track {
  const out: [number, number][] = [];
  for (let t = 0, s = 1; t + 500 <= ms; t += 500, s = -s) out.push([3 * s, 500]);
  out.push([0, 300]);
  return out;
}

/** Bakış (CouCou): hedef = tanh(dx/260), tanh(dy/200); yumuşatma adımı 1 - 0,0025^dt (dt saniye). */
export const gazeTarget = (dx: number, dy: number): [number, number] => [Math.tanh(dx / 260), Math.tanh(dy / 200)];
export const gazeStep = (dt: number) => 1 - Math.pow(0.0025, dt);

/** Dokunma tepkileri (CouCou "tokat" ve "sevgi"). Sayılar başlangıç değeri; kaynak: analiz §5. */
export const REACT = { slapMs: 600, slapGap: 350, loveHoverMs: 1900, loveMs: 2400, loveGap: 8000, hearts: 5, dizzyTaps: 5, dizzyWindow: 3000, dizzyMs: 2600 } as const;
/** Tokat: ezilme (POKE) + yatay titreme birlikte; gözler `slapMs` boyunca kısık. Sonra önceki hale döner. */
/** Sevgi yalnız sakin hallerde (onay, hata, uyku, dikkat örtülmez). */
export const LOVE_MOODS: ReadonlySet<string> = new Set(["idle", "done", "listening", "music", "speaking"]);

/** Tepki kapısı (saf): tıklama seli sonsuz tokat döngüsüne girmesin; sevgi aralıklı. Saat dışarıdan verilir. */
export function createReactionGate(now: () => number = () => performance.now()) {
  let lastSlap = -Infinity, lastLove = -Infinity, dizzyUntil = -Infinity, stamps: number[] = [];
  return {
    /** Tıklama: "slap", hız sınırında "none" (kart açma gibi asıl eylem yine çalışır) ya da 3 sn'de 5 tıklamada "dizzy" (süresince tepki yok). */
    tap(): "slap" | "dizzy" | "none" {
      const t = now();
      if (t < dizzyUntil) return "none";
      stamps = stamps.filter((s) => t - s <= REACT.dizzyWindow); stamps.push(t);
      if (stamps.length >= REACT.dizzyTaps) { stamps = []; dizzyUntil = t + REACT.dizzyMs; return "dizzy"; }
      if (t - lastSlap < REACT.slapGap) return "none";
      lastSlap = t; return "slap";
    },
    /** Üstünde 1,9 sn kalınca: sevgi serbest mi (8 sn'de en çok bir). */
    love(): boolean {
      const t = now();
      if (t - lastLove < REACT.loveGap) return false;
      lastLove = t; return true;
    },
  };
}

/** Sersem: bir tur yuvarlanma (900 ms) sonra ±3° yavaş sallanma; son değer 360 = 0 (iz sonunda sıfırlanır). */
export function dizzyTrack(ms: number): Track {
  const out: [number, number][] = [[360, 900]];
  for (let t = 900, s = 1; t + 500 <= ms; t += 500, s = -s) out.push([360 + 3 * s, 500]);
  out.push([360, 300]);
  return out;
}
