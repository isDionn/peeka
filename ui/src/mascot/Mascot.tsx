import { PanelTop } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState, type DragEvent, type ReactNode, type Ref } from "react";
import { Ghost } from "./ghost";
import { DAZE_SIZE, HANG, sizePlan, type Mood } from "./moods";
import { LOVE_MOODS, REACT, createClickCounter, createReactionGate } from "./motion";
import { useSingleMascot } from "./useSingleMascot";
import "./mascot.css";

/** Tıklanabilir gövde dikdörtgeni (istemci koordinatı, CSS px). */
export interface HitRect { x: number; y: number; width: number; height: number }

export interface MascotHandle {
  hop(): void; prank(): void;
  /** Dokunma tepkileri: tokat (~600 ms, sonra önceki hal) ve sevgi (kalpler). */
  slap(): void; love(): void;
  /** Dosya yutma: sy 0,78 -> 1,18 -> 1 (80/130/220 ms), ağız açık. */
  swallow(): void;
  /** Asılı pozda (size=40) gövdenin tıklanabilir dikdörtgeni; başka boyda tüm kutu. Görünmezken null. */
  hitRect(): HitRect | null;
  /** Çizim döngüsü çalışıyor mu (hareketsizken false). */
  running(): boolean;
}

export interface MascotProps {
  /** Kutu genişliği (px): 24 şerit (siluet, allıksız), 40 şeritten taşan asılı poz (kutu 40x30, gövde ~12 px sarkar; üst öğe taşmayı kırpmamalı),
   *  56 kart, 96 büyük kart (boş/uyku/ilk açılış); 28 ve 22 eski boylar, 27 ve altı siluet. Yükseklik 4/3 (40'ta 30). */
  size: number;
  mood: Mood;
  /** ADR-0062 §2: yüz yalnız ana asistanın. Değilse Peeka'nın nötr simgesi (ya da `fallback`) çizilir. */
  isMainAssistant: boolean;
  /** Tıklama: küçük zıplama (96 px'te sersemleme), sonra bu çağrılır (kart açma). */
  onPoke?: () => void;
  /** İmleç, bu pencerenin istemci koordinatında (CSS px). `null` = imleç yok (merkeze bakar). Verilmezse pencere pointermove'u dinlenir. */
  cursor?: { x: number; y: number } | null;
  /** Ekranda tek maskot kuralı (§0i madde 23): varsayılan açık; öncelik = size, büyük olan kazanır. */
  single?: boolean;
  /** Durgun kare (ekran görüntüsü, hareketsiz yerler): yay, kırpma, süzülme yok. */
  still?: boolean;
  /** Dosya maskotun üstüne bırakılınca: maskot yutar (swallow) ve bu çağrılır. */
  onFileDrop?: (files: File[]) => void;
  /** Rozet yanındaki klavye ipucu yuvası (örn. `<kbd>Y</kbd>`); yalnız ≥56 px'te izin halinde görünür, içeriği çağıran çizer. */
  badgeHint?: ReactNode;
  fallback?: ReactNode;
  className?: string;
  ref?: Ref<MascotHandle>;
}

export function Mascot(props: MascotProps) {
  if (!props.isMainAssistant) {
    return <>{props.fallback ?? <span className="mascot-neutral" style={{ width: props.size, height: props.size }} aria-hidden="true"><PanelTop size={Math.round(props.size * .8)} strokeWidth={1.5} /></span>}</>;
  }
  return <MainMascot {...props} />;
}

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

