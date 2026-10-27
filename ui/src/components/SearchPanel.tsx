import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Bell, Brain, Calculator, Timer, Monitor, MonitorOff, Search, SlidersHorizontal, Volume2 } from "lucide-react";
import { bridge, type SearchIndexState, type SearchResult } from "../bridge";
import { askLabel, useMainAssistant, useSettings } from "../hooks";
import { fileKind } from "../lib/clip";
import { Mascot } from "../mascot";
import { flatten, groupResults, parseSearchAnswer, parseTimer, splitMatch } from "../lib/search";
import { AppIcon, Kbd } from "./common";
import { FileIcon } from "./Pano";
import { ExtGroup, useExtSearch } from "./ExtSearch";
import { ext } from "../ext";
import "../fidelity-settings.css";

const KIND_LABEL: Record<SearchResult["kind"], string> = { app: "App", window: "Window", file: "File", setting: "Setting", plugin: "Plugin" };

/** A setting result's icon comes from its title (mockup ARA.ayar); unknown settings get the generic settings icon. */
const SETTING_ICON: [RegExp, typeof Bell][] = [[/saver/i, MonitorOff], [/display|screen/i, Monitor], [/notification/i, Bell], [/^sound|volume/i, Volume2]];

function Tile({ r }: { r: SearchResult }) {
  if (r.kind === "app" || r.kind === "window") return <span className="tile none"><AppIcon src={r.icon} size={22} /></span>;
  if (r.kind === "file") return <span className={"tile k-" + fileKind(r.title)}><FileIcon name={r.title} /></span>;
  if (r.kind === "setting") { const I = SETTING_ICON.find(([re]) => re.test(r.title))?.[1] ?? SlidersHorizontal; return <span className="tile"><I /></span>; }
  return <span className="tile iconBrain"><Brain /></span>;
}

function Title({ text, q }: { text: string; q: string }) {
  const m = splitMatch(text, q);
  return <>{m ? <>{m[0]}<b>{m[1]}</b>{m[2]}</> : text}</>;
}

/**
 * Ctrl+K panel (mockup ara0-ara2): apps, open windows, files (Windows Search index; a one-line warning when it's off), settings,
 * plugin groups and "ask the assistant" at the bottom (absent when no main assistant is connected). Arrow keys move across all groups.
 */
