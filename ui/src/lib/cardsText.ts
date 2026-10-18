// Kart metinleri ve iş bitti bütçesi: saf kurallar (sadakat denetimi 2). Eklenti verisi düz metne süzülür; ön ek kuralı (ad Peeka'nın) bozulmaz.
import { flat, riskOf } from "./plugin";

const BACK = /[aıouâ]/i, FRONT = /[eiöüî]/i, VOWEL = /[aeıioöuüâî]/i;
/** Türkçe yönelme eki (ünlü uyumu): "Pusula" -> "Pusula'ya", "Örnek Asistan" -> "Örnek Asistan'a", "Ece" -> "Ece'ye". Ünlü bulunamazsa "'e". */
export function dative(name: string): string {
  const n = flat(name, 64) || "Eklenti";
  const letters = Array.from(n).filter((c) => VOWEL.test(c));
  const last = letters.at(-1) ?? "e";
  const back = BACK.test(last) && !FRONT.test(last);
  const endsVowel = VOWEL.test(Array.from(n).at(-1) ?? "");
  return `${n}'${endsVowel ? "y" : ""}${back ? "a" : "e"}`;
}

/** Çıkıntıdaki kısa başlık: eklenti `shortTitle` verdiyse o; değilse yüksek riskte "... yüksek riskli bir komut istiyor" -> "... izin istiyor" (risk zaten ayrı yazılır). */
export function shortApprovalTitle(a: { title: string; risk?: unknown; shortTitle?: unknown }): string {
  const s = flat(a.shortTitle, 80);
  if (s) return s;
  const t = flat(a.title);
  return riskOf(a.risk) === "high" ? t.replace(/\s+yüksek riskli\b[^]*?\bistiyor\s*$/i, " izin istiyor") : t;
}

const ACC: Record<string, string> = { a: "ı", ı: "ı", e: "i", i: "i", o: "u", u: "u", ö: "ü", ü: "ü" };
/** Türkçe belirtme eki: "Pusula" -> "Pusula'yı", "Ece" -> "Ece'yi". Ünlü bulunamazsa "'yi". */
export function accusative(name: string): string {
  const n = flat(name, 64) || "Eklenti";
  const v = [...n.toLocaleLowerCase("tr")].reverse().find((c) => c in ACC);
  return `${n}'${/[aeıioöuüâî]$/i.test(n) ? "y" : ""}${v ? ACC[v] : "i"}`;
}