function MainMascot({ size, mood, onPoke, cursor, single = true, still = false, onFileDrop, badgeHint, className, ref }: MascotProps) {
  const owner = useSingleMascot(size, single);
  const visible = !single || owner;
  const host = useRef<HTMLDivElement>(null);
  const hit = useRef<HTMLDivElement>(null);
  const ghost = useRef<Ghost | null>(null);
  // tokat seli (3 sn'de 5 tıklama) geçici "dizzy" hali verir; süresi dolunca asıl hale döner
  const [forced, setForced] = useState<Mood | null>(null);
  const shown = forced ?? mood;
  const moodRef = useRef(shown); moodRef.current = shown;
  const clicks = useRef(createClickCounter());
  const gate = useRef(createReactionGate());
  const loveT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dizzyT = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => { clearTimeout(loveT.current); clearTimeout(dizzyT.current); }, []);
  const plan = sizePlan(size);

  useEffect(() => {
    if (!visible || !host.current) return;
    const g = new Ghost(host.current, { size, mood: moodRef.current, still });
    ghost.current = g;
    return () => { g.destroy(); ghost.current = null; };
  }, [visible, size, still]);

  useEffect(() => { ghost.current?.setMood(shown); }, [shown]);

  useImperativeHandle(ref, () => ({
    hop: () => ghost.current?.hop(), slap: () => ghost.current?.slap(), love: () => ghost.current?.love(), prank: () => ghost.current?.prank(), swallow: () => ghost.current?.swallow(),
    running: () => !!ghost.current?.running,
    hitRect: () => {
      const r = (hit.current ?? host.current)?.getBoundingClientRect();
      return r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
    },
  }), []);

  // Göz takibi: cursor verilmişse ondan (Rust beslemesi), yoksa pencere pointermove'undan (önizleme). 28 px altında Ghost yok sayar.
  const fed = cursor !== undefined;
  useEffect(() => {
    if (!visible || !plan.eyeTracking) return;
    if (fed) { ghost.current?.lookAt(cursor ? cursor.x : null, cursor ? cursor.y : 0); return; }
    const move = (e: PointerEvent) => ghost.current?.lookAt(e.clientX, e.clientY);
    addEventListener("pointermove", move);
    return () => removeEventListener("pointermove", move);
  }, [visible, size, fed, cursor?.x, cursor?.y]);

  // son 3 sn'de klavye varsa kırpma yok
  useEffect(() => {
    const key = () => { if (ghost.current) ghost.current.lastInput = performance.now(); };
    addEventListener("keydown", key, true);
    return () => removeEventListener("keydown", key, true);
  }, []);

  if (!visible) return null;
  const poke = () => {
    // 96 px (boş/uyku kartı): 1 tıklama ezilme + 800 ms sersem, 1,7 sn'de 3 tıklama 3,3 sn. Diğer boylarda tokat (hız sınırlı; asıl eylem yine çalışır).
    clearTimeout(loveT.current);
    if (size === DAZE_SIZE) ghost.current?.daze(clicks.current());
    else {
      const r = gate.current.tap();
      if (r === "slap") ghost.current?.slap();
      else if (r === "dizzy") { setForced("dizzy"); clearTimeout(dizzyT.current); dizzyT.current = setTimeout(() => setForced(null), REACT.dizzyMs); }
    }
    onPoke?.();
  };
  // Üstünde 1,9 sn durunca sevgi (yalnız sakin hallerde, 8 sn'de en çok bir)
  const hover = {
    onPointerEnter: () => { clearTimeout(loveT.current); loveT.current = setTimeout(() => { if (LOVE_MOODS.has(moodRef.current) && gate.current.love()) ghost.current?.love(); }, REACT.loveHoverMs); },
    onPointerLeave: () => clearTimeout(loveT.current),
  };
  const handlers = {
    onPointerDown: poke, ...hover,
    ...(onFileDrop ? {
      onDragOver: (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); },
      onDrop: (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); ghost.current?.swallow(); onFileDrop(Array.from(e.dataTransfer.files)); },
    } : {}),
  };
  const hang = plan.hang;
  return (
    <div
      ref={host} className={`mascot${className ? ` ${className}` : ""}`} aria-hidden="true"
      data-mood={shown} data-size={size} data-hang={hang ? "1" : undefined}
      style={{ width: size, height: hang ? HANG.box.h : (size * 4) / 3 }}
      {...(hang ? {} : handlers)}
    >
      {hang && <div ref={hit} className="mascot-hit" style={{ left: HANG.hit.x, top: HANG.hit.y, width: HANG.hit.w, height: HANG.hit.h }} {...handlers} />}
      {plan.badge && mood === "approval" && badgeHint != null && <span className="mascot-ipucu">{badgeHint}</span>}
    </div>
  );
}
