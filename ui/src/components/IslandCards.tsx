import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, Bell, Calendar, Clipboard, Cpu, Inbox, LayoutGrid, Music, PanelTop, Pause, Play, Settings, SkipBack, SkipForward, Timer, X, type LucideIcon } from "lucide-react";
import { bridge, type Alert, type TimerState, type Media, type TabExt, type ModuleEntry, type PluginInfo, type ProtrusionItem, type ShelfItem, type SurfacesView, type SysmonTick, type VolumeOsd } from "../bridge";
import { capTabs, flat, MASCOT_STATES } from "../lib/plugin";
import { AlertIcon } from "../lib/alertIcon";
import { ageLabel } from "../lib/alerts";
import { actionLabel } from "../lib/alerts";
import { useAlerts, useMainAssistant } from "../hooks";
import { openModuleSettings } from "../hooks.fidelity";
import { Lead, SummaryBoxes, TabBlocks, TabGlyph, tabLabel } from "./Plugin";
import { MeetingCard, ShelfSuggestRow } from "./Fidelity";
import { WaveMascot } from "./CardsExtra";
import "./cards.css";
import { durationSec, fmtTime, timeSlot, trackTitle } from "../lib/media";
import { PanoView } from "./Pano";
import { ShelfCard, TimerBump, TimerCenter } from "./Extras";

/* ---- çıkıntı satırları (.cik): şerit renginde, ince ---- */

export const Bars = () => <span className="gor" aria-hidden="true"><i /><i /><i /><i /></span>;

const PlayIcon = ({ playing }: { playing: boolean }) => (playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />);
const ctl = (action: "play_pause" | "next" | "previous") => () => bridge.call("media_control", { action }).catch(() => undefined);
const prev = ctl("previous"), next = ctl("next"), toggle = ctl("play_pause");

export function MusicBump({ media, pos }: { media: Media; pos: number }) {
  const d = durationSec(media);
  return (
    <div className="cik">
      <span className="t11 l3 num" style={{ minWidth: timeSlot(d) + "ch", textAlign: "right" }}>{fmtTime(pos)}</span>
      <span className="miniIlerle" style={{ "--y": d ? Math.min(1, pos / d) : 0 } as CSSProperties}><b /></span>
      <span className="t11 l3 num" style={{ minWidth: timeSlot(d) + 1 + "ch" }}>{d ? "-" + fmtTime(d - pos) : "canlı"}</span>
      <button className="mini dolu" title="Önceki" aria-label="Önceki parça" disabled={!media.canPrevious} onClick={prev}><SkipBack fill="currentColor" /></button>
      <button className="mini dolu" title={media.playing ? "Duraklat" : "Oynat"} aria-label={media.playing ? "Duraklat" : "Oynat"} onClick={toggle}><PlayIcon playing={media.playing} /></button>
      <button className="mini dolu" title="Sonraki" aria-label="Sonraki parça" disabled={!media.canNext} onClick={next}><SkipForward fill="currentColor" /></button>
    </div>
  );
}

export function AlertBump({ alert, onLater }: { alert: Alert; onLater: () => void }) {
  const level = alert.style === "level" && alert.progress !== null;
  return (
    <div className="cik">
      {level && <><span className="hudiz"><b style={{ "--s": alert.progress } as CSSProperties} /></span><span className="num b6 t12">{Math.round((alert.progress ?? 0) * 100)}</span></>}
      {!level && alert.progress !== null && <span className="miniIlerle" style={{ "--y": alert.progress } as CSSProperties}><b /></span>}
      {alert.subtitle && <span className="t12 l2" title={alert.subtitle}>{alert.subtitle}</span>}
      {alert.action && <button className="btn kk ana" onClick={() => bridge.call("open_alert", { id: alert.id }).catch(() => undefined)}>{actionLabel(alert)}</button>}
      {!level && <button className="btn kk gri" onClick={onLater}>Sonra</button>}
    </div>
  );
}

export function OsdBump({ osd }: { osd: VolumeOsd }) {
  const v = osd.percent;
  return (
    <div className="cik">
      <span className="hudiz"><b style={{ "--s": osd.muted ? 0 : v / 100 } as CSSProperties} /></span>
      <span className="num b6 t12 l2" style={{ minWidth: 40, textAlign: "right" }}>{osd.muted ? "Kapalı" : v}</span>
    </div>
  );
}

/* ---- kartlar (.govde) ---- */

