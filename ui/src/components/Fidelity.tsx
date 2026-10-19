// Fidelity audit 1 pieces: assistant line and waves, island line, meeting card, assistant-offline card, shelf suggestion, alert/budget peek, new resting centers.
// Peek/card pieces are used from Island.tsx; the line and waves are drawn on the strip page (lineChan.ts bridge).
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Calendar, EyeOff, Inbox, Share, Sparkles, Video } from "lucide-react";
import { bridge, type Alert, type CalendarNext, type PluginInfo, type ProtrusionItem, type ShelfItem, type ShelfSuggestion } from "../bridge";
import { AlertIcon } from "../lib/alertIcon";
import { actionLabel } from "../lib/alerts";
import { flat, MASCOT_STATES, plain, pluginName } from "../lib/plugin";
import { askLabel } from "../hooks";
import { listenLine, LINE_IDLE, type LineState } from "../lib/lineChan";
import { lineVars } from "../lib/line";
import { useGuard } from "../lib/useGuard";
import { Mascot, type MascotHandle, type Mood } from "../mascot";
import { REMINDER_PLUGIN, type ReminderItem } from "../lib/meetingReminder";
import { Attr, JoinButton, Lead } from "./Plugin";
import { NotchIcon } from "./IslandCards";

const noop = () => undefined;
const refOf = (m: Pick<PluginInfo, "id" | "name">) => ({ id: m.id, name: m.name, main: true });

/* ---- assistant line (#cizgi) and strip wave: on the strip page ---- */
export function StripLine({ shift = 0 }: { shift?: number }) {
  const [s, setS] = useState<LineState>(LINE_IDLE);
  useEffect(() => listenLine((m) => { if (m.k === "line") setS({ color: m.color, mod: m.mod, gap: m.gap }); }), []);
  const mask = s.gap > 0 ? `linear-gradient(90deg,#000 calc(50% - ${s.gap + 8}px),transparent calc(50% - ${s.gap}px),transparent calc(50% + ${s.gap}px),#000 calc(50% + ${s.gap + 8}px))` : undefined;
  return (
    <div id="line" data-mode={s.mod} aria-hidden="true" style={{ ...lineVars(s), maskImage: mask, WebkitMaskImage: mask, transform: shift ? `translateY(${shift}px)` : undefined }}>
      <i className="left" /><i className="right" />
    </div>
  );
}

/** On an alert, a short light runs from the center to both sides (mockup dalgalandir); the line flashes briefly too. */
export function Waves() {
  const L = useRef<HTMLDivElement>(null), R = useRef<HTMLDivElement>(null);
  useEffect(() => listenLine((m) => {
    if (m.k !== "wave") return;
    const W = L.current?.parentElement?.offsetWidth ?? 1920;
    ([[L.current, -1], [R.current, 1]] as const).forEach(([el, dir]) => {
      if (!el?.animate) return;
      el.style.setProperty("--dc", m.color);
      el.animate([{ opacity: 0, transform: "translateX(0) scaleX(.6)" }, { opacity: 1, offset: .18 }, { opacity: 0, transform: `translateX(${dir * W * .5}px) scaleX(1.6)` }], { duration: 1100, easing: "cubic-bezier(.23,1,.32,1)" });
    });
    document.getElementById("line")?.animate?.([{ filter: "brightness(1)" }, { filter: "brightness(2.2)", offset: .15 }, { filter: "brightness(1)" }], { duration: 900, easing: "ease-out" });
  }), []);
  return <><div className="ripple" ref={L} aria-hidden="true" /><div className="ripple" ref={R} aria-hidden="true" /></>;
}

/** The line on the island peek's bottom edge (inside #ada). */
export const IslandLine = ({ s, hidden }: { s: Pick<LineState, "color" | "mod">; hidden: boolean }) => (
  <div className="islandLine" data-mode={s.mod} aria-hidden="true" style={{ ...lineVars(s), ...(hidden ? { "--co": 0 } : null) } as CSSProperties}><i className="left" /><i className="right" /></div>
);

