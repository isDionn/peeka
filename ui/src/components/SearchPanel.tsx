import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bell, Brain, Timer, Monitor, MonitorOff, Search, SlidersHorizontal, Volume2 } from "lucide-react";
import { bridge, type SearchIndexState, type SearchResult } from "../bridge";
import { dative } from "../lib/cardsText";
import { askLabel, useMainAssistant, useSettings } from "../hooks";
import { fileKind } from "../lib/clip";
import { Mascot } from "../mascot";
import { flatten, groupResults, parseTimer, splitMatch } from "../lib/search";
import { YAY } from "../motion/spring";
import { useSpring } from "../motion/useSpring";
import { AppIcon, Kbd } from "./common";
import { FileIcon } from "./Pano";
import "../fidelity-ayar.css";

const TUR: Record<SearchResult["kind"], string> = { app: "Uygulama", window: "Pencere", file: "Dosya", setting: "Ayar", plugin: "Eklenti" };

/** Ayar sonucunun simgesi başlığa göre (maket ARA.ayar); tanınmayan ayar genel ayar simgesi alır. */
const SETTING_ICON: [RegExp, typeof Bell][] = [[/koruyucu/i, MonitorOff], [/ekran/i, Monitor], [/bildirim/i, Bell], [/^ses|ses ayar/i, Volume2]];

function Tile({ r }: { r: SearchResult }) {
  if (r.kind === "app" || r.kind === "window") return <span className="tile yok"><AppIcon src={r.icon} size={22} /></span>;
  if (r.kind === "file") return <span className={"tile k-" + fileKind(r.title)}><FileIcon name={r.title} /></span>;
  if (r.kind === "setting") { const I = SETTING_ICON.find(([re]) => re.test(r.title))?.[1] ?? SlidersHorizontal; return <span className="tile"><I /></span>; }
  return <span className="tile ikBrain"><Brain /></span>;
}

function Title({ text, q }: { text: string; q: string }) {
  const m = splitMatch(text, q);
  return <>{m ? <>{m[0]}<b>{m[1]}</b>{m[2]}</> : text}</>;
}

/**
 * Ctrl+K paneli (maket ara0-ara2): uygulamalar, açık pencereler, dosyalar (Windows Arama dizini; kapalıysa tek satır uyarı), ayarlar,
 * eklenti grupları ve en altta "asistana sor" (ana asistan bağlı değilken hiç yok). Ok tuşları bütün gruplarda gezer.
 */
