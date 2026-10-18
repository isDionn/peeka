// Preview shell (browser preview and screenshots only): for cards not wired into Island.tsx it draws the strip center + the `.dangling` card
// statically, with the same shape formulas as Island (corner, shoulder, edge). In production Island draws these (wiring lines are in the report).
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Clipboard } from "lucide-react";
import { EmptyBoard, ErrorCard, ErrorCenter, FirstConnectCard, FirstConnectCenter, LoadingCard, LoadingCenter } from "./CardsExtra";

export type CardsId = "firstconnect" | "ky" | "kh" | "kb";
interface Spec { center: ReactNode; kw?: number; card?: ReactNode }
const SPECS: Record<CardsId, Spec> = {
  firstconnect: { center: <FirstConnectCenter />, kw: 520, card: <FirstConnectCard onDone={() => undefined} /> },
  ky: { center: <LoadingCenter title="Clipboard" />, kw: 620, card: <LoadingCard what="Reading clipboard" /> },
  kh: { center: <ErrorCenter />, kw: 520, card: <ErrorCard title="Can't reach Claude Code" detail="The hook bridge isn't responding (timed out)." onRetry={() => undefined} /> },
  kb: { center: <LoadingCenter title="Clipboard" icon={<Clipboard />} />, kw: 620, card: <div className="body"><EmptyBoard /></div> },
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
  const shape = { left: "50%", transform: "translateX(-50%)", width: spec.kw, height: H, visibility: spec.card ? "visible" : "hidden", "--r": r + "px", "--f": f + "px", "--vis": Math.min(1, H / 80), "--cardMix": Math.max(0, 1 - H / 70), "--ambO": 0 } as unknown as CSSProperties;
  return (
    <>
      <div style={{ position: "absolute", left: "50%", top: 0, width: 520, height: 30, marginLeft: -260, background: "var(--strip)", zIndex: 5 }} aria-hidden="true" />
      <div className="islandStage">
        <button className="islandCenter" data-hit style={{ width: m.cw + 24, transform: "translateX(-50%)" }} tabIndex={-1}><span className="islandMascot" ref={mk}>{spec.center}</span></button>
        {spec.card && (
          <div id="island" className="dangling" style={shape}>
            <div className="cut"><div className="amb" /><div className="islandInner mockCard" ref={body} style={{ width: spec.kw }}>{spec.card}</div></div>
          </div>
        )}
      </div>
    </>
  );
}
