// Dalga 5 küçük çıkıntıları (FPV §0i madde 12; maket sarj, pil, bt, zam, g0, g): şarj, düşük pil, Bluetooth kulaklık, zamanlayıcı, raf.
// Her biri iki parça: şeridin ortası (`*Center`) ve altından uzanan çıkıntı ya da kart (`*Bump`, `ShelfCard`). Veri Rust'tan (bridge.ts, status_changed).
import type { CSSProperties } from "react";
import { BatteryCharging, BatteryLow, Download, File, FileImage, FileSpreadsheet, FileText, FileVideo, Headphones, Inbox, Pause, Play, Share, Sparkles, Square, Bell, Timer, TimerOff, Wifi, WifiOff } from "lucide-react";
import { bridge, type PluginInfo, type ShelfItem, type Status, type TimerState } from "../bridge";
import { askLabel, timerLeft, useSecond } from "../hooks";
import { fmtTime } from "../lib/media";
import { flat } from "../lib/plugin";
import { Lead } from "./Plugin";

type Battery = NonNullable<Status["battery"]>;
const noop = () => undefined;
const mmss = (s: number) => fmtTime(Math.ceil(s)); // bir saati aşınca 1:30:00

/* ---- şarj ---- */
export const ChargeCenter = ({ b }: { b: Battery }) => <span className="ms"><BatteryCharging /><span className="b6">Şarj oluyor</span>{b.percent !== null && <span className="l2 num">%{b.percent}</span>}</span>;
/** "Tam dolmasına yaklaşık ...": Windows kalan süreyi vermiyorsa yalnız çubuk. */
export const ChargeBump = ({ b }: { b: Battery }) => (
  <div className="cik">
    {b.percent !== null && <span className="miniIlerle" style={{ "--y": b.percent / 100 } as CSSProperties}><b /></span>}
    <span className="t12 l2 num">{b.remaining ? `Tam dolmasına yaklaşık ${b.remaining}` : "Şarj oluyor"}</span>
  </div>
);

/* ---- düşük pil ---- */
export const LowBatteryCenter = ({ b }: { b: Battery }) => <span className="ms"><span style={{ color: "var(--turuncu)" }}><BatteryLow /></span><span className="b6">Pil %{b.percent}</span></span>;
export const LowBatteryBump = ({ b }: { b: Battery }) => (
  <div className="cik">
    {b.remaining && <span className="t12 l2 num">Yaklaşık {b.remaining} kaldı</span>}
    <button className="btn kk gri" onClick={() => bridge.call("open_windows_settings", { uri: "ms-settings:batterysaver" }).catch(noop)}>Pil tasarrufu ayarları</button>
  </div>
);

/* ---- Bluetooth kulaklık: kutu pili yok, pil bildirmeyen cihazda çıkıntı olmaz ---- */
export const BtCenter = ({ name }: { name: string }) => <span className="ms"><Headphones /><span className="b6">{flat(name, 40)} bağlandı</span></span>;
export const BtBump = ({ battery }: { battery: number }) => (
  <div className="cik">
    <span className="t12 l2 num">Pil %{Math.round(battery)}</span>
    <span className="miniIlerle" style={{ "--y": battery / 100, width: 56 } as CSSProperties}><b /></span>
  </div>
);

