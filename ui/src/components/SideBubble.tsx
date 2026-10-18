import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Calendar, Bell, BatteryLow, Check, Clipboard, Download, Cpu, Gauge, Headphones, Music, ShieldCheck, Terminal, Timer, WifiOff } from "lucide-react";
import type { Alert, Media, CpuHigh, DownloadDone, MusicStopped, Status, TimerState } from "../bridge";
import type { ProtrusionItem } from "../plugin-api";
import { timerLeft, useSecond } from "../hooks";
import { AlertIcon, safeIcon } from "../lib/alertIcon";
import { fmtTime, trackTitle } from "../lib/media";
import { burstLabel, type Burst } from "../lib/notes";
import { REMINDER_PLUGIN } from "../lib/meetingReminder";
import { flat } from "../lib/plugin";
import type { ActivityKind } from "../lib/priority";
import { YAY } from "../motion/spring";
import { useSpring } from "../motion/useSpring";

/** Kilitliyken şeritte ve baloncukta içerik yerine genel etiket (ADR-0063 §6; karar 2026-10-17): parça adı, sanatçı, kapak ve uyarı metni DOM'a, title'a, aria'ya girmez. */
export const LOCK_MUSIC = "Müzik çalıyor", LOCK_ALERT = "Uyarı var";

/** Baloncuğun ve "+N" listesinin bir satırı. Maskot burada hiç yok (tek maskot kuralı): yüz yalnız simge, kapak ya da halka. */
export interface BubbleItem { kind: ActivityKind; /** 30 px yuvarlağın içi. */ face: ReactNode; /** Listedeki küçük simge. */ glyph: ReactNode; label: string; sub?: ReactNode }
export interface BubbleCtx { away?: string | null; net?: "lost" | "back" | null; media: Media | null; timer: TimerState | null; alert: Alert | null; prot: ProtrusionItem | null; done: { title: string } | null; locked: boolean; battery?: Status["battery"]; burst?: Burst | null; stopped?: MusicStopped | null; dl?: DownloadDone | null; cpu?: CpuHigh | null }

const R = 13, C = 2 * Math.PI * R;
/** İnce halka: `y` 0..1 dolu oran; `spin` belirsiz ilerleme (dönen yay). */
function Ring({ y = 0, spin = false }: { y?: number; spin?: boolean }) {
  return (
    <svg className={"yanHalka" + (spin ? " don" : "")} viewBox="0 0 30 30" aria-hidden="true">
      <circle className="iz" cx="15" cy="15" r={R} />
      <circle className="ilr" cx="15" cy="15" r={R} strokeDasharray={spin ? `${C * 0.25} ${C}` : `${C * Math.max(0, Math.min(1, y))} ${C}`} />
    </svg>
  );
}

/** "24:12"; bir saati aşınca "2 sa" (30 px'e sığmaz). */
const shortTime = (s: number) => (s >= 3600 ? `${Math.ceil(s / 3600)} sa` : fmtTime(Math.ceil(s)));
function TimeText({ t }: { t: TimerState }) {
  const now = useSecond(t.running);
  return <>{shortTime(timerLeft(t, now))}</>;
}
function TimerFace({ t }: { t: TimerState }) {
  const now = useSecond(t.running);
  const left = timerLeft(t, now);
  return <><Ring y={t.totalS > 0 ? left / t.totalS : 0} /><span className="yanSure">{shortTime(left)}</span></>;
}