export function MusicCard({ media, pos }: { media: Media; pos: number }) {
  const d = durationSec(media) ?? 0;
  const [scrub, setScrub] = useState<number | null>(null);
  const val = scrub ?? pos;
  const sub = [media.artist, media.album].filter(Boolean).join(", ");
  const commit = () => { if (scrub !== null) { bridge.call("media_control", { action: "seek", positionMs: Math.round(scrub * 1000) }).catch(() => undefined); setScrub(null); } };
  return (
    <div className="govde">
      <div className="calar">
        {media.art ? <img className="kapak" data-paylas="kapak" src={media.art} alt="" /> : <span className="kapak notchIk" data-paylas="kapak"><Music /></span>}
        <div style={{ minWidth: 0 }}>
          <div className="t20 b6" data-paylas="baslik" title={trackTitle(media)} style={{ width: "max-content", maxWidth: "100%" }}>{trackTitle(media)}</div>
          <div className="t15 b4 l2 sira" title={sub}>{sub}</div>
          <div className="ilerle t11 l2 num sira">
            <span style={{ minWidth: timeSlot(d) + "ch" }}>{fmtTime(val)}</span>
            <input type="range" min={0} max={d || 1} step={1} value={Math.min(val, d || 1)} disabled={!media.canSeek || !d} aria-label="Şarkı konumu" aria-valuetext={`${fmtTime(val)}, toplam ${fmtTime(d)}`}
              style={{ "--y": d ? (Math.min(val, d) / d) * 100 + "%" : "0%" } as CSSProperties}
              onChange={(e) => setScrub(+e.target.value)} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
            <span style={{ textAlign: "right", minWidth: timeSlot(d) + 1 + "ch" }}>{d ? "-" + fmtTime(d - val) : ""}</span>
          </div>
          <div className="kont sira">
            <button className="dolu" title="Önceki" aria-label="Önceki parça" disabled={!media.canPrevious} onClick={prev}><SkipBack fill="currentColor" /></button>
            <button className="buyuk dolu" title={media.playing ? "Duraklat" : "Oynat"} aria-label={media.playing ? "Duraklat" : "Oynat"} onClick={toggle}><PlayIcon playing={media.playing} /></button>
            <button className="dolu" title="Sonraki" aria-label="Sonraki parça" disabled={!media.canNext} onClick={next}><SkipForward fill="currentColor" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

const dash = "—";
function Meter({ label, text, ratio }: { label: string; text: string; ratio: number | null }) {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}><span>{label}</span><span className="num b6">{text}</span></div>
      {ratio !== null && <div className="olc" style={{ "--o": Math.round(ratio * 100) + "%", "--renk": "var(--camgobegi)" } as CSSProperties}><b /></div>}
    </>
  );
}

/** Zamanlayıcı başlat: dakika (1-1440) ve isteğe bağlı ad. Çalıyorsa yenisi yerini alır; geri sayım şeritte görünür. */
export function TimerStart({ timer = null }: { timer?: TimerState | null }) {
  const [min, setMin] = useState("5");
  const [label, setLabel] = useState("");
  const [started, setStarted] = useState(false); // Başlat'a basınca kısa onay: odak ve alanlar yerinde kalır
  useEffect(() => { if (!started) return; const t = setTimeout(() => setStarted(false), 1400); return () => clearTimeout(t); }, [started]);
  const m = Math.floor(Number(min));
  const ok = m >= 1 && m <= 1440;
  const go = (e: React.FormEvent) => { e.preventDefault(); if (ok) bridge.call("timer_start", { label: label.trim() || "Zamanlayıcı", seconds: m * 60 }).then(() => setStarted(true)).catch(() => undefined); };
  return (
    <>
    {timer && (
      <div className="kutu cam calisanSayac" aria-label="Çalışan zamanlayıcı">
        <h4><Timer />Çalışıyor</h4>
        <div className="calisanSat"><TimerCenter t={timer} /><TimerBump t={timer} /></div>
      </div>
    )}
    <form className="kutu cam" onSubmit={go}>
      <h4><Timer />{timer ? "Yeni zamanlayıcı" : "Zamanlayıcı"}</h4>
      <div className="zamanSat">
        <input className="dk num" type="number" min={1} max={1440} inputMode="numeric" aria-label="Dakika" value={min} onChange={(e) => setMin(e.target.value)} />
        <span className="t12 l3">dk</span>
        <input className="ad" type="text" maxLength={40} aria-label="Zamanlayıcı adı" placeholder="Ad (isteğe bağlı)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button className="btn kk ana" type="submit" disabled={!ok} aria-live="polite">{started ? "Başlatıldı" : "Başlat"}</button>
      </div>
    </form>
    </>
  );
}

