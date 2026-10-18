// Ayarlar › Eklentiler (maket aye) ve Ayarlar › Modüller (maket aym). Geri alma: kapsamlar tek tek kapanır, bağlantı kesilir, eklenti kaldırılır.
import { useEffect, useState, type KeyboardEvent } from "react";
import { Bell, Clipboard, Cpu, Calendar, Ghost, GripVertical, Inbox, LayoutGrid, Music, Terminal, Timer, TriangleAlert, Users, type LucideIcon } from "lucide-react";
import { bridge, type ModuleEntry, type PluginInfo } from "../bridge";
import { usePlugins } from "../hooks";
import { ageLabel } from "../lib/alerts";
import { flat, pluginName } from "../lib/plugin";
import { LEVEL_NAME, scopeInfo } from "../lib/scopes";
import { HoldButton, NO_INDENT, Switch } from "./common";
import { Lead } from "./Plugin";

const MAIN_SCOPE = "composer.handler";
/** Kısa izin yazıları (maket aye); tablodaki uzun açıklama (Peeka'nın kendi tablosu) bilinmeyenler için kalır. */
const SHORT: Record<string, string> = {
  "island.protrusion": "Adada durum ve çıkıntı", "approvals.prompt": "Onay sormak", "windows.read": "Açık pencerelerin adlarını okumak", "composer.handler": "Ctrl+Space sorularını almak",
  "card.module": "Modüller kartında sekme", "clipboard.read": "Pano geçmişini okumak", "notifications.read": "Windows bildirimlerini okumak", "media.read": "Çalan parçayı okumak",
};
const shortText = (scope: string) => SHORT[scope] ?? scopeInfo(scope).text;

function PluginCard({ p }: { p: PluginInfo }) {
  const name = pluginName(p);
  const granted = p.scopes.filter((s) => s.granted).length;
  const seen = p.lastSeen ? `son bağlantı ${ageLabel(Math.max(0, (Date.now() - p.lastSeen) / 1000))} önce` : "";
  const state = p.connected ? "Bağlı" : seen ? `Bağlı değil · ${seen}` : "Bağlı değil";
  const hasMain = p.scopes.some((s) => s.scope === MAIN_SCOPE);
  const canMain = p.scopes.some((s) => s.scope === MAIN_SCOPE && s.granted);
  return (
    <section className="liste cam" style={NO_INDENT} aria-label={name}>
      <div className="sat">
        <div className="mkBas" style={{ gap: 10, flex: 1 }}>
          <Lead plugin={{ id: p.id, name: p.name, main: false }} size={28} />
          <div style={{ minWidth: 0 }}><div className="b6 pluginAd" title={name}>{name}{p.main && <span className="l3 b4"> · ana asistan</span>}</div>
            <div className="t12 l3 b4">{state} · {granted} izin · son 24 saatte {p.messages24h} mesaj, {p.approvals24h} onay</div>
            <div className="t12 l3 b4">{flat(p.publisher, 64)} · {flat(p.version, 24)} · {flat(p.id, 64)} · yayıncı doğrulanmadı</div></div>
        </div>
      </div>
      {p.lookalike && <div className="sat"><span className="eoUyari" role="alert"><TriangleAlert />Bu ad “{flat(p.lookalike, 64)}” adına benziyor.</span></div>}
      {p.scopes.map((s) => {
        const info = scopeInfo(s.scope);
        return (
          <div className="sat" key={s.scope}>
            <div style={{ flex: 1 }}><div>{shortText(s.scope)}</div><div className="t12 l3 b4" id={`risk-${p.id}-${s.scope}`}>{LEVEL_NAME[info.level]}</div></div>
            <Switch on={s.granted} describedBy={`risk-${p.id}-${s.scope}`} label={shortText(s.scope)} onChange={(on) => bridge.call("plugin_set_scope", { id: p.id, scope: s.scope, on })} />
          </div>
        );
      })}
      {hasMain && (
        <div className="sat">
          <div style={{ flex: 1 }}><div>Ana asistan</div><div className="t12 l3 b4">{canMain ? "Maskotu, canlı dökümü ve Ctrl+Space'i alır; aynı anda tek ana asistan" : "Önce yukarıdaki “Ctrl+Space sorularını almak” iznini aç"}</div></div>
          <Switch on={p.main && canMain} disabled={!canMain} label={`${name} ana asistan`} onChange={(on) => bridge.call("plugin_set_main", { id: on ? p.id : null })} />
        </div>
      )}
      <div className="sat pluginEylem">
        <span style={{ flex: 1 }} />
        {p.connected && <button className="btn kk cam" onClick={() => bridge.call("plugin_disconnect", { id: p.id })}>Bağlantıyı kes</button>}
        <HoldButton danger label="Erişimi geri al" aria={`${name} erişimini geri al`} icon={null} onDone={() => bridge.call("plugin_remove", { id: p.id })} />
      </div>
    </section>
  );
}

export function Plugins() {
  const list = usePlugins();
  return (
    <>
      <div className="t17 b6">Eklentiler</div>
      {list.length === 0 && <div className="liste cam" style={NO_INDENT}><div className="sat"><span className="l3">Bağlı eklenti yok. Bir program bağlanmak isteyince burada görünür.</span></div></div>}
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
      <div className="t17 b6">Modüller</div>
      <div className="liste cam" style={{ "--girinti": "30px" } as React.CSSProperties}>
        {list.map((m, i) => {
          const Icon = ICONS[m.icon] ?? LayoutGrid;
          return (
            <div className="sat" key={m.id} draggable onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag !== null) move(drag, i); setDrag(null); }} onDragEnd={() => setDrag(null)}
              style={drag === i ? { opacity: 0.5 } : undefined}>
              <button className="tutamac" aria-label={`${m.title} sırasını değiştir: yukarı ve aşağı ok tuşları`} onKeyDown={key(i)}><GripVertical /></button>
              <Icon /><span className="metin">{m.title}</span><span className="t12 l3">{m.owner}</span>
              <Switch on={m.on} label={m.title} onChange={(on) => save(list.map((x) => (x.id === m.id ? { ...x, on } : x)))} />
            </div>
          );
        })}
      </div>
    </>
  );
}
