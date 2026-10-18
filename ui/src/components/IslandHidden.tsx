// Hide the island for now (mockup gz): no island, just a small eye icon in the middle of the strip; clicking it brings the island back.
// While `useIslandHidden()` is true the strip/island page skips the island and puts `<IslandHiddenGlyph />` in the middle (approvals and the security peek still open).
import { EyeOff } from "lucide-react";
import { bridge } from "../bridge";
import { useSettings } from "../hooks";
import "../fidelity-settings.css";

export function IslandHiddenGlyph() {
  const keys = useSettings()?.shortcuts.hide_island ?? "Ctrl+Shift+A";
  return (
    <button className="key hiddenIsland" title={`Island hidden. Press ${keys} to show it`} aria-label={`Island hidden. Show it (${keys})`} onClick={() => bridge.call("island_hide", { on: false }).catch(() => undefined)}>
      <EyeOff />
    </button>
  );
}
