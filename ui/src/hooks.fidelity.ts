// Sadakat 3 kancaları (hooks.ts'e dokunmadan): adanın geçici gizli durumu, kart yükleme gecikmesi, ek türleri, ilk bağlantı.
import { useEffect, useState } from "react";
import { bridge, type ComposerKind } from "./bridge";

/** Ada geçici gizli mi (Rust `island_hidden` + `island_hidden_changed`). Şerit orta kısmı ve ada sayfası bunu okur. */
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

/** Yükleme 800 ms'yi geçmezse iskelet hiç görünmez (maket ky). */
export function useDelayed(on: boolean, ms = 800): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!on) { setShown(false); return; }
    const t = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return on && shown;
}

/** Ek türleri: komut yoksa (Rust henüz bilmiyor) yalnız `window_image`. */
export function useComposerKinds(): ReadonlySet<ComposerKind> {
  const [k, setK] = useState<ReadonlySet<ComposerKind>>(new Set<ComposerKind>(["window_image"]));
  useEffect(() => { let live = true; bridge.call("composer_kinds").then((l) => { if (live) setK(new Set(l)); }).catch(() => undefined); return () => { live = false; }; }, []);
  return k;
}

/** asistan ilk bağlandı (ilk2), hayatta bir kez. İkinci dönen işlev söndürür. */
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

/** Dişli düğmesi: Ayarlar › Modüller. Shell: şerit sayfası bu mesajı dinleyip `aym` panelini açmalı (bkz. rapor). */
export function openModuleSettings() {
  try { const c = new BroadcastChannel("notch-xwin"); c.postMessage({ t: "open-panel", panel: "aym" }); c.close(); } catch { /* kanal yok */ }
}
