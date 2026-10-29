import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Calendar, Bell, FilePen, BatteryLow, Check, Clipboard, Download, Cpu, Gauge, Headphones, Music, ShieldCheck, Terminal, Timer, WifiOff } from "lucide-react";
import type { Alert, CcEdit, Media, CpuHigh, DownloadDone, MusicStopped, Status, TimerState } from "../bridge";
import type { ProtrusionItem } from "../plugin-api";
import { timerLeft, useSecond } from "../hooks";
import { AlertIcon, safeIcon } from "../lib/alertIcon";
import { fmtTime, trackTitle } from "../lib/media";
import { burstLabel, editLabel, type Burst } from "../lib/notes";
import { REMINDER_PLUGIN } from "../lib/meetingReminder";
import { flat } from "../lib/plugin";
import type { ActivityKind } from "../lib/priority";
import { SPRINGS } from "../motion/spring";
import { useSpring } from "../motion/useSpring";

/** Generic labels on the strip and bubble while locked (ADR-0063 §6; decision 2026-10-17): track name, artist, cover and alert text never reach the DOM, title or aria. */
export const LOCK_MUSIC = "Music playing", LOCK_ALERT = "Alert";

/** One row of the bubble and the "+N" list. No mascot here ever (one-mascot rule): the face is only an icon, cover or ring. */
export interface BubbleItem { kind: ActivityKind; /** Inside of the 30 px circle. */ face: ReactNode; /** Small icon in the list. */ glyph: ReactNode; label: string; sub?: ReactNode }
export interface BubbleCtx { away?: string | null; net?: "lost" | "back" | null; media: Media | null; timer: TimerState | null; alert: Alert | null; prot: ProtrusionItem | null; done: { title: string } | null; locked: boolean; battery?: Status["battery"]; burst?: Burst | null; stopped?: MusicStopped | null; dl?: DownloadDone | null; update?: string | null; cpu?: CpuHigh | null; edit?: CcEdit | null }

const R = 13, C = 2 * Math.PI * R;
/** Thin ring: `y` is the 0..1 filled ratio; `spin` is indeterminate progress (a spinning arc). */
function Ring({ y = 0, spin = false }: { y?: number; spin?: boolean }) {
  return (
    <svg className={"sideRing" + (spin ? " spin" : "")} viewBox="0 0 30 30" aria-hidden="true">
      <circle className="track" cx="15" cy="15" r={R} />
      <circle className="ilr" cx="15" cy="15" r={R} strokeDasharray={spin ? `${C * 0.25} ${C}` : `${C * Math.max(0, Math.min(1, y))} ${C}`} />
    </svg>
  );
}

/** "24:12"; past an hour, "2h" (the full time doesn't fit in 30 px). */
const shortTime = (s: number) => (s >= 3600 ? `${Math.ceil(s / 3600)}h` : fmtTime(Math.ceil(s)));
function TimeText({ t }: { t: TimerState }) {
  const now = useSecond(t.running);
  return <>{shortTime(timerLeft(t, now))}</>;
}
function TimerFace({ t }: { t: TimerState }) {
  const now = useSecond(t.running);
  const left = timerLeft(t, now);
  return <><Ring y={t.totalS > 0 ? left / t.totalS : 0} /><span className="sideTime">{shortTime(left)}</span></>;
}

