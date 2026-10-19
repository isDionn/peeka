// Clipboard card and Clipboard tab (mockup h, h1, h2, h3), Peeka lock card (kl). ADR-0063: password rows are masked; plain text only via the eye button,
// lives only in this component's state and for at most 5 s (never written to logs, URLs, storage or events).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { justPressed } from "../lib/justPressed";
import { AlignLeft, Check, Clipboard, Copy, Eye, EyeOff, File, FileImage, FileSpreadsheet, FileText, FileVideo, Fingerprint, KeyRound, Link, Lock, PanelTop, Pin, ScanText, Scissors, Search, Sparkles, Terminal, Trash2 } from "lucide-react";
import { bridge, type ClipItem, type ClipPassword, type ClipPlain, type LockState, type PluginInfo } from "../bridge";
import { askLabel, useClips, useInput, useLock, useMainAssistant, useNow } from "../hooks";
import { ago, fileKind, hexOf, passwordSub, REVEAL_MS, safePreview, safeThumb } from "../lib/clip";
import { flat } from "../lib/plugin";
import { sendX } from "../lib/xwin";
import { EmptyBoard } from "./CardsExtra";
import { Lead } from "./Plugin";
import { delOk } from "./common";
import "../fidelity-settings.css";

/** Fixed fake placeholder: unrelated to the real password, only for the blurred-text look. Plain text arrives only on hover or keyboard focus. */
const DUMMY = "a8F!k2Qm9Zr7vT";
const noop = () => undefined;

/** A row's actions show only on hover, focus or selection (owner decision 15). When hidden they're not in the DOM either. */
function useActive(_selected: boolean, forced: boolean) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  return {
    active: hover || focus || forced, // being selected alone doesn't show actions: Delete mustn't appear on two rows at once (O17)
    bind: {
      onPointerEnter: () => setHover(true),
      onPointerLeave: () => setHover(false),
      onFocus: () => setFocus(document.documentElement.hasAttribute("data-kb")), // only on keyboard focus; for mouse users hover is the only source
      onBlur: (e: React.FocusEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false); },
    },
  };
}

/** Id of the item being dragged out (mockup h2: the source thumbnail fades to 35%). The page gets no events during a native Windows drag; `clip_drag_end` or the first buttonless pointer event signals the end. */
let dragId: string | null = null;
const dragSubs = new Set<() => void>();
export function setClipboardDrag(id: string | null) { dragId = id; dragSubs.forEach((f) => f()); }
const useDragId = () => useSyncExternalStore((f) => { dragSubs.add(f); return () => { dragSubs.delete(f); }; }, () => dragId);

/** Dragging an image or file row 6 px starts a drag out (Windows' native drag image, in Rust). */
function useDragOut(id: string, on: boolean) {
  const start = useRef<[number, number] | null>(null);
  if (!on) return {};
  return {
    onPointerDown: (e: React.PointerEvent) => { if (e.button === 0 && !(e.target as HTMLElement).closest("button")) start.current = [e.clientX, e.clientY]; },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (s && e.buttons === 0) start.current = null; // button already released
      else if (s && Math.hypot(e.clientX - s[0], e.clientY - s[1]) > 6) { start.current = null; setClipboardDrag(id); bridge.call("clip_drag", { id }).catch(() => setClipboardDrag(null)); }
    },
    onPointerUp: () => { start.current = null; },
  };
}

