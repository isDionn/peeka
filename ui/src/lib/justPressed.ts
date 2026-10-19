// In the real window Peeka hands focus back to the previous app right after a click (ADR-0062 §1, notch-win
// style.rs `strip_no_activate`); that blur isn't leaving. Alt+Tab / Win+L arrive without a click: those count.
let lastUp = 0, lastDown = 0;
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", () => { lastDown = Date.now(); }, true);
  document.addEventListener("pointerup", () => { lastUp = Date.now(); }, true);
}

/** If the last click is this recent, a window blur is the focus hand-back (hand-back takes ≤ ~400 ms). A press still held
 * counts too: leaving the Start search box hands focus back on pointerdown, before the click (2 s cap: a lost pointerup). */
export const justPressed = () => Date.now() - lastUp < 700 || (lastDown > lastUp && Date.now() - lastDown < 2000);

/** Text entry field: while focus is here the strip window keeps focus (the Start search box, Settings fields). */
export const isTextEntry = (t: EventTarget | null) =>
  t instanceof HTMLElement && t.matches('textarea, [contenteditable="true"], input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit])');
