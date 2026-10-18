// Eklenti verisini çizmeden önce süzen saf kurallar (ADR-0062 §4.6). Eklenti HTML, bağlantı ya da simge gönderemez; her metin düz metindir.
import type { PluginRef } from "../bridge";
import type { Mood } from "../mascot";

/** Kazara tıklama koruması: bir düğme ekrana gelince ilk 300 ms tıklamayı yok sayar. */
export const GUARD_MS = 300;

// denetim, sıfır genişlikli ve çift yönlü biçim karakterleri atılır
// eslint-disable-next-line no-control-regex
const HIDDEN = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;
// ayraç taklidi ("asistan › Claude Code" gibi bir ön ek kurmak) düz karaktere çevrilir
const SEPARATORS = /[›»❯▸▶→>|]/g;

/** Düz metin: gizli karakterleri at, uzunluğu kes. Metin olmayan değer boş yazı olur. */
/** Düz metin: gizli ve yön denetim karakterleri atılır, `max` birime kısalır; kesilen emoji yarım kalmaz (sonda yalnız yüksek vekil kalırsa atılır). */
export const plain = (v: unknown, max = 400): string => {
  if (typeof v !== "string") return "";
  const t = v.replace(HIDDEN, "").slice(0, max);
  return /[\ud800-\udbff]$/.test(t) ? t.slice(0, -1) : t;
};
/** Sayaç yazısı: 99'u aşınca "99+" (rozet ve şerit yazıları genişlemez). */
export const cap99 = (n: number): string => (n > 99 ? "99+" : String(n));
/** Baş harf (Türkçe büyük harf; emoji bölünmez). */
export const initial = (v: string): string => Array.from(v)[0]?.toLocaleUpperCase("tr") ?? "";
/** Başlık ve ad için: ayraçlar da düz karaktere döner. */
export const flat = (v: unknown, max = 200): string => plain(v, max).replace(SEPARATORS, "-").trim();

/** Eklentinin görünen adı (Peeka'nın kendi kaydından); boşsa genel ad. */
export const pluginName = (p: Pick<PluginRef, "name">): string => flat(p.name, 64) || "Eklenti";

/** Her öğenin başındaki ad ön eki. Ön eki Peeka basar: eklenti başlığı ne gönderirse göndersin ad her zaman başta kalır. */
export function prefixed(p: Pick<PluginRef, "name">, title: unknown): string {
  const n = pluginName(p), t = flat(title);
  return t && t.toLocaleLowerCase("tr") !== n.toLocaleLowerCase("tr") ? `${n} › ${t}` : n;
}

/** Risk: yalnız tam olarak "low" düşüktür; alan yok ya da tanınmıyorsa yüksek. */
export const riskOf = (risk: unknown): "low" | "high" => (risk === "low" ? "low" : "high");

/** Peeka'nın maskot hal tablosu (§0i); eklenti başka ad gönderemez. */
export const MASCOT_STATES = new Set(["hazir", "dinliyor", "dusunuyor", "konusuyor", "onay", "ciddi", "hata", "bitti", "muzik", "bosta", "uyku", "sessiz", "yorgun", "dikkat", "arama", "soru", "kota", "sersem"]);   // son dördü Peeka'nın kendi halleri (Rust eklentiden yalnız ilk sekizini alır)
/** Eklentinin hal adı -> maskotun hali (src/mascot/moods.ts). */
export const HAL_MOOD: Record<string, Mood> = {
  hazir: "idle", dinliyor: "listening", dusunuyor: "thinking", konusuyor: "speaking", onay: "approval", ciddi: "serious", hata: "error",
  bitti: "done", muzik: "music", bosta: "drowsy", uyku: "sleeping", sessiz: "quiet", yorgun: "tired", dikkat: "attention",
  arama: "searching", soru: "question", kota: "ratelimit", sersem: "dizzy",
};
export const moodOf = (hal: string): Mood => HAL_MOOD[hal] ?? "idle";
/** Maskot yalnız ana asistanın ve yalnız tablodaki halde; aksi halde null (Peeka'nın baş harf karosu çizilir). */
export const mascotOf = (p: Pick<PluginRef, "main">, hal: unknown): string | null => (p.main && typeof hal === "string" && MASCOT_STATES.has(hal) ? hal : null);

/** Yalnız PNG/JPEG `data:` görsel, en çok ~256 KB (base64'te 350 000 karakter); başka her şey null. */
export const safeImage = (src: unknown): string | null =>
  typeof src === "string" && src.length <= 350_000 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(src) ? src : null;

/** Sayaç: 83 sn -> "01:23", bir saati aşınca "1:02:03". */
export function elapsed(startedAt: string, nowMs: number): string {
  const t = Date.parse(startedAt);
  const s = Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 1000)) : 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}

/** Eklenti başına en çok 3 sekme (Rust da keser; sayfa yine de sınırlar). */
export const MAX_TABS = 3;
export function capTabs<T extends { plugin: { id: string } }>(tabs: T[]): T[] {
  const seen = new Map<string, number>();
  return tabs.filter((t) => { const n = (seen.get(t.plugin.id) ?? 0) + 1; seen.set(t.plugin.id, n); return n <= MAX_TABS; });
}
/** "Genel" özetinde eklenti başına en çok 3 satır. */
export const MAX_SUMMARY = 3;
