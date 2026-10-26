// Three pieces under Settings › Plugins (mockup aye): the Claude Code bridge row, "Permission history" and the global "revoke access".
import { Fragment, useEffect, useRef, useState } from "react";
import { CircleCheck, TriangleAlert, X } from "lucide-react";
import { bridge, type AgentBridge, type BridgePreview, type BridgeState, type PermissionEvent } from "../bridge";
import { usePlugins, useSettings } from "../hooks";
import { ageLabel } from "../lib/alerts";

/** "5m ago", or "just now" (ageLabel says "now" under a minute). */
export const agoText = (s: number) => { const t = ageLabel(s); return t === "now" ? "just now" : `${t} ago`; };
import { flat, pluginName } from "../lib/plugin";
import { scopeInfo } from "../lib/scopes";
import { HoldButton, NO_INDENT } from "./common";
import "../fidelity-settings.css";
import "./cards.css";

export const bridgeSub = (s: BridgeState): string => {
  const ev = s.lastEventAgoS === null ? "" : ` · last event ${agoText(s.lastEventAgoS)}`;
  return s.installed ? `Installed · ${s.healthy ? "connected to this Peeka" : "points to another copy"}${ev}` : "Not installed";
};

const FAILED = "Didn't work. See the notification for why";
/** A bridge row's box: the change before the confirm, or (after it) the result in the space the change took. */
type Box = { pv: BridgePreview } | { done: string; h: number };
const baseName = (f: string) => f.split(/[\\/]/).pop() ?? f;

/**
 * Under a bridge row after its Install / Remove / Reinstall click: exactly what changes in `file` (`agent_bridge_preview`, nothing written yet) and the confirm, which
 * sends the preview's fingerprint back so Rust refuses a file changed meanwhile. After the confirm the box keeps its height and only says the result, so nothing below
 * moves under the cursor; it goes when Settings closes or the row's button is clicked again.
 */
