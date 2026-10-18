import { useEffect, useRef, useState } from "react";
import type { NetworkLevel } from "../bridge";

export type NetNote = "lost" | "back";
/** Is there internet: "none" and "local" (network but no internet) count as no; "unknown" doesn't decide (null). */
export const netUp = (n: NetworkLevel | undefined): boolean | null => (n === undefined || n === "unknown" ? null : n === "internet" || n === "constrained");

/**
 * Connection lost / back notice (row 28). A state counts as "settled" once it holds for `holdMs`: flaky Wi-Fi doesn't reopen the notice.
 * The first reading is silent. The notice goes away after `showMs` (not while `hold`); the strip's network icon is the lasting info.
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
