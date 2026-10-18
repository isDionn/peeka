import { useCallback, useEffect, useRef, useState } from "react";

/** Press-and-hold confirm (Shut down, Restart): `onDone` if held for `ms`. Mouse, touch and keyboard (Enter/Space) take the same path. */
export function useHold(onDone: () => void, ms = 1200) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const done = useRef(onDone);
  done.current = onDone;
  const stop = useCallback(() => { clearTimeout(timer.current); timer.current = undefined; setHolding(false); }, []);
  const start = useCallback(() => {
    if (timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => { timer.current = undefined; setHolding(false); done.current(); }, ms);
  }, [ms]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    holding,
    props: {
      onPointerDown: (e: React.PointerEvent) => { if (e.button === 0) start(); },
      onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop, onBlur: stop,
      onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); start(); } },
      onKeyUp: stop,
    },
  };
}