/** An activity's face and label in the bubble. While locked, only a generic icon and generic label. */
export function bubbleItem(kind: ActivityKind, c: BubbleCtx): BubbleItem {
  const { media: m, timer: t, alert: a, prot: p, done: d, locked } = c;
  const plain = (icon: ReactNode, label: string, sub?: ReactNode): BubbleItem => ({ kind, face: icon, glyph: icon, label, sub });
  const shown = !locked || p?.plugin.id === REMINDER_PLUGIN.id; // the meeting reminder's title is already generic text when locked / presenting
  switch (kind) {
    case "music": {
      const open = !locked && m;
      return { kind, glyph: <Music />, face: open && m.art ? <img className="sideCover" src={m.art} alt="" /> : <Music />, label: open ? `Playing: ${trackTitle(m)}` : LOCK_MUSIC, sub: open ? m.artist : undefined };
    }
    case "timer": case "timerEnd":
      return { kind, glyph: <Timer />, face: !locked && t ? <TimerFace t={t} /> : <Timer />, label: !locked && t ? `Timer: ${flat(t.label, 24)}` : "Timer", sub: !locked && t ? <TimeText t={t} /> : undefined };
    case "live": {
      const open = !locked && p;
      const ring = open && typeof p.progress === "number" ? <Ring y={p.progress} /> : open ? <Ring spin /> : null;
      return { kind, glyph: <Terminal />, face: <>{ring}<Terminal /></>, label: open ? flat(p.title, 60) : "Assistant working", sub: open && p.subtitle ? flat(p.subtitle, 60) : undefined };
    }
    case "meeting": return plain(<Calendar />, shown && p ? flat(p.title, 60) : "Meeting", shown && p?.subtitle ? flat(p.subtitle, 60) : undefined);
    case "alert": return plain(<AlertIcon name={locked ? null : a?.icon ?? null} />, locked || !a ? LOCK_ALERT : flat(a.title, 60), !locked && a?.subtitle ? flat(a.subtitle, 60) : undefined);
    case "done": return plain(<Check />, !locked && d ? flat(d.title, 60) : "Task done");
    case "summary": return plain(<Bell />, c.away ?? "While you were away");
    case "battery": case "batteryCrit": return plain(<BatteryLow />, c.battery?.percent != null ? `Battery ${c.battery.percent}%` : "Battery low");
    case "burst": return plain(<Bell />, burstLabel(c.burst?.n ?? 0, c.burst?.apps ?? [], locked));
    case "musicStopped": return plain(<Headphones />, locked || !c.stopped ? "Music paused" : `Music paused — ${flat(c.stopped.name, 28)} disconnected`);
    case "cpu": return plain(<Cpu />, locked || !c.cpu?.app ? "CPU is very busy" : `${flat(c.cpu.app, 28)} is using a lot of CPU`);
    case "edit": return plain(<FilePen />, c.edit ? editLabel(c.edit, locked) : "Claude Code is editing");
    case "rateLimit": return plain(<Gauge />, "Usage limit reached");
    case "net": return plain(<WifiOff />, c.net === "back" ? "Back online" : "Connection lost");
    case "clip": return plain(<Clipboard />, "Copied to clipboard");
    case "approval": return plain(<ShieldCheck />, "Awaiting approval");
    case "update": return plain(<Download />, c.update ? `Peeka ${flat(c.update, 12)} is available` : "Update available");
    case "download": return plain(<Download />, locked || !c.dl ? "Download complete" : `Downloaded: ${flat(c.dl.name, 40)}`);
    default: return plain(<AlertIcon name={locked ? null : safeIcon(p?.icon)} />, shown && p ? flat(p.title, 60) : "Plugin");
  }
}

/**
 * Side bubble (owner decision 2026-10-17): the next live activity after the main strip, a 30 px circle right of the island.
 * Out of flow, absolutely placed from the island's edge (`edge`, px from center): the island never shifts. Enter and exit are a short, calm spring (from scale 0.88, slightly from the left).
 * `items[0]` is in the bubble, the rest in the "+N" list. Clicking brings that activity forward (`onPick`).
 */
export function SideBubble({ items, edge, open, setOpen, onPick, onHover }: {
  items: BubbleItem[]; edge: number; open: boolean; setOpen: (v: boolean) => void; onPick: (k: ActivityKind) => void; onHover: (on: boolean) => void;
}) {
  const on = items.length > 0;
  const v = useSpring(on ? 1 : 0, SPRINGS.quick);
  const keep = useRef(items);
  if (on) keep.current = items; // keep the last content visible while the exit spring runs
  const list = on ? items : keep.current;
  const root = useRef<HTMLDivElement>(null);
  const n = list.length - 1; // "+N": activities after the one in the bubble
  useEffect(() => { if (open && (!on || n < 1)) setOpen(false); }, [open, on, n, setOpen]);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node | null)) setOpen(false); };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [open, setOpen]);
  if (!on && v < 0.01) return null;
  const top = list[0], rest = list.slice(1);
  const label = n >= 1 ? `${top.label}. ${n} more` : top.label;
  const style = { left: `calc(50% + ${edge}px)`, opacity: Math.min(1, v * 1.6), transform: `translateX(${(1 - v) * -18}px) scale(${0.88 + 0.12 * v})`, visibility: v < 0.01 ? "hidden" : "visible", pointerEvents: on ? undefined : "none" } as CSSProperties;
  return (
    <div ref={root} className="sideBubble" style={style} onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)}>
      <button type="button" className="sideBtn" data-hit aria-label={label} title={label} onClick={() => { setOpen(false); onPick(top.kind); }}>
        <span key={top.kind} className="sideFace">{top.face}</span>
      </button>
      {n >= 1 && <button type="button" className="sidePlus" data-hit aria-expanded={open} aria-label={`${n} more, ${open ? "hide" : "show"} list`} onClick={() => setOpen(!open)}>+{n}</button>}
      {open && n >= 1 && (
        <div className="sideList" data-hit role="group" aria-label="Other activities">
          {rest.map((it) => (
            <button type="button" key={it.kind} className="sideRow" onClick={() => { setOpen(false); onPick(it.kind); }}>
              {it.glyph}<span className="b6 sideName">{it.label}</span>{it.sub && <span className="l3 num">{it.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