export function SearchPanel({ onClose, initialQuery = "", initialSel = 0 }: { onClose: () => void; initialQuery?: string; initialSel?: number }) {
  const [q, setQ] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [index, setIndex] = useState<SearchIndexState["files"]>("on");
  const [sel, setSel] = useState(initialSel);
  const [touched, setTouched] = useState(false); // with no results, the "ask the assistant" row isn't selected until the user presses an arrow or hovers it (so Enter doesn't ask silently)
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
  const timer = useMemo(() => parseTimer(q), [q]); // local action: first row, never goes to the assistant (no tokens spent)
  const answer = useMemo(() => parseSearchAnswer(q), [q]);
  const ai = answer ? 1 : 0;
  const ti = timer ? 1 : 0;
  // assistant slots (Y3): the extension's commands come after the timer, its groups after Peeka's results; empty without one
  const x = useExtSearch(query, !!main, onClose);
  const lead = x.lead.length;
  const askIx = main ? ordered.length + ai + ti + lead + x.tailCount : -1; // "ask the assistant" is the last navigable row
  const total = ordered.length + ai + ti + lead + x.tailCount + (main ? 1 : 0);

  const open = (r?: SearchResult) => { if (!r) return; bridge.call("search_open", { id: r.id }).catch(() => undefined); onClose(); };
  const doAsk = () => { bridge.call("search_ask", { query }).catch(() => undefined); onClose(); };
  const doTimer = () => { if (!timer) return; bridge.call("timer_start", { label: timer.label, seconds: timer.seconds }).catch(() => undefined); onClose(); };
  const [copied, setCopied] = useState(false);
  const copy = () => { if (answer) bridge.call("clipboard_write", { text: answer.text }).then(() => setCopied(true)).catch(() => undefined); };
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 1200); return () => clearTimeout(t); }, [copied]);
  const cur = ordered.length === 0 && lead === 0 && !timer && !answer && !touched ? -1 : sel;
  const act = (i: number) => {
    if (answer && i === 0) return copy();
    if (timer && i === ai) return doTimer();
    if (i === askIx) return doAsk();
    const j = i - ai - ti;
    if (j < lead) return x.lead[j].go();
    if (j < lead + ordered.length) return open(ordered[j - lead]);
    x.tail.flatMap((g) => g.rows)[j - lead - ordered.length]?.go();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setTouched(true); setSel((s) => Math.max(0, Math.min(total - 1, s + (e.key === "ArrowDown" ? 1 : -1)))); }
    else if (e.key === "Enter") { e.preventDefault(); if (cur >= 0) act(cur); }
  };
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" }); }, [sel]);

  let n = ai + ti + lead; // navigation row index
  const noRows = ordered.length === 0 && lead === 0 && x.tailCount === 0 && !timer && !answer && !groups.some((g) => g.note);
  const hover = (i: number) => { setTouched(true); setSel(i); };
  return (
    <div className="body">
      <div className="inputBox large glass">
        <Search className="l3" />
        <input data-autofocus value={q} onChange={(e) => { setQ(e.target.value); setTouched(false); }} onKeyDown={onKey}
          onKeyDownCapture={(e) => { if (e.key === "Escape" && q && noRows) { e.preventDefault(); e.stopPropagation(); setQ(""); } }} placeholder="Search apps, windows, files and settings" aria-label="Search" autoComplete="off"
          role="combobox" aria-controls={id} aria-expanded="true" aria-activedescendant={total && cur >= 0 ? `${id}-${cur}` : undefined} />
        <Kbd keys="Esc" />
      </div>
      <div className="results plat glass" id={id} role="listbox" aria-label="Results" ref={list}>
        {answer && <div role="group" aria-label="Answer"><div className="groupHead">Answer</div><div id={`${id}-0`} role="option" aria-selected={cur === 0} className={"result" + (cur === 0 ? " selected" : "")} onMouseMove={() => { setTouched(true); setSel(0); }} onClick={copy}><span className="tile"><Calculator /></span><span className="name"><b>{answer.text}</b></span><span className="kind">Calculator</span><span className="enter key-hint">{copied ? "Copied" : "Copy"}<kbd>â†µ</kbd></span></div></div>}
        {timer && (
          <div role="group" aria-label="Actions">
            <div className="groupHead">Actions</div>
            <div id={`${id}-${ai}`} role="option" aria-selected={cur === ai} className={"result" + (cur === ai ? " selected" : "")} onMouseMove={() => { setTouched(true); setSel(ai); }} onClick={doTimer}>
              <span className="tile"><Timer /></span>
              <span className="name">Start timer: <b>{timer.text}</b></span>
              <span className="kind">Action</span>
              <span className="enter key-hint">Start<kbd>↵</kbd></span>
            </div>
          </div>
        )}
        {lead > 0 && <ExtGroup title={ext()!.label} rows={x.lead} start={ai + ti} cur={cur} idp={id} onHover={hover} />}
        {groups.map((g) => (
          <div key={g.key} role="group" aria-label={g.title}>
            <div className="groupHead">{g.title}</div>
            {g.rows.map((r) => {
              const i = n++;
              return (
                <div key={r.id} id={`${id}-${i}`} role="option" aria-selected={i === cur} className={"result" + (i === cur ? " selected" : "")} onMouseMove={() => { setTouched(true); setSel(i); }} onClick={() => open(r)}>
                  <Tile r={r} />
                  <span className="name" title={r.title}><Title text={r.title} q={query} />{r.subtitle && r.kind !== "app" && (query || r.kind !== "setting") && <small>{r.subtitle}</small>}</span>
                  <span className="kind">{r.kind === "plugin" && !/note/i.test(r.group ?? "") ? KIND_LABEL.plugin : r.kind === "plugin" ? "Note" : KIND_LABEL[r.kind]}</span>
                  <span className="enter key-hint">Open<kbd>↵</kbd></span>
                </div>
              );
            })}
            {g.note && <div className="noResults t12">{g.note}</div>}
          </div>
        ))}
        {x.tail.map((g) => { const start = n; n += g.rows.length; return <ExtGroup key={g.title} title={g.title} rows={g.rows} start={start} cur={cur} idp={id} onHover={hover} />; })}
        {x.status && <div className="noResults t12" role="status">{x.status}</div>}
        {!query && <div className="noResults t12">Start typing to find apps, open windows, files, settings{main ? ", notes" : ""}.</div>}
        {query && noRows && !x.status && <div className="noResults">No results for “{query}”.{main ? ` You can ask ${main.name}.` : ""}</div>}
        {main && (
          <>
            <div className="groupHead" aria-hidden="true" />
            <div id={`${id}-${askIx}`} role="option" aria-selected={askIx === cur} className={"result assistantAsk" + (askIx === cur ? " selected" : "")} onMouseMove={() => { setTouched(true); setSel(askIx); }} onClick={doAsk}>
              <span className="tile"><Mascot size={22} mood="idle" isMainAssistant single={false} still /></span>
              <span className="name">{query ? <>{askLabel(main)}: <b>“{query}”</b></> : `${askLabel(main)}…`}</span>
              <span className="kind">{main.name}</span>
              <span className="enter key-hint">{askLabel(main)}<kbd>↵</kbd></span>
            </div>
          </>
        )}
      </div>
      <div className="searchFoot">
        <span className="key-hint"><kbd>↑</kbd><kbd>↓</kbd> select</span><span className="key-hint"><kbd>↵</kbd> open</span>
        {main && <span className="key-hint">{ask.split("+").map((k) => <kbd key={k}>{k}</kbd>)} {askLabel(main)}</span>}
      </div>
    </div>
  );
}
