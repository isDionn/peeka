import { X } from "lucide-react";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useFocusTrap } from "../lib/useFocusTrap";
import { useGuard } from "../lib/useGuard";
import { GUARD_MS } from "../lib/plugin";
import { useHold } from "../lib/useHold";
import { useSpring } from "../motion/useSpring";
import { YAY } from "../motion/spring";
import { useLayoutEffect, useState } from "react";

/** Rust'ın verdiği simge yalnız PNG/SVG data URL olabilir (CSS url("...") içine girer). */
export const SAFE_ICON = /^data:image\/(png|svg\+xml)[;,]/;

/** Tek renk uygulama simgesi: data URL alfa maskesi olarak yazı rengiyle boyanır (§0i madde 7). */
export function AppIcon({ src, color, size }: { src: string; /** Renkli simge (data URL); yalnız Ayarlar › Görünüm › Renkli uygulama simgeleri açıkken (html[data-renkli]) kullanılır. */ color?: string | null; size?: number }) {
  const style = { WebkitMaskImage: `url("${src}")`, maskImage: `url("${src}")`, ...(color && /^data:image\/(png|svg\+xml)[;,]/.test(color) ? { "--ikon-renk": `url("${color}")` } : null), ...(size ? { width: size, height: size } : null) } as CSSProperties;
  return <span className="uygIk mono" style={style} aria-hidden="true" />;
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
  return <span className="tus-ipucu">{keys.split("+").map((k) => <kbd key={k}>{k}</kbd>)}</span>;
}

