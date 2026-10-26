// Drift glow: one light field in screen coordinates, drawn as a slice by the strip window and the island window (glow.css).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { bridge } from "../bridge";
import { listenLine, type LineMod } from "../lib/lineChan";
import "../glow.css";

export type GlowState = "idle" | "busy" | "attention";
type Cols = readonly [string, string, string]; // left, right, centre (glow.css --c1, --c2, --c3)

/** Assistant line → glow state: an approval waits (attention), speaking / listening is busy, everything else idle. Both windows get the line, so both agree. */
export const glowOf = (mod: LineMod | undefined): GlowState => (mod === "wait" ? "attention" : mod === "speak" || mod === "listen" ? "busy" : "idle");

const HEX = /^#[0-9a-f]{6}$/i;
/** `screen_tint` colours from Rust (left, centre, right under the strip), or null when sampling is off. Anything that isn't three #rrggbb = null (→ --glow-color). */
export function tintOf(c: unknown): Cols | null {
  return Array.isArray(c) && c.length === 3 && c.every((x) => typeof x === "string" && HEX.test(x)) ? [c[0], c[2], c[1]] : null;
}

const LAYERS = ["sL", "sR", "p3", "p1", "p2"];
interface Copy { cols: Cols | null; state: GlowState }
const same = (a: Copy, b: Copy) => a.state === b.state && a.cols?.join() === b.cols?.join();

/** Every window takes the phase from the wall clock, so separate windows show the same frame without talking to each other. */
function phase(el: HTMLElement | null) {
  if (!el) return;
  const speed = parseFloat(getComputedStyle(el).getPropertyValue("--glow-speed")) || 1;
  for (const a of el.getAnimations?.({ subtree: true }) ?? []) { a.playbackRate = speed; a.currentTime = Date.now() * speed; }
}

/** One slice of the field. Mount it inside a `.glowHost` (strip, island body) or a shoulder's `.glowSlice`. It paints only inside its host: nothing lands in the band under the strip that Rust samples (y >= 38 outside the card). */
export function GlowField({ monitor }: { monitor: string }) {
  const [state, setState] = useState<GlowState>("idle");
  const [tint, setTint] = useState<Cols | null>(null);
  useEffect(() => listenLine((m) => { if (m.k === "line") setState(glowOf(m.mod)); }), []);
  // only this display's band; while sampling is paused nothing arrives and the last colours stay
  useEffect(() => { const off = bridge.on("screen_tint", (t) => { if (t.monitor === monitor) setTint(tintOf(t.colors)); }); return () => { off.then((f) => f()); }; }, [monitor]);
  // a new colour or speed goes into the hidden copy, then the copies cross-fade (never animates a colour, never jumps the phase in view)
  const [cp, setCp] = useState<{ a: Copy; b: Copy; on: "a" | "b" }>(() => ({ a: { cols: null, state: "idle" }, b: { cols: null, state: "idle" }, on: "a" }));
  const key = `${state}|${tint?.join() ?? ""}`;
  useEffect(() => {
    const want: Copy = { cols: tint, state };
    setCp((s) => (same(s[s.on], want) ? s : s.on === "a" ? { ...s, b: want, on: "b" } : { ...s, a: want, on: "a" }));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const ra = useRef<HTMLDivElement>(null), rb = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => phase(ra.current), [cp.a]);
  useLayoutEffect(() => phase(rb.current), [cp.b]);
  return (
    <div className="glowField" data-glow-state={state} aria-hidden="true">
      {(["a", "b"] as const).map((k) => {
        const c = cp[k].cols;
        return (
          <div key={k} ref={k === "a" ? ra : rb} className="glowCopy" data-glow-state={cp[k].state} style={{ opacity: cp.on === k ? 1 : 0, ...(c ? { "--c1": c[0], "--c2": c[1], "--c3": c[2] } : null) } as CSSProperties}>
            {LAYERS.map((l) => <i key={l} className={l} />)}
          </div>
        );
      })}
    </div>
  );
}
