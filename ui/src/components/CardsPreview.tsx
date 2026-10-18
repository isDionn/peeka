// Önizleme kabı (yalnız tarayıcı önizlemesi ve ekran görüntüsü): Island.tsx'e bağlanmamış kartlar için şerit ortası + `.sarkan` kartını
// Island ile aynı biçim formülleriyle (köşe, omuz, kenar) durağan çizer. Üretimde bunları Island çizer (bağlama satırları rapordadır).
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Clipboard } from "lucide-react";
import { EmptyBoard, ErrorCard, ErrorCenter, FirstConnectCard, FirstConnectCenter, LoadingCard, LoadingCenter } from "./CardsExtra";

export type CardsId = "ilk2" | "ky" | "kh" | "kb";
interface Spec { center: ReactNode; kw?: number; card?: ReactNode }
const SPECS: Record<CardsId, Spec> = {
  ilk2: { center: <FirstConnectCenter />, kw: 520, card: <FirstConnectCard onDone={() => undefined} /> },
  ky: { center: <LoadingCenter title="Pano" />, kw: 620, card: <LoadingCard what="Pano okunuyor" /> },
  kh: { center: <ErrorCenter />, kw: 520, card: <ErrorCard title="Claude Code'a ulaşamıyorum" detail="Hook köprüsü yanıt vermiyor (zaman aşımı)." onRetry={() => undefined} /> },
  kb: { center: <LoadingCenter title="Pano" icon={<Clipboard />} />, kw: 620, card: <div className="govde"><EmptyBoard /></div> },
};
export const CARDS_IDS = Object.keys(SPECS) as CardsId[];

export function CardsPreview({ id }: { id: CardsId }) {
  const spec = SPECS[id];
  const mk = useRef<HTMLSpanElement>(null), body = useRef<HTMLDivElement>(null);
  const [m, setM] = useState({ cw: 200, h: 0 });
  useLayoutEffect(() => {
    const read = () => setM({ cw: mk.current?.offsetWidth ?? 200, h: body.current?.offsetHeight ?? 0 });
    const ro = new ResizeObserver(read);
    if (mk.current) ro.observe(mk.current);
    if (body.current) ro.observe(body.current);
    read();
    return () => ro.disconnect();
  }, []);
  const H = m.h, r = Math.min(H * 0.6, 34, 15 + Math.max(0, H - 40) * 0.3), f = Math.min(16, 8 + H * 0.12, H * 0.8);
  const shape = { left: "50%", transform: "translateX(-50%)", width: spec.kw, height: H, visibility: spec.card ? "visible" : "hidden", "--r": r + "px", "--f": f + "px", "--go": Math.min(1, H / 80), "--kt": Math.max(0, 1 - H / 70), "--ambO": 0 } as unknown as CSSProperties;
  return (
    <>
      <div style={{ position: "absolute", left: "50%", top: 0, width: 520, height: 30, marginLeft: -260, background: "var(--strip)", zIndex: 5 }} aria-hidden="true" />
      <div className="adaStage">
        <button className="adaMerkez" data-hit style={{ width: m.cw + 24, transform: "translateX(-50%)" }} tabIndex={-1}><span className="adaMk" ref={mk}>{spec.center}</span></button>
        {spec.card && (
          <div id="ada" className="sarkan" style={shape}>
            <div className="kes"><div className="amb" /><div className="adaIc mkart" ref={body} style={{ width: spec.kw }}>{spec.card}</div></div>
          </div>
        )}
      </div>
    </>
  );
}
