import { useEffect, useState, type ComponentType } from "react";
import { bridge, type SurfacesView } from "../bridge";
import { ext, type StripButtonProps } from "../ext";
import { onX, sendX } from "../lib/xwin";

/** Y1: the extension's strip button (first on the right); nothing without an extension. */
export function ExtStripKey({ surfaces }: { surfaces: SurfacesView }) {
  const B = ext()?.StripButton;
  return B ? <Key B={B} surfaces={surfaces} /> : null;
}

function Key({ B, surfaces }: { B: ComponentType<StripButtonProps>; surfaces: SurfacesView }) {
  const [open, setOpen] = useState(false); // the island owns the card and says when it is open
  useEffect(() => onX((m) => { if (m.t === "ext-open") setOpen(m.open); }), []);
  const onOpen = () => { bridge.call("focus_island").catch(() => undefined).finally(() => sendX({ t: "ext-go" })); };
  return <B surfaces={surfaces} open={open} onOpen={onOpen} />;
}
