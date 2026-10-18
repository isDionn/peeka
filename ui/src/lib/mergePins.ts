import type { PinnedApp, WindowInfo } from "../bridge";

/** Şeritteki tek öğe: sabit + açık uygulama tek öğedir (sahip kararı 20). */
export interface StripItem {
  appId: string;
  name: string;
  icon: string;
  colorIcon?: string | null;
  pinned: boolean;
  windows: WindowInfo[];
  active: boolean;
}

const group = (windows: WindowInfo[]): Map<string, WindowInfo[]> => {
  const m = new Map<string, WindowInfo[]>();
  for (const w of windows) m.set(w.appId, [...(m.get(w.appId) ?? []), w]);
  return m;
};

/** `pinned`: sabitlerin sırası (kapalı olanlar yalnız simge). `tabs`: sabit olmayan uygulamaların pencereleri, uygulama başına bir öğe, ilk görülme sırasıyla. */
export function mergePins(pins: PinnedApp[], windows: WindowInfo[]): { pinned: StripItem[]; tabs: StripItem[] } {
  const byApp = group(windows);
  const pinnedIds = new Set(pins.map((p) => p.appId));
  const item = (a: { appId: string; name: string; icon: string; colorIcon?: string | null }, ws: WindowInfo[], pinned: boolean): StripItem => ({
    appId: a.appId, name: a.name, icon: a.icon, colorIcon: a.colorIcon, pinned, windows: ws, active: ws.some((w) => w.active),
  });
  return {
    pinned: pins.map((p) => item(p, byApp.get(p.appId) ?? [], true)),
    tabs: [...byApp].filter(([id]) => !pinnedIds.has(id)).map(([, ws]) => item(ws[0], ws, false)),
  };
}

/** Sürükle-sırala: tutulan öğenin yeni sırası ve diğerlerinin kayma miktarı (px). `widths` sıralı genişlikler (boşluk dahil), `dx` işaretçinin başlangıçtan kayması. */
export function dragLayout(widths: number[], from: number, dx: number): { to: number; shifts: number[]; dx: number } {
  const lefts = widths.reduce<number[]>((a, _w, i) => (a.push(i ? a[i - 1] + widths[i - 1] : 0), a), []);
  const total = lefts[lefts.length - 1] + widths[widths.length - 1];
  const w = widths[from];
  const x = Math.min(Math.max(lefts[from] + dx, 0), total - w); // kenarda dur
  const center = x + w / 2;
  let to = 0;
  widths.forEach((ww, i) => { if (i !== from && lefts[i] + ww / 2 < center) to++; });
  const shifts = widths.map((_, i) => (i === from ? 0 : from < to && i > from && i <= to ? -w : from > to && i < from && i >= to ? w : 0));
  return { to, shifts, dx: x - lefts[from] };
}

export const reorder = <T,>(list: T[], from: number, to: number): T[] => {
  const out = list.slice();
  out.splice(to, 0, ...out.splice(from, 1));
  return out;
};
