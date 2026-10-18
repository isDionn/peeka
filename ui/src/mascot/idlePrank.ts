// Boştaki muziplik zamanlayıcısı (FPV §0i madde 19, sahip kararı 8): 45-90 dk'da bir, günde en çok 6, kapatılabilir.
// Saf: saat, rastgelelik ve "şu an engel var mı" dışarıdan verilir; kendi zamanlayıcısı yok, sahibi poll() çağırır (~1 sn).
export const PRANK_MIN_MS = 45 * 60_000;
export const PRANK_MAX_MS = 90 * 60_000;
export const PRANK_PER_DAY = 6;
export const INPUT_QUIET_MS = 3_000;

export interface PrankEnv {
  now(): number;
  random(): number;
  enabled(): boolean;          // Ayarlar > "Maskot muziplikleri"
  lastInputAgoMs(): number;    // GetLastInputInfo
  fullscreen(): boolean;
  dnd(): boolean;              // Peeka rahatsız etme kipi ya da QUNS_BUSY
  presentation(): boolean;     // QUNS_PRESENTATION_MODE
  meeting(): boolean;
  cardOpen(): boolean;
  musicPlaying(): boolean;
}

export type PrankResult = "fired" | "wait" | "off" | "daily-limit" | "input" | "fullscreen" | "dnd" | "presentation" | "meeting" | "card" | "music";

export function createIdlePrank(env: PrankEnv, onPrank: () => void) {
  let nextAt: number | null = null;
  let day = "";
  let today = 0;
  const gap = () => PRANK_MIN_MS + env.random() * (PRANK_MAX_MS - PRANK_MIN_MS);

  function poll(): PrankResult {
    const now = env.now();
    if (!env.enabled()) { nextAt = null; return "off"; }   // açılınca sayaç baştan başlar, birikmiş muziplik patlamaz
    if (nextAt === null) nextAt = now + gap();
    if (now < nextAt) return "wait";
    const d = new Date(now).toDateString();
    if (d !== day) { day = d; today = 0; }
    if (today >= PRANK_PER_DAY) { nextAt = now + gap(); return "daily-limit"; }
    const blocked: [boolean, PrankResult][] = [
      [env.lastInputAgoMs() < INPUT_QUIET_MS, "input"], [env.fullscreen(), "fullscreen"], [env.dnd(), "dnd"],
      [env.presentation(), "presentation"], [env.meeting(), "meeting"], [env.cardOpen(), "card"], [env.musicPlaying(), "music"],
    ];
    const hit = blocked.find(([b]) => b);
    if (hit) return hit[1];   // vakti geldi, engel kalkınca ilk poll'da çıkar; en az aralık yine de korunur
    today++;
    nextAt = now + gap();
    onPrank();
    return "fired";
  }
  return { poll };
}
