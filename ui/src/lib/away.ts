/** "Sen yokken" özeti (satır 38): rahatsız etme kapanınca ya da uzun boşluktan dönünce, yokluk sırasında gelenlerin sayısı. Veri uydurulmaz: yalnız yokluk boyunca yeni görünen kimlikler sayılır. */
export const AWAY_IDLE_MS = 600_000; // 10 dk (maskot uykusu 2 dk: mascot/ambient.ts IDLE_SLEEP_MS)
export const SUMMARY_MS = 8000;
export interface AwayCounts { notif: number; approval: number; done: number }

export function createAway() {
  let was = false;
  let seen = new Set<string>();
  let c: AwayCounts = { notif: 0, approval: 0, done: 0 };
  return {
    /** Her değişimde çağrılır. `on` iken yeni kimlikleri sayar; `on` kapanınca (en az bir şey geldiyse) sayıları döner. */
    sync(on: boolean, notif: readonly string[], approval: readonly string[]): AwayCounts | null {
      const ids = [...notif.map((i) => "n:" + i), ...approval.map((i) => "a:" + i)];
      if (on && !was) { was = true; seen = new Set(ids); c = { notif: 0, approval: 0, done: 0 }; return null; } // başlangıçta var olanlar sayılmaz
      if (on) { for (const i of ids) if (!seen.has(i)) { seen.add(i); c[i[0] === "n" ? "notif" : "approval"]++; } return null; }
      if (!was) return null;
      was = false;
      return c.notif + c.approval + c.done > 0 ? c : null;
    },
    /** Bir iş bitti olayı (yokluk sırasındaysa sayılır). */
    done() { if (was) c.done++; },
  };
}

const plural = (n: number, w: string) => `${n} ${w}`;
/** "Sen yokken: 3 bildirim, 1 onay, 2 iş bitti"; `generic` (kilit ya da sunum) sayıları söylemez. */
export function awayLabel(c: AwayCounts, generic = false): string {
  if (generic) return "Sen yokken: yeni olaylar var";
  const p = [c.notif && plural(c.notif, "bildirim"), c.approval && plural(c.approval, "onay"), c.done && plural(c.done, "iş bitti")].filter(Boolean);
  return "Sen yokken: " + p.join(", ");
}
