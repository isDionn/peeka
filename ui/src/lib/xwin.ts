import { focusables } from "./useFocusTrap";
// Şerit sayfası ile ada sayfası ayrı pencereler: aralarındaki tek yol aynı kökenli BroadcastChannel (centerClock.ts ile aynı yöntem).
// Şerit -> ada: hangi panel açık (ortadaki kısa etiket), "ilk açılışı tekrar göster", "yanıt görünümünü aç" (bildirim aynasında asistan yanıtlasın). Kanal yoksa mesaj sessizce düşer.
export type XMsg = { t: "panel"; panel: "search" | "settings" | "status" | "start" | "mt" | null } | { t: "firstrun" } | { t: "ask" } | { t: "open-panel"; panel: "aym" }
  /** Şerit -> ada: bir şerit paneli açıldı (Ctrl+K, dişli, Başlat...). Ada açık kartını kapatır, böylece tek Esc üstteki yüzeyi kapatır. */
  | { t: "panel-open"; panel: string }
  /** Ada -> şerit: adanın içine tıklandı; açık şerit paneli kapanır. */
  | { t: "island-click" }
  /** Rust -> ada: saydam alana (kartın dışına) tıklandı; açık kart kapanır. */
  | { t: "outside" }
  /** Tab sırası pencereler arası (sekmeler -> ada -> sağ grup): şerit -> ada, odak adanın ilk (ya da `end` ise son) denetimine. */
  | { t: "to-island"; end?: boolean }
  /** Ada -> şerit: odak sağ grubun ilk ya da sol grubun son denetimine. */
  | { t: "to-strip"; side: "left" | "right" }
  /** Ada -> şerit: hoş geldin kartı açık mı (açılışta, her değişimde ve "welcome?" sorusuna cevap). Açıkken kurulum sihirbazı bekler. */
  | { t: "welcome"; open: boolean }
  /** Şerit -> ada: hoş geldin kartı açık mı? */
  | { t: "welcome?" };
const NAME = "notch-xwin";

export function sendX(m: XMsg) {
  try { if (typeof BroadcastChannel === "undefined") return; const c = new BroadcastChannel(NAME); c.postMessage(m); c.close(); } catch { /* kanal yok */ }
}

/** Dinleyici; dönen işlev kanalı kapatır. */
export function onX(cb: (m: XMsg) => void): () => void {
  let c: BroadcastChannel | null = null;
  try { c = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(NAME); } catch { return () => undefined; }
  if (!c) return () => undefined;
  c.onmessage = (e) => { if (e.data && typeof e.data.t === "string") cb(e.data as XMsg); };
  return () => c.close();
}

/** Tab/Shift+Tab pencerenin son (ilk) denetiminden çıkıyor mu? Çıkıyorsa çağıran odağı öbür pencereye verir. */
export const tabLeaves = (e: { key: string; shiftKey: boolean; defaultPrevented?: boolean }, list: HTMLElement[], active: Element | null) =>
  e.key === "Tab" && !e.defaultPrevented && list.length > 0 && active === list[e.shiftKey ? 0 : list.length - 1];

/** Şerit denetimleri ortadaki boşluğun (`.bos`) solunda ve sağında. */
export function stripSides(header: HTMLElement) {
  const bos = header.querySelector(".bos"), all = focusables(header);
  const left = all.filter((el) => !bos || !!(el.compareDocumentPosition(bos) & Node.DOCUMENT_POSITION_FOLLOWING));
  return { left, right: all.filter((el) => !left.includes(el)) };
}

/** Odak başka pencereden klavyeyle geldi: odak halkası görünsün. */
export const focusViaKeys = (el: HTMLElement | undefined) => { if (!el) return; document.documentElement.setAttribute("data-kb", ""); el.focus(); };
