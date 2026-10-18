// Kart açılınca odak ilk denetime gider; halka yalnız klavye kullanılıyorsa görünür (fareyle açılan kartta yok).
// html[data-kb] klavyede açılır, fare basınca kapanır; notch.css `:focus-visible` halkasını buna bağlar.
let on = false;
export function installKbModality() {
  if (on || typeof document === "undefined") return;
  on = true;
  const root = document.documentElement;
  addEventListener("keydown", (e) => { if (!["Shift", "Control", "Alt", "Meta"].includes(e.key)) root.setAttribute("data-kb", ""); }, true);
  addEventListener("pointerdown", () => root.removeAttribute("data-kb"), true);
}