function ChangeBox({ box, file, label, busy, onApply }: { box: Box; file: string; label: string; busy: boolean; onApply: (fingerprint: string, height: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  if ("done" in box) return <div className="row" style={{ display: "block", minHeight: box.h, boxSizing: "border-box" }} role="status"><div className="t12 l2">{box.done}</div></div>;
  const { pv } = box;
  const name = baseName(file);
  return (
    <div ref={ref} className="row" style={{ display: "block" }} role="group" aria-label={`Changes to ${name}`}>
      <div className="t12 l2">{pv.lines.length === 0 ? `Nothing to change in ${file}.` : <>{file}: <span className="num editCount"><span className="add">+{pv.add}</span> <span className="del">−{pv.del}</span></span> lines, only Peeka's hook. The first time, a copy of the original is kept as {name}.bak-peeka.</>}</div>
      {pv.lines.length > 0 && <pre className="code glass diffLines" style={{ margin: "8px 0" }} aria-label="Changes">{pv.lines.map((l, i) => <div key={i} className={l[0] === "+" ? "add" : l[0] === "-" ? "del" : undefined}>{l}</div>)}</pre>}
      {pv.more > 0 && <div className="t12 l3 num">{pv.more} more lines</div>}
      {pv.lines.length > 0 && <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}><button className="btn kk primary" disabled={busy} onClick={() => onApply(pv.fingerprint, ref.current?.offsetHeight ?? 0)}>{`${label} now`}</button></div>}
    </div>
  );
}

/**
 * Claude Code hook bridge: status (installed?, pointing at this Peeka?, last event) and one button. The row only renders if Rust `claude_bridge_state` answers (no made-up status).
 * The button opens the change (`ChangeBox`) and becomes Cancel in place. Disabled in demo mode (Rust refuses too). Fixed width: the row doesn't shift when the label changes.
 * The failure reason arrives as a Rust notification.
 */
function BridgeRow() {
  const [st, setSt] = useState<BridgeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  const demo = !!useSettings()?.demo;
  useEffect(() => { bridge.call("claude_bridge_state").then(setSt).catch(() => undefined); }, []);
  if (!st) return null;
  const ok = st.installed && st.healthy;
  const label = !st.installed ? "Install" : st.healthy ? "Remove" : "Reinstall";
  const open = !!box && "pv" in box;
  const look = () => {
    if (open) { setBox(null); return; }
    setBusy(true); setFailed(false);
    bridge.call("agent_bridge_preview", { agent: "claude", remove: ok }).then((pv) => setBox({ pv }), () => setFailed(true)).finally(() => setBusy(false));
  };
  const apply = (fingerprint: string, h: number) => {
    setBusy(true);
    bridge.call(ok ? "claude_bridge_remove" : "claude_bridge_install", { fingerprint })
      .then((s) => { setSt(s); setBox({ done: "Done. settings.json updated.", h }); }, () => { setFailed(true); setBox({ done: "Nothing was written.", h }); })
      .finally(() => setBusy(false));
  };
  return (
    <div className="list glass" style={NO_INDENT}>
      <div className="row">
        <div style={{ flex: 1 }}><div>Claude Code bridge</div><div className="t12 l3 b4" role="status">{failed ? FAILED : bridgeSub(st)}</div></div>
        <span style={{ color: ok ? "var(--green)" : "var(--orange)", display: "grid" }} role="img" aria-label={ok ? "Healthy" : "Needs attention"}>{ok ? <CircleCheck /> : <TriangleAlert />}</span>
        <button className="btn kk glass" style={{ width: 92 }} disabled={busy || demo} title={demo ? "Not available in demo mode" : undefined} aria-expanded={open} onClick={look}>{open ? "Cancel" : label}</button>
      </div>
      {box && <ChangeBox box={box} file="settings.json" label={label} busy={busy} onApply={apply} />}
    </div>
  );
}

/**
 * The other coding agents (Codex CLI, Cursor, Gemini CLI, Copilot CLI): one row each, same size as the Claude Code row, only for agents
 * whose folder exists on this PC (or that still hold Peeka's hook). The sub line says which file Install changes; the button opens that
 * change (`ChangeBox`, one row at a time) like the Claude Code row. Status only: Peeka never answers an agent's permission request.
 */
/** One line, so the row keeps its height when the long "Not installed" line becomes the short status (nothing moves under the cursor). */
const ONE_LINE = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } as const;
function AgentRows() {
  const [rows, setRows] = useState<AgentBridge[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [box, setBox] = useState<{ id: string; b: Box } | null>(null);
  const demo = !!useSettings()?.demo;
  useEffect(() => { bridge.call("agent_bridges").then(setRows).catch(() => undefined); }, []);
  const shown = rows.filter((r) => r.present || r.installed);
  if (shown.length === 0) return null;
  const look = (r: AgentBridge, open: boolean) => {
    if (open) { setBox(null); return; }
    setBusy(r.id); setFailed(null);
    bridge.call("agent_bridge_preview", { agent: r.id, remove: r.installed && r.healthy }).then((pv) => setBox({ id: r.id, b: { pv } }), () => setFailed(r.id)).finally(() => setBusy(null));
  };
  const apply = (r: AgentBridge, fingerprint: string, h: number) => {
    setBusy(r.id);
    bridge.call(r.installed && r.healthy ? "agent_bridge_remove" : "agent_bridge_install", { agent: r.id, fingerprint })
      .then((n) => { setRows((l) => l.map((x) => (x.id === n.id ? n : x))); setBox({ id: r.id, b: { done: `Done. ${baseName(r.file)} updated.`, h } }); },
        () => { setFailed(r.id); setBox({ id: r.id, b: { done: "Nothing was written.", h } }); })
      .finally(() => setBusy(null));
  };
  return (
    <div className="list glass" style={NO_INDENT} aria-label="Other coding agents">
      {shown.map((r) => {
        const ok = r.installed && r.healthy;
        const label = !r.installed ? "Install" : ok ? "Remove" : "Reinstall";
        const mine = box?.id === r.id ? box.b : null;
        const open = !!mine && "pv" in mine;
        const sub = failed === r.id ? FAILED : r.installed ? bridgeSub(r) : `Not installed · Install adds Peeka's hook to ${r.file} (backup kept)`;
        return (
          <Fragment key={r.id}>
            <div className="row">
              <div style={{ flex: 1, minWidth: 0 }}><div>{r.name} bridge</div><div className="t12 l3 b4" role="status" title={sub} style={ONE_LINE}>{sub}</div></div>
              <span style={{ color: ok ? "var(--green)" : "var(--orange)", display: "grid" }} role="img" aria-label={ok ? "Healthy" : "Needs attention"}>{ok ? <CircleCheck /> : <TriangleAlert />}</span>
              <button className="btn kk glass" style={{ width: 92 }} disabled={busy !== null || demo} title={demo ? "Not available in demo mode" : undefined} aria-expanded={open} aria-label={`${open ? "Cancel" : label} ${r.name} bridge`} onClick={() => look(r, open)}>{open ? "Cancel" : label}</button>
            </div>
            {mine && <ChangeBox box={mine} file={r.file} label={label} busy={busy !== null} onApply={(fp, h) => apply(r, fp, h)} />}
          </Fragment>
        );
      })}
    </div>
  );
}

function History() {
  const [rows, setRows] = useState<PermissionEvent[] | null>(null);
  useEffect(() => { bridge.call("permission_history").then(setRows).catch(() => setRows([])); }, []);
  const now = Date.now();
  return (
    <div className="list glass permissionHistory" style={NO_INDENT} aria-label="Permission history">
      {rows && rows.length === 0 && <div className="row"><span className="l3">Nothing yet.</span></div>}
      {rows?.map((r, i) => (
        <div className="row" key={i}>
          <div style={{ flex: 1 }}><div>{flat(r.plugin, 64)}: {scopeInfo(r.scope).text}</div></div>
          <span className="t12 l3">{r.granted ? "granted" : "revoked"} · {agoText(Math.max(0, (now - r.at) / 1000))}</span>
        </div>
      ))}
    </div>
  );
}

export function PluginExtras() {
  const list = usePlugins();
  const [hist, setHist] = useState(false);
  const main = list.find((p) => p.main);
  const label = main ? `Revoke ${pluginName(main)}'s access` : "Revoke plugin access";
  return (
    <>
      <BridgeRow />
      <AgentRows />
      <div className="settingsFoot">
        <button className="btn kk glass" aria-expanded={hist} onClick={() => setHist(!hist)}>Permission history</button>
        {list.length > 0 && <HoldButton danger label={label} icon={<X />} onDone={() => list.forEach((p) => bridge.call("plugin_remove", { id: p.id }))} />}
      </div>
      {hist && <History />}
    </>
  );
}
