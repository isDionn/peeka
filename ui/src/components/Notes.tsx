// Small peeks: notification burst, usage limit reached, "N sessions" chip. Logic lives in lib/notes.ts; Island picks, this file only draws.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUp, Bell, Cpu, Download, FilePen, Gauge, Headphones } from "lucide-react";
import { bridge, type CcDiff, type CcEdit } from "../bridge";
import { agentOf, burstLabel, originLabel, type Burst, type CcSession, type CcState } from "../lib/notes";
import { flat } from "../lib/plugin";
import { BRAND } from "../brand";

export const BurstCenter = ({ b, generic }: { b: Burst; generic: boolean }) =>
  <span className="ms"><Bell /><span className="b6">{flat(burstLabel(b.n, b.apps.map((a) => flat(a, 20)), generic), 60)}</span></span>;
export const BurstBump = ({ onOpen }: { onOpen: () => void }) => <div className="peekBar"><button className="btn kk primary" onClick={onOpen}>Show all</button></div>;

/** The reset time doesn't come from the hook (`cc_event` carries only type and reason): just "Usage limit reached". */
export const QuotaCenter = () => <span className="ms"><Gauge /><span className="b6">Usage limit reached</span></span>;
export const QuotaBump = ({ onOk }: { onOk: () => void }) => <div className="peekBar"><button className="btn kk gray" onClick={onOk}>OK</button></div>;

/** Headphones disconnected and music stopped (Rust `music_stopped`): the name is the device name; hidden when generic. "Resume" is `media_control` play_pause. */
export const MusicStoppedCenter = ({ name, generic }: { name: string; generic: boolean }) =>
  <span className="ms"><Headphones /><span className="b6">{generic ? "Music paused" : `Music paused — ${flat(name, 28)} disconnected`}</span></span>;
export const MusicStoppedBump = ({ onResume }: { onResume: () => void }) => <div className="peekBar"><button className="btn kk primary" onClick={onResume}>Resume</button></div>;
export const resumeMusic = () => bridge.call("media_control", { action: "play_pause" }).catch(() => undefined);

/** Download finished (Rust `download_done {id, name, size}`): only name and size arrive. When generic, no name or buttons (Rust refuses anyway). Failures are silent. */
export const DownloadCenter = ({ name, generic, ghost }: { name: string; generic: boolean; /** The 40 px strip ghost (cheers), if any. */ ghost?: ReactNode }) =>
  <span className="ms">{ghost}<Download /><span className="b6">{generic ? "Download complete" : `Downloaded: ${flat(name, 40)}`}</span></span>;
export function DownloadBump({ id, generic }: { id: string; generic: boolean }) {
  const go = (cmd: "download_open" | "download_show_in_folder") => () => bridge.call(cmd, { id }).catch(() => undefined);
  return generic
    ? <div className="peekBar"><span className="t12 l2">Download complete</span></div>
    : <div className="peekBar"><button className="btn kk primary" onClick={go("download_open")}>Open</button><button className="btn kk gray" onClick={go("download_show_in_folder")}>Show in folder</button></div>;
}

/** A newer release exists (Rust `update_available`, the version). "Download" opens the page Rust remembers; either button dismisses it for good. */
export const UpdateCenter = ({ version }: { version: string }) =>
  <span className="ms"><Download /><span className="b6">{BRAND.productName} {flat(version, 12)} is available</span></span>;
export function UpdateBump({ onDone }: { onDone: () => void }) {
  const done = (open: boolean) => () => { (open ? bridge.call("update_open") : Promise.resolve()).catch(() => undefined); bridge.call("update_dismiss").catch(() => undefined); onDone(); };
  return <div className="peekBar"><button className="btn kk primary" onClick={done(true)}>Download</button><button className="btn kk gray" onClick={done(false)}>Dismiss</button></div>;
}

/** CPU above 95% for a long time (Rust `cpu_high {app}`; Rust makes the 60 s call, no timer here). Task Manager is `open_task_manager`. */
export const CpuCenter = ({ app, generic, ghost }: { app: string | null; generic: boolean; /** The 40 px strip ghost (overheated), if any. */ ghost?: ReactNode }) =>
  <span className="ms">{ghost}<Cpu /><span className="b6">{app && !generic ? `${flat(app, 28)} is using a lot of CPU` : "CPU is very busy"}</span></span>;
