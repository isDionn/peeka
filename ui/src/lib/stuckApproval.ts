import type { ApprovalItem, PluginRef, ProtrusionItem } from "../bridge";
import { flat } from "./plugin";

/** Stuck-agent reminder: an approval waiting this long gets one gentle peek (no sound), shown for SHOW_MS. */
export const STUCK_MS = 180_000, SHOW_MS = 10_000;
export const STUCK_GENERIC = "Waiting for you";
const STUCK_PLUGIN: PluginRef = { id: "peeka.approval-reminder", name: "Peeka", main: false };

/** Notes when each approval was first seen, forgets the answered ones, and returns the one to remind about now (once per id). */
export function stuckApproval(first: Map<string, number>, done: Set<string>, approvals: ApprovalItem[], now: number): ApprovalItem | null {
  const ids = new Set(approvals.map((a) => a.id));
  for (const id of [...first.keys()]) if (!ids.has(id)) { first.delete(id); done.delete(id); }
  for (const a of approvals) if (!first.has(a.id)) first.set(a.id, now);
  const hit = approvals.find((a) => !done.has(a.id) && now - first.get(a.id)! >= STUCK_MS) ?? null;
  if (hit) done.add(hit.id);
  return hit;
}

/** `generic`: lock or presentation; no approval text. */
export function stuckPeek(a: ApprovalItem, generic: boolean): ProtrusionItem {
  return { plugin: STUCK_PLUGIN, state: "attention", icon: "shield", title: generic ? STUCK_GENERIC : `Still waiting: ${flat(a.title, 50)}` };
}
