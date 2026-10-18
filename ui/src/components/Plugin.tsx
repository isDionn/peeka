// Declarative plugin rendering (ADR-0062 §4.6): the plugin sends data, Peeka draws. All text is plain text (React escaping); no `dangerouslySetInnerHTML`, links or plugin icons.
// Peeka prints the plugin's name in front of every item (`prefixed`); the plugin can't change that.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlarmClock, Brain, Check, Circle, CircleCheck, CircleDot, ExternalLink, Ghost, List, Mic, MousePointerClick, Paperclip, Plus, ScanLine, ShieldAlert, StickyNote, Terminal, TriangleAlert, Users, Video, X, type LucideIcon } from "lucide-react";
import { bridge, type ActionDef, type ApprovalExt, type ApprovalItem, type Attached, type CardBlock, type ChoiceExt, type ComposerKind, type MeterBlock, type RowExt, type ProtrusionExt, type SummaryRowExt, type ModuleTab, type PluginRef, type ProtrusionItem, type SurfacesView } from "../bridge";
import { useClips, useDeadline, useSecond, useShelf, useStream, type Turn } from "../hooks";
import { AlertIcon, safeIcon } from "../lib/alertIcon";
import { Mascot } from "../mascot";
import { elapsed, flat, mascotOf, moodOf, plain, pluginName, prefixed, riskOf, safeImage } from "../lib/plugin";
import { useGuard } from "../lib/useGuard";
import { openJoinLink, REMINDER_PLUGIN, type ReminderItem } from "../lib/meetingReminder";
import { shortApprovalTitle } from "../lib/cardsText";
import { useComposerKinds } from "../hooks.fidelity";
import { Transcript, phaseOf } from "./Voice";
import "./cards.css";
import { HoldButton } from "./common";

/* ---- identity: name prefix and initial tile / mascot ---- */

/** "assistant › Title": the prefix is Peeka's, dimmed; the title is the plugin's, with separators flattened. */
export function Attr({ plugin, title, strong, dim }: { plugin: Pick<PluginRef, "name">; title?: unknown; strong?: boolean; /** Source name: the title is dimmed too (mockup c1: "Claude Code" text 3). */ dim?: boolean }) {
  const n = pluginName(plugin), t = flat(title);
  const same = !t || t.toLowerCase() === n.toLowerCase();
  return <span className="prefix" data-prefix>{same ? <span className={strong ? "b6" : "l3"}>{n}</span> : <><span className="l3">{n} ›</span> <span className={strong ? "b6" : dim ? "l3" : undefined}>{t}</span></>}</span>;
}

/** The main assistant's mascot (in the table's state) or Peeka's initial tile. 24 px strip (default), 56 px card, 96 px large card. `onPoke`: click (after the hop). */
export function Lead({ plugin, mascot, size = 24, onPoke, still, hint }: { plugin: PluginRef; mascot?: unknown; size?: number; onPoke?: () => void; still?: boolean; /** Keyboard hint next to the badge (shown only at 56 px in the approval state). */ hint?: ReactNode }) {
  const state = mascotOf(plugin, mascot);
  if (state) return <span className="leadMascot" data-mk={state} aria-hidden="true"><Mascot size={size} mood={moodOf(state)} isMainAssistant onPoke={onPoke} still={still} badgeHint={hint} /></span>;
  return <span className={"initials" + (size < 28 ? " k" : size >= 56 ? " b" : "")} aria-hidden="true">{Array.from(pluginName(plugin))[0]?.toUpperCase()}</span>;
}

/** Peeka's button styles: only `default | primary | destructive`; no free colors. */
const styleClass = (s: ActionDef["style"]) => (s === "primary" ? "blue" : s === "destructive" ? "destructiveFill" : "gray");

/** A button that ignores clicks before the guard time has passed. */
function GuardBtn({ className, onClick, children, ...rest }: { className: string; onClick: () => void; children: ReactNode } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "className">) {
  const guard = useGuard();
  return <button {...rest} ref={guard.ref} className={className} data-guarded onClick={guard(onClick)}>{children}</button>;
}

