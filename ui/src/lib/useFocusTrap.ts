import { useEffect, useRef } from "react";

const FOCUSABLE = 'a[href],button:not([disabled]):not([tabindex="-1"]),input:not([disabled]):not([tabindex="-1"]),select:not([disabled]),textarea:not([disabled]),[role="switch"],[tabindex]:not([tabindex="-1"])';

export const focusables = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => !e.hasAttribute("disabled") && e.getAttribute("aria-hidden") !== "true");

/** Card behavior: focus goes to the first control on open, Tab cycles inside the card, Esc closes and focus returns to the opener. If the opener is gone (a card opened from a peek) and the keyboard is in use, focus goes to `fallback` (F-08). */
export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, onClose: () => void, active = true, fallback?: () => HTMLElement | null) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const root = ref.current;
    if (!root || !active) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = root.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(root)[0];
    first?.focus({ preventScroll: true }); // a panel opens at its top even when the default button sits below the fold (consent: Deny)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close.current(); return; }
      if (e.key !== "Tab") return;
      const list = focusables(root);
      if (!list.length) { e.preventDefault(); return; }
      const i = list.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : i === list.length - 1 ? 0 : i + 1;
      e.preventDefault();
      list[next].focus();
    };
    root.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus();
      else if (fallback && document.documentElement.hasAttribute("data-kb") && (!document.activeElement || document.activeElement === document.body)) fallback()?.focus();
      else if (!document.activeElement || document.activeElement === document.body) document.querySelector<HTMLElement>(".islandCenter, header.bar button")?.focus(); // the opener is gone (peek, gear): don't let focus fall to body (F-08)
    };
  }, [ref, active]);
}
