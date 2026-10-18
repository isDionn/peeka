// One mascot on screen at a time (FPV §0i item 23): if a card shows its own mascot, the strip's hides.
// Winner: highest priority (card 28+ > strip 20), the earliest registration on ties.
import { useId, useLayoutEffect, useSyncExternalStore } from "react";

interface Claim { id: string; priority: number }
let claims: Claim[] = [];
let winner: string | null = null;
const subs = new Set<() => void>();

function recompute() {
  const best = claims.reduce<Claim | null>((a, c) => (!a || c.priority > a.priority ? c : a), null);
  const next = best ? best.id : null;
  if (next !== winner) { winner = next; subs.forEach((f) => f()); }
}

export function claimMascot(id: string, priority: number): () => void {
  claims = [...claims.filter((c) => c.id !== id), { id, priority }];
  recompute();
  return () => { claims = claims.filter((c) => c.id !== id); recompute(); };
}
export const mascotOwner = () => winner;
export const resetMascotRegistry = () => { claims = []; winner = null; };

/** true = this mascot may be visible. With `want` false it never registers (e.g. not the main assistant). */
export function useSingleMascot(priority: number, want = true): boolean {
  const id = useId();
  useLayoutEffect(() => (want ? claimMascot(id, priority) : undefined), [id, priority, want]);
  const owner = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, mascotOwner);
  return want && owner === id;
}
