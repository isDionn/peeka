// F8 weekly recap: the card's rows and the share image (1080x1350). Everything is drawn on the page from the counts
// Rust sent; nothing is uploaded. Peeka never learns project names (the agent hook drops the folder), so the image has none.
import type { RecapWeek } from "../bridge";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const SHARE_W = 1080, SHARE_H = 1350;

export function duration(ms: number): string {
  const m = Math.round(ms / 60_000), h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

/** The weekday with the most coding activity; null for a week without any. Ties go to the earlier day. */
export function busiest(w: RecapWeek): string | null {
  let best = -1;
  w.days.forEach((n, i) => { if (n > 0 && (best < 0 || n > w.days[best])) best = i; });
  return best < 0 ? null : DAYS[best];
}

/** "Oct 12 – 18" (or "Sep 28 – Oct 4"); `startDay` is a local date, so it is formatted as UTC. */
export function weekRange(w: RecapWeek): string {
  const f = (d: number, o: Intl.DateTimeFormatOptions) => new Date(d * 86_400_000).toLocaleDateString("en-US", { timeZone: "UTC", ...o });
  const a = new Date(w.startDay * 86_400_000), b = new Date((w.startDay + 6) * 86_400_000);
  return `${f(w.startDay, { month: "short", day: "numeric" })} – ${f(w.startDay + 6, a.getUTCMonth() === b.getUTCMonth() ? { day: "numeric" } : { month: "short", day: "numeric" })}`;
}

export function recapRows(w: RecapWeek): { label: string; value: string }[] {
  return [
    { label: "Coding sessions", value: String(w.sessions) },
    { label: "Session time", value: duration(w.sessionMs) },
    { label: "Approvals", value: `${w.allowed} allowed, ${w.denied} denied` },
    { label: "Files changed", value: String(w.files) },
    { label: "Busiest day", value: busiest(w) ?? "None" },
    { label: "Clipboard items", value: String(w.clips) },
  ];
}

/** Effective opacity of `el` up to (not including) `top`. */
function opacity(el: Element, top: Element): number {
  let o = 1;
  for (let e: Element | null = el; e && e !== top; e = e.parentElement) {
    const s = getComputedStyle(e);
    if (s.display === "none" || s.visibility === "hidden") return 0;
    o *= Number(s.opacity || 1);
  }
  return o;
}

/**
 * Draws the share image. `ghost` is a rendered, still Mascot (its art parts are <img>s): each visible part is copied
 * at its laid-out rectangle, scaled to `ghostW`. Returns PNG bytes, or null when the page has no canvas.
 * shortcut: part rotations and clip-paths are ignored (the `done` mood has none); draw them if another mood is used.
 */
export async function shareImage(w: RecapWeek, ghost: HTMLElement): Promise<Uint8Array | null> {
  const c = document.createElement("canvas");
  c.width = SHARE_W; c.height = SHARE_H;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const imgs = Array.from(ghost.querySelectorAll("img")).filter((i) => i.getAttribute("src"));
  await Promise.all(imgs.map((i) => i.decode?.().catch(() => undefined)));
  await document.fonts?.ready;
  // background: the island's dark surface with a soft green light behind the ghost
  ctx.fillStyle = "#121214"; ctx.fillRect(0, 0, SHARE_W, SHARE_H);
  const glow = ctx.createRadialGradient(SHARE_W / 2, 330, 0, SHARE_W / 2, 330, 520);
  glow.addColorStop(0, "rgba(48,209,88,.16)"); glow.addColorStop(1, "rgba(48,209,88,0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, SHARE_W, SHARE_H);
  // ghost
  const box = ghost.getBoundingClientRect(), ghostW = 360, k = box.width ? ghostW / box.width : 0;
  const gx = (SHARE_W - ghostW) / 2, gy = 110;
  for (const i of imgs) {
    const r = i.getBoundingClientRect(), o = opacity(i, ghost);
    if (!k || !r.width || !o) continue;
    ctx.globalAlpha = o;
    ctx.drawImage(i, gx + (r.left - box.left) * k, gy + (r.top - box.top) * k, r.width * k, r.height * k);
  }
  ctx.globalAlpha = 1;
  // title and numbers
  const font = getComputedStyle(document.documentElement).getPropertyValue("--font").trim() || "system-ui, sans-serif";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  ctx.fillStyle = "#F5F5F7"; ctx.font = `700 76px ${font}`;
  ctx.fillText("My week", SHARE_W / 2, 690);
  ctx.fillStyle = "rgba(235,235,245,.6)"; ctx.font = `500 34px ${font}`;
  ctx.fillText(weekRange(w), SHARE_W / 2, 746);
  const x0 = 140, x1 = SHARE_W - 140;
  recapRows(w).forEach(({ label, value }, n) => {
    const y = 860 + n * 70;
    if (n) { ctx.fillStyle = "rgba(235,235,245,.12)"; ctx.fillRect(x0, y - 46, x1 - x0, 1); }
    ctx.textAlign = "left"; ctx.fillStyle = "rgba(235,235,245,.74)"; ctx.font = `500 34px ${font}`;
    ctx.fillText(label, x0, y);
    ctx.textAlign = "right"; ctx.fillStyle = "#F5F5F7"; ctx.font = `600 34px ${font}`;
    ctx.fillText(value, x1, y);
  });
  ctx.textAlign = "center"; ctx.fillStyle = "rgba(235,235,245,.6)"; ctx.font = `600 28px ${font}`;
  ctx.fillText("Peeka", SHARE_W / 2, SHARE_H - 64);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