function Actions({ item, main, variant, revealed, onEye, notify }: { item: ClipItem; main: PluginInfo | null; variant: "row" | "thumb"; revealed: boolean; onEye: (id: string) => void; notify: (m: string) => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 1200); return () => clearTimeout(t); }, [copied]);
  const pw = item.kind === "password";
  const base = variant === "row" ? "mini" : "";
  const btn = (title: string, icon: ReactNode, onClick: () => void, extra = "", pressed?: boolean, disabled?: boolean) => (
    <button type="button" className={(base + " " + extra).trim()} title={title} aria-label={title} aria-pressed={pressed} disabled={disabled} onClick={(e) => { e.stopPropagation(); onClick(); }}>{icon}</button>
  );
  const id = item.id;
  return (
    <span className={variant === "row" ? "rowAction" : "action"}>
      {pw && btn(revealed ? "Hide" : "Show briefly", revealed ? <EyeOff /> : <Eye />, () => onEye(id), revealed ? "eyeOpen" : "")}
      {btn(pw ? "Copy without showing" : "Copy again", copied ? <Check /> : <Copy />, () => { bridge.call("clip_copy", { id }).then(() => { setCopied(true); notify("Copied"); }).catch(noop); })}
      {item.kind === "image" && btn("Copy text", <ScanText />, () => { bridge.call("clip_ocr", { id }).then((ok) => notify(ok ? "Text copied" : "No text found")).catch(() => notify("Couldn't read text")); })}
      {!pw && btn(item.pinned ? "Unpin" : "Pin", <Pin />, () => { bridge.call("clip_pin", { id, on: !item.pinned }).catch(noop); }, item.pinned ? "shown" : "", item.pinned)}
      {!pw && btn(main ? askLabel(main) : "Assistant not connected", <Sparkles />, () => { bridge.call("clip_share", { id }).then(() => notify("Sent")).catch(() => notify("Assistant not connected")); }, "ask", undefined, !main)}
      {btn("Delete", <Trash2 />, () => { if (delOk()) bridge.call("clip_delete", { id }).catch(noop); }, "delete")}
    </span>
  );
}

const FILE_ICON = { pdf: FileText, video: FileVideo, sheet: FileSpreadsheet, image: FileImage, other: File } as const;

/** Icon by file type (Clipboard row and Ctrl+K file result). */
export function FileIcon({ name }: { name: string | null }) { const I = FILE_ICON[fileKind(name)]; return <I />; }

/** Clicking a row's body copies it (except passwords: the eye button and "Copy without showing" handle those). */
const copyBody = (id: string, notify: (m: string) => void) => { bridge.call("clip_copy", { id }).then(() => notify("Copied")).catch(noop); };

interface EntryProps { item: ClipItem; now: number; selected: boolean; main: PluginInfo | null; onSelect: (id: string) => void; notify: (m: string) => void }

/** Thumbnail tile (image items, 4 columns). */
function Thumb({ item, now, selected, main, onSelect, notify }: EntryProps & { item: ClipPlain }) {
  const { active, bind } = useActive(selected, false);
  const src = safeThumb(item.thumb);
  const drag = useDragOut(item.id, true);
  const dragging = useDragId();
  return (
    <div className={"pg glass" + (selected ? " selected" : "") + (dragging === item.id ? " dragging" : "")} data-clip={item.id} tabIndex={selected ? 0 : -1} data-autofocus={selected ? "" : undefined} aria-label={`${item.sub ?? "Image"}, ${ago(item.createdAt, now)}`}
      {...bind} {...drag} onFocus={() => { bind.onFocus(); onSelect(item.id); }} onClick={() => { onSelect(item.id); copyBody(item.id, notify); }}>
      {src ? <img src={src} alt="" draggable={false} /> : <span className="pgNone"><FileImage /></span>}
      {active && <Actions item={item} main={main} variant="thumb" revealed={false} onEye={noop} notify={notify} />}
      <div className="sub"><span>{flat(item.sub, 40) || "Image"}</span><span className="num">{ago(item.createdAt, now)}</span></div>
    </div>
  );
}

function Tile({ item }: { item: ClipItem }) {
  if (item.kind === "password") return <span className="tip2 k-password"><KeyRound /></span>;
  if (item.kind === "file") return <span className={"tip2 k-" + fileKind(item.text)}><FileIcon name={item.text} /></span>;
  if (item.kind === "image") { const s = safeThumb(item.thumb); return s ? <img className="swatch thumb" src={s} alt="" /> : <span className="tip2 k-image"><FileImage /></span>; }
  const hex = hexOf(item);
  if (hex) return <span className="swatch" style={{ background: hex }} />;
  const I = item.hint === "link" ? Link : item.hint === "command" ? Terminal : AlignLeft;
  return <span className="tip2"><I /></span>;
}