const SistemBox = ({ sys, cpu }: { sys: SysmonTick | null; cpu: number[] }) => {
  const gb = (n: number | null) => (n === null ? dash : (n / 1024 ** 3).toLocaleString("tr-TR", { maximumFractionDigits: 1 }));
  return (
    <div className="kutu cam">
      <h4><Cpu />Sistem</h4>
      <div style={{ display: "flex", justifyContent: "space-between" }}><span>İşlemci</span><span className="num b6">{sys?.cpu == null ? dash : "%" + Math.round(sys.cpu)}</span></div>
      <div className="t12 l3" style={{ display: "flex", justifyContent: "space-between" }}><span>En çok kullanan</span><span className="num">{sys?.topCpu ? flat(sys.topCpu, 24) : dash}</span></div>{/* satır hep var: ölçüm gelince kart kaymaz */}
      <div className="spark" aria-hidden="true">{Array.from({ length: 16 }, (_, i) => cpu[cpu.length - 16 + i]).map((v, i) => <i key={i} className={v === undefined ? "bos" : undefined} style={{ height: v === undefined ? "4%" : Math.max(4, v * 2) + "%" }} />)}</div>
      <Meter label="Bellek" text={sys?.memUsed == null || sys.memTotal == null ? dash : `${gb(sys.memUsed)} / ${gb(sys.memTotal)} GB`} ratio={sys?.memUsed == null || !sys.memTotal ? null : sys.memUsed / sys.memTotal} />
      <Meter label="Ekran kartı" text={sys?.gpu == null ? dash : "%" + Math.round(sys.gpu)} ratio={sys?.gpu == null ? null : sys.gpu / 100} />
    </div>
  );
};

/** Müzik sekmesi: b2 çalar kartının aynısı (MusicCard); hiçbir şey çalmıyorsa kısa not. */
function MusicTab({ media, pos }: { media: Media | null; pos: number }) {
  if (!media) return <div className="kutu cam"><h4><Music />Müzik</h4><div className="t13 l2 b4">Şu an bir şey çalmıyor.</div></div>;
  return <MusicCard media={media} pos={pos} />;
}

