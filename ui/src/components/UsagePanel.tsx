import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { bridge } from "../bridge";
import { useInput, useLock, usePrivacy } from "../hooks";
import { radioKeys } from "./common";
import "./usage.css";

type Usage = { agent: string; windows: { usedPercent: number; windowMinutes: number; resetsAt?: number; resetsInSeconds?: number }[] };
type Mode = "compact" | "detailed";

const nameOf = (agent: string) => agent === "codex" ? "Codex" : agent === "claude" ? "Claude" : agent;
const fiveHour = (row: Usage) => row.windows.find((w) => w.windowMinutes === 300);
const generic = (locked: boolean, presenting: boolean, shared: boolean) => locked || presenting || shared;

function remaining(w: NonNullable<ReturnType<typeof fiveHour>>) {
  const seconds = w.resetsAt ? Math.max(0, Math.round(w.resetsAt - Date.now() / 1000)) : w.resetsInSeconds ?? 0;
  const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function resetText(w: Usage["windows"][number]) {
  const at = w.resetsAt ? new Date(w.resetsAt * 1000) : new Date(Date.now() + (w.resetsInSeconds ?? 0) * 1000);
  return `Resets ${at.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
}

export function useAgentUsage() {
  const [rows, setRows] = useState<Usage[] | null>(null);
  const refresh = () => bridge.call("agent_usage").then((next) => setRows(next.filter((row) => row.windows.length > 0)), () => setRows([]));
  useEffect(() => { refresh(); }, []);
  return { rows, refresh };
}

export function UsageStrip({ onOpen }: { onOpen: () => void }) {
  const { rows } = useAgentUsage();
  const lock = useLock(), privacy = usePrivacy(), input = useInput();
  const hidden = generic(lock.locked, input.presentation, privacy.screen);
  const shown = useMemo(() => rows?.map((row) => ({ row, window: fiveHour(row) })).filter((item): item is { row: Usage; window: NonNullable<ReturnType<typeof fiveHour>> } => !!item.window) ?? [], [rows]);
  if (!shown.length) return null;
  return <button className="usageStrip" aria-label="Usage" title="Usage" onClick={onOpen}>
    {hidden ? <span>Usage</span> : shown.map(({ row, window }) => <span className="usageSummary" key={row.agent}><b className="usageTile">{nameOf(row.agent)[0]}</b><strong className={window.usedPercent >= 80 ? "usageHot" : ""}>{window.usedPercent}%</strong><em>{remaining(window)}</em></span>)}
  </button>;
}

export function UsagePanel({ onSettings }: { onSettings: () => void }) {
  const { rows, refresh } = useAgentUsage();
  const [mode, setMode] = useState<Mode>("detailed");
  const lock = useLock(), privacy = usePrivacy(), input = useInput();
  const hidden = generic(lock.locked, input.presentation, privacy.screen);
  return <div className="body usagePanel">
    <div className="usageHead"><div className="t17 b6">Usage</div><button className="mini" title="Refresh usage" aria-label="Refresh usage" onClick={refresh}><RefreshCw /></button></div>
    <div className="seg glass segSmall" role="radiogroup" aria-label="Usage detail" onKeyDown={radioKeys}>
      {(["detailed", "compact"] as Mode[]).map((item) => <button key={item} className={"segb" + (mode === item ? " on" : "")} role="radio" aria-checked={mode === item} tabIndex={mode === item ? 0 : -1} onClick={() => setMode(item)}>{item === "detailed" ? "Detailed" : "Compact"}</button>)}
    </div>
    {!rows ? <div className="usageBlank" /> : rows.length === 0 ? <div className="usageEmpty">No usage data yet — Claude needs the statusline bridge in Settings<button className="btn kk glass" onClick={onSettings}>Open Settings</button></div> : <div className="usageRows">
      {rows.map((row) => <div className="usageRow" key={row.agent}><b className="usageTile">{nameOf(row.agent)[0]}</b><div><strong>{nameOf(row.agent)}</strong><div className="usageWindows">{row.windows.filter((window) => mode === "detailed" || window.windowMinutes === 300).map((window) => <div className="usageWindow" key={window.windowMinutes}><span>{window.windowMinutes === 300 ? "5-hour" : "Weekly"}</span>{hidden ? <span>Usage hidden</span> : <><strong className={window.usedPercent >= 80 ? "usageHot" : ""}>{window.usedPercent}%</strong><span>{mode === "detailed" ? resetText(window) : remaining(window as NonNullable<ReturnType<typeof fiveHour>>)}</span></>}</div>)}</div></div></div>)}
    </div>}
  </div>;
}