/** "Join" in a reminder: opens the link; if that fails the button says "Couldn't open" (it doesn't fail silently). */
export function JoinButton({ link, className, label, focus, children }: { link: string; className: string; label: string; focus?: boolean; children?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  return <GuardBtn className={className} data-autofocus={focus ? true : undefined} onClick={() => { setFailed(false); openJoinLink(link).catch(() => setFailed(true)); }}>{children}{failed ? "Couldn't open" : plain(label, 24)}</GuardBtn>;
}

function ActionButtons({ plugin, actions, kk = true, video, link }: { plugin: PluginRef; actions?: ActionDef[]; kk?: boolean; /** Meeting peek: a camera icon at the start of the primary button. */ video?: boolean; /** The reminder button goes to this link, not to the plugin. */ link?: string }) {
  return <>{(actions ?? []).slice(0, 2).map((a) => plugin.id === REMINDER_PLUGIN.id ? (
    link ? <JoinButton key={a.id} link={link} className={"btn " + (kk ? "kk " : "") + styleClass(a.style)} label={a.label}><span className="filled"><Video /></span></JoinButton> : null
  ) : (
    <GuardBtn key={a.id} className={"btn " + (kk ? "kk " : "") + styleClass(a.style)} onClick={() => bridge.call("plugin_action", { pluginId: plugin.id, actionId: a.id }).catch(() => undefined)}>{video && a.style === "primary" && <span className="filled"><Video /></span>}{plain(a.label, 24)}</GuardBtn>
  ))}</>;
}

/** Plain-text counter (Peeka counts from the start time). */
export function Elapsed({ startedAt }: { startedAt: string }) {
  const now = useSecond();
  return <span className="num">{elapsed(startedAt, now)}</span>;
}

/* ---- island.protrusion ---- */

/** Strip center: mascot or initial tile, icon, title with the name prefix. */
export function ProtrusionCenter({ item }: { item: ProtrusionItem }) {
  const icon = safeIcon(item.icon);
  const rec = item.state === "danger" && !!item.timer; // recording chip: red dot and counter on the strip
  const phase = item.plugin.main ? phaseOf(item.mascot) : null; // voice phase (d1/d3) or dictation: wave in the phase color
  const note = plain((item as ProtrusionExt).note, 40) || (item.plugin.main && item.icon === "ticket" ? "draft ready" : ""); // strip sub-note (mockup tik)
  const title = phase && (item.mascot !== "listening" || (item as ProtrusionExt).transcript) ? phase.label : item.title; // phase text comes from Peeka's table; dictation keeps its own title
  return (
    <span className="ms" data-state={item.state} data-phase={phase ? item.mascot : undefined}>
      {(!item.plugin.main || mascotOf(item.plugin, item.mascot)) && !riding(item) && <Lead plugin={item.plugin} mascot={item.mascot} />}{/* no "A" tile on the assistant's mascot-less peek; the name prefix stays */}
      {rec ? <span className="recDot" aria-hidden="true" /> : icon && <span className="ikK pst"><AlertIcon name={icon} /></span>}
      <span className="b6"><Attr plugin={item.plugin} title={title} strong /></span>
      {item.timer && <span className="counter l2"><Elapsed startedAt={item.timer.startedAt} /></span>}
      {note && <span className="l3">{note}</span>}
      {phase && <span className="wave" style={{ "--phase": phase.color } as React.CSSProperties} aria-hidden="true">{Array.from({ length: 7 }, (_, i) => <i key={i} />)}</span>}
    </span>
  );
}

/** On a main-assistant peek with a progress bar, the mascot rides the bar (one mascot: the Lead in the center row is hidden). */
const riding = (item: ProtrusionItem) => item.plugin.main && !!mascotOf(item.plugin, item.mascot) && typeof item.progress === "number";

/** Peek row: subtitle, progress, counter, streaming text, up to 2 buttons. */
export function ProtrusionBump({ item }: { item: ProtrusionItem }) {
  const { text: live, speaker } = useStream(item.liveText?.streamId);
  const p = typeof item.progress === "number" ? Math.min(1, Math.max(0, item.progress)) : null;
  const dictating = item.plugin.main && item.mascot === "listening"; // dictation: quoted live line and "Esc cancel"
  const tr = (item as ProtrusionExt).transcript?.streamId;
  if (tr) return <Transcript streamId={tr} name={item.plugin.name} />;
  return (
    <div className="peekBar" data-state={item.state}>
      {item.subtitle && <span className="t12 l2" title={plain(item.subtitle, 120)}>{plain(item.subtitle, 120)}</span>}
      {live && (dictating
        ? <span className="t12 l2 liveText">“{plain(live, 160)}”</span>
        : <span className="t12 l2 liveText">{plain(speaker, 24) && <span className="who">{plain(speaker, 24)}</span>}{plain(live, 160)}</span>)}
      {p !== null && (riding(item)
        ? <span className="progressMascot" style={{ "--y": p } as React.CSSProperties}><span className="miniProgress"><b /></span><span className="rider"><Lead plugin={item.plugin} mascot={item.mascot} /></span></span>
        : <span className="miniProgress" style={{ "--y": p } as React.CSSProperties}><b /></span>)}
      <ActionButtons plugin={item.plugin} actions={item.actions} video={item.icon === "calendar"} link={(item as ReminderItem).link} />
      {dictating && <span className="key-hint"><kbd>Esc</kbd> cancel</span>}
    </div>
  );
}

/* ---- approvals.prompt ---- */

const codeOf = (a: ApprovalItem) => plain(a.command ?? a.path ?? "", 600);

/** Strip center (while the peek is open): orange dot, title, "high risk" when high risk, else the source with the name prefix. */
export function ApprovalCenter({ a }: { a: ApprovalItem }) {
  const high = riskOf(a.risk) === "high";
  return (
    <span className="ms">
      <Lead plugin={a.plugin} mascot={a.kind === "question" ? "question" : "approval"} />
      <span className="pulse" />
      <span className="b6">{shortApprovalTitle(a as ApprovalItem & ApprovalExt)}</span>
      {high ? <span className="b6 l1">high risk</span> : <Attr plugin={a.plugin} title={a.source} dim />}
    </span>
  );
}

/** Short strip label while the card is open ("say it once"). */
export const ApprovalShort = () => <span className="ms"><span className="pulse" /><span className="b6">Approval</span></span>;

/**
 * Approval peek. Low risk: "Allow" + "Details"; high risk (or unknown risk), on the strip dropping in over full screen,
 * and for questions that need a choice or text: only "Details" (the answer goes in the card).
 */
export function ApprovalBump({ a, onDetail, onlyDetail, dropMs }: { a: ApprovalItem; onDetail: () => void; onlyDetail?: boolean; dropMs?: number | null }) {
  const high = riskOf(a.risk) === "high";
  const simple = !a.choices?.length && !a.freeText;
  const direct = !high && !onlyDetail && simple && a.options.includes("allow");
  return (
    <div className="peekBar" style={dropMs ? ({ "--dur": dropMs + "ms", position: "relative" } as React.CSSProperties) : undefined}>
      {codeOf(a) && <span className="codeRow" title={codeOf(a)}>{codeOf(a)}</span>}
      {direct && <GuardBtn className="btn kk primary" onClick={() => answer(a, "allow", {}, "protrusion")}>Allow</GuardBtn>}
      <button className={"btn kk " + (direct ? "gray" : "primary")} onClick={onDetail}>Details</button>
      {dropMs ? <span className="timeLine" /> : null}
    </div>
  );
}

function answer(a: ApprovalItem, decision: "allow" | "always" | "deny" | "choice", extra: { choiceId?: string; text?: string } = {}, surface: "protrusion" | "card" = "card") {
  bridge.call("approval_answer", { pluginId: a.plugin.id, id: a.id, decision, surface, ...extra }).catch(() => undefined);
}

/** Approval card. On high risk "Deny" has default focus, "Allow" needs a 1.2 s press and hold, and there's no "Always". */
export function ApprovalCard({ a }: { a: ApprovalItem }) {
  const high = riskOf(a.risk) === "high";
  const opts = new Set(a.options);
  if (high) opts.delete("always"); // Peeka removes it on high risk
  const choices = (a.choices ?? []).slice(0, 6);
  const rec = choices.find((c) => (c as ChoiceExt).recommended === true)?.id ?? null; // the recommended choice is preselected in the card (mockup c3)
  const [choice, setChoice] = useState<string | null>(rec);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false); // "Write another answer" opens the text box
  const warnId = useId();
  const asks = choices.length > 0 || !!a.freeText;
  // radio group: one Tab stop, arrow keys move and select (F-17)
  const radioKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = choices.findIndex((c) => c.id === e.currentTarget.dataset.id), n = (i + d + choices.length) % choices.length;
    setChoice(choices[n].id);
    (e.currentTarget.parentElement?.children[n] as HTMLElement | undefined)?.focus();
  };
  const code = codeOf(a);
  const left = useDeadline(a.id, a.expiresS);
  // N = Deny, Y = Allow: clicks the button, so the same guard (600 ms + pointer rule) applies. On high risk Y only focuses the hold button.
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat || t?.closest?.("input,textarea,[contenteditable]")) return;
      const k = e.key.toLowerCase();
      if (k !== "n" && k !== "y") return;
      const b = card.current?.querySelector<HTMLElement>(k === "n" ? "[data-shortcut=deny]" : high ? ".permissionHold" : "[data-shortcut=allow]");
      if (!b) return;
      e.preventDefault();
      if (k === "y" && high) b.focus(); else b.click();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [high]);
  const hint = high ? <span><kbd>N</kbd> Deny / <kbd>Y</kbd> hold</span> : <span><kbd>N</kbd> Deny / <kbd>Y</kbd> Allow</span>;
  const reply = asks && (choice || text.trim()) ? () => answer(a, "choice", { choiceId: choice ?? undefined, text: text.trim() ? text.trim().slice(0, 2000) : undefined }) : null;
  const sub = [prefixed(a.plugin, a.source), a.detail ? plain(a.detail, 200) : ""].filter(Boolean).join(" · ");
  const open = <button className="btn glass icon" title="Open in editor" aria-label="Open in editor"><ExternalLink /></button>;
  const box = a.freeText && (typing || choices.length === 0) && (
    <>
      {a.freeTextWarning && <div className="alertRow t12" id={warnId}><TriangleAlert aria-hidden="true" />This question is from {pluginName(a.plugin)}. Don't type passwords here</div>}
      <div className="inputBox glass"><input autoFocus={typing} value={text} maxLength={2000} placeholder="Write another answer" aria-label="Write another answer" aria-describedby={a.freeTextWarning ? warnId : undefined} onChange={(e) => setText(e.target.value)} /></div>
    </>
  );
  return (
    <div className="body" ref={card} data-approval={high ? "high" : "low"}>
      <div className="mkHead">
        {high && <span className="alertIcon"><TriangleAlert /></span>}
        <Lead plugin={a.plugin} mascot={high ? "serious" : a.kind === "question" ? "question" : "approval"} size={56} hint={hint} />
        <div style={{ flex: 1, minWidth: 0 }}><div className="t17 b6" title={flat(a.title)}>{flat(a.title)}</div><div className="t13 l2 b4" title={sub}>{sub}</div></div>
      </div>
      {code && <div className="code glass">{code}{a.cwd ? <>{"\n"}<span className="l2">folder: {plain(a.cwd, 300)}</span></> : null}</div>}
      {choices.length > 0 && (
        <div className="list glass" style={{ "--indent": "30px" } as React.CSSProperties} role="radiogroup" aria-label="Options">
          {choices.map((c, i) => (
            <button key={c.id} data-id={c.id} className={"row" + (choice === c.id ? " selected" : "")} role="radio" aria-checked={choice === c.id} tabIndex={choice === c.id || (choice === null && i === 0) ? 0 : -1} onKeyDown={radioKey} onClick={() => setChoice(c.id)}>
              {choice === c.id ? <CircleDot /> : <Circle />}<span className="text" style={{ textAlign: "left" }}>{flat(c.label, 120)}</span>{c.id === rec && <span className="t12 l3 suggestionTag">recommended</span>}
            </button>
          ))}
        </div>
      )}
      {choices.length === 0 && box}
      <div className="buttons">
        {high ? (
          <>
            <button className="btn primary" data-autofocus data-shortcut="deny" onClick={() => answer(a, "deny")}><X />Deny</button>
            {opts.has("allow") && <HoldButton big guarded className="permissionHold" label="Allow" icon={null} onDone={() => answer(a, "allow")} />}
          </>
        ) : asks ? (
          <>
            <GuardBtn className="btn primary" data-autofocus onClick={() => reply?.()} aria-disabled={!reply}>{a.kind === "plan" && opts.has("allow") ? "Approve plan" : "Reply"}</GuardBtn>
            {a.freeText && choices.length > 0 && <button className="btn glass" aria-expanded={typing} disabled={typing} onClick={() => setTyping(true)}>Write another answer</button>}
            {opts.has("deny") && <GuardBtn className="btn glass destructive" data-shortcut="deny" onClick={() => answer(a, "deny")}><X />Deny</GuardBtn>}
          </>
        ) : (
          <>
            {opts.has("allow") && <GuardBtn className="btn primary" data-autofocus data-shortcut="allow" onClick={() => answer(a, "allow")}>Allow</GuardBtn>}
            {opts.has("always") && <GuardBtn className="btn glass" title={plain(a.alwaysLabel, 80)} onClick={() => answer(a, "always")}>Always allow</GuardBtn>}
            {opts.has("deny") && <GuardBtn className="btn glass destructive" data-shortcut="deny" onClick={() => answer(a, "deny")}><X />Deny</GuardBtn>}
          </>
        )}
        <span style={{ flex: 1 }} />
        {left !== null && <span className="t12 l3 num" role="timer">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>}
        {a.kind === "command" || a.kind === "file" || a.kind === "plan" ? open : null}
      </div>
      {choices.length > 0 && box}{/* the text box opens below the buttons: the buttons stay put (R1-3) */}
      {!high && opts.has("always") && a.alwaysLabel && <div className="t12 l3 b4">Always: {plain(a.alwaysLabel, 80)}</div>}
    </div>
  );
}