export const CpuBump = () => <div className="peekBar"><button className="btn kk primary" onClick={() => bridge.call("open_task_manager").catch(() => undefined)}>Task Manager</button></div>;

/**
 * Open Claude Code sessions chip (>= 2): a 30 px tall pill left of the island, out of flow (the island doesn't shift). Clicking lists the known ones.
 * The hook gives a salted short hash of the session id (`sid`) and the session folder's name: each row is that name ("Session N" while locked, presenting or shared, or without one),
 * its state, last tool and a message field; those without a hash (main assistant) only count toward the total.
 */
export function SessionChip({ n, list, edge, last, locked, limited = false }: { n: number; list: CcSession[]; edge: number; last: { tool: string | null; at: number } | null; locked: boolean; limited?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node | null)) setOpen(false); };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [open]);
  return (
    <div ref={root} className="sessionChip" style={{ right: `calc(50% + ${edge}px)` } as CSSProperties}>
      <button type="button" className="sessionBtn" data-hit aria-expanded={open} aria-label={`${n} sessions, ${open ? "hide" : "show"} list`} onClick={() => setOpen(!open)}>{n} sessions</button>
      {open && <SessionList n={n} list={list} last={last} locked={locked} limited={limited} />}
    </div>
  );
}

/** The chip's list; also opened from General's "Claude Code" place (IslandCards.tsx). */
export function SessionList({ n, list, last, locked, limited = false }: { n: number; list: CcSession[]; last: { tool: string | null; at: number } | null; locked: boolean; limited?: boolean }) {
  const ago = last ? Math.max(0, Math.round((Date.now() - last.at) / 1000)) : null;
  // only Claude Code's (or none told apart): the wording stays as it was; mixed agents: each row names its agent
  const mixed = list.some((x) => x.agent !== "claude");
  const what = mixed ? "agent sessions" : "Claude Code sessions";
  return (
    <div className="sideList sessionList" data-hit role="group" aria-label={mixed ? "Agent sessions" : "Claude Code sessions"}>
      <div className="sideRow"><span className="b6 sideName">{n} {what} open</span></div>
      {limited && <div className="sideRow"><Gauge aria-hidden="true" /><span className="l2 sideName">Usage limit reached</span></div>}
      {list.map((x, i) => {
        const name = !locked && x.name ? flat(x.name, 40) : `Session ${i + 1}`;
        return locked
          ? <div className="sideRow" key={x.sid}><span className="l3 sideName">{name}</span></div>
          : <div className="sessRow" key={x.sid} role="group" aria-label={name}>
              <div className="sessHead">{mixed && <span className="agentDot" style={{ background: agentOf(x.agent).color }} aria-hidden="true" />}<span className="sideName">{mixed && `${agentOf(x.agent).name} · `}{name}</span><span className="t12 sessState" data-state={x.state}>{STATE[x.state]}</span></div>
              <div className="sessMeta t12 l3"><span className="sideName">{x.tool ? flat(x.tool, 24) : "event"}, {Math.max(0, Math.round((Date.now() - x.at) / 1000))}s ago</span>{originLabel(x.origin) && <span>{originLabel(x.origin)}</span>}</div>
              {x.agent === "claude" && x.origin !== "desktop" && <SessionSend sid={x.sid} name={name} waiting={x.state === "waiting"} />}
            </div>;
      })}
      {list.length === 0 && !locked && last && <div className="sideRow"><span className="l3 sideName">Last activity: {last.tool ? flat(last.tool, 24) : "event"}, {ago}s ago</span></div>}
      {n > list.length && <div className="sideRow"><span className="l3 sideName">{list.length ? `${n - list.length} more can't be told apart` : "Sessions can't be told apart"}</span></div>}
    </div>
  );
}

const STATE: Record<CcState, string> = { working: "Working", waiting: "Waiting for you", idle: "Idle" };
/** Rust's `cc_send` error names. */
const SEND_ERR: Record<string, string> = {
  unknown: `This session can't take messages from ${BRAND.productName}`,
  missing: "This session has ended",
  refused: "Couldn't reach this session's terminal",
  invalid: "Plain text only, up to 2000 characters",
  denied: "Not while locked, presenting or sharing",
};

