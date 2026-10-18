/** Turns pressed keys into "Ctrl+Shift+K"; a lone modifier or a key without a modifier is invalid (null). */
export function formatCombo(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">): string | null {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
  if (!(e.ctrlKey || e.altKey || e.metaKey)) return null; // a shortcut without Ctrl/Alt/Win would break typing
  const key = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Win", key].filter(Boolean).join("+");
}