/** Radyo grubunda ok tuşları seçimi taşır (F-17); düğmelerde yalnız seçili olan Tab durağıdır. */
export function radioKeys(e: React.KeyboardEvent<HTMLElement>) {
  if (!/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
  const rs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
  const i = rs.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  const next = rs[(i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + rs.length) % rs.length];
  next.focus(); next.click();
}

export function Switch({ on, label, onChange, describedBy, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; describedBy?: string; /** Satır yerinde kalır, anahtar soluk ve basılmaz (satırın nedenini alt yazı söyler). */ disabled?: boolean }) {
  return (
    <span className={"anahtar" + (on ? " on" : "")} role="switch" aria-checked={on} aria-disabled={disabled || undefined} aria-label={label} aria-describedby={describedBy} tabIndex={disabled ? -1 : 0}
      onClick={() => { if (!disabled) onChange(!on); }} onKeyDown={(e) => { if (!disabled && (e.key === " " || e.key === "Enter")) { e.preventDefault(); onChange(!on); } }} />
  );
}

/** Basılı tutarak onaylanan düğme (Kapat, Yeniden başlat): 1,2 sn doğrusal dolgu, bırakınca 200 ms'de geri. */
export function HoldButton({ label, icon, danger, onDone, className, guarded, autoFocus, big, aria }: { label: string; /** Ekran okuyucu adı (görünen etiket kısaysa tam adı): varsayılan `label`. */ aria?: string; icon: ReactNode; danger?: boolean; onDone: () => void; className?: string; guarded?: boolean; autoFocus?: boolean; big?: boolean }) {
  const { holding, props } = useHold(onDone);
  const guard = useGuard(guarded ? GUARD_MS : 0); // eklenti onayında ilk 300 ms basış sayılmaz
  return (
    <button className={"btn cam tut" + (big ? "" : " kk") + (danger ? " yikici" : "") + (className ? " " + className : "") + (holding ? " dolu2" : "")} aria-label={`${aria ?? label}: basılı tut`} data-autofocus={autoFocus ? "" : undefined} ref={guarded ? guard.ref : undefined}
      {...props} onPointerDown={guard(props.onPointerDown)} onKeyDown={guard(props.onKeyDown)}>
      {icon}{label}<span className="tutIpucu">basılı tut</span>
    </button>
  );
}

/**
 * Şeridin altından sarkan panel: yükseklik gerçek yay, köşe ve sıvı omuz maketteki formüllerle (§0i madde 2, 8).
 * Kapalıyken yayla kapanır, sonra içeriği söker. `open` iken odak kartın içinde döner, Esc kapatır ve odak açan öğeye döner.
 */
/** Silme / kaldırma sonrası liste kayınca imlecin altına gelen sonraki yıkıcı düğmeye çifte tıklama düşmesin: 500 ms içindeki ikinci silme yok sayılır (O5). */
let lastDel = 0;
export function delOk(): boolean { const t = performance.now(); if (t - lastDel < 500) return false; lastDel = t; return true; }

/** Panel gölgesinin (0 28px 72px) ve sıvı omuzun pencere bölgesindeki payı, CSS px. */
const PANEL_GOLGE_YAN = 72, PANEL_GOLGE_ALT = 110;

/** Panelin alt sınırı: görünür yükseklik - şerit - boşluk (O6). */
export const panelMaxH = (vh: number) => Math.max(160, vh - 30 - 16);

export function Panel({ side, width, label, open, onClose, dataKind, children, offset, amb, ownHint }: {
  side: "left" | "right" | "center"; width: number; label: string; open: boolean; onClose: () => void; dataKind: string; children: ReactNode;
  /** Kenardan uzaklık (px, varsayılan 8): tepsi paneli okun altına bu uzaklıkla oturur. */ offset?: number;
  /** Ortam rengi (kartın arkasında hafif parıltı; maket mt amber). */ amb?: string;
  /** İçerik kendi "Esc" ipucunu gösteriyorsa köşe kapat düğmesi çizilmez. */ ownHint?: boolean; /* tepsi gibi küçük açılırlar da bunu kullanır: Esc ve dışarı tıklama kapatır, köşe düğmesi simgelere binerdi */
}) {
  const [vh, setVh] = useState(() => window.innerHeight);
  useEffect(() => { const f = () => setVh(window.innerHeight); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []);
  const inner = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState(0);
  const mounted = useRef(false);
  const h = useSpring(open ? content : 0, side === "center" ? YAY.kart : YAY.sag);
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
    ...pos, width, height: H, visibility: open || H >= 0.4 ? "visible" : "hidden", opacity: H < 0.4 ? 0 : 1, // açıkken görünür kalır: gizli öğeye odak verilemez
    "--r": r + "px", "--f": f + "px", "--go": Math.min(1, H / 80), "--kt": Math.max(0, 1 - H / 70),
    ...(amb ? { "--amb1": amb, "--amb2": amb, "--ambO": 0.7 } : null),
  } as CSSProperties;
  return (
    <div ref={root} className={"sarkan panel-" + side} style={style} role="dialog" aria-label={label} aria-hidden={!open} data-panel={dataKind}>
      {/* pencere bölgesi: açılırken hemen hedef boy + gölge payı, kapanırken yay bitene kadar (gerçek pencerede kırpılmasın) */}
      <div data-hit aria-hidden style={{ position: "absolute", top: 0, left: -PANEL_GOLGE_YAN, width: width + 2 * PANEL_GOLGE_YAN, height: content + PANEL_GOLGE_ALT, pointerEvents: "none" }} />
      <div className="kes">
        {amb && <div className="amb" />}
        {open && !ownHint && <button className="panelKapat mini" title="Kapat (Esc)" aria-label="Paneli kapat" onClick={onClose}><X /></button>}
        {(open || mounted.current) && (
          <div ref={inner} className={"ic " + (side === "right" ? "sagda" : side === "left" ? "solda" : "orta")} style={{ width, maxHeight: panelMaxH(vh), overflowY: "auto" }}>
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

export const NO_INDENT = { "--girinti": "0" } as CSSProperties;
/** Ayarlar satırı: başlık, isteğe bağlı alt yazı, sağda denetim. */
export function Row({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="sat">
      <div style={{ flex: 1 }}><div>{title}</div>{sub && <div className="t12 l3 b4">{sub}</div>}</div>
      {children}
    </div>
  );
}
