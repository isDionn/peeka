// Pure rules for clipboard rows (ADR-0063): time format, image safety, file kind. Plain-text passwords never pass through here.
import type { ClipItem, ClipPlain } from "../bridge";

/** Reveal time cap (ADR-0063 §4): even if Rust says longer, the UI hides after 5 s. */
export const REVEAL_MS = 5000;

/** Relative time in the list: "now", "5m", "3h", "2d". */
export function ago(createdAt: number, now: number): string {
  const m = Math.max(0, Math.floor((now - createdAt) / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/** A password's remaining life: 60 min and up is "1h", then it counts down as "40m", the last minute is "<1m". */
export function left(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (ms < 60_000) return "<1m";
  const m = Math.ceil(ms / 60_000);
  return m >= 60 ? `${Math.ceil(m / 60)}h` : `${m}m`;
}

/** An expired password isn't listed (Rust deletes it anyway; the UI filters too in case of clock drift). */
export const alive = (c: ClipItem, now: number) => c.kind !== "password" || c.expiresAt > now;

/** Thumbnail: only a base64 raster or SVG `data:` image, at most ~256 KB; anything else is null (no file paths or links). */
export const safeThumb = (src: unknown): string | null =>
  typeof src === "string" && src.length <= 350_000 && /^data:image\/(png|jpeg|webp|svg\+xml)[;,]/.test(src) ? src : null;

/** `clip_preview` result (Rust: PNG up to 1024 px): a larger cap than thumbnails, still only safe image types. */
export const safePreview = (src: unknown): string | null =>
  typeof src === "string" && src.length <= 8_000_000 && /^data:image\/(png|jpeg|webp)[;,]/.test(src) ? src : null;

/** Color swatch only for an exact #RRGGBB (the value going into a style is validated). */
export const hexOf = (c: ClipPlain): string | null => (c.hint === "color" && c.text && /^#[0-9a-fA-F]{6}$/.test(c.text) ? c.text : null);

export type FileKind = "pdf" | "video" | "sheet" | "image" | "other";
const EXT: Record<string, FileKind> = { pdf: "pdf", mp4: "video", mkv: "video", mov: "video", avi: "video", xlsx: "sheet", xls: "sheet", csv: "sheet", png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image" };
export const fileKind = (name: string | null): FileKind => EXT[(name ?? "").toLowerCase().split(".").pop() ?? ""] ?? "other";

/** Password row subtitle: source app ("Password manager" if unknown), encrypted, time left. */
export const passwordSub = (source: string | null, expiresAt: number, now: number) => `${(source ?? "").trim().slice(0, 40) || "Password manager"} · encrypted · ${left(expiresAt, now)}`;