/** Bir işin baloncuktaki yüzü ve etiketi. Kilitliyken yalnız genel simge ve genel etiket. */
export function bubbleItem(kind: ActivityKind, c: BubbleCtx): BubbleItem {
  const { media: m, timer: t, alert: a, prot: p, done: d, locked } = c;
  const plain = (icon: ReactNode, label: string, sub?: ReactNode): BubbleItem => ({ kind, face: icon, glyph: icon, label, sub });
  const shown = !locked || p?.plugin.id === REMINDER_PLUGIN.id; // toplantı hatırlatmasının başlığı kilitte/sunumda zaten genel metindir
  switch (kind) {
    case "music": {
      const open = !locked && m;
      return { kind, glyph: <Music />, face: open && m.art ? <img className="yanKapak" src={m.art} alt="" /> : <Music />, label: open ? `Çalıyor: ${trackTitle(m)}` : LOCK_MUSIC, sub: open ? m.artist : undefined };
    }
    case "timer": case "timerEnd":
      return { kind, glyph: <Timer />, face: !locked && t ? <TimerFace t={t} /> : <Timer />, label: !locked && t ? `Zamanlayıcı: ${flat(t.label, 24)}` : "Zamanlayıcı", sub: !locked && t ? <TimeText t={t} /> : undefined };
    case "live": {
      const open = !locked && p;
      const ring = open && typeof p.progress === "number" ? <Ring y={p.progress} /> : open ? <Ring spin /> : null;
      return { kind, glyph: <Terminal />, face: <>{ring}<Terminal /></>, label: open ? flat(p.title, 60) : "Asistan çalışıyor", sub: open && p.subtitle ? flat(p.subtitle, 60) : undefined };
    }
    case "meeting": return plain(<Calendar />, shown && p ? flat(p.title, 60) : "Toplantı", shown && p?.subtitle ? flat(p.subtitle, 60) : undefined);
    case "alert": return plain(<AlertIcon name={locked ? null : a?.icon ?? null} />, locked || !a ? LOCK_ALERT : flat(a.title, 60), !locked && a?.subtitle ? flat(a.subtitle, 60) : undefined);
    case "done": return plain(<Check />, !locked && d ? flat(d.title, 60) : "İş bitti");
    case "summary": return plain(<Bell />, c.away ?? "Sen yokken");
    case "battery": case "batteryCrit": return plain(<BatteryLow />, c.battery?.percent != null ? `Pil %${c.battery.percent}` : "Pil az");
    case "burst": return plain(<Bell />, burstLabel(c.burst?.n ?? 0, c.burst?.apps ?? [], locked));
    case "musicStopped": return plain(<Headphones />, locked || !c.stopped ? "Müzik durdu" : `Müzik durdu — ${flat(c.stopped.name, 28)} ayrıldı`);
    case "cpu": return plain(<Cpu />, locked || !c.cpu?.app ? "İşlemci çok yoğun" : `${flat(c.cpu.app, 28)} çok yoruyor`);
    case "rateLimit": return plain(<Gauge />, "Kota doldu");
    case "net": return plain(<WifiOff />, c.net === "back" ? "Bağlantı geri geldi" : "Bağlantı koptu");
    case "clip": return plain(<Clipboard />, "Panoya kopyalandı");
    case "approval": return plain(<ShieldCheck />, "Onay bekliyor");
    case "download": return plain(<Download />, locked || !c.dl ? "İndirme bitti" : `İndi: ${flat(c.dl.name, 40)}`);
    default: return plain(<AlertIcon name={locked ? null : safeIcon(p?.icon)} />, shown && p ? flat(p.title, 60) : "Eklenti");
  }
}

/**
 * Yan baloncuk (sahip kararı 2026-10-17): ana şeritten sonra gelen canlı iş, adanın sağında 30 px yuvarlak.
 * Akışta değil, adanın kenarından (`edge`, merkezden px) hesaplanan mutlak konumda: ada hiç kaymaz. Giriş ve çıkış kısa, sakin bir yay (ölçek 0,88 den, hafif soldan).
 * `items[0]` baloncukta, ikinciden sonrası "+N" listesinde. Tıklama işi öne alır (`onPick`).
 */
export function SideBubble({ items, edge, open, setOpen, onPick, onHover }: {
  items: BubbleItem[]; edge: number; open: boolean; setOpen: (v: boolean) => void; onPick: (k: ActivityKind) => void; onHover: (on: boolean) => void;
}) {
  const on = items.length > 0;
  const v = useSpring(on ? 1 : 0, YAY.hizli);
  const keep = useRef(items);
  if (on) keep.current = items; // çıkış yayı sürerken son içerik görünür kalır
  const list = on ? items : keep.current;
  const root = useRef<HTMLDivElement>(null);
  const n = list.length - 1; // "+N": baloncuktakinden sonraki işler
  useEffect(() => { if (open && (!on || n < 1)) setOpen(false); }, [open, on, n, setOpen]);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node | null)) setOpen(false); };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [open, setOpen]);
  if (!on && v < 0.01) return null;
  const top = list[0], rest = list.slice(1);
  const label = n >= 1 ? `${top.label}. ${n} iş daha var` : top.label;
  const style = { left: `calc(50% + ${edge}px)`, opacity: Math.min(1, v * 1.6), transform: `translateX(${(1 - v) * -18}px) scale(${0.88 + 0.12 * v})`, visibility: v < 0.01 ? "hidden" : "visible", pointerEvents: on ? undefined : "none" } as CSSProperties;
  return (
    <div ref={root} className="yanBal" style={style} onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)}>
      <button type="button" className="yanDug" data-hit aria-label={label} title={label} onClick={() => { setOpen(false); onPick(top.kind); }}>
        <span key={top.kind} className="yanYuz">{top.face}</span>
      </button>
      {n >= 1 && <button type="button" className="yanArti" data-hit aria-expanded={open} aria-label={`${n} iş daha, listeyi ${open ? "kapat" : "aç"}`} onClick={() => setOpen(!open)}>+{n}</button>}
      {open && n >= 1 && (
        <div className="yanListe" data-hit role="group" aria-label="Diğer işler">
          {rest.map((it) => (
            <button type="button" key={it.kind} className="yanSat" onClick={() => { setOpen(false); onPick(it.kind); }}>
              {it.glyph}<span className="b6 yanAd">{it.label}</span>{it.sub && <span className="l3 num">{it.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
