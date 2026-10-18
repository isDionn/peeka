import { useEffect, useRef, useState } from "react";
import { advance, Spring, type SpringParams } from "./spring";

/** Hedefe yayla giden değer. Yarıda hedef değişince o anki değer ve hızdan devam eder (kesilebilir). */
export function useSpring(target: number, params: SpringParams, initial = target): number {
  const s = useRef<Spring>(null as unknown as Spring);
  if (!s.current) s.current = new Spring(initial, params);
  const [v, setV] = useState(initial);
  useEffect(() => {
    const sp = s.current;
    sp.t = target;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      advance(sp, (now - last) / 1000); last = now;
      setV(sp.x);
      if (!sp.settled) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}
