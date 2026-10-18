// Adayı geçici gizle (maket gz): ada yok, şeridin ortasında yalnız küçük bir göz simgesi; tıklayınca ada geri gelir.
// Şerit/ada sayfası `useIslandHidden()` true iken adayı çizmez ve ortaya `<IslandHiddenGlyph />` koyar (onaylar ve güvenlik çıkıntısı yine açılır).
import { EyeOff } from "lucide-react";
import { bridge } from "../bridge";
import { useSettings } from "../hooks";
import "../fidelity-ayar.css";

export function IslandHiddenGlyph() {
  const keys = useSettings()?.shortcuts.hide_island ?? "Ctrl+Shift+A";
  return (
    <button className="tus gizliAda" title={`Ada gizli: ${keys} ile geri getir`} aria-label={`Ada gizli. Geri getir (${keys})`} onClick={() => bridge.call("island_hide", { on: false }).catch(() => undefined)}>
      <EyeOff />
    </button>
  );
}