export function SearchPanel({ onClose, initialQuery = "", initialSel = 0 }: { onClose: () => void; initialQuery?: string; initialSel?: number }) {
  const [q, setQ] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [index, setIndex] = useState<SearchIndexState["files"]>("on");
  const [sel, setSel] = useState(initialSel);
  const [touched, setTouched] = useState(false); // sonuç yokken "asistana sor" satırı, kullanıcı oka basana ya da fareyle değene dek seçili sayılmaz (Enter sessizce sormasın)
  const first = useRef(true);
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const main = useMainAssistant();
  const ask = useSettings()?.shortcuts.ask ?? "Ctrl+Space";
  useEffect(() => { bridge.call("search_index_state").then((s) => setIndex(s.files)).catch(() => undefined); }, []);
  useEffect(() => {
    let live = true;
    bridge.call("search", { query: q }).then((r) => { if (live) { setResults(r); setSel(first.current ? initialSel : 0); first.current = false; } }).catch(() => undefined);
    return () => { live = false; };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const query = q.trim();
  const groups = useMemo(() => groupResults(results, q, index === "off"), [results, q, index]);
  const ordered = useMemo(() => flatten(groups), [groups]);
  const timer = useMemo(() => parseTimer(q), [q]); // yerel eylem: ilk satır, asistana (jeton harcamadan) gitmez
  const ti = timer ? 1 : 0; // eylem satırı gezilen sıranın başındadır
  const askIx = main ? ordered.length + ti : -1; // "asistana sor" gezilebilir son satır
  const total = ordered.length + ti + (main ? 1 : 0);

  const open = (r?: SearchResult) => { if (!r) return; bridge.call("search_open", { id: r.id }).catch(() => undefined); onClose(); };
  const doAsk = () => { bridge.call("search_ask", { query }).catch(() => undefined); onClose(); };
  const doTimer = () => { if (!timer) return; bridge.call("timer_start", { label: timer.label, seconds: timer.seconds }).catch(() => undefined); onClose(); };
  const cur = ordered.length === 0 && !timer && !touched ? -1 : sel;
  const act = (i: number) => (timer && i === 0 ? doTimer() : i === askIx ? doAsk() : open(ordered[i - ti]));
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setTouched(true); setSel((s) => Math.max(0, Math.min(total - 1, s + (e.key === "ArrowDown" ? 1 : -1)))); }
    else if (e.key === "Enter") { e.preventDefault(); if (cur >= 0) act(cur); }
  };
  // seçim kapsülü yayla seçili satıra kayar (arama sonuç seçimi 0,34 / 0,82)
  const [top, setTop] = useState(0);
  useLayoutEffect(() => { const el = document.getElementById(`${id}-${sel}`); if (el) setTop(el.offsetTop); }, [sel, results, id, groups]);
  const pillY = useSpring(top, YAY.sekme);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" }); }, [sel]);

  let n = ti; // gezilen satır sırası
  const noRows = ordered.length === 0 && !timer && !groups.some((g) => g.note);
  return (
    <div className="govde">
      <div className="yazkutu buyuk cam">
        <Search className="l3" />
        <input data-autofocus value={q} onChange={(e) => { setQ(e.target.value); setTouched(false); }} onKeyDown={onKey}
          onKeyDownCapture={(e) => { if (e.key === "Escape" && q && noRows) { e.preventDefault(); e.stopPropagation(); setQ(""); } }} placeholder="Uygulama, pencere, dosya ya da ayar ara" aria-label="Ara" autoComplete="off"
          role="combobox" aria-controls={id} aria-expanded="true" aria-activedescendant={total && cur >= 0 ? `${id}-${cur}` : undefined} />
        <Kbd keys="Esc" />
      </div>
      <div className="sonuclar plat cam" id={id} role="listbox" aria-label="Sonuçlar" ref={list}>
        {total > 0 && cur >= 0 && <span className="secPil" aria-hidden="true" style={{ transform: `translateY(${pillY}px)` }} />}
        {timer && (
          <div role="group" aria-label="Eylemler">
            <div className="grupBas">Eylemler</div>
            <div id={`${id}-0`} role="option" aria-selected={cur === 0} className={"sonuc" + (cur === 0 ? " sec" : "")} onMouseMove={() => { setTouched(true); setSel(0); }} onClick={doTimer}>
              <span className="tile"><Timer /></span>
              <span className="ad">Zamanlayıcı başlat: <b>{timer.text}</b></span>
              <span className="tur">Eylem</span>
              <span className="enter tus-ipucu">Başlat<kbd>↵</kbd></span>
            </div>
          </div>
        )}
        {groups.map((g) => (
          <div key={g.key} role="group" aria-label={g.title}>
            <div className="grupBas">{g.title}</div>
            {g.rows.map((r) => {
              const i = n++;
              return (
                <div key={r.id} id={`${id}-${i}`} role="option" aria-selected={i === cur} className={"sonuc" + (i === cur ? " sec" : "")} onMouseMove={() => { setTouched(true); setSel(i); }} onClick={() => open(r)}>
                  <Tile r={r} />
                  <span className="ad" title={r.title}><Title text={r.title} q={query} />{r.subtitle && r.kind !== "app" && (query || r.kind !== "setting") && <small>{r.subtitle}</small>}</span>
                  <span className="tur">{r.kind === "plugin" && !/not/i.test(r.group ?? "") ? TUR.plugin : r.kind === "plugin" ? "Not" : TUR[r.kind]}</span>
                  <span className="enter tus-ipucu">Aç<kbd>↵</kbd></span>
                </div>
              );
            })}
            {g.note && <div className="bosSonuc t12">{g.note}</div>}
          </div>
        ))}
        {!query && <div className="bosSonuc t12">Yazmaya başla: uygulama, açık pencere, dosya, ayar{main ? ", not" : ""}.</div>}
        {query && noRows && <div className="bosSonuc">“{query}” için sonuç yok.{main ?  ` ${dative(main.name)} sorabilirsin.` : ""}</div>}
        {main && (
          <>
            <div className="grupBas" aria-hidden="true" />
            <div id={`${id}-${askIx}`} role="option" aria-selected={askIx === cur} className={"sonuc asistanSor" + (askIx === cur ? " sec" : "")} onMouseMove={() => { setTouched(true); setSel(askIx); }} onClick={doAsk}>
              <span className="tile"><Mascot size={22} mood="idle" isMainAssistant single={false} still /></span>
              <span className="ad">{query ? <>{askLabel(main)}: <b>“{query}”</b></> : `${askLabel(main)}…`}</span>
              <span className="tur">{main.name}</span>
              <span className="enter tus-ipucu">{askLabel(main)}<kbd>↵</kbd></span>
            </div>
          </>
        )}
      </div>
      <div className="araAlt">
        <span className="tus-ipucu"><kbd>↑</kbd><kbd>↓</kbd> seç</span><span className="tus-ipucu"><kbd>↵</kbd> aç</span>
        {main && <span className="tus-ipucu">{ask.split("+").map((k) => <kbd key={k}>{k}</kbd>)} {askLabel(main)}</span>}
      </div>
    </div>
  );
}