/** Bildirimler sekmesi (maket m): başlık + "Listeyi temizle", altında düz uyarı satırları. "Gözden geçir" temizlik onayı şerit panelinde kalır; burada yaş yazılır. */
function AlertsTab() {
  const { alerts } = useAlerts();
  const main = useMainAssistant();
  const nowMs = bridge.now().getTime();
  return (
    <div className="govde">
      <div style={{ display: "flex", alignItems: "center" }}>
        <span className="t17 b6" style={{ flex: 1 }}>Bildirimler</span>
        <button className="btn kk cam" disabled={alerts.length === 0} onClick={() => bridge.call("clear_alerts").catch(() => undefined)}>Listeyi temizle</button>
      </div>
      {alerts.length === 0 ? <div className="bosSonuc">Bildirim yok</div> : (
        <div className="bilds" role="list">
          {alerts.map((a) => (
            <div key={a.id} role="listitem" className="bild plat cam">
              {main && a.icon && MASCOT_STATES.has(a.icon) ? <Lead plugin={{ id: main.id, name: main.name, main: true }} mascot={a.icon} size={24} /> : <span className="uyg"><AlertIcon name={a.icon} /></span>}
              <div style={{ flex: 1, minWidth: 0 }}><div className="b6">{a.title}</div>{a.subtitle && <div className="t12 l2 b4">{a.subtitle}</div>}</div>
              <span className="t12 l3">{ageLabel((nowMs - a.updatedAt) / 1000)}</span>
              {a.action && <button className="mini" title="Bağlantıyı aç" aria-label={`${a.title}, bağlantıyı aç`} onClick={() => bridge.call("open_alert", { id: a.id }).catch(() => undefined)}><ArrowUpRight /></button>}
              <button className="mini" title="Kaldır" aria-label={`${a.title}, kaldır`} onClick={() => bridge.call("dismiss_alert", { id: a.id }).catch(() => undefined)}><X /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Modüller kartının genişliği sekmeye uyar (maket: j yalnız Genel'i 3 sütunda çizer; diğerleri kendi tek kartı kadar).
 * müzik b2, pano h, raf g, takvim f, bildirimler m; zamanlayıcı ve sistem küçük; `eklenti` = normal eklenti kartı.
 */
/** Genel 3 sütun için geniş; diğer her sekme AYNI genişlikte (sahip kararı: Takvim ile Zamanlayıcı farklı genişlikte olmasın). 620 = Pano/Raf/Sor kartlarıyla aynı genişlik sınıfı; 11 sekme + dişli + × sığar. */
export const MOD_NARROW = 620;
export const modulesKw = (page: string, screenW: number) => (page === "genel" ? Math.min(1056, Math.round(screenW * 0.55)) : MOD_NARROW);

/** Çekirdek sekmeler (maket j): Peeka'nın; sonra ayraç ve eklenti sekmeleri. `id` Ayarlar › Modüller kimliğiyle aynıdır. */
const CORE: [string, string, LucideIcon][] = [["genel", "Genel", LayoutGrid], ["müzik", "Müzik", Music], ["pano", "Pano", Clipboard], ["raf", "Raf", Inbox], ["takvim", "Takvim", Calendar], ["zamanlayıcı", "Zamanlayıcı", Timer], ["sistem", "Sistem", Cpu], ["bildirimler", "Bildirimler", Bell]];

/** Modüller kartı (maket j): 11 sekme + dişli; Genel = asistan | Claude Code | Sistem. Kart açıkken sistem izleme çalışır (Island başlatır). */
export const ModulesCard = memo(ModulesCardImpl); // yay sırasında Island her karede yeniden çizilir; kart girdisi değişmedikçe çizilmez
function ModulesCardImpl({ media, pos, sys, cpu, surf, shelf, main, meeting, onPage, onClose, onApproval, start, timer = null }: { start?: string; timer?: TimerState | null; meeting: ProtrusionItem | null; onPage: (page: string, title: string) => void; onClose: () => void; media: Media | null; pos: number; sys: SysmonTick | null; cpu: number[]; surf: SurfacesView; shelf: ShelfItem[]; main: PluginInfo | null; onApproval: (id: string) => void }) {
  // Ayarlar › Modüller: kapalı olan gizlenir, eklenti sekmeleri kaydedilen sıraya göre dizilir (liste gelene dek hepsi açık)
  const [mods, setMods] = useState<ModuleEntry[] | null>(null);
  useEffect(() => { bridge.call("modules_get").then(setMods).catch(() => undefined); }, []);
  const on = (id: string) => mods?.find((m) => m.id === id)?.on ?? true;
  const rank = (t: { title: string }) => { const i = mods?.findIndex((m) => m.id === t.title.toLocaleLowerCase("tr")) ?? -1; return i < 0 ? 999 : i; };
  const tabs = capTabs(surf.tabs).filter((t) => on(t.title.toLocaleLowerCase("tr"))).sort((a, b) => rank(a) - rank(b));
  const core = CORE.filter(([id]) => on(id));
  const [tab, setTab] = useState(start ?? "genel");
  const cur = tabs.find((t) => t.plugin.id + "/" + t.id === tab);
  const page = cur ? "eklenti" : core.some(([id]) => id === tab) ? tab : (core[0]?.[0] ?? "genel");
  const pageTitle = cur ? tabLabel(cur) : (CORE.find(([id]) => id === page)?.[1] ?? "Genel");
  useEffect(() => onPage(page, pageTitle), [page, pageTitle, onPage]);
  // Pano sekmesi hazır olana dek (clip_visible cevabı) eski sekme görünür kalır: kart boşalıp yeniden büyümez
  const want = page === "eklenti" ? tab : page;
  const [panoOk, setPanoOk] = useState(false);
  const shownRef = useRef(want);
  const waiting = want === "pano" && !panoOk && shownRef.current !== "pano";
  const shown = waiting ? shownRef.current : want;
  shownRef.current = shown;
  useEffect(() => { if (want !== "pano") setPanoOk(false); }, [want]);
  const segRef = useRef<HTMLDivElement>(null);
  // dar kartta etkin sekme satırda görünür kalsın
  useEffect(() => { (segRef.current?.querySelector(".segb.on") as HTMLElement | null)?.scrollIntoView?.({ inline: "nearest", block: "nearest" }); }, [tab, page]);
  // sekmeler her genişlikte yalnız simge, sabit boyut: tıklayınca hiçbiri kaymaz. Etkin olanı kayan hap gösterir, ad 400 ms sonra ipucunda.
  const [pil, setPil] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => { const e = segRef.current?.querySelector(".segb.on") as HTMLElement | null; setPil(e ? { x: e.offsetLeft, w: e.offsetWidth } : null); }, [tab, page, tabs.length, core.length]);
  const [tip, setTip] = useState<{ text: string; x: number } | null>(null);
  const tipTimer = useRef<number | undefined>(undefined);
  const hideTip = () => { window.clearTimeout(tipTimer.current); setTip(null); };
  const tipOn = (text: string) => (e: { currentTarget: HTMLElement }) => { const b = e.currentTarget, u = b.closest(".modUst") as HTMLElement; window.clearTimeout(tipTimer.current); tipTimer.current = window.setTimeout(() => setTip({ text, x: b.getBoundingClientRect().left - u.getBoundingClientRect().left + b.offsetWidth / 2 }), 400); };
  useEffect(() => () => window.clearTimeout(tipTimer.current), []);
  // odak ipucu yalnız klavyede (açılışta ilk sekmeye programla odak gelir; fareyle açılınca ipucu kendiliğinden çıkmasın)
  const tipProps = (text: string) => ({ "aria-label": text, onMouseEnter: tipOn(text), onFocus: (e: React.FocusEvent<HTMLElement>) => { if (document.documentElement.hasAttribute("data-kb")) tipOn(text)(e); }, onMouseLeave: hideTip, onBlur: hideTip });
  // sekme çubuğu: tek Tab durağı (etkin sekme), Sol/Sağ/Home/End gezer ve seçer (F-04)
  const order = [...core.map(([id]) => id), ...tabs.map((t) => t.plugin.id + "/" + t.id)];
  const idOf = (k: string) => "modtab-" + k.replace(/[^\p{L}\p{N}_-]/gu, "_");
  const onTabKey = (e: React.KeyboardEvent<HTMLElement>) => {
    const btns = [...(segRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])], i = btns.indexOf(e.currentTarget), n = btns.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (i < 0 || to < 0 || !order[to]) return;
    e.preventDefault(); hideTip(); setTab(order[to]); btns[to].focus();
  };
  const genelTabs = tabs.filter((t) => (t as typeof t & TabExt).genel);
  const hasSummary = surf.summary.length > 0 || surf.approvals.length > 0;
  const boxes = (hasSummary ? 1 : 0) + genelTabs.length + (on("sistem") ? 1 : 0);
  const body = (p: string) => {
    const t = tabs.find((x) => x.plugin.id + "/" + x.id === p);
    return t ? <TabBlocks tab={t} />
      : p === "raf" ? <><ShelfCard items={shelf} main={main} /><ShelfSuggestRow items={shelf} main={main} /></>
      : p === "müzik" ? <MusicTab media={media} pos={pos} />
      : p === "takvim" ? (meeting ? <MeetingCard item={meeting} /> : <div className="kutu cam"><h4><Calendar />Takvim</h4><div className="t13 l2 b4">Yaklaşan toplantı yok. Toplantılar takvim eklentisinden gelir.</div></div>)
      : p === "zamanlayıcı" ? <TimerStart timer={timer} />
      : p === "sistem" ? <SistemBox sys={sys} cpu={cpu} />
      : p === "bildirimler" ? <AlertsTab />
      : <div className="izgara modul genel3" style={{ gridTemplateColumns: boxes >= 3 ? "1.3fr 1fr .9fr" : `repeat(${Math.max(1, boxes)}, 1fr)` }}>
        <SummaryBoxes surf={surf} onDetail={onApproval} />
        {genelTabs.map((x) => <TabBlocks key={x.plugin.id + "/" + x.id} tab={x} />)}
        {on("sistem") && <SistemBox sys={sys} cpu={cpu} />}
      </div>;
  };
  return (
    <div className="govde modKok">
      <div className="modUst">
        <div className="seg cam" ref={segRef} role="tablist" aria-label="Modüller" onScroll={hideTip} onWheel={(e) => { if (e.deltaY) e.currentTarget.scrollLeft += e.deltaY; }}>
          {pil && <span className="segPil" aria-hidden="true" style={{ transform: `translateX(${pil.x}px)`, width: pil.w }} />}
          {core.map(([id, title, Icon]) => <button key={id} id={idOf(id)} className={"segb" + (page === id ? " on" : "")} role="tab" aria-selected={page === id} tabIndex={page === id ? 0 : -1} {...tipProps(title)} onKeyDown={onTabKey} onClick={() => { hideTip(); setTab(id); }}><Icon /></button>)}
          {tabs.length > 0 && <span className="segAyrac" aria-hidden="true" />}
          {tabs.map((t) => {
            const key = t.plugin.id + "/" + t.id, sel = cur === t;
            return <button key={key} id={idOf(key)} className={"segb" + (sel ? " on" : "")} role="tab" aria-selected={sel} tabIndex={sel ? 0 : -1} {...tipProps(tabLabel(t))} onKeyDown={onTabKey} onClick={() => { hideTip(); setTab(key); }}><TabGlyph name={t.icon} /></button>;
          })}
        </div>
        {tip && <span className="segTip" role="tooltip" style={{ left: tip.x }}>{tip.text}</span>}
        <button className="mini" title="Modül ayarları" aria-label="Modül ayarları" onClick={openModuleSettings}><Settings /></button>
        <button className="kapat" title="Kapat (Esc)" aria-label="Kapat" onClick={onClose}><X /></button>
      </div>
      {shown !== "pano" && <div className="modBody" key={shown} role="tabpanel" aria-labelledby={idOf(shown)}>{body(shown)}</div>}
      {want === "pano" && <div className={"modBody" + (waiting ? " bekle" : "")} key="pano" role="tabpanel" aria-labelledby={idOf("pano")}><PanoView bare onReady={() => setPanoOk(true)} /></div>}
    </div>
  );
}

const Orta = ({ children }: { children: ReactNode }) => <div className="govde"><div className="mkOrta">{children}</div></div>;

export const NotchIk = ({ size }: { size: number }) => <span className="notchIk" style={{ width: size, height: size }}><PanelTop /></span>;

const TITLE = "Peeka'ya hoş geldin";
const STRIP = "Bu şerit görev çubuğunun yerini aldı: solda uygulamaların, ortada ada, sağda saat ve durum.";
const SEARCH = "Ctrl+K ile uygulama, pencere, dosya ve ayar ara.";
const STEPS: { d: string; note?: string }[] = [
  { d: STRIP },
  { d: SEARCH + " Ctrl+Shift+Enter ile adadaki uyarıya klavyeyle ulaşırsın." },
  { d: STRIP + " " + SEARCH, note: "Windows görev çubuğuna dönmek istersen: Ayarlar › Görünüm › Görev çubuğunu geri getir" },
];

/**
 * Peeka'nın ilk açılışı (`ilk`): üç sayfa, son sayfada maketteki tam metin ve görev çubuğuna dönüş yolu; ilk iki sayfada "Geç".
 * Kahraman: asistan bağlıysa el sallayan maskot 96 (FPV §19; maket nötr simge çizer, sapma bilinçli), değilse nötr Peeka simgesi. `?adim=3` önizlemede son sayfadan başlatır.
 */
export function FirstRunCard({ onDone, mascot = false }: { onDone: () => void; mascot?: boolean }) {
  const [i, setI] = useState(() => { const n = Number(new URLSearchParams(location.search).get("adim")); return n >= 1 && n <= STEPS.length ? n - 1 : 0; });
  const last = i === STEPS.length - 1;
  return (
    <Orta>
      {mascot ? <WaveMascot /> : <NotchIk size={72} />}
      <div className="t20 b6">{TITLE}</div>
      <div className="frMetin"><div className="t13 l2 b4">{STEPS[i].d}</div>{STEPS[i].note && <div className="t12 l3 b4">{STEPS[i].note}</div>}</div>
      <div className="adimlar" aria-label={`Adım ${i + 1} / ${STEPS.length}`}>{STEPS.map((_, k) => <i key={k} className={k === i ? "on" : ""} />)}</div>
      <div className="dugmeler frDugme" style={{ marginTop: 2 }}>
        {/* sabit yuvalar: sayfa değişince hiçbir düğme kaymaz (olmayan yuva yalnız gizlenir) */}
        <button className="btn cam" style={{ visibility: i > 0 ? "visible" : "hidden" }} tabIndex={i > 0 ? 0 : -1} aria-hidden={i === 0} onClick={() => setI(i - 1)}>Geri</button>
        <button className="btn cam" style={{ visibility: last ? "hidden" : "visible" }} tabIndex={last ? -1 : 0} aria-hidden={last} onClick={onDone}>Geç</button>
        <button className="btn ana" data-autofocus onClick={() => (last ? onDone() : setI(i + 1))}>{last ? "Başla" : "İleri"}</button>
      </div>
    </Orta>
  );
}
