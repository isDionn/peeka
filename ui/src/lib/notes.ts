/** Küçük çıkıntıların saf mantığı (Island.tsx kullanır): pil kademeleri, bildirim yağmuru, Claude Code oturum sayısı. Saat ve React yok. */
import type { CcEvent } from "../mascot/ccMood";

/** Pil: %20'ye inince bir kez 20, %10'a inince bir kez 10. Prize takılınca sıfırlanır. Doğrudan %8'e düşerse yalnız 10 (20 de harcanmış sayılır). */
export function createBatteryTiers() {
  const fired = new Set<number>();
  return {
    feed(percent: number | null, powered: boolean): 10 | 20 | null {
      if (powered) { fired.clear(); return null; }
      if (percent === null) return null;
      const t = percent <= 10 ? 10 : percent <= 20 ? 20 : null;
      if (!t || fired.has(t)) return null;
      fired.add(t); if (t === 10) fired.add(20);
      return t;
    },
  };
}

export interface Burst { n: number; apps: string[] }
/** `windowMs` içinde `n` ya da daha çok YENİ bildirim gelirse sayı ve uygulama adları (tekrarsız, geliş sırasıyla). İlk liste sessizce taban olur. */
export function createBurst(n = 6, windowMs = 5000) {
  let seen: Set<string> | null = null;
  let recent: { t: number; app: string }[] = [];
  return {
    feed(items: readonly { id: string; app: string }[], now: number): Burst | null {
      if (seen === null) { seen = new Set(items.map((i) => i.id)); return null; }
      for (const i of items) if (!seen.has(i.id)) { seen.add(i.id); recent.push({ t: now, app: i.app }); }
      recent = recent.filter((r) => now - r.t <= windowMs);
      if (recent.length < n) return null;
      const out = { n: recent.length, apps: [...new Set(recent.map((r) => r.app))] };
      recent = [];
      return out;
    },
  };
}
/** "6 yeni bildirim: Discord, Outlook…" (en çok 2 ad; fazlası ya da gizli ise "…"). `generic`: kilit ya da sunum, ad yok. */
export const burstLabel = (count: number, apps: readonly string[], generic = false) =>
  generic ? "Yeni bildirimler var" : `${count} yeni bildirim: ${apps.slice(0, 2).join(", ")}${apps.length > 2 ? "…" : ""}`;

export interface CcSession { sid: string; tool: string | null; at: number }

/**
 * Açık Claude Code oturumları, Peeka'nın kendi kancasından (`cc_event`). Kanca oturum kimliğini değil, tuzlu 8 karakterlik özetini
 * (`sid`) gönderir: `sid`li olaylar özete göre izlenir (her oturumun son aracıyla), `session_end` oturumu siler, `quietMs` olaysız kalan
 * oturum düşer (yeni olay gelirse yeniden eklenir). `sid`siz olaylar (ana asistan) eski sayaçla sayılır: session_start +1, session_end -1,
 * shortcut: çöken oturum sayıyı şişirir ve Peeka'dan önce başlayanlar sayılmaz; `staleMs` olaysız kalırsa sıfırlanır.
 */
export function createCcSessions(staleMs = 3_600_000, quietMs = 1_800_000) {
  let anon = 0, last = 0;
  const known = new Map<string, CcSession>();
  const prune = (now: number) => {
    for (const [k, v] of known) if (now - v.at > quietMs) known.delete(k);
    if (anon > 0 && now - last > staleMs) anon = 0;
  };
  return {
    feed(e: CcEvent, now: number): number {
      prune(now);
      if (e.sid) {
        if (e.kind === "session_end") known.delete(e.sid);
        else known.set(e.sid, { sid: e.sid, tool: e.tool ?? known.get(e.sid)?.tool ?? null, at: now }); // yeniden atama sırayı korur: "Oturum 1" yerinde kalır
      } else {
        last = now;
        if (e.kind === "session_start") anon++;
        else if (e.kind === "session_end") anon = Math.max(0, anon - 1);
      }
      return known.size + anon;
    },
    /** Zamanla düşenleri atıp güncel sayı (olay gelmese de). */
    count(now: number): number { prune(now); return known.size + anon; },
    /** Kimliği bilinen oturumlar, ilk görülme sırasıyla. */
    list(now: number): CcSession[] { prune(now); return [...known.values()]; },
  };
}
