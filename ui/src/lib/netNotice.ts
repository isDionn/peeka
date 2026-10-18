import { useEffect, useRef, useState } from "react";
import type { NetworkLevel } from "../bridge";

export type NetNote = "lost" | "back";
/** İnternet var mı: "none" ve "local" (ağ var, internet yok) yok sayılır; "unknown" karar vermez (null). */
export const netUp = (n: NetworkLevel | undefined): boolean | null => (n === undefined || n === "unknown" ? null : n === "internet" || n === "constrained");

/**
 * Bağlantı koptu / geri geldi bildirimi (satır 28). Durum `holdMs` boyunca değişmeden kalırsa "oturmuş" sayılır: sallanan Wi-Fi tekrar bildirim açmaz.
 * İlk okuma sessizdir. Bildirim `showMs` sonra kalkar (`hold` iken kalkmaz); şeritteki ağ simgesi kalıcı bilgidir.
 */
export function useNetNotice(network: NetworkLevel | undefined, hold = false, init: NetNote | null = null, holdMs = 3000, showMs = 4000) {
  const up = netUp(network);
  const settled = useRef<boolean | null>(null);
  const [note, setNote] = useState<NetNote | null>(init);
  useEffect(() => {
    if (up === null) return;
    const first = settled.current === null;
    const t = setTimeout(() => {
      const was = settled.current; settled.current = up;
      if (was !== null && was !== up) setNote(up ? "back" : "lost");
    }, first ? 0 : holdMs);
    return () => clearTimeout(t);
  }, [up, holdMs]);
  useEffect(() => {
    if (!note || hold) return;
    const t = setTimeout(() => setNote(null), note === "back" ? showMs - 1000 : showMs);
    return () => clearTimeout(t);
  }, [note, hold, showMs]);
  return [note, () => setNote(null)] as const;
}