/** List row: text, link, color, command, file and password. */
function Row({ item, now, selected, main, onSelect, shown, onEye, onPeek, onHide, notify }: EntryProps & { shown: string | null; onEye: (id: string) => void; onPeek: (id: string) => void; onHide: () => void }) {
  const pw = item.kind === "password";
  const revealed = shown !== null;
  const { active, bind } = useActive(selected, revealed);
  const drag = useDragOut(item.id, item.kind === "file" || item.kind === "image");
  const time = ago(item.createdAt, now);
  let body: ReactNode;
  if (pw) {
    const p: ClipPassword = item;
    body = (
      <div style={{ flex: 1, minWidth: 0 }}>
        {revealed ? <div className="text num">{shown}</div> : <div className="text num" role="img" aria-label="Hidden password">{DUMMY}</div>}
        <div className="t12 l3 b4">{revealed ? "Hides again in 5s" : passwordSub(p.source, p.expiresAt, now)}</div>
      </div>
    );
  } else if (item.kind === "file" || item.kind === "image") {
    body = <div style={{ flex: 1, minWidth: 0 }}><div className="text">{flat(item.text ?? item.sub, 120)}</div>{item.kind === "file" && item.sub && <div className="t12 l3 b4">{flat(item.sub, 120)}</div>}</div>;
  } else {
    body = <span className={"text b4 num" + (item.hint === "command" ? " command" : "")}>{flat(item.text, 200)}</span>;
  }
  return (
    <div className={"row" + (dragId === item.id ? " dragging" : "") + (pw ? " hidden" : "") + (revealed ? " shown" : "") + (selected ? " selected" : "") + (active ? " current" : "") + (!pw && item.missing ? " dim" : "")}
      data-clip={item.id} tabIndex={selected ? 0 : -1} data-autofocus={selected ? "" : undefined} {...bind} {...drag}
      // password: plain text arrives on hover / keyboard focus (one call per entry, not on pointermove); cleared at once on leave or blur
      onPointerEnter={() => { bind.onPointerEnter(); if (pw) onPeek(item.id); }} onPointerLeave={() => { bind.onPointerLeave(); if (pw) onHide(); }}
      onBlur={(e) => { bind.onBlur(e); if (pw && !e.currentTarget.contains(e.relatedTarget as Node | null) && !justPressed()) onHide(); }}
      onFocus={() => { bind.onFocus(); onSelect(item.id); if (pw && document.documentElement.hasAttribute("data-kb")) onPeek(item.id); }} onClick={() => { onSelect(item.id); if (!pw) copyBody(item.id, notify); }}>
      <Tile item={item} />
      {body}
      {!pw && item.pinned && <Pin className="pinIcon" aria-label="Pinned" />}
      <span className="t12 l3 num time">{time}</span>
      {active && <Actions item={item} main={main} variant="row" revealed={revealed} onEye={onEye} notify={notify} />}
    </div>
  );
}

const Empty = () => <EmptyBoard />;

/**
 * Clipboard card body (island card and the Modules Clipboard tab). While visible it tells Rust `clip_visible`: the island window is excluded from capture (ADR-0063 §7).
 * Eye button: the value shows for 5 s; it's cleared from state on timeout, a second press, window blur, unmount, lock, or when the item goes away.
 */