/** A session row's message field: the text goes to that session as if typed in its terminal, then Enter (`cc_send`). Takes the keyboard only while focused (`typing_focus`).
 *  Off while the session waits on a permission prompt: that Enter would answer the prompt. */
function SessionSend({ sid, name, waiting }: { sid: string; name: string; waiting: boolean }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const focused = useRef(false);
  const typing = (on: boolean) => { focused.current = on; bridge.call("typing_focus", { label: "island", on }).catch(() => undefined); };
  // the list closed while the field had the keyboard: give it back
  useEffect(() => () => { if (focused.current) bridge.call("typing_focus", { label: "island", on: false }).catch(() => undefined); }, []);
  const send = () => {
    if (!text.trim() || busy || waiting) return;
    setBusy(true);
    bridge.call("cc_send", { sid, text })
      .then(() => { setText(""); setNote({ ok: true, text: "Sent" }); })
      .catch((e) => setNote({ ok: false, text: SEND_ERR[String(e)] ?? "Couldn't send" }))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <form className="sessSend" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input className="sessInput" value={text} maxLength={2000} disabled={waiting} placeholder={waiting ? "Answer its prompt in the terminal first" : `Message ${name}`} aria-label={`Message to ${name}`}
          onChange={(e) => { setText(e.target.value); setNote(null); }} onFocus={() => typing(true)} onBlur={() => typing(false)} />
        <button type="submit" className="sessGo" aria-label={`Send to ${name}`} disabled={busy || waiting || !text.trim()} onMouseDown={(e) => e.preventDefault()}><ArrowUp size={13} strokeWidth={2.4} /></button>
      </form>
      {note && <div className={`t12 sessNote${note.ok ? " l3" : ""}`} role="status">{note.text}</div>}
    </>
  );
}

export const EditCenter = ({ e, generic }: { e: CcEdit; generic: boolean }) => {
  const open = !generic && e.file !== null;
  return <span className="ms"><FilePen /><span className="b6">{open ? flat(e.file!.split("/").pop() ?? "", 40) : "Claude Code is editing"}</span>{open && <span className="t12 num editCount"><span className="add">+{e.add}</span> <span className="del">−{e.del}</span></span>}</span>;
};
/** "Show changes" only when there's something to show (a name and a session tag for the cache). */
export const EditBump = ({ onShow }: { onShow: (() => void) | null }) =>
  <div className="peekBar">{onShow ? <button className="btn kk primary" onClick={onShow}>Show changes</button> : <span className="t12 l2">Claude Code is editing</span>}</div>;

/**
 * Read-only diff of the session's last edit, fetched on open (`cc_diff`; never sent before the click). At most 200 lines, then a count; "Open in editor" opens the file with its default app.
 * The lines are the edit itself (Edit's old/new text, or Write's whole content), without file line numbers.
 */
export function DiffCard({ sid }: { sid: string }) {
  const [d, setD] = useState<CcDiff | "error" | null>(null);
  useEffect(() => { let live = true; bridge.call("cc_diff", { sid }).then((x) => live && setD(x), () => live && setD("error")); return () => { live = false; }; }, [sid]);
  const head = d && d !== "error" ? <><span className="b6">{flat(d.file, 80)}</span> <span className="num editCount"><span className="add">+{d.add}</span> <span className="del">−{d.del}</span></span></> : "Changes";
  return (
    <div className="body diffCard">
      <div className="t15">{head}</div>
      {d === null ? <div className="t13 l2">Loading…</div>
        : d === "error" ? <div className="t13 l2">These changes aren't available anymore.</div>
        : <pre className="code glass diffLines" aria-label="Changes">{d.lines.map((l, i) => <div key={i} className={l[0] === "+" ? "add" : l[0] === "-" ? "del" : undefined}>{l}</div>)}</pre>}
      <div className="buttons">
        {d && d !== "error" && d.more > 0 && <span className="t12 l2 num">{d.more} more lines</span>}
        <button className="btn glass" disabled={d === null || d === "error"} onClick={() => bridge.call("cc_diff_open", { sid }).catch(() => undefined)}>Open in editor</button>
      </div>
    </div>
  );
}
