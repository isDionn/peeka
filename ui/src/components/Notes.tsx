// Küçük çıkıntılar: bildirim yağmuru, kota doldu, "N oturum" çipi. Mantık lib/notes.ts'te; Island seçer, burada yalnız çizilir.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Bell, Cpu, Download, Gauge, Headphones } from "lucide-react";
import { bridge } from "../bridge";
import { burstLabel, type Burst, type CcSession } from "../lib/notes";
import { flat } from "../lib/plugin";

export const BurstCenter = ({ b, generic }: { b: Burst; generic: boolean }) =>
  <span className="ms"><Bell /><span className="b6">{flat(burstLabel(b.n, b.apps.map((a) => flat(a, 20)), generic), 60)}</span></span>;
export const BurstBump = ({ onOpen }: { onOpen: () => void }) => <div className="cik"><button className="btn kk ana" onClick={onOpen}>Listeyi aç</button></div>;

/** Reset saati kancadan gelmez (`cc_event` yalnız tür ve sebep taşır): yalnız "Kota doldu". */
export const QuotaCenter = () => <span className="ms"><Gauge /><span className="b6">Kota doldu</span></span>;
export const QuotaBump = ({ onOk }: { onOk: () => void }) => <div className="cik"><button className="btn kk gri" onClick={onOk}>Tamam</button></div>;

/** Kulaklık ayrıldı ve müzik durdu (Rust `music_stopped`): ad cihazın adıdır; gizliyken yok. "Devam" `media_control` play_pause. */
export const MusicStoppedCenter = ({ name, generic }: { name: string; generic: boolean }) =>
  <span className="ms"><Headphones /><span className="b6">{generic ? "Müzik durdu" : `Müzik durdu — ${flat(name, 28)} ayrıldı`}</span></span>;
export const MusicStoppedBump = ({ onResume }: { onResume: () => void }) => <div className="cik"><button className="btn kk ana" onClick={onResume}>Devam</button></div>;
export const resumeMusic = () => bridge.call("media_control", { action: "play_pause" }).catch(() => undefined);

/** İndirme bitti (Rust `download_done {id, name, size}`): yalnız ad ve boyut gelir. Gizliyken ad ve düğme yok (Rust zaten reddeder). Ret sessiz. */
export const DownloadCenter = ({ name, generic }: { name: string; generic: boolean }) =>
  <span className="ms"><Download /><span className="b6">{generic ? "İndirme bitti" : `İndi: ${flat(name, 40)}`}</span></span>;
export function DownloadBump({ id, generic }: { id: string; generic: boolean }) {
  const go = (cmd: "download_open" | "download_show_in_folder") => () => bridge.call(cmd, { id }).catch(() => undefined);
  return generic
    ? <div className="cik"><span className="t12 l2">İndirme bitti</span></div>
    : <div className="cik"><button className="btn kk ana" onClick={go("download_open")}>Aç</button><button className="btn kk gri" onClick={go("download_show_in_folder")}>Klasörde göster</button></div>;
}

/** İşlemci uzun süre %95 üstünde (Rust `cpu_high {app}`; 60 sn kararını Rust verir, burada zamanlayıcı yok). Görev Yöneticisi `open_task_manager`. */
export const CpuCenter = ({ app, generic }: { app: string | null; generic: boolean }) =>
  <span className="ms"><Cpu /><span className="b6">{app && !generic ? `${flat(app, 28)} çok yoruyor` : "İşlemci çok yoğun"}</span></span>;
export const CpuBump = () => <div className="cik"><button className="btn kk ana" onClick={() => bridge.call("open_task_manager").catch(() => undefined)}>Görev Yöneticisi</button></div>;

/**
 * Açık Claude Code oturumları çipi (>= 2): adanın solunda 30 px yüksekliğinde hap, akışta değil (ada kaymaz). Tıklayınca bilinenler listelenir.
 * Kanca oturum kimliğinin yalnız tuzlu kısa özetini verir (`sid`): oturumlar "Oturum 1", "Oturum 2" diye sayılır ve her birinin son aracı yazılır; özeti olmayanlar (ana asistan) yalnız sayıda görünür.
 */
export function SessionChip({ n, list, edge, last, locked }: { n: number; list: CcSession[]; edge: number; last: { tool: string | null; at: number } | null; locked: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node | null)) setOpen(false); };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [open]);
  const ago = last ? Math.max(0, Math.round((Date.now() - last.at) / 1000)) : null;
  return (
    <div ref={root} className="oturumChip" style={{ right: `calc(50% + ${edge}px)` } as CSSProperties}>
      <button type="button" className="oturumDug" data-hit aria-expanded={open} aria-label={`${n} oturum, listeyi ${open ? "kapat" : "aç"}`} onClick={() => setOpen(!open)}>{n} oturum</button>
      {open && (
        <div className="yanListe oturumListe" data-hit role="group" aria-label="Claude Code oturumları">
          <div className="yanSat"><span className="b6 yanAd">{n} Claude Code oturumu açık</span></div>
          {list.map((x, i) => <div className="yanSat" key={x.sid}><span className="l3 yanAd">Oturum {i + 1}{!locked && `: ${x.tool ? flat(x.tool, 24) : "olay"}, ${Math.max(0, Math.round((Date.now() - x.at) / 1000))} sn önce`}</span></div>)}
          {list.length === 0 && !locked && last && <div className="yanSat"><span className="l3 yanAd">Son hareket: {last.tool ? flat(last.tool, 24) : "olay"}, {ago} sn önce</span></div>}
          {n > list.length && <div className="yanSat"><span className="l3 yanAd">{list.length ? `${n - list.length} oturum daha ayırt edilemiyor` : "Oturumlar tek tek ayırt edilemiyor"}</span></div>}
        </div>
      )}
    </div>
  );
}
