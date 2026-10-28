// Settings › Plugins (mockup aye) and Settings › Modules (mockup aym). Revoking: scopes turn off one by one, the connection drops, the plugin is removed.
import { useEffect, useState, type KeyboardEvent } from "react";
import { Bell, Clipboard, Cpu, Calendar, Ghost, GripVertical, Inbox, LayoutGrid, Music, Terminal, Timer, TriangleAlert, Users, type LucideIcon } from "lucide-react";
import { bridge, type ModuleEntry, type PluginInfo } from "../bridge";
import { usePlugins } from "../hooks";
import { flat, pluginName } from "../lib/plugin";
import { LEVEL_NAME, scopeInfo } from "../lib/scopes";
import { HoldButton, NO_INDENT, Switch } from "./common";
import { agoText } from "./PluginExtras";
import { Lead } from "./Plugin";

const MAIN_SCOPE = "composer.handler";
/** Short permission labels (mockup aye); the long description from Peeka's own table stays for unknown scopes. */
const SHORT: Record<string, string> = {
  "island.protrusion": "Status and peeks in the island", "approvals.prompt": "Ask for approval", "windows.read": "Read open window titles", "composer.handler": "Answer Ctrl+Space questions",
  "card.module": "Tab in the Modules card", "clipboard.read": "Read clipboard history", "notifications.read": "Read Windows notifications", "media.read": "See what's playing",
};
const shortText = (scope: string) => SHORT[scope] ?? scopeInfo(scope).text;

function PluginCard({ p }: { p: PluginInfo }) {
  const name = pluginName(p);
  const granted = p.scopes.filter((s) => s.granted).length;
  const seen = p.lastSeen ? `last connected ${agoText(Math.max(0, (Date.now() - p.lastSeen) / 1000))}` : "";
  const state = p.connected ? "Connected" : seen ? `Not connected · ${seen}` : "Not connected";
  const hasMain = p.scopes.some((s) => s.scope === MAIN_SCOPE);
  const canMain = p.scopes.some((s) => s.scope === MAIN_SCOPE && s.granted);
  return (
    <section className="list glass" style={NO_INDENT} aria-label={name}>
      <div className="row">
        <div className="mkHead" style={{ gap: 10, flex: 1 }}>
          <Lead plugin={{ id: p.id, name: p.name, main: false }} size={28} />
          <div style={{ minWidth: 0 }}><div className="b6 pluginName" title={name}>{name}{p.main && <span className="l3 b4"> · main assistant</span>}</div>
            <div className="t12 l3 b4">{state} · {granted} permissions · last 24h: {p.messages24h} messages, {p.approvals24h} approvals</div>
            <div className="t12 l3 b4">{flat(p.publisher, 64)} · {flat(p.version, 24)} · {flat(p.id, 64)} · publisher not verified</div></div>
        </div>
      </div>
      {p.lookalike && <div className="row"><span className="consentWarning" role="alert"><TriangleAlert />This name looks like “{flat(p.lookalike, 64)}”.</span></div>}
      {p.scopes.map((s) => {
        const info = scopeInfo(s.scope);
        return (
          <div className="row" key={s.scope}>
            <div style={{ flex: 1 }}><div>{shortText(s.scope)}</div><div className="t12 l3 b4" id={`risk-${p.id}-${s.scope}`}>{`${LEVEL_NAME[info.level]} risk`}</div></div>
            <Switch on={s.granted} describedBy={`risk-${p.id}-${s.scope}`} label={shortText(s.scope)} onChange={(on) => bridge.call("plugin_set_scope", { id: p.id, scope: s.scope, on })} />
          </div>
        );
      })}
      {hasMain && (
        <div className="row">
          <div style={{ flex: 1 }}><div>Main assistant</div><div className="t12 l3 b4">{canMain ? "Gets the mascot, live transcript and Ctrl+Space. Only one main assistant at a time" : "First turn on “Answer Ctrl+Space questions” above"}</div></div>
          <Switch on={p.main && canMain} disabled={!canMain} label={`${name} main assistant`} onChange={(on) => bridge.call("plugin_set_main", { id: on ? p.id : null })} />
        </div>
      )}
      <div className="row pluginAction">
        <span style={{ flex: 1 }} />
        {p.connected && <button className="btn kk glass" onClick={() => bridge.call("plugin_disconnect", { id: p.id })}>Disconnect</button>}
        <HoldButton danger label="Revoke access" aria={`Revoke ${name}'s access`} icon={null} onDone={() => bridge.call("plugin_remove", { id: p.id })} />
      </div>
    </section>
  );
}

export function Plugins() {
  const list = usePlugins();
  return (
    <>
      <div className="t17 b6">Plugins</div>
      {list.length === 0 && <div className="list glass" style={NO_INDENT}><div className="row"><span className="l3">No plugins connected. When an app asks to connect, it shows up here.</span></div></div>}
      {list.map((p) => <PluginCard key={p.id} p={p} />)}
    </>
  );
}

const ICONS: Record<string, LucideIcon> = { "layout-grid": LayoutGrid, music: Music, clipboard: Clipboard, inbox: Inbox, calendar: Calendar, timer: Timer, cpu: Cpu, bell: Bell, ghost: Ghost, terminal: Terminal, users: Users };

export function Modules() {
  const [list, setList] = useState<ModuleEntry[]>([]);
  const [drag, setDrag] = useState<number | null>(null);
  useEffect(() => { bridge.call("modules_get").then(setList).catch(() => undefined); }, []);
  const save = (next: ModuleEntry[]) => { setList(next); bridge.call("modules_set", { order: next.map((m) => m.id), off: next.filter((m) => !m.on).map((m) => m.id) }).catch(() => undefined); };
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= list.length) return;
    const next = [...list]; next.splice(to, 0, next.splice(from, 1)[0]); save(next);
  };
  const key = (i: number) => (e: KeyboardEvent) => { if (e.key === "ArrowUp") { e.preventDefault(); move(i, i - 1); } else if (e.key === "ArrowDown") { e.preventDefault(); move(i, i + 1); } };
  return (
    <>
      <div className="t17 b6">Modules</div>
      <div className="list glass" style={{ "--indent": "30px" } as React.CSSProperties}>
        {list.map((m, i) => {
          const Icon = ICONS[m.icon] ?? LayoutGrid;
          return (
            <div className="row" key={m.id} draggable onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag !== null) move(drag, i); setDrag(null); }} onDragEnd={() => setDrag(null)}
              style={drag === i ? { opacity: 0.5 } : undefined}>
              <button className="handle" aria-label={`Reorder ${m.title}: use the up and down arrow keys`} onKeyDown={key(i)}><GripVertical /></button>
              <Icon /><span className="text">{m.title}</span><span className="t12 l3">{m.owner}</span>
              <Switch on={m.on} label={m.title} onChange={(on) => save(list.map((x) => (x.id === m.id ? { ...x, on } : x)))} />
            </div>
          );
        })}
      </div>
    </>
  );
}
