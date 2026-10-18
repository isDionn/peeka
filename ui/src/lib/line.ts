import type { CSSProperties } from "react";
import type { LineMod, LineState } from "./lineChan";

import { phaseOf } from "../components/Voice";

export const AMBER = "#FF9F0A", MINT = "#63E6E2", CYAN = "#64D2FF", CRIMSON = "#F2555A";

export interface LineIn { assistantUp: boolean; hidden: boolean; kind: string; /** Mascot state of the main assistant's peek: sets the voice phase (`phaseOf`). */ mascot?: string | null }
/** Color and mode of the assistant line (mockup CIZ table): orange wait on approvals, cyan/mint listen on dictation, no assistant or card/first run: no line, everything else dim gray. */
export function lineOf({ assistantUp, hidden, kind, mascot }: LineIn): Pick<LineState, "color" | "mod"> {
  if (!assistantUp || hidden || kind === "noassistant" || kind === "lock" || kind === "welcome") return { color: "#8E8E93", mod: "off" };
  if (kind === "approval" || kind === "approval-card") return { color: AMBER, mod: "wait" };
  const ph = kind === "plugin" ? phaseOf(mascot) : null; // listening mint, thinking orange, speaking red
  if (ph) return { color: ph.mod === "listen" ? MINT : ph.mod === "wait" ? AMBER : CRIMSON, mod: ph.mod };
  return { color: "#8E8E93", mod: "idle" };
}

const SH: Record<LineMod, number> = { listen: .55, speak: .9, idle: .22, wait: 0, off: 0 };
const GL: Partial<Record<LineMod, number>> = { listen: .45, wait: .3 };
const CO: Record<LineMod, number> = { off: 0, idle: .32, wait: 1, listen: 1, speak: 1 };
/** Animation periods (ms): notch.css `--flow` (per mode), `voice` 1.7 s, `wait` 2.4 s. */
export const FLOW_MS: Record<LineMod, number> = { listen: 2200, speak: 1150, idle: 9000, wait: 9000, off: 9000 };
/** Phase from the wall clock: two separate windows (strip, island) show the same frame. Negative delay = the animation starts `now % period` in. */
export const phaseDelay = (periodMs: number, now = Date.now()) => `-${(now % periodMs) / 1000}s`;
let phased: { mod: LineMod; vars: CSSProperties } | null = null; // recomputed when the mode changes, not on every render (so the phase doesn't jump)
const phaseVars = (mod: LineMod): CSSProperties => {
  if (phased?.mod !== mod) phased = { mod, vars: { "--flowDelay": phaseDelay(FLOW_MS[mod]), "--sd": phaseDelay(1700), "--bd": phaseDelay(2400) } as CSSProperties };
  return phased.vars;
};
/** CSS variables (--lc color, --sh flow brightness, --gl halo, --co opacity, --flowDelay/--sd/--bd wall-clock phase). */
export const lineVars = (s: Pick<LineState, "color" | "mod">): CSSProperties =>
  ({ "--lc": s.color, "--sh": SH[s.mod], "--gl": GL[s.mod] ?? 0, "--co": CO[s.mod], ...phaseVars(s.mod) }) as CSSProperties;
