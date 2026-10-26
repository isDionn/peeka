import { useEffect, useRef, useState } from "react";
import { bridge, inTauri } from "../bridge";

/** The short windows' heights, CSS px (= notch_core::model::STRIP_IDLE_HEIGHT, ISLAND_IDLE_HEIGHT): a rect reaching lower still hangs below. */
export const STRIP_IDLE_HEIGHT = 64;
export const ISLAND_IDLE_HEIGHT = 80;

/** The invoke can answer before WebView2 has resized the page (panelMaxH and 100vh read the viewport): wait for the tall one, 250 ms at most. */
const tallViewport = (idle: number) => new Promise<void>((done) => {
  const ok = () => innerHeight > idle + 2;
  if (ok()) return done();
  const end = () => { clearTimeout(t); removeEventListener("resize", f); done(); };
  const f = () => { if (ok()) end(); };
  const t = setTimeout(end, 250);
  addEventListener("resize", f);
});

/**
 * A strip or the island window is short (`idle` CSS px) while nothing hangs below the bar, so its animations recomposite a small surface.
 * `want`: something is to open below; `hang`: something still paints below (a closing spring). Returns true once the window
 * is tall: render what hangs only then, so no first frame is cut. A browser page (`live` false) is full size from the start.
 */
export function useWindowTall(want: boolean, hang: boolean, idle: number, live = inTauri): boolean {
  const [tall, setTall] = useState(!live);
  const queue = useRef(Promise.resolve()); // a shrink and the next grow reach Rust in the order asked
  useEffect(() => {
    if (!live) return;
    const ask = (on: boolean) => (queue.current = queue.current.then(() => bridge.call("window_tall", { tall: on })).catch(() => undefined));
    // a failed grow still opens (fail open: a cut panel beats a dead button); a stray rect below the bar grows it too
    if ((want || hang) && !tall) ask(true).then(() => tallViewport(idle)).then(() => setTall(true));
    else if (!want && !hang && tall) { setTall(false); ask(false); }
  }, [want, hang, tall, idle, live]);
  return tall;
}
