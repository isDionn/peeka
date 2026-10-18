// Fidelity 3 hooks (without touching hooks.ts): the island's temporary hidden state, card load delay, attachment kinds, first connection.
import { useEffect, useState } from "react";
import { bridge, type ComposerKind } from "./bridge";

/** Is the island temporarily hidden (Rust `island_hidden` + `island_hidden_changed`). The strip's middle and the island page read it. */
export function useIslandHidden(): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let live = true;
    bridge.call("island_hidden").then((h) => { if (live) setHidden(h); }).catch(() => undefined);
    const off = bridge.on("island_hidden_changed", setHidden);
    return () => { live = false; off.then((f) => f()); };
  }, []);
  return hidden;
}

/** If loading takes under 800 ms the skeleton never shows (mockup ky). */
export function useDelayed(on: boolean, ms = 800): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!on) { setShown(false); return; }
    const t = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return on && shown;
}

/** Attachment kinds: without the command (Rust doesn't know it yet) only `window_image`. */
export function useComposerKinds(): ReadonlySet<ComposerKind> {
  const [k, setK] = useState<ReadonlySet<ComposerKind>>(new Set<ComposerKind>(["window_image"]));
  useEffect(() => { let live = true; bridge.call("composer_kinds").then((l) => { if (live) setK(new Set(l)); }).catch(() => undefined); return () => { live = false; }; }, []);
  return k;
}

/** The assistant connected for the first time (ilk2), once ever. The second returned function clears it. */
export function useFirstConnect(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    bridge.call("first_connect_get").then((v) => { if (live) setOn(v); }).catch(() => undefined);
    const off = bridge.on("first_connect", () => setOn(true));
    return () => { live = false; off.then((f) => f()); };
  }, []);
  return [on, () => { setOn(false); bridge.call("first_connect_ack").catch(() => undefined); }];
}

