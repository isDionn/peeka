import { PanelTop } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState, type DragEvent, type ReactNode, type Ref } from "react";
import { Ghost } from "./ghost";
import { DAZE_SIZE, HANG, sizePlan, type Mood } from "./moods";
import { LOVE_MOODS, REACT, createClickCounter, createReactionGate } from "./motion";
import { FADE_MS } from "./react";
import { useSingleMascot } from "./useSingleMascot";
import "./mascot.css";

/** Clickable body rectangle (client coordinates, CSS px). */
export interface HitRect { x: number; y: number; width: number; height: number }

export interface MascotHandle {
  hop(): void; prank(): void;
  /** Touch reactions: slap (~600 ms, then the previous look) and love (hearts). */
  slap(): void; love(): void;
  /** File swallow: sy 0.78 -> 1.18 -> 1 (80/130/220 ms), mouth open. */
  swallow(): void;
  /** Eyes turn toward a client point for `ms` (a new notification), then back. */
  glance(x: number, y: number, ms: number): void;
  /** In the hanging pose (size=40) the body's clickable rectangle; at other sizes the whole box. null while invisible. */
  hitRect(): HitRect | null;
  /** Is the draw loop running (false when still). */
  running(): boolean;
}

export interface MascotProps {
  /** Box width (px): 24 strip (silhouette, no blush), 40 hanging pose overflowing the strip (box 40x30, body hangs ~12 px; parents mustn't clip the overflow),
   *  56 card, 96 big card (idle/sleep/first run); 28 and 22 are legacy sizes, 27 and below silhouette. Height 4/3 (30 at 40). */
  size: number;
  mood: Mood;
  /** ADR-0062 §2: the face belongs to the main assistant only. Otherwise Peeka's neutral icon (or `fallback`) is drawn. */
  isMainAssistant: boolean;
  /** Click: a small hop (a daze at 96 px), then this is called (opening a card). */
  onPoke?: () => void;
  /** Cursor in this window's client coordinates (CSS px). `null` = no cursor (looks at the center). If omitted, the window's pointermove is used. */
  cursor?: { x: number; y: number } | null;
  /** One-mascot-on-screen rule (§0i item 23): on by default; priority = size, the larger wins. */
  single?: boolean;
  /** Fades out (same cross-fade as losing the one-mascot slot): another surface shows the mascot, e.g. a strip panel in another window. */
  hide?: boolean;
  /** Still frame (screenshots, static spots): no spring, blink or float. */
  still?: boolean;
  /** When a file is dropped on the mascot: it swallows it, then this is called. */
  onFileDrop?: (files: File[]) => void;
  /** Keyboard hint slot beside the badge (e.g. `<kbd>Y</kbd>`); shown only at ≥56 px in the approval mood, the caller draws its content. */
  badgeHint?: ReactNode;
  fallback?: ReactNode;
  className?: string;
  ref?: Ref<MascotHandle>;
}

export function Mascot(props: MascotProps) {
  if (!props.isMainAssistant) {
    return <>{props.fallback ?? <span className="mascot-neutral" style={{ width: props.size, height: props.size }} aria-hidden="true"><PanelTop size={Math.round(props.size * .8)} strokeWidth={1.5} /></span>}</>;
  }
  return <MainMascot {...props} />;
}

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

