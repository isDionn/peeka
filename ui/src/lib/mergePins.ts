import type { PinnedApp, WindowInfo } from "../bridge";

/** One strip item: a pin + its open app are a single item (owner decision 20). */
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

/** `pinned`: pin order (closed ones are icon only). `tabs`: windows of unpinned apps, one item per app, in first-seen order. */
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

/** Strip slots (px): 32 at rest, shrinking to 26 at most (an 18 px logo plus its count badge), then a "+N" button. */
export const SLOT = 32, SLOT_MIN = 26, GAP = 2, DIVIDER = 17, MORE = 32;

export interface StripFit { slot: number; pinned: StripItem[]; tabs: StripItem[]; hidden: StripItem[] }

/** Pins then tabs into `avail` px (left of the island): slots shrink first, then the end of the list goes behind "+N".
 *  The foreground app never hides: it takes the last visible slot. `hold`: the slot width kept while the pointer is on the
 *  list, so an app starting or quitting never resizes the logos under it. */
export function fitStrip(pinned: StripItem[], tabs: StripItem[], avail: number, hold?: number | null): StripFit {
  const all = [...pinned, ...tabs];
  const div = tabs.length ? DIVIDER : 0;
  const slot = hold ?? Math.max(SLOT_MIN, Math.min(SLOT, Math.floor((avail - div) / Math.max(1, all.length)) - GAP));
  if (all.length * (slot + GAP) + div <= avail) return { slot, pinned, tabs, hidden: [] };
  const cap = Math.max(1, Math.floor((avail - div - MORE - GAP) / (slot + GAP)));
  const shown = all.slice(0, cap), hidden = all.slice(cap);
  const fg = hidden.findIndex((i) => i.active);
  if (fg >= 0) [shown[cap - 1], hidden[fg]] = [hidden[fg], shown[cap - 1]];
  if (fg > 0) hidden.unshift(...hidden.splice(fg, 1)); // the app it pushed out leads the hidden list (its old place)
  return { slot, pinned: shown.filter((i) => i.pinned), tabs: shown.filter((i) => !i.pinned), hidden };
}

/** Drag to reorder: the held item's new index and how far the others shift (px). `widths` are the ordered widths (gap included), `dx` the pointer's offset from the start. */
export function dragLayout(widths: number[], from: number, dx: number): { to: number; shifts: number[]; dx: number } {
  const lefts = widths.reduce<number[]>((a, _w, i) => (a.push(i ? a[i - 1] + widths[i - 1] : 0), a), []);
  const total = lefts[lefts.length - 1] + widths[widths.length - 1];
  const w = widths[from];
  const x = Math.min(Math.max(lefts[from] + dx, 0), total - w); // stop at the edge
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
