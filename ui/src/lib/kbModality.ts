// When a card opens focus goes to the first control; the ring shows only when the keyboard is in use (not on a card opened by mouse).
// html[data-kb] turns on with the keyboard and off on mouse press; notch.css ties its `:focus-visible` ring to it.
let on = false;
export function installKbModality() {
  if (on || typeof document === "undefined") return;
  on = true;
  const root = document.documentElement;
  addEventListener("keydown", (e) => { if (!["Shift", "Control", "Alt", "Meta"].includes(e.key)) root.setAttribute("data-kb", ""); }, true);
  addEventListener("pointerdown", () => root.removeAttribute("data-kb"), true);
}