function MainMascot({ size, mood, onPoke, cursor, single = true, still = false, hide = false, onFileDrop, badgeHint, className, ref }: MascotProps) {
  const owner = useSingleMascot(size, single && !hide);
  const want = (!single || owner) && !hide;
  // one-mascot cross-fade: a ghost that loses its slot stays FADE_MS while fading out (clicks pass through), the new one fades in on mount (mascot.css)
  const [visible, setVisible] = useState(want);
  if (want && !visible) setVisible(true);
  useEffect(() => { if (want || !visible) return; const t = setTimeout(() => setVisible(false), FADE_MS); return () => clearTimeout(t); }, [want, visible]);
  const wantRef = useRef(want); wantRef.current = want;
  const host = useRef<HTMLDivElement>(null);
  const hit = useRef<HTMLDivElement>(null);
  const ghost = useRef<Ghost | null>(null);
  // a slap flood (5 clicks in 3 s) gives a temporary "dizzy" mood; when it ends the real mood returns
  const [forced, setForced] = useState<Mood | null>(null);
  const shown = forced ?? mood;
  const moodRef = useRef(shown); moodRef.current = shown;
  const clicks = useRef(createClickCounter());
  const gate = useRef(createReactionGate());
  const loveT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dizzyT = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => { clearTimeout(loveT.current); clearTimeout(dizzyT.current); }, []);
  const plan = sizePlan(size);

  useEffect(() => {
    if (!visible || !host.current) return;
    const g = new Ghost(host.current, { size, mood: moodRef.current, still });
    ghost.current = g;
    return () => { g.destroy(); ghost.current = null; };
  }, [visible, size, still]);

  useEffect(() => { ghost.current?.setMood(shown); }, [shown]);

  useImperativeHandle(ref, () => ({
    hop: () => ghost.current?.hop(), slap: () => ghost.current?.slap(), love: () => ghost.current?.love(), prank: () => ghost.current?.prank(), swallow: () => ghost.current?.swallow(),
    glance: (x, y, ms) => ghost.current?.glance(x, y, ms),
    running: () => !!ghost.current?.running,
    hitRect: () => {
      if (!wantRef.current) return null;   // fading out: takes no clicks
      const r = (hit.current ?? host.current)?.getBoundingClientRect();
      return r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
    },
  }), []);

  // Eye tracking: from `cursor` if given (Rust feed), otherwise from the window's pointermove (preview). Ghost ignores it below 28 px.
  const fed = cursor !== undefined;
  useEffect(() => {
    if (!visible || !plan.eyeTracking) return;
    if (fed) { ghost.current?.lookAt(cursor ? cursor.x : null, cursor ? cursor.y : 0); return; }
    const move = (e: PointerEvent) => ghost.current?.lookAt(e.clientX, e.clientY);
    addEventListener("pointermove", move);
    return () => removeEventListener("pointermove", move);
  }, [visible, size, fed, cursor?.x, cursor?.y]);

  // no blinking if the keyboard was used in the last 3 s
  useEffect(() => {
    const key = () => { if (ghost.current) ghost.current.lastInput = performance.now(); };
    addEventListener("keydown", key, true);
    return () => removeEventListener("keydown", key, true);
  }, []);

  if (!visible) return null;
  const poke = () => {
    // 96 px (idle/sleep card): 1 click squash + 800 ms daze, 3 clicks in 1.7 s 3.3 s. Other sizes slap (rate limited; the real action still runs).
    clearTimeout(loveT.current);
    if (size === DAZE_SIZE) ghost.current?.daze(clicks.current());
    else {
      const r = gate.current.tap();
      if (r === "slap") ghost.current?.slap();
      else if (r === "dizzy") { setForced("dizzy"); clearTimeout(dizzyT.current); dizzyT.current = setTimeout(() => setForced(null), REACT.dizzyMs); }
    }
    onPoke?.();
  };
  // Love after hovering 1.9 s (calm moods only, at most once every 8 s)
  const hover = {
    onPointerEnter: () => { clearTimeout(loveT.current); loveT.current = setTimeout(() => { if (LOVE_MOODS.has(moodRef.current) && gate.current.love()) ghost.current?.love(); }, REACT.loveHoverMs); },
    onPointerLeave: () => clearTimeout(loveT.current),
  };
  const handlers = {
    onPointerDown: poke, ...hover,
    ...(onFileDrop ? {
      onDragOver: (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); },
      onDrop: (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); ghost.current?.swallow(); onFileDrop(Array.from(e.dataTransfer.files)); },
    } : {}),
  };
  const hang = plan.hang;
  return (
    <div
      ref={host} className={`mascot${want ? "" : " out"}${className ? ` ${className}` : ""}`} aria-hidden="true"
      data-mood={shown} data-size={size} data-hang={hang ? "1" : undefined}
      style={{ width: size, height: hang ? HANG.box.h : (size * 4) / 3 }}
      {...(hang ? {} : handlers)}
    >
      {hang && <div ref={hit} className="mascot-hit" style={{ left: HANG.hit.x, top: HANG.hit.y, width: HANG.hit.w, height: HANG.hit.h }} {...handlers} />}
      {plan.badge && mood === "approval" && badgeHint != null && <span className="mascot-hint">{badgeHint}</span>}
    </div>
  );
}
