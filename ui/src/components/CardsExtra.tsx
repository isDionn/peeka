// Sadakat denetimi 2: maketteki ama arayüzde olmayan kartlar ve çizgi. Island.tsx bunları bağlar (bağlama satırları rapordadır).
//   ilk2 -> FirstConnectCard + "asistan bağlandı" şerit etiketi, ky -> LoadingCard, kh -> ErrorCard, kb -> EmptyBoard.
// (asistan çizgisi ve bit kutlaması sadakat 1'de Fidelity.tsx'te yapıldı.) Metinler maketten; hareket her zaman açık.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Clipboard, TriangleAlert } from "lucide-react";
import { Mascot, type MascotHandle, type Mood } from "../mascot";
import { useDelayed } from "../hooks.fidelity";
import { plain, pluginName } from "../lib/plugin";
import { useMainAssistant } from "../hooks";
import "./cards.css";

const Orta = ({ children, narrow }: { children: ReactNode; narrow?: boolean }) => <div className="govde"><div className={"mkOrta" + (narrow ? " dar" : "")}>{children}</div></div>;

/**
 * El sallayan maskot (ilk açılış): `merhaba` hali mascot/ klasöründe yok; el kalkık + mutlu yüz + pırıltı hali (`done`) ve bir zıplama kullanılır.
 * Zıplama açılışta bir kez, sonra yalnız tıklayınca (Mascot kendi içinde).
 */
export function WaveMascot({ size = 96, mood = "done" }: { size?: number; mood?: Mood }) {
  const ref = useRef<MascotHandle>(null);
  useEffect(() => { const t = setTimeout(() => ref.current?.hop(), 300); return () => clearTimeout(t); }, []);
  return <Mascot ref={ref} size={size} mood={mood} isMainAssistant />;
}

/** `ilk2`: asistan eklentisi ilk bağlandığında, hayatta bir kez. Şeritte "asistan bağlandı" (`FirstConnectCenter`). */
export function FirstConnectCard({ onDone }: { onDone: () => void }) {
  const ad = useAdi();
  return (
    <Orta>
      <WaveMascot />
      <div className="t20 b6">{`Merhaba, ben ${ad}`}</div>
      <div className="t13 l2 b4">Ortadaki adada yaşarım. Ctrl+Space ile bana sor; onayların ve işlerim burada görünür.</div>
      <div className="dugmeler frDugme" style={{ marginTop: 2 }}>
        <button className="btn cam" onClick={onDone}>Geç</button>
        <button className="btn ana" data-autofocus onClick={onDone}>Tamam</button>
      </div>
    </Orta>
  );
}
export const useAdi = () => { const main = useMainAssistant(); return main ? pluginName(main) : "Asistan"; };
export const FirstConnectCenter = () => <span className="ms"><span className="b6">{useAdi()} bağlandı</span></span>;

/** `ky`: kart yükleniyor. 800 ms'yi geçmezse hiç görünmez (`loading` + `useDelayed`); şeritte sayı yok. */
export function LoadingCard({ what = "Pano okunuyor", loading = true }: { what?: string; loading?: boolean }) {
  const show = useDelayed(loading, 800);
  if (!show) return null;
  return (
    <div className="govde" role="status" aria-label={what}>
      <div className="mkBas"><Mascot size={56} mood="thinking" isMainAssistant /><span className="t13 l2 b4">{plain(what, 60)}</span></div>
      <div className="iskelet" /><div className="iskelet" style={{ width: "86%" }} /><div className="iskelet" style={{ width: "70%" }} />
    </div>
  );
}
export const LoadingCenter = ({ icon, title }: { icon?: ReactNode; title: string }) => <span className="ms">{icon ?? <Clipboard />}<span className="b6">{title}</span></span>;

/** `kh`: hata kartı (520 px). Teknik ayrıntı "Ayrıntı"nın içinde; aynı hata 10 dk içinde şeritte tepki vermez (çağıran `errorBudget` ile sınar). */
export function ErrorCard({ title, hint = "Yeniden dene; düzelmezse asistanı yeniden başlat.", detail, onRetry, retry = "Yeniden dene" }: { title: string; hint?: string; detail?: string; onRetry: () => void; retry?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Orta narrow>
      <Mascot size={56} mood="error" isMainAssistant />
      <div className="t15 b6">{plain(title, 80)}</div>
      <div className="t13 l2 b4">{plain(hint, 160)}</div>
      <div className="dugmeler">
        <button className="btn ana" data-autofocus onClick={onRetry}>{retry}</button>
        {detail && <button className="btn cam" aria-expanded={open} onClick={() => setOpen(!open)}>Neden?</button>}
      </div>
      {open && detail && <div className="kod cam hataAyrinti" role="note">{plain(detail, 400)}</div>}{/* düğmelerin altında: açılınca düğmeler yerinde kalır (R1-2) */}
    </Orta>
  );
}
export const ErrorCenter = () => <span className="ms"><span className="ikK"><TriangleAlert /></span><span className="b6">Hata</span></span>;

/** Aynı hata 10 dk içinde ikinci kez şeritte tepki vermez (maket kh). `key` hata türü. */
export function makeErrorBudget(now: () => number = Date.now, windowMs = 600_000) {
  const seen = new Map<string, number>();
  return (key: string): boolean => { const t = now(), last = seen.get(key); if (last !== undefined && t - last < windowMs) return false; seen.set(key, t); return true; };
}

/** `kb`: boş Pano (ve boş kartlar): uyuklayan maskot 96, ilk 600 ms içinde süzülerek gelir; zzz yazısı yazı 3 grisi. */
export function EmptyBoard({ title = "Pano boş", hint = "Kopyaladıkların burada durur: metin, görsel ve dosya." }: { title?: string; hint?: string }) {
  return (
    <div className="mkOrta">
      <span className="yuzGir"><Mascot size={96} mood="drowsy" isMainAssistant fallback={<span className="notchIk" style={{ width: 56, height: 56 }}><Clipboard /></span>} /></span>
      <div className="t15 b6">{plain(title, 60)}</div>
      <div className="t13 l2 b4">{plain(hint, 160)}</div>
    </div>
  );
}
