import { useEffect, useRef } from "react";
import { bridge } from "../bridge";

/* The music bars follow the speaker's level (Rust `audio_level`); with no level (fake bridge stopped, paused, locked,
   presenting, an error) they keep the calm CSS loop (`.seen i` in notch.css). Only `transform: scaleY` changes. */

type Level = [number, number];

/** Auto gain: the loudest recent peak, halving in about 4.5 s at 30 levels a second. Dividing by it makes quiet and loud
    songs (and any volume) use the bars' whole height; the 0.02 floor keeps near-silence from being blown up. */
export const hold = (prev: number, l: Level) => Math.max(l[0], l[1], prev * 0.995, 0.02);

/** One step of an attack/release follower: rises with `attackMs`, falls with `releaseMs` (time constants). */
export const follow = (cur: number, target: number, dtMs: number, attackMs: number, releaseMs: number) =>
  cur + (target - cur) * (1 - Math.exp(-dtMs / (target > cur ? attackMs : releaseMs)));

// Per bar: channel, gain, wobble speed, attack, release. Different numbers fake four bands from two peaks.
const BAND = [
  { ch: 0, gain: 0.8, wob: 5.1, attack: 35, release: 160 },
  { ch: 1, gain: 1, wob: 3.7, attack: 45, release: 200 },
  { ch: 0, gain: 0.92, wob: 6.3, attack: 40, release: 180 },
  { ch: 1, gain: 0.72, wob: 4.4, attack: 50, release: 220 },
];
const MIN = 0.3; // the CSS loop's low point, so switching between the two does not jump
const STALE = 400; // ms without a level: back to the CSS loop

const sinks = new Set<(l: Level) => void>();
let off: Promise<() => void> | null = null;

/** One `audio_level` listener and one start/stop for every Bars on the page. */
function subscribe(sink: (l: Level) => void) {
  sinks.add(sink);
  if (sinks.size === 1) {
    off = bridge.on("audio_level", (l) => sinks.forEach((f) => f(l)));
    bridge.call("audio_level_start").catch(() => undefined);
  }
  return () => {
    sinks.delete(sink);
    if (sinks.size > 0) return;
    bridge.call("audio_level_stop").catch(() => undefined);
    off?.then((f) => f());
    off = null;
  };
}

/** `still`: the island is hidden or under a fullscreen app: no level stream, no CSS loop (nothing to see). */
export function Bars({ still = false }: { still?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || still) return;
    const bars = [...root.children] as HTMLElement[];
    const cur = BAND.map(() => 0);
    let lvl: Level = [0, 0], top = 0.02, last = 0, prev = 0, raf = 0;
    const frame = (t: number) => {
      if (t - last > STALE) {
        raf = 0;
        root.classList.remove("live");
        bars.forEach((b) => (b.style.transform = ""));
        return;
      }
      const dt = Math.min(t - prev, 100);
      prev = t;
      BAND.forEach((b, i) => {
        const target = (lvl[b.ch] / top) * b.gain * (0.85 + 0.15 * Math.sin((t / 1000) * b.wob + i));
        cur[i] = follow(cur[i], target, dt, b.attack, b.release);
        bars[i].style.transform = `scaleY(${(MIN + (1 - MIN) * cur[i]).toFixed(3)})`;
      });
      raf = requestAnimationFrame(frame);
    };
    const unsub = subscribe((l) => {
      lvl = l;
      top = hold(top, l);
      last = performance.now();
      if (raf) return;
      prev = last;
      cur.fill(0);
      bars.forEach((b) => (b.style.transform = `scaleY(${MIN})`)); // before the loop stops, or one frame shows full height
      root.classList.add("live");
      raf = requestAnimationFrame(frame);
    });
    return () => { unsub(); cancelAnimationFrame(raf); root.classList.remove("live"); bars.forEach((b) => (b.style.transform = "")); };
  }, [still]);
  return <span ref={ref} className={"seen" + (still ? " still" : "")} aria-hidden="true"><i /><i /><i /><i /></span>;
}