/* ---- strip center: new resting and event states ---- */
export const HiddenCenter = () => <span className="ms hiddenIsland" title="Island hidden. Press Ctrl+Shift+A to show it"><EyeOff aria-label="Island hidden. Press Ctrl+Shift+A to show it" /></span>;
export const OfflineRest = () => <span className="ms"><Mascot size={24} mood="sleeping" isMainAssistant still /><span className="l2">Offline</span></span>;

export function DndRest({ approvals, until, lock }: { approvals: number; until?: string | null; lock?: React.ReactNode }) {
  return (
    <>
      <span className="ms">{lock}<Mascot size={24} mood="quiet" isMainAssistant still /><span className="l2">Do not disturb</span></span>
      {approvals > 0 && <span className="t12 b6 approvalCount num">{approvals} {approvals === 1 ? "approval" : "approvals"}</span>}
      {until && <span className="t12 l3 num">{flat(until, 24)}</span>}
    </>
  );
}

/** Task done: the 40 px strip ghost cheers (raised hands, sparkles) and hops once; no peek opens. `mood` is idle while locked/presenting. */
export function JobDoneCenter({ title, took, mood = "done" }: { title: string; took: string; mood?: Mood }) {
  const mk = useRef<MascotHandle>(null);
  useEffect(() => { const t = setTimeout(() => mk.current?.hop(), 200); return () => clearTimeout(t); }, []);
  return <span className="ms"><Mascot ref={mk} size={40} mood={mood} isMainAssistant /><span className="b6">{flat(title, 60)}</span><span className="l3">{flat(took, 24)}</span></span>;
}

export const MeetingCenter = ({ main }: { main: PluginInfo | null }) => <span className="ms">{main && <Lead plugin={refOf(main)} mascot="ready" />}<Calendar /><span className="b6">Meeting</span></span>;
export const ShelfOpenCenter = () => <span className="ms"><Inbox /><span className="b6">Shelf</span></span>;

/** Alert center: the mascot (attention, tired) if a main assistant is connected and the alert icon is a mascot state, else a monochrome icon. */
export function AlertCenter({ alert, main }: { alert: Alert; main: PluginInfo | null }) {
  const mood = main && alert.icon && MASCOT_STATES.has(alert.icon) ? alert.icon : null;
  return <span className="ms">{mood ? <Lead plugin={refOf(main!)} mascot={mood} /> : <span className="ikK"><AlertIcon name={alert.icon} /></span>}<span className="b6">{alert.title}</span></span>;
}

/* ---- alert peek: primary button, budget/usage bar ---- */
const BUDGET = "tired"; // plugin API value: budget and usage alerts arrive with the "tired" (tired) mascot state; the button is "Details"
export function AlertBumpFid({ alert, onLater, onDetail }: { alert: Alert; onLater: () => void; onDetail: () => void }) {
  const level = alert.style === "level" && alert.progress !== null;
  const budget = alert.icon === BUDGET;
  const p = alert.progress;
  return (
    <div className="peekBar">
      {level && <><span className="hudTrack"><b style={{ "--s": p } as CSSProperties} /></span><span className="num b6 t12">{Math.round((p ?? 0) * 100)}</span></>}
      {!level && p !== null && <span className="miniProgress" style={{ "--y": p, width: budget ? 72 : undefined } as CSSProperties}><b style={budget ? { background: p >= 1 ? "var(--red)" : "var(--orange)" } : undefined} /></span>}
      {alert.subtitle && <span className="t12 l2" title={alert.subtitle}>{alert.subtitle}</span>}
      {alert.action && !budget && <button className="btn kk primary" onClick={() => bridge.call("open_alert", { id: alert.id }).catch(noop)}>{actionLabel(alert)}</button>}
      {budget ? <button className="btn kk gray" onClick={onDetail}>Details</button> : !level && <button className="btn kk gray" onClick={onLater}>Later</button>}
    </div>
  );
}