let lastH = 0; // last drawn height: the placeholder doesn't collapse the card while waiting for the answer
export function ClipboardView({ bare, onReady }: { bare?: boolean; onReady?: () => void }) {
  const all = useClips();
  const main = useMainAssistant();
  const now = useNow().getTime();
  const [sel, setSel] = useState<string | null>(null);
  const [shown, setShown] = useState<{ id: string; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seq = useRef(0);
  const root = useRef<HTMLDivElement>(null);

  // Capture exclusion turns on before the card draws: the first frame comes after Rust answers. If the answer isn't `true` (refused, error, no Rust)
  // the window may be capturable: password rows are never drawn (safe side, ADR-0063 §7).
  const [excluded, setExcluded] = useState<boolean | null>(null); // null = waiting for the answer
  useLayoutEffect(() => {
    let live = true;
    bridge.call("clip_visible", { on: true }).then((ok) => ok === true, () => false).then((ok) => { if (live) setExcluded(ok); });
    return () => { live = false; bridge.call("clip_visible", { on: false }).catch(noop); };
  }, []);
  useEffect(() => { if (excluded !== null) onReady?.(); }, [excluded]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { if (root.current) lastH = root.current.offsetHeight; });
  const base = excluded ? all : all.filter((c) => c.kind !== "password");
  // filter: narrows as you type; password rows match only the source app name, never content (the content isn't on the client anyway)
  const [fq, setFq] = useState("");
  const needle = fq.trim().toLowerCase();
  const items = needle ? base.filter((c) => (c.kind === "password" ? [c.source] : [c.source, c.text, c.sub]).some((v) => v?.toLowerCase().includes(needle))) : base;
  const [note, setNote] = useState<string | null>(null); // copy / send feedback (1.6 s)
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((m: string) => { setNote(m); clearTimeout(noteTimer.current); noteTimer.current = setTimeout(() => setNote(null), 1600); }, []);
  useEffect(() => () => clearTimeout(noteTimer.current), []);

  // the source brightens again when the drag ends: a Rust event or the first buttonless pointer event (the native drag is over)
  const dragging = useDragId();
  useEffect(() => {
    if (!dragging) return;
    const off = bridge.on("clip_drag_end", () => setClipboardDrag(null));
    const end = (e: PointerEvent) => { if (e.type === "pointerup" || e.buttons === 0) setClipboardDrag(null); };
    window.addEventListener("pointerup", end); window.addEventListener("pointermove", end);
    return () => { off.then((f) => f()); window.removeEventListener("pointerup", end); window.removeEventListener("pointermove", end); };
  }, [dragging]);

  const hide = useCallback(() => { seq.current++; clearTimeout(timer.current); setShown(null); }, []);
  // hides on window blur; handing focus back to the previous app right after a click doesn't count
  useEffect(() => { const off = () => { if (!justPressed()) hide(); }; window.addEventListener("blur", off); return () => { window.removeEventListener("blur", off); hide(); }; }, [hide]);
  useEffect(() => { if (shown && !items.some((c) => c.id === shown.id)) hide(); }, [items, shown, hide]);
  const reveal = useCallback(async (id: string) => {
    if (shown?.id === id) return hide();
    hide();
    const mine = seq.current;
    try {
      const r = await bridge.call("clip_reveal", { id });
      if (mine !== seq.current) return; // hidden meanwhile, or another item was requested
      setShown({ id, text: r.text });
      timer.current = setTimeout(hide, Math.min(r.ttlMs, REVEAL_MS));
    } catch { /* locked or no item: nothing shown */ }
  }, [shown, hide]);
  // While presenting, hovering shows nothing (the eye button is off too); while locked Rust already returns `denied`.
  const presenting = useInput().presentation;
  useEffect(() => { if (presenting) hide(); }, [presenting, hide]);
  const peek = useCallback((id: string) => { if (!presenting && shown?.id !== id) void reveal(id); }, [presenting, shown, reveal]);

  const images = items.filter((c): c is ClipPlain => c.kind === "image").slice(0, 8);
  const rows = items.filter((c) => !images.includes(c as ClipPlain));
  const order = [...images, ...rows];
  const cur = order.some((c) => c.id === sel) ? sel : order[0]?.id ?? null;

  const onKey = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (!el.dataset.clip) return; // only while the item itself has focus
    const i = order.findIndex((c) => c.id === el.dataset.clip);
    const go = (k: number) => root.current?.querySelector<HTMLElement>(`[data-clip="${order[Math.max(0, Math.min(order.length - 1, k))]?.id}"]`)?.focus();
    if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); go(i + 1); }
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); go(i - 1); }
    else if (e.key === "Enter") { e.preventDefault(); bridge.call("clip_copy", { id: el.dataset.clip }).catch(noop); }
    else if (e.key === "Delete") { e.preventDefault(); go(i === order.length - 1 ? i - 1 : i + 1); bridge.call("clip_delete", { id: el.dataset.clip }).catch(noop); }
  };

  if (excluded === null) return <div className={bare ? "clipInner" : "body"} aria-busy="true" style={{ minHeight: lastH || undefined }} />;
  return (
    <div className={bare ? "clipInner" : "body"} ref={root} onKeyDown={onKey}>
      {base.length === 0 ? <Empty /> : (
        <>
          <div className="inputBox glass clipFilter">
            <Search className="l3" />
            <input value={fq} onChange={(e) => setFq(e.target.value)} placeholder="Search clipboard" aria-label="Search clipboard" autoComplete="off"
              onKeyDownCapture={(e) => { if (e.key === "Escape" && fq) { e.preventDefault(); e.stopPropagation(); setFq(""); } }}
              onKeyDown={(e) => { if (e.key === "ArrowDown" && order[0]) { e.preventDefault(); root.current?.querySelector<HTMLElement>(`[data-clip="${order[0].id}"]`)?.focus(); } }} />
          </div>
          {order.length === 0 && <div className="noResults" role="status">No matches</div>}
          {images.length > 0 && (
            <div className="clipImages">{images.map((c) => <Thumb key={c.id} item={c} now={now} selected={c.id === cur} main={main} onSelect={setSel} notify={notify} />)}</div>
          )}
          {rows.length > 0 && (
            <div className="list glass clipList" style={{ "--indent": "36px" } as React.CSSProperties}>
              {rows.map((c) => <Row key={c.id} item={c} now={now} selected={c.id === cur} main={main} onSelect={setSel} notify={notify} shown={shown?.id === c.id ? shown.text : null} onEye={presenting ? noop : reveal} onPeek={peek} onHide={hide} />)}
            </div>
          )}
          <div className="t12 l3 b4" role="status">{note ?? <>Last 24 hours, on this PC only{!excluded && " · Passwords hidden: this window couldn't be excluded from screen capture"}</>}</div>
        </>
      )}
    </div>
  );
}

