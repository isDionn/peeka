// Three pieces under Settings › Plugins (mockup aye): the Claude Code bridge row, "Permission history" and the global "revoke access".
import { useEffect, useState } from "react";
import { CircleCheck, TriangleAlert, X } from "lucide-react";
import { bridge, type BridgeState, type PermissionEvent } from "../bridge";
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
      <div className="settingsFoot">
        <button className="btn kk glass" aria-expanded={hist} onClick={() => setHist(!hist)}>Permission history</button>
        {list.length > 0 && <HoldButton danger label={label} icon={<X />} onDone={() => list.forEach((p) => bridge.call("plugin_remove", { id: p.id }))} />}
      </div>
      {hist && <History />}
    </>
  );
}
