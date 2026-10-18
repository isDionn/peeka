import type { Alert } from "../bridge";

/** Öncelik yüksekten düşüğe, eşitte yeni önce, sonra kimlik (Rust'ın sırasıyla aynı). Sistem uyarıları (100) betiklerin (0..99) üstünde kalır. */
export const sortAlerts = (list: Alert[]): Alert[] => [...list].sort((a, b) => b.priority - a.priority || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));

/** Süresi dolanları atar (`expiresAt` Unix ms). */
export const liveAlerts = (list: Alert[], now: number): Alert[] => list.filter((a) => a.expiresAt === null || a.expiresAt > now);

/** Çıkıntı açacak uyarı: görülmemiş ve `expand` olanların en öncelikli ilki. Listeye sıralı verilir. */
export const pickProtrusion = (sorted: Alert[], seen: ReadonlySet<string>): Alert | null => sorted.find((a) => a.expand && !seen.has(a.id)) ?? null;

/** En erken kalkacak uyarıya kalan ms (yeniden süzmek için zamanlayıcı); hiçbirinin süresi yoksa null. */
export function nextExpiry(list: Alert[], now: number): number | null {
  let best: number | null = null;
  for (const a of list) if (a.expiresAt !== null) { const t = a.expiresAt - now; if (t > 0 && (best === null || t < best)) best = t; }
  return best;
}


/** "şimdi", "3 dk", "2 sa", "4 g". */
export function ageLabel(seconds: number): string {
  if (seconds < 60) return "şimdi";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} dk`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} sa`;
  return `${Math.floor(seconds / 86400)} g`;
}

/** Birincil düğmenin yazısı: Rust `action: "task_manager"` gönderirse Görev Yöneticisi'ni açar, bağlantıda yalnız "Aç". */
export const actionLabel = (a: { action: string | null }): string => (a.action === "task_manager" ? "Görev Yöneticisi'nde aç" : "Aç");
