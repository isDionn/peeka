// Fidelity audit 2: cards and a line that were in the mockup but not in the UI. Island.tsx wires them up (wiring lines are in the report).
//   ilk2 -> FirstConnectCard + "assistant connected" strip label, ky -> LoadingCard, kh -> ErrorCard, kb -> EmptyBoard.
// (The assistant line and done celebration were done in Fidelity.tsx in audit 1.) Copy comes from the mockup; motion is always on.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Clipboard, TriangleAlert } from "lucide-react";
import { Mascot, type MascotHandle, type Mood } from "../mascot";
import { useDelayed } from "../hooks.fidelity";
import { plain, pluginName } from "../lib/plugin";
import { useMainAssistant } from "../hooks";
import { bridge, type RecapWeek } from "../bridge";
import { recapRows, shareImage, weekRange } from "../lib/recap";
import "./cards.css";

const Center = ({ children, narrow }: { children: ReactNode; narrow?: boolean }) => <div className="body"><div className={"mkCenter" + (narrow ? " narrow" : "")}>{children}</div></div>;

/**
 * Waving mascot (first run): there's no `hello` state in mascot/, so it uses the raised hand + happy face + sparkle state (`done`) and a hop.
 * Hops once on open, then only on click (inside Mascot).
 */
export function WaveMascot({ size = 96, mood = "done" }: { size?: number; mood?: Mood }) {
  const ref = useRef<MascotHandle>(null);
  useEffect(() => { const t = setTimeout(() => ref.current?.hop(), 300); return () => clearTimeout(t); }, []);
  return <Mascot ref={ref} size={size} mood={mood} isMainAssistant />;
}

/** `firstconnect`: the first time an assistant plugin connects, once ever. The strip shows "assistant connected" (`FirstConnectCenter`). */
export function FirstConnectCard({ onDone }: { onDone: () => void }) {
  const name = useAssistantName();
  return (
    <Center>
      <WaveMascot />
      <div className="t20 b6">{`Hi, I'm ${name}`}</div>
      <div className="t13 l2 b4">I live in the island up top. Press Ctrl+Space to ask me anything. Approvals and my work show up here.</div>
      <div className="buttons frBtn" style={{ marginTop: 2 }}>
        <button className="btn glass" onClick={onDone}>Skip</button>
        <button className="btn primary" data-autofocus onClick={onDone}>OK</button>
      </div>
    </Center>
  );
}
export const useAssistantName = () => { const main = useMainAssistant(); return main ? pluginName(main) : "Assistant"; };
export const FirstConnectCenter = () => <span className="ms"><span className="b6">{useAssistantName()} connected</span></span>;

/** `ky`: card loading. Never shows if it takes under 800 ms (`loading` + `useDelayed`); no count on the strip. */
export function LoadingCard({ what = "Reading clipboard", loading = true }: { what?: string; loading?: boolean }) {
  const show = useDelayed(loading, 800);
  if (!show) return null;
  return (
    <div className="body" role="status" aria-label={what}>
      <div className="mkHead"><Mascot size={56} mood="thinking" isMainAssistant /><span className="t13 l2 b4">{plain(what, 60)}</span></div>
      <div className="skeleton" /><div className="skeleton" style={{ width: "86%" }} /><div className="skeleton" style={{ width: "70%" }} />
    </div>
  );
}
export const LoadingCenter = ({ icon, title }: { icon?: ReactNode; title: string }) => <span className="ms">{icon ?? <Clipboard />}<span className="b6">{title}</span></span>;