/** Strip center while the card is open (say it once): "Clipboard 11 items". */
export function ClipboardCenter() {
  const items = useClips();
  return <span className="ms"><Clipboard /><span className="b6">Clipboard</span>{items.length > 0 && <span className="l3">{items.length === 1 ? "1 item" : `${items.length} items`}</span>}</span>;
}

/** Copies that open a peek: every image, file and link (plain text doesn't). Passwords and sensitive windows are never recorded in Rust anyway. */
export type StripKind = "image" | "file" | "link";
export const stripKind = (c: ClipItem | null): StripKind | null => (c === null || c.kind === "password" ? null : c.kind === "image" ? "image" : c.kind === "file" ? "file" : c.hint === "link" ? "link" : null);
export const STRIP_TXT: Record<StripKind, string> = { image: "Image copied", file: "File copied", link: "Link copied" };
const STRIP_ICON = { image: FileImage, file: File, link: Link } as const;

/** Win+Shift+S peek (mockup h1) and other copies: a thumbnail for images, icon and name for files/links. */
export function ShotCenter({ main, item }: { main: PluginInfo | null; item?: ClipPlain }) {
  const k = stripKind(item ?? null) ?? "image", Ic = item?.screenshot ? Scissors : STRIP_ICON[k];
  return <span className="ms">{main && <Lead plugin={{ id: main.id, name: main.name, main: true }} mascot="ready" size={24} />}<Ic /><span className="b6">{item?.screenshot || !item ? "Screenshot" : STRIP_TXT[k]}</span></span>;
}
/**
 * Copy peek (decision 2026-10-17). The top row never changes; `big` (pointer over it, images only) adds a large preview and Copy / Keep below:
 * the width is fixed at 360 px so it only grows downward and nothing shifts under the pointer. Large preview via `clip_preview` for images; Open and Add to Shelf for images and files.
 */
