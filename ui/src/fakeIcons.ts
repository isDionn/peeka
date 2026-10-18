// Önizleme için tek renk simge verisi (maketteki şablon simgeler). Gerçekte Rust exe simgesinden alfa maskesi üretir.
import mono from "./icons-mono.json";

const wrap = (inner: string) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${inner.replaceAll("currentColor", "#000")}</svg>`);
const g = (d: string) => `<g fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</g>`;

const extra: Record<string, { ad: string; m: string }> = {
  notepad: { ad: "Not Defteri", m: g('<rect x="4.5" y="3.5" width="15" height="17" rx="2.5"/><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4"/>') },
  calc: { ad: "Hesap Makinesi", m: g('<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 7.5h7M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01"/>') },
  settings: { ad: "Ayarlar", m: g('<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>') },
  word: { ad: "Word", m: g('<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="m7.5 9 1.6 6 2.9-6 2.9 6 1.6-6"/>') },
};
const all = { ...mono, ...extra } as Record<string, { ad: string; m: string }>;

export const APP_NAMES: Record<string, string> = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.ad]));
export const iconOf = (appId: string): string => wrap(all[appId]?.m ?? g('<rect x="4" y="4" width="16" height="16" rx="4"/>'));
