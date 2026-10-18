import type { CalendarNext, PluginRef, ProtrusionItem } from "../bridge";
import { flat } from "./plugin";

/** Toplantı hatırlatması (plan satır 22): asistanın takviminden (`calendar_next`) gelen sıradaki toplantıya 5 dk kala çıkıntı, 1 dk kala ana şerit. Ses yok. */
export const SOON_S = 300, NOW_S = 60, GRACE_S = 60;
export const REMINDER_GENERIC = "Toplantı yaklaşıyor";
/** Hatırlatma bir eklentiden gelmez; Peeka'nın kendi kaydı (ana asistan değil, maskotsuz). */
export const REMINDER_PLUGIN: PluginRef = { id: "peeka.takvim", name: "Takvim", main: false };
export type ReminderItem = ProtrusionItem & { link?: string };

/** `generic`: kilit ya da sunum; başlık ve bağlantı hiç yok. Başlamasına ≤ 5 dk ve başlayalı ≤ 1 dk olan ilk satır; yoksa null. */
export function meetingReminder(cal: CalendarNext | null, nowMs: number, generic: boolean): ReminderItem | null {
  for (const e of cal?.next ?? []) {
    const startMs = e.start ? Date.parse(e.start) : NaN;
    const left = (startMs - nowMs) / 1000; // NaN: satır geri sayıma girmez
    if (!(left <= SOON_S && left > -GRACE_S)) continue;
    const now = left <= NOW_S;
    const when = left <= 0 ? "Başladı" : `${now ? 1 : Math.ceil(left / 60)} dk sonra`;
    const link = !generic && e.link ? e.link : undefined;
    return {
      plugin: REMINDER_PLUGIN, state: "attention", title: generic ? REMINDER_GENERIC : `${when}: ${flat(e.title, 60)}`,
      icon: now ? "calendar" : "clock", // "calendar" = adanın "toplantı" sırası (priority.ts); 5 dk'da sıradan çıkıntı
      actions: link ? [{ id: "katil", label: "Katıl", style: "primary" }] : [], link,
    };
  }
  return null;
}

/** "Katıl": Peeka'da sayfanın bağlantı açan komutu yok (kabuk yalnız sabit ayar adreslerini ve uyarı bağlantısını açar); Rust'a `calendar_join` eklenince bu tek satır ona bağlanır. */
export let openJoinLink: (url: string) => Promise<void> = () => Promise.reject(new Error("open-url command missing"));
export const setOpenJoinLink = (f: typeof openJoinLink) => { openJoinLink = f; };