/** Protocol string, not UI copy: the assistant core recognizes this exact sentence as "summarize" (core notch_bridge/summary.py `asks_summary`, outside this repo). Change both together. */
const SUMMARIZE_ASK = "Summarize this link";
export function ShotBump({ item, main, big = false }: { item: ClipPlain; main: PluginInfo | null; big?: boolean }) {
  const k = stripKind(item) ?? "image", Ic = STRIP_ICON[k];
  // large preview: Rust's `clip_preview` PNG (up to 1024 px); the thumbnail stays until it arrives (fixed box, no shift). Refused while locked; quietly stays on the thumbnail.
  const [prev, setPrev] = useState<string | null>(null);
  useEffect(() => { if (!big || k !== "image") return; let live = true; bridge.call("clip_preview", { id: item.id }).then((u) => { if (live) setPrev(safePreview(u)); }).catch(noop); return () => { live = false; }; }, [big, k, item.id]);
  const thumb = safeThumb(item.thumb), src = prev ?? thumb;
  const call = (cmd: "clip_share" | "clip_edit" | "clip_copy" | "clip_open" | "clip_to_shelf") => () => bridge.call(cmd, { id: item.id }).catch(noop); // refusals (locked / no permission) are silent
  const ask = main && <button className="btn kk assistant" onClick={call("clip_share")}><Sparkles />{askLabel(main)}</button>;
  const pin = <button className="btn kk gray" onClick={() => bridge.call("clip_pin", { id: item.id, on: true }).catch(noop)}><Pin />Keep</button>;
  // Link: "Summarize with <assistant>" (only with a main assistant connected, not while locked). Rust resolves the link itself (the newest clipboard link); page text never passes through the UI; the answer opens in the island reply view.
  const locked = useLock().locked;
  const summarize = k === "link" && main && !locked && (
    <button className="btn kk assistant" onClick={() => { bridge.call("composer_submit", { text: SUMMARIZE_ASK, attachments: [{ kind: "clipboard_link" }] }).then(() => sendX({ t: "ask" })).catch(noop); }}><Sparkles />Summarize with {main.name}</button>
  );
  const openShelf = <><button className="btn kk gray" onClick={call("clip_open")}>Open</button><button className="btn kk gray" onClick={call("clip_to_shelf")}>Add to Shelf</button></>;
  return (
    <div className="peekBar shotOut">
      <div className="shotTop">
        {k === "image" ? thumb && <img className="snipSmall" src={thumb} alt={item.screenshot ? "Screenshot thumbnail" : "Image thumbnail"} /> : <span className="tip2 shotIcon"><Ic /></span>}
        <span className="t12 l2">{k === "image" ? "Copied to clipboard" : flat(item.text ?? item.sub, 40)}</span>
        {ask}
        {item.screenshot ? <button className="btn kk gray" onClick={call("clip_edit")}>Edit</button> : k !== "image" && pin}
      </div>
      {big && k === "image" && (
        <div className="shotLarge">
          {src && <img className="shotLargeImage" src={src} alt="Large preview" />}
          <div className="shotAction"><button className="btn kk gray" onClick={call("clip_copy")}><Copy />Copy</button>{pin}{openShelf}</div>
        </div>
      )}
      {k === "file" && <div className="shotAction">{openShelf}</div>}
      {summarize && <div className="shotAction">{summarize}</div>}
    </div>
  );
}

const WHY: Record<NonNullable<LockState["reason"]>, string> = {
  windows: "Unlocks automatically when you unlock Windows.", manual: "", plugin: "A plugin locked it.",
};
/** Peeka locked (mockup kl): display only. Clipboard, notification content and plugin cards are hidden; clock, pins and windows keep working. */
export function LockCard({ lock }: { lock: LockState }) {
  return (
    <div className="body">
      <div className="mkCenter">
        <span className="notchIcon" style={{ width: 56, height: 56 }}><PanelTop /></span>
        <div className="t15 b6">Peeka is locked</div>
        <div className="t13 l2 b4">Clipboard, notification content and plugin cards are hidden. The clock, pins and windows still work.</div>
        {lock.reason && WHY[lock.reason] && <div className="t12 l3 b4">{WHY[lock.reason]}</div>}
        {lock.reason !== "windows" && <button className="btn primary" data-autofocus onClick={() => bridge.call("lock_release").catch(noop)}><Fingerprint />Unlock</button>}
      </div>
    </div>
  );
}
export const LockCenter = () => <span className="ms"><Lock /><span className="b6">Peeka locked</span></span>;
