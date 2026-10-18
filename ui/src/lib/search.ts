// Ctrl+K sonuçlarının gruplanması (maket ara0-ara2): sıra Uygulamalar, Açık pencereler, Dosyalar, Ayarlar, sonra eklenti grupları.
import type { SearchResult } from "../bridge";
import { prefixed } from "./plugin";

export interface SearchGroup { key: string; title: string; rows: SearchResult[]; /** Satır yok ama söylenecek tek satır var (ör. dizin kapalı). */ note?: string }

export const FILES_OFF = "Windows Arama dizini kapalı, dosyalar aranamıyor.";
const BASE: [SearchResult["kind"], string][] = [["app", "Uygulamalar"], ["window", "Açık pencereler"], ["file", "Dosyalar"], ["setting", "Ayarlar"]];

/** Boş sorgu: Rust'ın "son kullanılanlar"ı tek grupta, geldiği sırayla. Sorgu varsa türe göre; dizin kapalıyken Dosyalar grubu tek satır uyarıyla durur. */
export function groupResults(results: SearchResult[], query: string, filesOff: boolean): SearchGroup[] {
  if (!query.trim()) return results.length ? [{ key: "recent", title: "Son kullanılanlar", rows: results }] : [];
  const groups: SearchGroup[] = BASE.map(([kind, title]) => ({ key: kind, title, rows: results.filter((r) => r.kind === kind), ...(kind === "file" && filesOff ? { note: FILES_OFF } : null) }));
  const plug = new Map<string, SearchGroup>();
  for (const r of results) {
    if (r.kind !== "plugin" || !r.plugin) continue;
    const title = prefixed(r.plugin, r.group); // ön eki Peeka basar
    const key = r.plugin.id + "|" + title;
    if (!plug.has(key)) plug.set(key, { key, title, rows: [] });
    plug.get(key)!.rows.push(r);
  }
  return [...groups, ...plug.values()].filter((g) => g.rows.length || g.note);
}

/** Sonuçların gezilme sırası (ok tuşları): grupların satırları arka arkaya. */
export const flatten = (groups: SearchGroup[]) => groups.flatMap((g) => g.rows);

/** Eşleşen ilk parçayı ayırır (Türkçe büyük/küçük harf duyarsız); eşleşme yoksa null. */
export function splitMatch(text: string, q: string): [string, string, string] | null {
  const t = q.trim();
  if (!t) return null;
  const i = text.toLocaleLowerCase("tr").indexOf(t.toLocaleLowerCase("tr"));
  return i < 0 ? null : [text.slice(0, i), text.slice(i, i + t.length), text.slice(i + t.length)];
}

const T_UNIT: Record<string, number> = { sn: 1, saniye: 1, dk: 60, dak: 60, dakika: 60, sa: 3600, saat: 3600 };
const T_WORD = "zamanlayıcı|zamanlayici|sayaç|sayac|timer";
const T_RE = new RegExp(`^(?:(?:${T_WORD})\\s+)?(\\d{1,3})\\s*(sn|saniye|dk|dak|dakika|sa|saat)?(?:\\s+(.+))?$`);

export interface TimerAsk { label: string; seconds: number; text: string }

/** "5 dk", "zamanlayıcı 10 dakika", "25 dk odak": yerel zamanlayıcı isteği. Anahtar sözcük yoksa birim şart ("2026" zamanlayıcı olmaz). Yoksa null. */
export function parseTimer(q: string): TimerAsk | null {
  const t = q.trim().toLocaleLowerCase("tr");
  const m = T_RE.exec(t);
  if (!m) return null;
  const keyword = new RegExp(`^(?:${T_WORD})\\s`).test(t);
  const unit = m[2] ?? (keyword ? "dk" : null);
  if (!unit) return null;
  const n = Number(m[1]), seconds = n * T_UNIT[unit];
  if (!n || seconds > 24 * 3600) return null;
  const rest = (m[3] ?? "").replace(new RegExp(`^(?:${T_WORD})$`), "").trim();
  const label = rest ? Array.from(rest).slice(0, 24).map((c, i) => (i ? c : c.toLocaleUpperCase("tr"))).join("") : "Zamanlayıcı";
  const text = seconds % 3600 === 0 ? `${seconds / 3600} sa` : seconds % 60 === 0 ? `${seconds / 60} dk` : `${seconds} sn`;
  return { label, seconds, text: rest ? `${text} · ${label}` : text };
}
