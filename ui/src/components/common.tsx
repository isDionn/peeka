import { X } from "lucide-react";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useFocusTrap } from "../lib/useFocusTrap";
import { useGuard } from "../lib/useGuard";
import { GUARD_MS } from "../lib/plugin";
import { useHold } from "../lib/useHold";
import { useSpring } from "../motion/useSpring";
import { SPRINGS } from "../motion/spring";
import { useLayoutEffect, useState } from "react";

/** Icons from Rust may only be PNG/SVG data URLs (they go inside CSS url("...")). */
export const SAFE_ICON = /^data:image\/(png|svg\+xml)[;,]/;

/** Monochrome app icon: the data URL is used as an alpha mask painted in the text color (§0i item 7). */
export function AppIcon({ src, color, size }: { src: string; /** Color icon (data URL), drawn instead of the mask whenever given: Rust sends it while Settings › Appearance › Color app icons is on, or when the mask would be a blank shape. */ color?: string | null; size?: number }) {
  const style = { WebkitMaskImage: `url("${src}")`, maskImage: `url("${src}")`, ...(color && /^data:image\/(png|svg\+xml)[;,]/.test(color) ? { "--icon-color": `url("${color}")` } : null), ...(size ? { width: size, height: size } : null) } as CSSProperties;
  return <span className="appIcon mono" style={style} aria-hidden="true" />;
}

export function WinLogo() {
  return (
    <svg className="winlogo" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <rect x="0" y="0" width="6.6" height="6.6" rx=".6" /><rect x="7.4" y="0" width="6.6" height="6.6" rx=".6" />
      <rect x="0" y="7.4" width="6.6" height="6.6" rx=".6" /><rect x="7.4" y="7.4" width="6.6" height="6.6" rx=".6" />
    </svg>
  );
}

export function Kbd({ keys }: { keys: string }) {
  return <span className="key-hint">{keys.split("+").map((k) => <kbd key={k}>{k}</kbd>)}</span>;
}