/** `kh`: error card (520 px). Technical detail sits behind "Why?"; the same error doesn't react on the strip again within 10 min (the caller checks with `errorBudget`). */
export function ErrorCard({ title, hint = "Try again. If that doesn't help, restart the assistant.", detail, onRetry, retry = "Try again" }: { title: string; hint?: string; detail?: string; onRetry: () => void; retry?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Center narrow>
      <Mascot size={56} mood="error" isMainAssistant />
      <div className="t15 b6">{plain(title, 80)}</div>
      <div className="t13 l2 b4">{plain(hint, 160)}</div>
      <div className="buttons">
        <button className="btn primary" data-autofocus onClick={onRetry}>{retry}</button>
        {detail && <button className="btn glass" aria-expanded={open} onClick={() => setOpen(!open)}>Why?</button>}
      </div>
      {open && detail && <div className="code glass errorDetail" role="note">{plain(detail, 400)}</div>}{/* below the buttons: they stay put when it opens (R1-2) */}
    </Center>
  );
}
export const ErrorCenter = () => <span className="ms"><span className="ikK"><TriangleAlert /></span><span className="b6">Error</span></span>;

/** The same error doesn't react on the strip a second time within 10 min (mockup kh). `key` is the error type. */
export function makeErrorBudget(now: () => number = Date.now, windowMs = 600_000) {
  const seen = new Map<string, number>();
  return (key: string): boolean => { const t = now(), last = seen.get(key); if (last !== undefined && t - last < windowMs) return false; seen.set(key, t); return true; };
}

/** `kb`: empty Clipboard (and empty cards): dozing mascot at 96, glides in over the first 600 ms; the zzz text is text gray 3. */
export function EmptyBoard({ title = "Clipboard is empty", hint = "Things you copy show up here: text, images and files." }: { title?: string; hint?: string }) {
  return (
    <div className="mkCenter">
      <span className="faceIn"><Mascot size={96} mood="drowsy" isMainAssistant fallback={<span className="notchIcon" style={{ width: 56, height: 56 }}><Clipboard /></span>} /></span>
      <div className="t15 b6">{plain(title, 60)}</div>
      <div className="t13 l2 b4">{plain(hint, 160)}</div>
    </div>
  );
}

/**
 * F8 `recap`: last week's counts, offered on the first unlock of a new week. "Copy image" draws the 1080x1350 share
 * image from an offscreen, still mascot (`single={false}`: it never takes the one on-screen slot) and copies it as a PNG.
 * The button keeps its size while its label changes.
 */
export function RecapCard({ week, onDone }: { week: RecapWeek; onDone: () => void }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const shot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state !== "busy") return;
    let live = true;
    // two frames: the offscreen mascot is laid out and its parts have their sources
    requestAnimationFrame(() => requestAnimationFrame(async () => {
      const ghost = shot.current?.querySelector<HTMLElement>(".mascot");
      const png = ghost ? await shareImage(week, ghost).catch(() => null) : null;
      const ok = png ? await bridge.call("recap_copy_image", { png: Array.from(png) }).then(() => true, () => false) : false;
      if (live) setState(ok ? "done" : "error");
    }));
    return () => { live = false; };
  }, [state, week]);
  return (
    <div className="body" data-recap>
      <div className="mkHead"><Mascot size={56} mood="done" isMainAssistant /><div className="textCol"><div className="t15 b6">Your week</div><div className="t12 l3 num">{weekRange(week)}</div></div></div>
      <div className="recapRows">
        {recapRows(week).map((r) => <div key={r.label} className="row"><span className="text t13 l2">{r.label}</span><span className="t13 b6 num">{r.value}</span></div>)}
      </div>
      <div className="buttons" style={{ justifyContent: "flex-end" }}>
        <button className="btn glass recapCopy" disabled={state === "busy"} onClick={() => setState("busy")}>{state === "done" ? "Copied" : "Copy image"}</button>
        <button className="btn primary" data-autofocus onClick={onDone}>OK</button>
      </div>
      {state === "error" && <div className="alertRow t12" role="status"><TriangleAlert aria-hidden="true" />Couldn't copy the image. Try again.</div>}{/* below the buttons: they stay put */}
      {state === "busy" && <div ref={shot} aria-hidden="true" style={{ position: "fixed", left: -10_000, top: 0 }}><Mascot size={300} mood="done" still single={false} isMainAssistant /></div>}
    </div>
  );
}
export const RecapCenter = () => <span className="ms"><span className="b6">Your week</span></span>;