/* ---- cards ---- */
export function MeetingCard({ item }: { item: ProtrusionItem }) {
  const [cal, setCal] = useState<CalendarNext | null>(null);
  useEffect(() => { bridge.call("calendar_next").then(setCal).catch(noop); }, []);
  const guard = useGuard();
  const join = item.actions?.find((a) => a.style === "primary") ?? item.actions?.[0];
  return (
    <div className="body">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t17 b6">{flat(item.title, 80)}</div>
          <div className="t13 b4 l2"><Attr plugin={item.plugin} title={cal?.detail ?? item.subtitle} /></div>
        </div>
        {join && item.plugin.id === REMINDER_PLUGIN.id ? ((item as ReminderItem).link && <JoinButton link={(item as ReminderItem).link!} className="btn blue" label={join.label} focus><span className="filled"><Video /></span></JoinButton>)
        : join && <button ref={guard.ref} className="btn blue" data-autofocus data-guarded onClick={guard(() => bridge.call("plugin_action", { pluginId: item.plugin.id, actionId: join.id }).catch(noop))}><span className="filled"><Video /></span>{plain(join.label, 24)}</button>}
      </div>
      {cal && cal.next.length > 0 && (
        <div className="list glass" style={{ "--indent": "52px" } as CSSProperties}>
          {cal.next.slice(0, 3).map((e) => <div className="row" key={e.time + e.title}><span className="l3 num" style={{ width: 42 }}>{flat(e.time, 8)}</span><span className="text">{flat(e.title, 60)}</span><span className="l3">{flat(e.source, 30)}</span></div>)}
        </div>
      )}
    </div>
  );
}

/** Main assistant not connected (x1): sleeping mascot and "Launch <name>" (only if the main plugin's manifest has `launch`). If no main plugin is installed (`main` missing), Peeka's neutral icon and no button. */
export function AssistantOfflineCard({ main = null }: { main?: PluginInfo | null }) {
  const [err, setErr] = useState(false);
  const name = main ? pluginName(main) : "Assistant";
  return (
    <div className="body">
      <div className="mkCenter">
        {main ? <Mascot size={56} mood="sleeping" isMainAssistant /> : <NotchIcon size={56} />}
        <div className="t15 b6">{name} isn't connected</div>
        <div className="t13 l2 b4">Peeka keeps working. Your questions come here once {name} is open.</div>
        {main?.launch && <div className="buttons" style={{ marginTop: 4 }}><button className="btn primary" data-autofocus onClick={() => { setErr(false); bridge.call("assistant_start").catch(() => setErr(true)); }}>Launch {name}</button></div>}
        {err && <div className="t12 l3" role="alert">Couldn't launch {name} right now</div>}
      </div>
    </div>
  );
}

/** Card loading (ky): skeleton. The show delay (800 ms) lives in Island. */
export const LoadingBody = ({ what }: { what: string }) => (
  <div className="body" role="status" aria-label={what}>
    <div className="mkHead"><Mascot size={56} mood="thinking" isMainAssistant /><span className="t13 l2 b4">{plain(what, 60)}</span></div>
    <div className="skeleton" /><div className="skeleton" style={{ width: "86%" }} /><div className="skeleton" style={{ width: "70%" }} />
  </div>
);

/** The assistant's suggestion for the selected file (g): nothing is drawn without a suggestion. */
export function ShelfSuggestRow({ items, main }: { items: ShelfItem[]; main: PluginInfo | null }) {
  const first = items[0]?.id;
  const [sug, setSug] = useState<ShelfSuggestion | null>(null);
  useEffect(() => { setSug(null); if (first && main) bridge.call("shelf_suggest", { id: first }).then(setSug).catch(noop); }, [first, main]);
  if (!main || !sug || sug.id !== first) return null;
  return (
    <div className="body" style={{ paddingTop: 0, marginTop: -4 }}>
      <div className="suggestion plat glass">
        <Lead plugin={refOf(main)} mascot="speaking" size={24} />
        <div style={{ flex: 1 }}>
          <div className="b4">{plain(sug.text, 200)}</div>
          <div className="buttons" style={{ marginTop: 10 }}>
            <button className="btn kk assistant" onClick={() => bridge.call("shelf_ask", { id: sug.id }).catch(noop)}><Sparkles />{askLabel(main)}</button>
            <button className="btn kk glass" onClick={() => bridge.call("shelf_memory", { id: sug.id }).catch(noop)}>Add to Notes</button>
            <button className="btn kk glass" onClick={() => bridge.call("share_open", { id: sug.id }).catch(noop)}><Share />Share</button>
          </div>
        </div>
      </div>
    </div>
  );
}
