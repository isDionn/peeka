// Wave 5 small peeks (FPV §0i item 12; mockup sarj, pil, bt, zam, g0, g): charging, low battery, Bluetooth headphones, timer, shelf.
// Each has two parts: the strip center (`*Center`) and the peek or card below it (`*Bump`, `ShelfCard`). Data comes from Rust (bridge.ts, status_changed).
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { BatteryCharging, BatteryLow, Check, Clipboard, Copy, Download, ExternalLink, File, FileArchive, FileImage, FileSpreadsheet, FileText, FileVideo, FolderOpen, Headphones, Inbox, Pause, Pin, PinOff, Play, Plus, Share, Sparkles, Square, Bell, Timer, TimerOff, Trash2, Wifi, WifiOff, X } from "lucide-react";
import { bridge, type PluginInfo, type ShelfItem, type Status, type TimerState } from "../bridge";
import { askLabel, timerLeft, useClips, useSecond, useShelfDrag } from "../hooks";
import { fmtTime } from "../lib/media";
import { flat } from "../lib/plugin";
import { Lead } from "./Plugin";

type Battery = NonNullable<Status["battery"]>;
const noop = () => undefined;
const mmss = (s: number) => fmtTime(Math.ceil(s)); // past an hour: 1:30:00

/* ---- charging ---- */
export const ChargeCenter = ({ b }: { b: Battery }) => <span className="ms"><BatteryCharging /><span className="b6">Charging</span>{b.percent !== null && <span className="l2 num">{b.percent}%</span>}</span>;
/** "About ... until full": just the bar when Windows doesn't give the remaining time. */
export const ChargeBump = ({ b }: { b: Battery }) => (
  <div className="peekBar">
    {b.percent !== null && <span className="miniProgress" style={{ "--y": b.percent / 100 } as CSSProperties}><b /></span>}
    <span className="t12 l2 num">{b.remaining ? `About ${b.remaining} until full` : "Charging"}</span>
  </div>
);

/* ---- low battery ---- */
export const LowBatteryCenter = ({ b }: { b: Battery }) => <span className="ms"><span style={{ color: "var(--orange)" }}><BatteryLow /></span><span className="b6">Battery {b.percent}%</span></span>;
export const LowBatteryBump = ({ b }: { b: Battery }) => (
  <div className="peekBar">
    {b.remaining && <span className="t12 l2 num">About {b.remaining} left</span>}
    <button className="btn kk gray" onClick={() => bridge.call("open_windows_settings", { uri: "ms-settings:batterysaver" }).catch(noop)}>Battery saver settings</button>
  </div>
);

/* ---- Bluetooth headphones: no case battery; no peek for devices that don't report battery ---- */
export const BtCenter = ({ name }: { name: string }) => <span className="ms"><Headphones /><span className="b6">{flat(name, 40)} connected</span></span>;
export const BtBump = ({ battery }: { battery: number }) => (
  <div className="peekBar">
    <span className="t12 l2 num">Battery {Math.round(battery)}%</span>
    <span className="miniProgress" style={{ "--y": battery / 100, width: 56 } as CSSProperties}><b /></span>
  </div>
);

