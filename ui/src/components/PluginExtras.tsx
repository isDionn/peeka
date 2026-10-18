// Three pieces under Settings › Plugins (mockup aye): the Claude Code bridge row, "Permission history" and the global "revoke access".
import { useEffect, useState } from "react";
import { CircleCheck, TriangleAlert, X } from "lucide-react";
import { bridge, type AgentBridge, type BridgeState, type PermissionEvent } from "../bridge";
import { usePlugins, useSettings } from "../hooks";
import { ageLabel } from "../lib/alerts";

/** "5m ago", or "just now" (ageLabel says "now" under a minute). */
export const agoText = (s: number) => { const t = ageLabel(s); return t === "now" ? "just now" : `${t} ago`; };
import { flat, pluginName } from "../lib/plugin";
import { scopeInfo } from "../lib/scopes";
import { HoldButton, NO_INDENT } from "./common";
import "../fidelity-settings.css";

export const bridgeSub = (s: BridgeState): string => {
  const ev = s.lastEventAgoS === null ? "" : ` · last event ${agoText(s.lastEventAgoS)}`;
  return s.installed ? `Installed · ${s.healthy ? "connected to this Peeka" : "points to another copy"}${ev}` : "Not installed";
};

/**
 * Claude Code hook bridge: status (installed?, pointing at this Peeka?, last event) and one button. The row only renders if Rust `claude_bridge_state` answers (no made-up status).
 * The button only acts on a real click; it's disabled in demo mode (Rust refuses too). Fixed width: the row doesn't shift when the label changes. The failure reason arrives as a Rust notification.
 */
function BridgeRow() {
  const [st, setSt] = useState<BridgeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const demo = !!useSettings()?.demo;
  useEffect(() => { bridge.call("claude_bridge_state").then(setSt).catch(() => undefined); }, []);
  if (!st) return null;
  const ok = st.installed && st.healthy;
  const run = () => {
    setBusy(true); setFailed(false);
    bridge.call(ok ? "claude_bridge_remove" : "claude_bridge_install").then(setSt, () => setFailed(true)).finally(() => setBusy(false));
  };
  return (
    <div className="list glass" style={NO_INDENT}>
      <div className="row">
        <div style={{ flex: 1 }}><div>Claude Code bridge</div><div className="t12 l3 b4" role="status">{failed ? "Didn't work. See the notification for why" : bridgeSub(st)}</div></div>
        <span style={{ color: ok ? "var(--green)" : "var(--orange)", display: "grid" }} role="img" aria-label={ok ? "Healthy" : "Needs attention"}>{ok ? <CircleCheck /> : <TriangleAlert />}</span>
        <button className="btn kk glass" style={{ width: 92 }} disabled={busy || demo} title={demo ? "Not available in demo mode" : undefined} onClick={run}>{!st.installed ? "Install" : st.healthy ? "Remove" : "Reinstall"}</button>
      </div>
    </div>
  );
}

/**
 * The other coding agents (Codex CLI, Cursor, Gemini CLI, Copilot CLI): one row each, same size as the Claude Code row, only for agents
 * whose folder exists on this PC (or that still hold Peeka's hook). The sub line says which file Install changes before it is clicked
 * (Rust backs it up first). Status only: Peeka never answers an agent's permission request.
 */
/** One line, so the row keeps its height when the long "Not installed" line becomes the short status (nothing moves under the cursor). */
const ONE_LINE = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } as const;
function AgentRows() {
  const [rows, setRows] = useState<AgentBridge[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const demo = !!useSettings()?.demo;
  useEffect(() => { bridge.call("agent_bridges").then(setRows).catch(() => undefined); }, []);
  const shown = rows.filter((r) => r.present || r.installed);
  if (shown.length === 0) return null;
  const run = (r: AgentBridge) => {
    setBusy(r.id); setFailed(null);
    bridge.call(r.installed && r.healthy ? "agent_bridge_remove" : "agent_bridge_install", { agent: r.id })
      .then((n) => setRows((l) => l.map((x) => (x.id === n.id ? n : x))), () => setFailed(r.id))
      .finally(() => setBusy(null));
  };
  return (
    <div className="list glass" style={NO_INDENT} aria-label="Other coding agents">
      {shown.map((r) => {
        const ok = r.installed && r.healthy;
        const sub = failed === r.id ? "Didn't work. See the notification for why" : r.installed ? bridgeSub(r) : `Not installed · Install adds Peeka's hook to ${r.file} (backup kept)`;
        return (
          <div className="row" key={r.id}>
            <div style={{ flex: 1, minWidth: 0 }}><div>{r.name} bridge</div><div className="t12 l3 b4" role="status" title={sub} style={ONE_LINE}>{sub}</div></div>
            <span style={{ color: ok ? "var(--green)" : "var(--orange)", display: "grid" }} role="img" aria-label={ok ? "Healthy" : "Needs attention"}>{ok ? <CircleCheck /> : <TriangleAlert />}</span>
            <button className="btn kk glass" style={{ width: 92 }} disabled={busy !== null || demo} title={demo ? "Not available in demo mode" : undefined} aria-label={`${!r.installed ? "Install" : ok ? "Remove" : "Reinstall"} ${r.name} bridge`} onClick={() => run(r)}>{!r.installed ? "Install" : ok ? "Remove" : "Reinstall"}</button>
          </div>
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