/** In a radio group the arrow keys move the selection (F-17); only the selected button is a Tab stop. */
export function radioKeys(e: React.KeyboardEvent<HTMLElement>) {
  if (!/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
  const rs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
  const i = rs.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  const next = rs[(i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + rs.length) % rs.length];
  next.focus(); next.click();
}

export function Switch({ on, label, onChange, describedBy, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; describedBy?: string; /** The row stays in place, the switch is dimmed and can't be pressed (the row's subtitle says why). */ disabled?: boolean }) {
  return (
    <span className={"toggle" + (on ? " on" : "")} role="switch" aria-checked={on} aria-disabled={disabled || undefined} aria-label={label} aria-describedby={describedBy} tabIndex={disabled ? -1 : 0}
      onClick={() => { if (!disabled) onChange(!on); }} onKeyDown={(e) => { if (!disabled && (e.key === " " || e.key === "Enter")) { e.preventDefault(); onChange(!on); } }} />
  );
}

/** Press-and-hold button (Shut down, Restart): 1.2 s linear fill, drains back in 200 ms on release. */
export function HoldButton({ label, icon, danger, onDone, className, guarded, autoFocus, big, aria }: { label: string; /** Screen reader name (the full name when the visible label is short): defaults to `label`. */ aria?: string; icon: ReactNode; danger?: boolean; onDone: () => void; className?: string; guarded?: boolean; autoFocus?: boolean; big?: boolean }) {
  const { holding, props } = useHold(onDone);
  const guard = useGuard(guarded ? GUARD_MS : 0); // in plugin consent, presses in the first 300 ms don't count
  return (
    <button className={"btn glass hold" + (big ? "" : " kk") + (danger ? " destructive" : "") + (className ? " " + className : "") + (holding ? " filled2" : "")} aria-label={`${aria ?? label}: press and hold`} data-autofocus={autoFocus ? "" : undefined} ref={guarded ? guard.ref : undefined}
      {...props} onPointerDown={guard(props.onPointerDown)} onKeyDown={guard(props.onKeyDown)}>
      {icon}{label}<span className="holdHint">hold</span>
    </button>
  );
}

/**
 * Panel hanging below the strip: height is a real spring, corner and liquid shoulder use the mockup formulas (§0i items 2, 8).
 * When closed it springs shut, then unmounts its content. While `open`, focus cycles inside the card, Esc closes and focus returns to the opener.
 */
/** After a delete/remove the list shifts, so a double-click mustn't land on the next destructive button under the pointer: a second delete within 500 ms is ignored (O5). */
let lastDel = 0;
export function delOk(): boolean { const t = performance.now(); if (t - lastDel < 500) return false; lastDel = t; return true; }

/** Room the panel shadow (0 28px 72px) and the liquid shoulder need in the window region, CSS px. */
const PANEL_SHADOW_SIDE = 72, PANEL_SHADOW_BOTTOM = 110;

/** Panel's max height: visible height - strip - gap (O6). */
export const panelMaxH = (vh: number) => Math.max(160, vh - 30 - 16);

export function Panel({ side, width, label, open, onClose, dataKind, children, offset, amb, ownHint }: {
  side: "left" | "right" | "center"; width: number; label: string; open: boolean; onClose: () => void; dataKind: string; children: ReactNode;
  /** Distance from the edge (px, default 8): the tray panel sits under the arrow at this distance. */ offset?: number;
  /** Ambient color (a soft glow behind the card; mockup mt amber). */ amb?: string;
  /** No corner close button when the content shows its own "Esc" hint. */ ownHint?: boolean; /* small popovers like the tray use this too: Esc and clicking outside close it, a corner button would cover the icons */
}) {
  const [vh, setVh] = useState(() => window.innerHeight);
  useEffect(() => { const f = () => setVh(window.innerHeight); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []);
  const inner = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState(0);
  const mounted = useRef(false);
  const h = useSpring(open ? content : 0, side === "center" ? SPRINGS.card : SPRINGS.side);
  if (open) mounted.current = true; else if (h < 0.4) mounted.current = false;
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContent(el.offsetHeight));
    ro.observe(el);
    setContent(el.offsetHeight);
    return () => ro.disconnect();
  }, [mounted.current]);
  useFocusTrap(root, onClose, open && content > 0);

  const H = Math.max(0, h);
  const r = side === "center" ? Math.min(H * 0.6, 34, 15 + Math.max(0, H - 40) * 0.3) : Math.min(H * 0.6, 28, 15 + H * 0.1);
  const f = Math.min(16, 8 + H * 0.12, H * 0.8);
  const pos: CSSProperties = side === "left" ? { left: offset ?? 8 } : side === "right" ? { right: offset ?? 8 } : { left: "50%", transform: "translateX(-50%)" };
  const style = {
    ...pos, width, height: H, visibility: open || H >= 0.4 ? "visible" : "hidden", opacity: H < 0.4 ? 0 : 1, // stays visible while open: a hidden element can't take focus
    "--r": r + "px", "--f": f + "px", "--vis": Math.min(1, H / 80), "--cardMix": Math.max(0, 1 - H / 70),
    ...(amb ? { "--amb1": amb, "--amb2": amb, "--ambO": 0.7 } : null),
  } as CSSProperties;
  return (
    <div ref={root} className={"dangling panel-" + side} style={style} role="dialog" aria-label={label} aria-hidden={!open} data-panel={dataKind}>
      {/* window region: on open, jump straight to target height + shadow room; on close, hold until the spring ends (so the real window doesn't clip) */}
      <div data-hit aria-hidden style={{ position: "absolute", top: 0, left: -PANEL_SHADOW_SIDE, width: width + 2 * PANEL_SHADOW_SIDE, height: content + PANEL_SHADOW_BOTTOM, pointerEvents: "none" }} />
      <div className="cut">
        {amb && <div className="amb" />}
        {open && !ownHint && <button className="panelClose mini" title="Close (Esc)" aria-label="Close panel" onClick={onClose}><X /></button>}
        {(open || mounted.current) && (
          <div ref={inner} className={"inner " + (side === "right" ? "onRight" : side === "left" ? "onLeft" : "middle")} style={{ width, maxHeight: panelMaxH(vh), overflowY: "auto" }}>
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

export const NO_INDENT = { "--indent": "0" } as CSSProperties;
/** Settings row: title, optional subtitle, control on the right. */
export function Row({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="row">
      <div style={{ flex: 1 }}><div>{title}</div>{sub && <div className="t12 l3 b4">{sub}</div>}</div>
      {children}
    </div>
  );
}
