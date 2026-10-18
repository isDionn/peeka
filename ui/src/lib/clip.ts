// Pano satırlarının saf kuralları (ADR-0063): süre biçimi, görsel güvenliği, dosya türü. Düz metin parola burada hiç geçmez.
import type { ClipItem, ClipPlain } from "../bridge";

/** Gösterme süresi üst sınırı (ADR-0063 §4): Rust daha uzun söylese de arayüz 5 sn'de gizler. */
export const REVEAL_MS = 5000;

/** Listedeki göreli zaman: "şimdi", "5 dk", "3 sa", "2 g". */
export function ago(createdAt: number, now: number): string {
  const m = Math.max(0, Math.floor((now - createdAt) / 60_000));
  if (m < 1) return "şimdi";
  if (m < 60) return `${m} dk`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} sa` : `${Math.floor(h / 24)} g`;
}

/** Parolanın kalan ömrü: 60 dk ve üstü "1 sa", sonra "40 dk" diye geri sayar, son dakika "1 dk'dan az". */
export function left(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (ms < 60_000) return "1 dk'dan az";
  const m = Math.ceil(ms / 60_000);
  return m >= 60 ? `${Math.ceil(m / 60)} sa` : `${m} dk`;
}

/** Süresi dolmuş parola listede görünmez (Rust zaten siler; saat kayması için arayüz de eler). */
export const alive = (c: ClipItem, now: number) => c.kind !== "password" || c.expiresAt > now;

/** Küçük resim: yalnız base64 raster ya da SVG `data:` görsel, en çok ~256 KB; başka her şey null (dosya yolu, bağlantı gelmez). */
export const safeThumb = (src: unknown): string | null =>
  typeof src === "string" && src.length <= 350_000 && /^data:image\/(png|jpeg|webp|svg\+xml)[;,]/.test(src) ? src : null;

/** `clip_preview` sonucu (Rust: en çok 1024 px PNG): küçük resimden büyük sınır, yine yalnız güvenli görsel türleri. */
export const safePreview = (src: unknown): string | null =>
  typeof src === "string" && src.length <= 8_000_000 && /^data:image\/(png|jpeg|webp)[;,]/.test(src) ? src : null;

/** Renk karesi yalnız tam #RRGGBB için (stile giden değer doğrulanır). */
export const hexOf = (c: ClipPlain): string | null => (c.hint === "color" && c.text && /^#[0-9a-fA-F]{6}$/.test(c.text) ? c.text : null);

export type FileKind = "pdf" | "video" | "sheet" | "image" | "other";
const EXT: Record<string, FileKind> = { pdf: "pdf", mp4: "video", mkv: "video", mov: "video", avi: "video", xlsx: "sheet", xls: "sheet", csv: "sheet", png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image" };
export const fileKind = (name: string | null): FileKind => EXT[(name ?? "").toLocaleLowerCase("tr").split(".").pop() ?? ""] ?? "other";

/** Parola satırı alt yazısı: kaynak uygulama (bilinmiyorsa "Parola yöneticisi"), şifreli, kalan süre. */
export const passwordSub = (source: string | null, expiresAt: number, now: number) => `${(source ?? "").trim().slice(0, 40) || "Parola yöneticisi"} · şifreli · ${left(expiresAt, now)}`;