/* ---- card.module ---- */

function Block({ b, plugin }: { b: CardBlock | MeterBlock; plugin: PluginRef }) {
  switch (b.type) {
    case "heading": return <div className="t15 b6">{plain(b.text, 120)}</div>;
    case "text": return <div className="t13 l2 b4">{plain(b.text, 1000)}</div>;
    case "list": return b.rows.some((r) => r.state) ? (
      // session list (mockup j): status indicator + name + dim description, no dividers
      <div className="sessions">
        {b.rows.slice(0, 12).map((r, i) => (
          <div className="row" key={i}><RowState state={r.state} /><b>{plain(r.title, 80)}</b><span className="t12 l3" style={{ flex: 1 }}>{plain(r.sub, 100)}</span>{r.value && <span className="t12 l3">{plain(r.value, 60)}</span>}<TerminalBtn id={(r as RowExt).session} /></div>
        ))}
      </div>
    ) : (
      <div className="list glass" style={{ "--indent": "0" } as React.CSSProperties}>
        {b.rows.slice(0, 12).map((r, i) => (
          <div className="row" key={i}><div className="text"><div>{plain(r.title, 120)}</div>{r.sub && <div className="t12 l3 b4">{plain(r.sub, 160)}</div>}</div>{r.value && <span className="t12 l3">{plain(r.value, 60)}</span>}<TerminalBtn id={(r as RowExt).session} /></div>
        ))}
      </div>
    );
    case "meter": return <Meter m={b} />;
    case "kv": return <div>{b.rows.slice(0, 12).map((r, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between" }}><span>{plain(r.k, 80)}</span><span className="num b6">{plain(r.v, 80)}</span></div>)}</div>;
    case "progress": return <><div style={{ display: "flex", justifyContent: "space-between" }}><span>{plain(b.label, 80)}</span><span className="num b6">{Math.round(Math.min(1, Math.max(0, b.value || 0)) * 100)}%</span></div><div className="meter" style={{ "--o": Math.round(Math.min(1, Math.max(0, b.value || 0)) * 100) + "%" } as React.CSSProperties}><b /></div></>;
    case "timer": return <div style={{ display: "flex", justifyContent: "space-between" }}><span>{plain(b.label, 80)}</span><span className="b6"><Elapsed startedAt={b.startedAt} /></span></div>;
    case "buttons": return <div className="buttons"><ActionButtons plugin={plugin} actions={b.buttons} kk={false} /></div>;
    case "image": { const src = safeImage(b.src); return src ? <img className="blockImage" src={src} alt="" /> : null; }
    default: return null;
  }
}

/** Rust's `cc_focus_terminal` error names. */
const FOCUS_ERR: Record<string, string> = {
  unknown: "This session is gone", not_connected: "Assistant not connected", missing: "Couldn't find the terminal window",
  refused: "Windows didn't bring the window forward", unsupported: "Not available in demo mode",
};
export const focusErrText = (e: unknown) => FOCUS_ERR[String(e)] ?? "Couldn't open the terminal";

/** The session row's "Open terminal" button; errors are written inside the row. Draws nothing without `id`. */
function TerminalBtn({ id }: { id?: string | null }) {
  const [err, setErr] = useState<string | null>(null);
  if (!id) return null;
  return <>
    <button className="btn kk glass" onClick={() => bridge.call("cc_focus_terminal", { sessionId: id }).then(() => setErr(null)).catch((e) => setErr(focusErrText(e)))}>Open terminal</button>
    {err && <span className="t12 l3" role="status">{err}</span>}
  </>;
}

/** Session state: orange dot (awaiting approval), spinning ring (running), green check (done); anything else holds an empty slot. */
function RowState({ state }: { state?: string | null }) {
  return state === "waiting" ? <span className="pulse" aria-label="awaiting approval" /> : state === "running" ? <span className="ring" aria-label="running" />
    : state === "done" ? <span className="tickGreen" aria-label="done"><CircleCheck /></span> : <span className="statusEmpty" />;
}

/** Usage bar (ADR-0059): name + percent, bar (optional threshold line), dim reset text. */
function Meter({ m }: { m: MeterBlock }) {
  const v = Math.min(1, Math.max(0, Number.isFinite(m.value) ? m.value : 0));
  const mark = typeof m.mark === "number" && m.mark > 0 && m.mark < 1 ? m.mark : null;
  return (
    <div className="quota">
      <div className="quotaRow"><span>{plain(m.label, 80)}</span><span className="num b6">{plain(m.text, 24) || Math.round(v * 100) + "%"}</span></div>
      <div className="meter" style={{ "--o": Math.round(v * 100) + "%" } as React.CSSProperties}><b />{mark !== null && <i className="threshold" style={{ left: mark * 100 + "%" }} />}</div>
      {m.note && <div className="t12 l3 b4">{plain(m.note, 80)}</div>}
    </div>
  );
}

export const tabLabel = (t: ModuleTab) => prefixed(t.plugin, t.title);

/** Tab / summary icons: only this allowed set (plugins can't send icons; nothing but a name is drawn). Names outside the set fall back to the ADR-0060 icons. */
const GLYPHS: Record<string, LucideIcon> = { ghost: Ghost, terminal: Terminal, users: Users, pointer: MousePointerClick, brain: Brain, list: List, shield: ShieldAlert };
const glyphOf = (n: unknown): LucideIcon | null => (typeof n === "string" && Object.hasOwn(GLYPHS, n) ? GLYPHS[n] : null);
/** Small icon on the tab button (14 px). */
export function TabGlyph({ name }: { name?: string | null }) {
  const G = glyphOf(name), safe = safeIcon(name);
  return G ? <G /> : safe ? <AlertIcon name={safe} /> : null;
}

/** Box heading: the main assistant's "ghost" box uses the mascot (24 px, still), others their icon, an icon-less box uses Lead. */
function BoxHead({ plugin, icon, children }: { plugin: PluginRef; icon?: string | null; children: ReactNode }) {
  const mk = icon === "ghost" || !icon;
  return <h4>{mk ? <Lead plugin={plugin} mascot="ready" size={24} still /> : <TabGlyph name={icon} />}{children}</h4>;
}

/** A plugin tab's content (list of blocks). */
export function TabBlocks({ tab }: { tab: ModuleTab }) {
  return (
    <div className="box glass blockBox">
      <BoxHead plugin={tab.plugin} icon={tab.icon}><Attr plugin={tab.plugin} title={tab.title} /></BoxHead>
      {tab.blocks.slice(0, 20).map((b, i) => <Block key={i} b={b} plugin={tab.plugin} />)}
    </div>
  );
}

/** Plugin boxes on the "General" page: summary rows (up to 3), with that plugin's approvals in between (300 ms guard applies), row icons and one action (e.g. Stop). */
export function SummaryBoxes({ surf, onDetail }: { surf: SurfacesView; onDetail: (id: string) => void }) {
  // An answered approval row doesn't vanish at once: ~1.5 s "Approved / Denied" placeholder, then a short height animation; the button below doesn't jump under the pointer (R1-4)
  const [ans, setAns] = useState<Record<string, { text: string; leaving: boolean }>>({});
  const seen = useRef(new Map<string, ApprovalItem>());
  surf.approvals.forEach((x) => seen.current.set(x.id, x));
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const onAnswered = (x: ApprovalItem, text: string) => {
    setAns((c) => ({ ...c, [x.id]: { text, leaving: false } }));
    timers.current.push(window.setTimeout(() => setAns((c) => (c[x.id] ? { ...c, [x.id]: { ...c[x.id], leaving: true } } : c)), GHOST_MS));
    timers.current.push(window.setTimeout(() => { seen.current.delete(x.id); setAns((c) => { const { [x.id]: _, ...rest } = c; return rest; }); }, GHOST_MS + 260));
  };
  const live = new Set(surf.approvals.map((x) => x.id));
  const shown = [...seen.current.values()].filter((x) => live.has(x.id) || ans[x.id]);
  const ids = [...new Set([...surf.summary.map((s) => s.plugin.id), ...shown.map((x) => x.plugin.id)])];
  return <>{ids.map((id) => {
    const rows = surf.summary.find((s) => s.plugin.id === id);
    const plugin = rows?.plugin ?? shown.find((a) => a.plugin.id === id)!.plugin;
    const list = (rows?.rows ?? []).slice(0, 3);
    const row = (r: (typeof list)[number], i: number) => {
      const x = r as typeof r & SummaryRowExt, G = glyphOf(x.icon);
      return (
        <div className="row" key={"r" + i}>
          {G && <span className={x.state === "attention" ? "orangeIcon" : "dim"}><G /></span>}
          <div style={{ flex: 1, minWidth: 0 }}><div>{plain(r.title, 100)}</div>{r.sub && <div className="t12 l3 b4">{plain(r.sub, 140)}</div>}</div>
          {r.value && <span className="t12 l3">{plain(r.value, 60)}</span>}
          {x.action && <ActionButtons plugin={plugin} actions={[x.action]} />}
          <TerminalBtn id={x.session} />
        </div>
      );
    };
    return (
      <div className="box glass" key={id}>
        <BoxHead plugin={plugin}>{pluginName(plugin)}</BoxHead>
        {list.slice(0, 1).map(row)}
        {shown.filter((a) => a.plugin.id === id).map((a) => <ApprovalRow key={a.id} a={a} done={ans[a.id]} onDetail={() => onDetail(a.id)} onAnswered={onAnswered} />)}
        {list.slice(1).map((r, i) => row(r, i + 1))}
      </div>
    );
  })}</>;
}

const GHOST_MS = 1500;
function ApprovalRow({ a, onDetail, done, onAnswered }: { a: ApprovalItem; onDetail: () => void; done?: { text: string; leaving: boolean }; onAnswered: (a: ApprovalItem, text: string) => void }) {
  const direct = riskOf(a.risk) === "low" && !a.choices?.length && !a.freeText && a.options.includes("allow");
  if (done) return (
    <div className={"row rowDone" + (done.leaving ? " go" : "")} role="status">
      <span style={{ color: done.text === "Approved" ? "var(--green)" : "var(--l3)" }}><Check /></span>
      <div style={{ flex: 1, minWidth: 0 }}><div>{done.text}</div><div className="t12 l3 b4">{flat(a.title)}</div></div>
    </div>
  );
  return (
    <div className="row">
      <span style={{ color: "var(--orange)" }}><ShieldAlert /></span>
      <div style={{ flex: 1, minWidth: 0 }}><div>Awaiting approval</div><div className="t12 l3 b4">{flat(a.title)}</div></div>
      {direct && <GuardBtn className="btn kk primary" onClick={() => { answer(a, "allow", {}, "protrusion"); onAnswered(a, "Approved"); }}>Allow</GuardBtn>}
      {direct ? <GuardBtn className="btn kk glass" onClick={() => { answer(a, "deny"); onAnswered(a, "Denied"); }}>Deny</GuardBtn> : <button className="btn kk primary" onClick={onDetail}>Details</button>}
    </div>
  );
}

/* ---- composer.handler (Ctrl+Space) ---- */

export interface Suggestion { id: "window_image"; label: string }
interface Added { key: string; kind: ComposerKind; label: string }
const LINK = /^https?:\/\/\S+$/i;
const shelfLabel = (n: number) => (n === 1 ? "1 file on Shelf" : `${n} files on Shelf`);

/**
 * Ctrl+Space box: text, suggestion chips (added on click), streaming answer, source chips. Peeka draws the bubbles and chips.
 * Chips: "This window" (from Island), "Link on clipboard" and "N files on Shelf" (the card reads them itself); scan and paperclip buttons appear once Rust reports the attachment kinds.
 */
/** Typed but unsent draft: survives closing and reopening the card (Esc, ×, click outside); cleared on send (O4). */
let draftKeep = "";
export const resetComposerDraft = () => { draftKeep = ""; };

export function ComposerCard({ owner, turns, send, suggestions, autoShelf }: { owner: PluginRef & { voice: boolean }; turns: Turn[]; send: (text: string, attachments: { kind: "window_image" }[]) => void; suggestions: Suggestion[]; /** A file was dropped on the mascot: Shelf files are added automatically. */ autoShelf?: boolean }) {
  const [text, setTextRaw] = useState(draftKeep);
  const setText = (v: string) => { draftKeep = v; setTextRaw(v); };
  const [added, setAdded] = useState<Added[]>([]);
  const talking = turns.length > 0;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "nearest" }); }, [turns]);
  const kinds = useComposerKinds();
  const clips = useClips(), shelf = useShelf();
  const hasLink = clips.some((c) => c.kind === "text" && (c.hint === "link" || (c.text !== null && LINK.test(c.text.trim()))));
  const offers: Added[] = [
    ...suggestions.map((s): Added => ({ key: s.id, kind: s.id, label: s.label })),
    ...(hasLink && kinds.has("clipboard_link") ? [{ key: "clipboard_link", kind: "clipboard_link" as const, label: "Link on clipboard" }] : []),
    ...(shelf.length > 0 && kinds.has("shelf") ? [{ key: "shelf", kind: "shelf" as const, label: shelfLabel(shelf.length) }] : []),
  ];
  useEffect(() => { if (autoShelf && shelf.length > 0 && kinds.has("shelf")) setAdded((cur) => (cur.some((x) => x.key === "shelf") ? cur : [...cur, { key: "shelf", kind: "shelf", label: shelfLabel(shelf.length) }])); }, [autoShelf, shelf.length, kinds]);
  const toggle = (o: Added) => setAdded((cur) => (cur.some((x) => x.key === o.key) ? cur.filter((x) => x.key !== o.key) : [...cur, o]));
  // Rust refuses a scan of a sensitive window with `denied` and reports why via notch://notice (Rust's own text, shown as is)
  const [scanNote, setScanNote] = useState("");
  const notice = useRef({ text: "", at: 0 });
  useEffect(() => { const off = bridge.on("notch://notice", (t) => { notice.current = { text: plain(t, 200), at: Date.now() }; }); return () => { off.then((f) => f()); }; }, []);
  const attach = (cmd: "composer_scan" | "composer_attach_file") => { setScanNote(""); return bridge.call(cmd).then((r: Attached | null) => { if (r) setAdded((cur) => [...cur, { key: r.kind + ":" + cur.length, kind: r.kind, label: plain(r.label, 40) }]); }).catch((e) => {
    if (cmd === "composer_scan" && String(e) === "denied") setScanNote(Date.now() - notice.current.at < 3000 && notice.current.text ? notice.current.text : "This window belongs to a sensitive app, so it wasn't scanned");
  }); };
  const go = () => {
    const t = text.trim();
    if (!t) return;
    // shortcut: hooks.ts only types window_image; other kinds get no chip/button until Rust reports them via composer_kinds, so this casts to the narrow type
    send(t, added.map(({ kind }) => ({ kind })) as { kind: "window_image" }[]);
    setText(""); setAdded([]);
  };
  const name = pluginName(owner), ask = `Ask ${owner.name}`;
  const clipBtn = kinds.has("file") && <button className="slot" title="Attach file" aria-label="Attach file" onClick={() => void attach("composer_attach_file")}><Paperclip /></button>;
  const scanBtn = kinds.has("screen_image") && <button className="slot" title="Attach screenshot" aria-label="Attach screenshot" onClick={() => void attach("composer_scan")}><ScanLine /></button>;
  const box = (
    <div className="inputBox glass assistantBox large" onMouseDown={(e) => { if ((e.target as HTMLElement).closest("button,input")) return; e.preventDefault(); e.currentTarget.querySelector("input")?.focus(); }}>
      {talking && kinds.has("file") && <span className="l3 leftIcon" aria-hidden="true"><Paperclip /></span>}
      <input data-autofocus value={text} maxLength={4000} placeholder={`${ask} anything: a question, a task, a reminder`} aria-label={ask} title={name}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); go(); } }} />
      {scanBtn}{!talking && clipBtn}
      {owner.voice && <button className={"slot" + (talking ? "" : " accent")} title="Ask by voice" aria-label="Ask by voice" onClick={() => bridge.call("composer_voice").catch(() => undefined)}><Mic /></button>}
    </div>
  );
  const chipOf = (o: Added, on: boolean) => on
    ? <button key={o.key} className="chip glass added" aria-pressed="true" title="Remove" onClick={() => toggle(o)}><Check />{o.label}</button>
    : <button key={o.key} className="chip suggestionChip" onClick={() => toggle(o)}><Plus />{o.label}</button>;
  const chips = talking ? (added.length > 0 ? <div className="buttons" style={{ gap: 6, flexWrap: "wrap" }}>{added.map((o) => chipOf(o, true))}</div> : null) : (
    <div className="buttons" style={{ gap: 6, flexWrap: "wrap" }}>
      {offers.map((o) => chipOf(o, added.some((x) => x.key === o.key)))}
      {added.filter((x) => !offers.some((o) => o.key === x.key)).map((o) => chipOf(o, true))}
      <span style={{ flex: 1 }} />
      <><span className="key-hint"><kbd>↵</kbd> send</span><span className="key-hint"><kbd>Esc</kbd> close</span></>
    </div>
  );
  // the box always sits in the same tree spot (top row): its place and focus don't change after the first message; the chat opens below
  return (
    <div className="body" data-composer>
      <div className="mkHead" style={{ alignItems: "flex-start" }}><Lead plugin={owner} mascot="listening" size={56} /><div className="textCol" style={{ paddingTop: 4 }}>{box}{scanNote && <div className="alertRow t12" role="status"><TriangleAlert aria-hidden="true" />{scanNote}</div>}{chips}</div></div>
      {talking && (
        <div className="chat">
          {turns.map((t) => (
            <div key={t.id} className="kind">
              {t.ask && <div className="bubble me">{plain(t.ask, 4000)}</div>}
              <div className="reply" aria-live="polite">
                {plain(t.answer, 64_000) || (t.state === "wait" ? <span className="l3">…</span> : null)}
                {t.state === "error" && <div className="consentWarning" role="alert"><TriangleAlert />{plain(t.error, 200) || "Couldn't get an answer."}</div>}
                {t.chips.length > 0 && <div className="buttons" style={{ marginTop: 10, gap: 6, flexWrap: "wrap" }}>{t.chips.map((c, i) => <span key={i} className="chip glass" data-kind={c.kind}>{c.kind === "reminder" ? <AlarmClock /> : c.kind === "note" ? <StickyNote /> : <Brain />}{plain(c.label, 60)}</span>)}</div>}
              </div>
            </div>
          ))}
          <div ref={end} />
        </div>
      )}
    </div>
  );
}
