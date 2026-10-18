/** Basılan tuşları "Ctrl+Shift+K" biçimine çevirir; yalnız değiştirici ya da değiştiricisiz harf geçersiz (null). */
export function formatCombo(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">): string | null {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
  if (!(e.ctrlKey || e.altKey || e.metaKey)) return null; // Ctrl/Alt/Win'siz kısayol yazı yazmayı bozar
  const key = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Win", key].filter(Boolean).join("+");
}
