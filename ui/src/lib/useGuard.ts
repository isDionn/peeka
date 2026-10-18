import { useCallback, useRef } from "react";
import { GUARD_MS } from "./plugin";

/** An approval button appearing under the cursor waits at least this long since the last layout change (ADR-0062 §4.5, friction 2 / R2-Y2). */
export const SETTLE_MS = 600;
const POLL_MS = 1500; // position is polled for this long after the last layout change

// Last cursor position (within the document). Tracked from module load so the position before the button appears is known.
let ptr = { x: -1, y: -1 };
if (typeof document !== "undefined") {
  const set = (e: PointerEvent) => { ptr = { x: e.clientX, y: e.clientY }; };
  document.addEventListener("pointermove", set, { capture: true, passive: true });
  document.addEventListener("pointerdown", set, { capture: true, passive: true });
}
const inside = (r: DOMRect) => ptr.x >= r.left && ptr.x <= r.right && ptr.y >= r.top && ptr.y <= r.bottom;
const isPointer = (e: unknown) => { const ev = e as { type?: string; detail?: number } | undefined; return !!ev && (ev.type === "pointerdown" || ev.type === "mousedown" || (ev.type === "click" && (ev.detail ?? 0) > 0)); };

/**
 * Accidental click guard (ADR-0062 §4.5/4.6). `disabled` isn't used; while guarded the button is dimmed (`data-wait`).
 * - Time: clicks and keys within the first `ms` (300) after the component mounts are ignored.
 * - If `guard.ref` is attached to the button the guard tightens: each time the button moves (mount, spring, shift) `SETTLE_MS` (600) restarts,
 *   and if the button appeared under (or slid under) a resting cursor, mouse clicks don't pass until the cursor leaves the button and comes back.
 *   Whichever condition ends later wins. The keyboard depends on time only.
 */
export function useGuard(ms = GUARD_MS) {
  const s = useRef({ at: Date.now(), under: false, attached: false, check: null as (() => void) | null });
  const blocked = useCallback((pointer: boolean) => { s.current.check?.(); return Date.now() - s.current.at < (s.current.attached ? SETTLE_MS : ms) || (pointer && s.current.under); }, [ms]);
  const ref = useCallback((el: HTMLElement | null) => {
    const st = s.current;
    st.check = null;
    cleanup.get(st)?.();
    cleanup.delete(st);
    st.attached = !!el;
    if (!el) return;
    let rect = el.getBoundingClientRect(), raf = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => el.toggleAttribute("data-wait", Date.now() - st.at < SETTLE_MS || st.under);
    const moved = () => { const r = el.getBoundingClientRect(); if (Math.abs(r.left - rect.left) > 0.5 || Math.abs(r.top - rect.top) > 0.5 || Math.abs(r.width - rect.width) > 0.5 || Math.abs(r.height - rect.height) > 0.5) { rect = r; touch(); return true; } return false; };
    const poll = () => {
      cancelAnimationFrame(raf);
      const tick = () => { if (!moved() && Date.now() - st.at < POLL_MS) raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    };
    st.check = moved; // position is checked at click time too (even if frame polling missed it)
    const touch = () => { st.at = Date.now(); st.under = st.under || inside(rect); sync(); clearTimeout(timer); timer = setTimeout(sync, SETTLE_MS + 10); poll(); };
    const move = () => { if (st.under && !inside(el.getBoundingClientRect())) { st.under = false; sync(); } };
    document.addEventListener("pointermove", move, true);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(poll);
    ro?.observe(el.closest("#island") ?? el);
    touch();
    cleanup.set(st, () => { cancelAnimationFrame(raf); clearTimeout(timer); document.removeEventListener("pointermove", move, true); ro?.disconnect(); el.removeAttribute("data-wait"); });
  }, []);
  const guard = useCallback(<A extends unknown[]>(fn?: (...a: A) => void) => (...a: A) => { if (!blocked(isPointer(a[0]))) fn?.(...a); }, [blocked]);
  return Object.assign(guard, { ref });
}
const cleanup = new WeakMap<object, () => void>();