/* ---- zamanlayıcı ---- */
export function TimerCenter({ t }: { t: TimerState }) {
  const now = useSecond(t.running);
  return <span className="ms"><Timer /><span className="b6 sayac" style={{ minWidth: fmtTime(t.totalS).length + "ch" }}>{mmss(timerLeft(t, now))}</span><span className="l3">{flat(t.label, 24)}</span></span>;
}
export function TimerBump({ t }: { t: TimerState }) {
  const now = useSecond(t.running);
  const y = t.totalS > 0 ? Math.min(1, timerLeft(t, now) / t.totalS) : 0;
  const ctl = (action: "pause" | "resume" | "add5" | "stop") => () => bridge.call("timer_control", { action }).catch(noop);
  return (
    <div className="cik">
      <span className="miniIlerle" style={{ "--y": y } as CSSProperties}><b /></span>
      <button className="mini dolu" title={t.running ? "Duraklat" : "Sürdür"} aria-label={t.running ? "Duraklat" : "Sürdür"} onClick={ctl(t.running ? "pause" : "resume")}>{t.running ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button>
      <button className="btn kk gri" onClick={ctl("add5")}>+5 dk</button>
      <button className="mini" title="Bitir" aria-label="Bitir" onClick={ctl("stop")}><Square /></button>
    </div>
  );
}

/* ---- zamanlayıcı bitti (karar 2026-10-17: ses yok, sahip kapatana dek durur) ---- */
export const TimerDoneCenter = ({ label }: { label: string | null }) => <span className="ms"><TimerOff /><span className="b6">Süre doldu</span>{label && <span className="l3">{flat(label, 24)}</span>}</span>;
/** "+5 dk": önce `timer_control add5`; bitmiş zamanlayıcıda Rust reddederse aynı adla 5 dk'lık yenisi başlar. */
export function TimerDoneBump({ label, onDone }: { label: string; onDone: () => void }) {
  const add5 = () => { onDone(); bridge.call("timer_control", { action: "add5" }).catch(() => bridge.call("timer_start", { label, seconds: 300 }).catch(noop)); };
  const stop = () => { onDone(); bridge.call("timer_control", { action: "stop" }).catch(noop); };
  return (
    <div className="cik">
      <span className="t12 l2">{label ? `${flat(label, 24)} bitti` : "Zamanlayıcı bitti"}</span>
      <button className="btn kk gri" onClick={add5}>+5 dk</button>
      <button className="btn kk" onClick={stop}>Kapat</button>
    </div>
  );
}

/* ---- bağlantı koptu / geri geldi (asistanın "Çevrimdışı kip"inden ayrı) ---- */
export const NetCenter = ({ lost }: { lost: boolean }) => <span className="ms">{lost ? <WifiOff /> : <Wifi />}<span className="b6">{lost ? "Bağlantı koptu" : "Bağlantı geri geldi"}</span></span>;
export const NetBump = ({ lost }: { lost: boolean }) => (
  <div className="cik">
    <span className="t12 l2">{lost ? "İnternet bağlantısı yok" : "İnternet yeniden var"}</span>
    {lost && <button className="btn kk gri" onClick={() => bridge.call("open_windows_settings", { uri: "ms-settings:network-wifi" }).catch(noop)}>Ağ ayarları</button>}
  </div>
);

/* ---- "Sen yokken" özeti: tek tıkla bildirim listesi ---- */
export const AwayCenter = () => <span className="ms"><Bell /><span className="b6">Sen yokken</span></span>;
export const AwayBump = ({ text, onOpen }: { text: string; onOpen: () => void }) => (
  <div className="cik">
    <button className="btn kk gri" onClick={onOpen}><Bell />{text}</button>
  </div>
);

/* ---- raf ---- */
const FILE_ICON = { pdf: FileText, video: FileVideo, sheet: FileSpreadsheet, image: FileImage, other: File } as const;
const FILE_TONE = { pdf: "var(--kirmizi)", video: "var(--camgobegi)", sheet: "var(--yesil)", image: "var(--camgobegi)", other: "var(--l2)" } as const;

export function ShelfCenter({ main, count }: { main: PluginInfo | null; count: number }) {
  return (
    <span className="ms">
      {main && <Lead plugin={{ id: main.id, name: main.name, main: true }} mascot="hazir" size={24} />}
      <Inbox /><span className="b6">Raf</span>{count > 0 && <span className="l3">{count} dosya</span>}
    </span>
  );
}
/** Dosya adaya sürüklenirken iki bırakma hedefi (bırakmayı Rust işler; arayüz yalnız hedefleri çizer). */
export const ShelfBump = ({ main }: { main: PluginInfo | null }) => (
  <div className="cik">
    {main && <span className="birakKucuk"><Sparkles />{askLabel(main)}</span>}
    <span className="birakKucuk"><Download />Rafa koy</span>
  </div>
);

export function ShelfCard({ items, main }: { items: ShelfItem[]; main: PluginInfo | null }) {
  return (
    <div className="govde">
      <div className="raf">
        {items.slice(0, 2).map((f) => {
          const I = FILE_ICON[f.kind];
          return (
            <div className="dosya plat cam" key={f.id} data-shelf={f.id}>
              <span className="tip" style={{ background: `color-mix(in srgb, ${FILE_TONE[f.kind]} 18%, transparent)`, color: FILE_TONE[f.kind] }}><I /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="b6" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{flat(f.name, 60)}</div>
                <div className="t12 l3" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{flat(f.sub, 60)}</div>
                <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                  <button className="mini" title="Paylaş" aria-label={`${flat(f.name, 60)}, paylaş`} onClick={() => bridge.call("share_open", { id: f.id }).catch(noop)}><Share /></button>
                  {main && <button className="mini sor" title={askLabel(main)} aria-label={`${flat(f.name, 60)}, ${askLabel(main)}`} onClick={() => bridge.call("shelf_ask", { id: f.id }).catch(noop)}><Sparkles /></button>}
                </div>
              </div>
            </div>
          );
        })}
        <div className="birak"><Download />Buraya bırak</div>
      </div>
      {items.length === 0 && <div className="t13 l2 b4">Raf boş. Dosyayı adaya sürükle, burada bekler.</div>}
    </div>
  );
}
