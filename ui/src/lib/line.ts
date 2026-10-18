import type { CSSProperties } from "react";
import type { LineMod, LineState } from "./lineChan";

import { phaseOf } from "../components/Voice";

export const AMBER = "#FF9F0A", MINT = "#63E6E2", CYAN = "#64D2FF", KIZIL = "#F2555A";

export interface LineIn { asistanUp: boolean; hidden: boolean; kind: string; /** Ana asistanın çıkıntısının maskot hali: ses fazını (`phaseOf`) belirler. */ mascot?: string | null }
/** asistan çizgisinin rengi ve kipi (maket CIZ tablosu): onaylarda turuncu bekle, dikte cam göbeği/nane dinle, asistan yok ya da kart/ilk açılış: çizgi yok, geri kalanı soluk gri. */
export function lineOf({ asistanUp, hidden, kind, mascot }: LineIn): Pick<LineState, "color" | "mod"> {
  if (!asistanUp || hidden || kind === "asistanyok" || kind === "lock" || kind === "ilk") return { color: "#8E8E93", mod: "yok" };
  if (kind === "approval" || kind === "approval-card") return { color: AMBER, mod: "bekle" };
  const ph = kind === "plugin" ? phaseOf(mascot) : null; // dinliyor nane, düşünüyor turuncu, konuşuyor kırmızı
  if (ph) return { color: ph.mod === "dinle" ? MINT : ph.mod === "bekle" ? AMBER : KIZIL, mod: ph.mod };
  return { color: "#8E8E93", mod: "bos" };
}

const SH: Record<LineMod, number> = { dinle: .55, konus: .9, bos: .22, bekle: 0, yok: 0 };
const GL: Partial<Record<LineMod, number>> = { dinle: .45, bekle: .3 };
const CO: Record<LineMod, number> = { yok: 0, bos: .32, bekle: 1, dinle: 1, konus: 1 };
/** Animasyon dönemleri (ms): notch.css `--akis` (kipe göre), `ses` 1.7 s, `bekle` 2.4 s. */
export const AKIS_MS: Record<LineMod, number> = { dinle: 2200, konus: 1150, bos: 9000, bekle: 9000, yok: 9000 };
/** Duvar saatinden evre: iki ayrı pencere (şerit, ada) aynı kareyi gösterir. Negatif gecikme = animasyon `now % dönem` ilerlemiş başlar. */
export const phaseDelay = (periodMs: number, now = Date.now()) => `-${(now % periodMs) / 1000}s`;
let phased: { mod: LineMod; vars: CSSProperties } | null = null; // kip değişince yeniden hesaplanır; her çizimde değil (evre sıçramasın)
const phaseVars = (mod: LineMod): CSSProperties => {
  if (phased?.mod !== mod) phased = { mod, vars: { "--ad": phaseDelay(AKIS_MS[mod]), "--sd": phaseDelay(1700), "--bd": phaseDelay(2400) } as CSSProperties };
  return phased.vars;
};
/** CSS değişkenleri (--lc renk, --sh akış parlaklığı, --gl hale, --co saydamlık, --ad/--sd/--bd duvar saati evresi). */
export const lineVars = (s: Pick<LineState, "color" | "mod">): CSSProperties =>
  ({ "--lc": s.color, "--sh": SH[s.mod], "--gl": GL[s.mod] ?? 0, "--co": CO[s.mod], ...phaseVars(s.mod) }) as CSSProperties;
