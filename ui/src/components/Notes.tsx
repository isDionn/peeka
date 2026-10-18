// Small peeks: notification burst, usage limit reached, "N sessions" chip. Logic lives in lib/notes.ts; Island picks, this file only draws.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Bell, Cpu, Download, Gauge, Headphones } from "lucide-react";
import { bridge } from "../bridge";
import { burstLabel, type Burst, type CcSession } from "../lib/notes";
import { flat } from "../lib/plugin";

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
export const DownloadCenter = ({ name, generic }: { name: string; generic: boolean }) =>
  <span className="ms"><Download /><span className="b6">{generic ? "Download complete" : `Downloaded: ${flat(name, 40)}`}</span></span>;
export function DownloadBump({ id, generic }: { id: string; generic: boolean }) {
  const go = (cmd: "download_open" | "download_show_in_folder") => () => bridge.call(cmd, { id }).catch(() => undefined);
  return generic
    ? <div className="peekBar"><span className="t12 l2">Download complete</span></div>
    : <div className="peekBar"><button className="btn kk primary" onClick={go("download_open")}>Open</button><button className="btn kk gray" onClick={go("download_show_in_folder")}>Show in folder</button></div>;
}

/** CPU above 95% for a long time (Rust `cpu_high {app}`; Rust makes the 60 s call, no timer here). Task Manager is `open_task_manager`. */
export const CpuCenter = ({ app, generic }: { app: string | null; generic: boolean }) =>
  <span className="ms"><Cpu /><span className="b6">{app && !generic ? `${flat(app, 28)} is using a lot of CPU` : "CPU is very busy"}</span></span>;
export const CpuBump = () => <div className="peekBar"><button className="btn kk primary" onClick={() => bridge.call("open_task_manager").catch(() => undefined)}>Task Manager</button></div>;

/**
 * Open Claude Code sessions chip (>= 2): a 30 px tall pill left of the island, out of flow (the island doesn't shift). Clicking lists the known ones.
 * The hook gives only a salted short hash of the session id (`sid`): sessions are numbered "Session 1", "Session 2" with each one's last tool; those without a hash (main assistant) only count toward the total.
 */
export function SessionChip({ n, list, edge, last, locked }: { n: number; list: CcSession[]; edge: number; last: { tool: string | null; at: number } | null; locked: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node | null)) setOpen(false); };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [open]);
  const ago = last ? Math.max(0, Math.round((Date.now() - last.at) / 1000)) : null;
  return (
    <div ref={root} className="sessionChip" style={{ right: `calc(50% + ${edge}px)` } as CSSProperties}>
      <button type="button" className="sessionBtn" data-hit aria-expanded={open} aria-label={`${n} sessions, ${open ? "hide" : "show"} list`} onClick={() => setOpen(!open)}>{n} sessions</button>
      {open && (
        <div className="sideList sessionList" data-hit role="group" aria-label="Claude Code sessions">
          <div className="sideRow"><span className="b6 sideName">{n} Claude Code sessions open</span></div>
          {list.map((x, i) => <div className="sideRow" key={x.sid}><span className="l3 sideName">Session {i + 1}{!locked && `: ${x.tool ? flat(x.tool, 24) : "event"}, ${Math.max(0, Math.round((Date.now() - x.at) / 1000))}s ago`}</span></div>)}
          {list.length === 0 && !locked && last && <div className="sideRow"><span className="l3 sideName">Last activity: {last.tool ? flat(last.tool, 24) : "event"}, {ago}s ago</span></div>}
          {n > list.length && <div className="sideRow"><span className="l3 sideName">{list.length ? `${n - list.length} more can't be told apart` : "Sessions can't be told apart"}</span></div>}
        </div>
      )}
    </div>
  );
}