/* ---- timer ---- */
export function TimerCenter({ t }: { t: TimerState }) {
  const now = useSecond(t.running);
  return <span className="ms"><Timer /><span className="b6 counter" style={{ minWidth: fmtTime(t.totalS).length + "ch" }}>{mmss(timerLeft(t, now))}</span><span className="l3">{flat(t.label, 24)}</span></span>;
}
export function TimerBump({ t }: { t: TimerState }) {
  const now = useSecond(t.running);
  const y = t.totalS > 0 ? Math.min(1, timerLeft(t, now) / t.totalS) : 0;
  const ctl = (action: "pause" | "resume" | "add5" | "stop") => () => bridge.call("timer_control", { action }).catch(noop);
  return (
    <div className="peekBar">
      <span className="miniProgress" style={{ "--y": y } as CSSProperties}><b /></span>
      <button className="mini filled" title={t.running ? "Pause" : "Resume"} aria-label={t.running ? "Pause" : "Resume"} onClick={ctl(t.running ? "pause" : "resume")}>{t.running ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button>
      <button className="btn kk gray" onClick={ctl("add5")}>+5 min</button>
      <button className="mini" title="Stop" aria-label="Stop" onClick={ctl("stop")}><Square /></button>
    </div>
  );
}

/* ---- timer done (decision 2026-10-17: no sound, stays until the owner closes it) ---- */
export const TimerDoneCenter = ({ label }: { label: string | null }) => <span className="ms"><TimerOff /><span className="b6">Time's up</span>{label && <span className="l3">{flat(label, 24)}</span>}</span>;
/** "+5 min": tries `timer_control add5` first; if Rust refuses on a finished timer, a new 5 min timer starts with the same name. */
export function TimerDoneBump({ label, onDone }: { label: string; onDone: () => void }) {
  const add5 = () => { onDone(); bridge.call("timer_control", { action: "add5" }).catch(() => bridge.call("timer_start", { label, seconds: 300 }).catch(noop)); };
  const stop = () => { onDone(); bridge.call("timer_control", { action: "stop" }).catch(noop); };
  return (
    <div className="peekBar">
      <span className="t12 l2">{label ? `${flat(label, 24)} is done` : "Timer done"}</span>
      <button className="btn kk gray" onClick={add5}>+5 min</button>
      <button className="btn kk" onClick={stop}>Close</button>
    </div>
  );
}

/* ---- connection lost / back (separate from the assistant's "Offline mode") ---- */
export const NetCenter = ({ lost }: { lost: boolean }) => <span className="ms">{lost ? <WifiOff /> : <Wifi />}<span className="b6">{lost ? "Connection lost" : "Back online"}</span></span>;
export const NetBump = ({ lost }: { lost: boolean }) => (
  <div className="peekBar">
    <span className="t12 l2">{lost ? "No internet connection" : "Internet is back"}</span>
    {lost && <button className="btn kk gray" onClick={() => bridge.call("open_windows_settings", { uri: "ms-settings:network-wifi" }).catch(noop)}>Network settings</button>}
  </div>
);

/* ---- "While you were away" summary: one click opens the notification list ---- */
export const AwayCenter = () => <span className="ms"><Bell /><span className="b6">While you were away</span></span>;
export const AwayBump = ({ text, onOpen }: { text: string; onOpen: () => void }) => (
  <div className="peekBar">
    <button className="btn kk gray" onClick={onOpen}><Bell />{text}</button>
  </div>
);

/* ---- shelf ---- */
const FILE_ICON = { pdf: FileText, video: FileVideo, sheet: FileSpreadsheet, image: FileImage, other: File } as const;
const FILE_TONE = { pdf: "var(--red)", video: "var(--cyan)", sheet: "var(--green)", image: "var(--cyan)", other: "var(--l2)" } as const;

export function ShelfCenter({ main, count }: { main: PluginInfo | null; count: number }) {
  return (
    <span className="ms">
      {main && <Lead plugin={{ id: main.id, name: main.name, main: true }} mascot="ready" size={24} />}
      <Inbox /><span className="b6">Shelf</span>{count > 0 && <span className="l3">{count === 1 ? "1 file" : `${count} files`}</span>}
    </span>
  );
}
/** Two drop targets while a file is dragged onto the island (Rust handles the drop; the UI only draws the targets). */
export const ShelfBump = ({ main }: { main: PluginInfo | null }) => (
  <div className="peekBar">
    {main && <span className="dropSmall"><Sparkles />{askLabel(main)}</span>}
    <span className="dropSmall"><Download />Add to Shelf</span>
  </div>
);

/** The empty shelf's buttons. Paste = the newest image or file you copied (none: no button); `useClips` only runs here. */
function ShelfAdd({ add }: { add: () => void }) {
  const pasteable = useClips().find((c) => c.kind === "image" || (c.kind === "file" && !c.missing));
  return (
    <div className="row">
      <button className="btn kk gray" onClick={add}><Plus />Add files</button>
      {pasteable && <button className="btn kk gray" title="The newest image or file you copied" onClick={() => bridge.call("clip_to_shelf", { id: pasteable.id }).catch(noop)}><Clipboard />Paste</button>}
    </div>
  );
}

const KIND_LABEL = { pdf: "PDF", video: "Video", sheet: "Spreadsheet", image: "Image", other: "File" } as const;
const files = (n: number) => (n === 1 ? "1 file" : `${n} files`);

/** Direction A (owner, 2026-10-26): every shelf file in a 4-column grid; click selects, Ctrl toggles, Shift selects a range,
 *  Esc clears; one action row for the selection; drag a tile out to any app (the files stay). The same component is the
 *  island's Shelf card and the Modules Shelf tab. `generic` (locked, presenting, screen shared): no names and no actions. */
export function ShelfCard({ items, main, generic = false }: { items: ShelfItem[]; main: PluginInfo | null; generic?: boolean }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [lifted, setLifted] = useState<string[]>([]);
  const [zipping, setZipping] = useState(false);
  const over = useShelfDrag();
  const seen = useRef(new Set(items.map((f) => f.id))); // ids already on screen: only newer tiles play the drop-in
  const fresh = new Set(items.filter((f) => !seen.current.has(f.id)).map((f) => f.id));
  useEffect(() => { items.forEach((f) => seen.current.add(f.id)); }, [items]);
  const sel = generic ? [] : items.filter((f) => picked.includes(f.id)).map((f) => f.id); // in shelf order; a removed file drops out
  const n = items.length;

  const pick = (id: string, e: ReactMouseEvent) => {
    if (e.shiftKey && anchor) {
      const ids = items.map((f) => f.id), [a, b] = [ids.indexOf(anchor), ids.indexOf(id)].sort((x, y) => x - y);
      setPicked(a < 0 ? [id] : ids.slice(a, b + 1));
      return;
    }
    setAnchor(id);
    // Enter / Space (detail 0) toggle like Ctrl-click: the keyboard has no Ctrl-click
    if (e.ctrlKey || e.metaKey || e.detail === 0) setPicked(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
    else setPicked(sel.length === 1 && sel[0] === id ? [] : [id]);
  };
  // 6 px with the button down starts Windows' drag: the selection if this tile is in it, else just this tile
  const start = useRef<{ id: string; x: number; y: number } | null>(null);
  const drag = (id: string) => ({
    onPointerDown: (e: ReactPointerEvent) => { if (e.button === 0 && !(e.target as HTMLElement).closest(".shMinis")) start.current = { id, x: e.clientX, y: e.clientY }; },
    onPointerMove: (e: ReactPointerEvent) => {
      const s = start.current;
      if (!s) return;
      if (e.buttons === 0) { start.current = null; return; }
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) <= 6) return;
      start.current = null;
      const ids = sel.includes(s.id) ? sel : [s.id];
      setLifted(ids);
      bridge.call("shelf_drag", { ids }).catch(noop).finally(() => setLifted([]));
    },
    onPointerUp: () => { start.current = null; },
  });
  // refusals (locked, a file Windows would run) are silent
  const zip = () => { setZipping(true); bridge.call("shelf_zip", { ids: sel }).catch(noop).finally(() => setZipping(false)); };
  const remove = (ids: string[]) => { bridge.call("shelf_remove", { ids }).catch(noop); setPicked((p) => p.filter((x) => !ids.includes(x))); };
  const add = () => bridge.call("shelf_add").catch(noop);
  const onKey = (e: ReactKeyboardEvent) => { if (e.key === "Escape" && sel.length) { e.preventDefault(); e.stopPropagation(); setPicked([]); } }; // capture: the card's focus trap would close the card first

  const drop = <div className="shDrop" aria-hidden="true"><Download />Release to add<small>Files stay where they are; the Shelf keeps a link.</small></div>;
  if (n === 0) return (
    <div className="body shBody">
      <div className={"shWell" + (over ? " over" : "")}>
        <div className="shEmpty">
          <Inbox aria-hidden="true" />
          <div><b>Park files here</b>Drag a file to the top of the screen, then drag it out into any app.</div>
          {!generic && <ShelfAdd add={add} />}
        </div>
        {drop}
      </div>
    </div>
  );
  return (
    <div className="body shBody" onKeyDownCapture={onKey}>
      <div className={"shWell" + (over ? " over" : "")}>
        <div className={"shGrid" + (sel.length ? " any" : "")} role="group" aria-label={"Shelf, " + files(n)}>
          {items.map((f) => {
            const I = FILE_ICON[f.kind], name = generic ? KIND_LABEL[f.kind] : flat(f.name, 80), on = sel.includes(f.id);
            return (
              <div className={"shTile" + (on ? " sel" : "") + (fresh.has(f.id) ? " new" : "") + (lifted.includes(f.id) ? " lifted" : "")} key={f.id} data-shelf={f.id} {...(generic ? {} : drag(f.id))}>
                <button className="shPick" aria-pressed={on} aria-label={`${name}, ${f.sub}${f.pinned ? ", pinned" : ""}`} disabled={generic} onClick={(e) => pick(f.id, e)}>
                  <span className="shThumb" style={{ color: FILE_TONE[f.kind] }}><I aria-hidden="true" /></span>
                  <span className="shName">{name}</span>
                  <span className="shMeta">{f.pinned && <Pin aria-hidden="true" />}{f.sub}</span>
                </button>
                {!generic && <>
                  <span className="shCheck" aria-hidden="true"><Check /></span>
                  <span className="shMinis">
                    <button className="mini" title="Open" aria-label={`Open ${name}`} onClick={() => bridge.call("shelf_open", { id: f.id }).catch(noop)}><ExternalLink /></button>
                    <button className="mini" title={f.pinned ? "Unpin" : "Pin to the top"} aria-label={`${f.pinned ? "Unpin" : "Pin"} ${name}`} onClick={() => bridge.call("shelf_pin", { id: f.id, on: !f.pinned }).catch(noop)}>{f.pinned ? <PinOff /> : <Pin />}</button>
                    <button className="mini" title="Remove from Shelf" aria-label={`Remove ${name} from Shelf`} onClick={() => remove([f.id])}><X /></button>
                  </span>
                </>}
              </div>
            );
          })}
        </div>
        {drop}
      </div>
      <div className="shBar">
        {generic ? <span className="hint">{files(n)}. Names are hidden right now.</span>
          : sel.length === 0 ? <>
            <span className="hint">{files(n)}. Click to select, Ctrl or Shift for more, drag out to any app.</span>
            <span className="sp" />
            <button className="btn kk gray" onClick={add}><Plus />Add</button>
            {n > 1 && <button className="btn kk gray" onClick={() => setPicked(items.map((f) => f.id))}>Select all</button>}
          </> : <>
            <span className="n" aria-live="polite">{sel.length} selected</span>
            <button className="btn kk gray" onClick={() => bridge.call("shelf_copy_files", { ids: sel }).catch(noop)}><Copy />Copy</button>
            <button className="btn kk gray" onClick={() => bridge.call("shelf_share", { ids: sel }).catch(noop)}><Share />Share</button>
            <button className="btn kk gray" disabled={zipping} onClick={zip}><FileArchive />{zipping ? "Zipping" : "Zip"}</button>
            <button className="btn kk gray ic" title="Show in folder" aria-label="Show in folder" onClick={() => bridge.call("shelf_show_in_folder", { id: sel[0] }).catch(noop)}><FolderOpen /></button>
            <button className="btn kk gray ic" title="Remove from Shelf" aria-label="Remove from Shelf" onClick={() => remove(sel)}><Trash2 /></button>
            <span className="sp" />
            {main && <button className="btn kk assistant" onClick={() => bridge.call("shelf_ask", { ids: sel }).catch(noop)}><Sparkles />{askLabel(main)}</button>}
          </>}
      </div>
    </div>
  );
}
