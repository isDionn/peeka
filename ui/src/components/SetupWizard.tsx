// Kurulum sihirbazı (maket kur, FPV §0i madde 11): üç adım, ilk açılışta ve istenince. Adım 2 maketteki üç satır: görev çubuğu, isteğe bağlı bildirim aynası, Windows afişleri.
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Bell, BellOff, CircleCheck, Keyboard, PanelTopClose } from "lucide-react";
import { bridge, type MirrorState } from "../bridge";
import { useSettings } from "../hooks";
import { Kbd, NO_INDENT, Panel, Row, Switch } from "./common";
import "../fidelity-ayar.css";

export const SETUP_KEY = "notch.kurulum";
export const setupDone = () => { try { return localStorage.getItem(SETUP_KEY) === "1"; } catch { return false; } };
export const markSetup = () => { try { localStorage.setItem(SETUP_KEY, "1"); } catch { /* depolama yok: her açılışta sorar */ } };
export const resetSetup = () => { try { localStorage.removeItem(SETUP_KEY); } catch { /* depolama yok */ } };

const STEPS = 3;

function Step({ n }: { n: number }) {
  const settings = useSettings();
  const [mirror, setMirror] = useState<MirrorState | null>(null);
  useEffect(() => { bridge.call("mirror_state").then(setMirror).catch(() => undefined); }, []);
  const k = settings?.shortcuts;
  if (n === 0) {
    return (
      <>
        <div className="t13 l2 b4">Bu şerit görev çubuğunun yerini aldı: solda uygulamaların, ortada ada, sağda saat ve durum.</div>
        <div className="liste cam" style={{ "--girinti": "30px" } as React.CSSProperties}>
          <div className="sat"><Keyboard /><span className="metin">Ara</span>{k && <Kbd keys={k.search} />}</div>
          <div className="sat"><Keyboard /><span className="metin">Asistana sor</span>{k && <Kbd keys={k.ask} />}</div>
          <div className="sat"><Keyboard /><span className="metin">Adayı geçici gizle</span>{k && <Kbd keys={k.hide_island} />}</div>
        </div>
      </>
    );
  }
  if (n === 1) {
    const hidden = settings ? settings.taskbarHide !== "off" : true;
    const blocked = !!mirror?.enabled && !!mirror.blocker;
    return (
      <div className="liste cam" style={{ "--girinti": "30px" } as React.CSSProperties}>
        <div className="sat">
          {hidden ? <span className="tik" role="img" aria-label="Yapıldı"><CircleCheck /></span> : <PanelTopClose />}
          <div style={{ flex: 1 }}><div>Windows görev çubuğunu gizle</div><div className="t12 l3 b4">Geri getirmek: {k?.emergency ?? "Ctrl+Alt+Shift+T"}, Başlat ya da şeride sağ tık</div></div>
          {!hidden && <button className="btn kk cam" onClick={() => bridge.call("taskbar_set_mode", { mode: "full" })}>Gizle</button>}
        </div>
        <div className="sat">
          <Bell />
          <div style={{ flex: 1 }}><div>Windows bildirimlerini sağ üstte göster</div><div className="t12 l3 b4">{blocked ? "Windows izin vermedi ya da Geliştirici Modu kapalı; ayrıntı Ayarlar › Görünüm'de" : "Geliştirici Modu ve Windows izni ister; isteğe bağlı"}</div></div>
          <Switch on={!!mirror?.enabled} label="Windows bildirimlerini sağ üstte göster" onChange={(v) => bridge.call(v ? "mirror_enable" : "mirror_disable").then(setMirror).catch(() => undefined)} />
        </div>
        <div className="sat">
          <BellOff />
          <div style={{ flex: 1 }}><div>Windows'un sağ alttaki afişlerini kapat</div><div className="t12 l3 b4">Uygulama başına Windows ayarında; önerilir, otomatik yapılmaz</div></div>
          <button className="btn kk cam" onClick={() => bridge.call("open_windows_settings", { uri: "ms-settings:notifications" }).catch(() => undefined)}>Ayarları aç<ArrowUpRight /></button>
        </div>
      </div>
    );
  }
  return (
    <div className="liste cam" style={NO_INDENT}>
      <Row title="Hazırsın" sub="Her şeyi sağ tıkla açılan Peeka ayarlarından değiştirebilirsin." />
    </div>
  );
}

/** Sihirbazın gövdesi. `onDone` "Bitti"ye basınca (kurulum tamamlandı olarak işaretlenir) ve Esc dışındaki kapanışta çağrılır. */
export function SetupWizard({ onDone, startStep = 0 }: { onDone: () => void; /** Önizleme: maket kur 2. adımı (0 tabanlı 1) gösterir. */ startStep?: number }) {
  const [n, setN] = useState(startStep);
  const last = n === STEPS - 1;
  const arrived = useRef(0);
  // "Bitti" İleri'nin yerinde belirir: son adıma gelişten sonraki 300 ms'de gelen tık (çift tık) sihirbazı bitirmez
  const next = () => {
    if (!last) { arrived.current = performance.now(); setN(n + 1); }
    else if (performance.now() - arrived.current >= 300) { markSetup(); onDone(); }
  };
  return (
    <div className="govde kurum">
      <div className="t17 b6">Kurulum</div>
      <div className="kurumAdim"><Step n={n} /></div>
      <div className="adimlar" role="img" aria-label={`Adım ${n + 1} / ${STEPS}`}>{Array.from({ length: STEPS }, (_, i) => <i key={i} className={i === n ? "on" : undefined} />)}</div>
      <div className="dugmeler" style={{ justifyContent: "flex-end" }}>
        <button className="btn cam" disabled={n === 0} onClick={() => setN(n - 1)}>Geri</button>
        <button className="btn ana" data-autofocus onClick={next}>{last ? "Bitti" : "İleri"}</button>
      </div>
    </div>
  );
}

/** Şeridin altından sarkan kurulum kartı (ayarlar kartıyla aynı boyutta merkezde). Shell `open` ile sürer. */
export function SetupPanel({ open, onClose, startStep }: { open: boolean; onClose: () => void; startStep?: number }) {
  return <Panel side="center" width={600} label="Kurulum" dataKind="setup" open={open} onClose={onClose}><SetupWizard onDone={onClose} startStep={startStep} /></Panel>;
}
