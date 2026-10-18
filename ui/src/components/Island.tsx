import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, Clipboard, LayoutGrid, Lock, Search, Settings as SettingsIcon, ShieldCheck, Volume2, VolumeX, X } from "lucide-react";
import { bridge, UNSUPPORTED_EVENT, type Alert, type ApprovalItem, type AssistantCounts, type BluetoothEvent, type ClipPlain, type CpuHigh, type DownloadDone, type Media, type MusicStopped, type ProtrusionItem, type Status, type TimerState, type VolumeOsd } from "../bridge";
import { timerLeft, useAlerts, useBluetooth, useComposer, useConsent, useHitRects, useInput, useLock, useMainAssistant, useMedia, useMirror, useNow, usePlugins, useMeetingReminder, useSecond, useSettings, useShelf, useShelfDrag, useStatus, useSurfaces, useSysmon, useTimer } from "../hooks";
import { pickProtrusion } from "../lib/alerts";
import { addHitProvider } from "../lib/hitRects";
import { cap99, flat, pluginName } from "../lib/plugin";
import { Kbd } from "./common";
import { Mascot, createIdlePrank, type Mood, type MascotHandle } from "../mascot";
import { firstRunDone, markFirstRun } from "../lib/firstRun";
import { focusViaKeys, onX, sendX, tabLeaves } from "../lib/xwin";
import { ambientMood } from "../mascot/ambient";
import { createCcMood } from "../mascot/ccMood";
import { BtBump, BtCenter, ChargeBump, ChargeCenter, LowBatteryBump, LowBatteryCenter, ShelfBump, ShelfCard, ShelfCenter, TimerBump, TimerCenter, TimerDoneBump, TimerDoneCenter, NetBump, NetCenter, AwayBump, AwayCenter } from "./Extras";
import { announceCenterClock } from "../lib/centerClock";
import { clockParts } from "../lib/clock";
import { coverColors } from "../lib/coverColor";
import { fly } from "../lib/flight";
import { trackKey, trackTitle } from "../lib/media";
import { focusables, useFocusTrap } from "../lib/useFocusTrap";
import { YAY } from "../motion/spring";
import { AWAY_IDLE_MS, awayLabel, createAway, SUMMARY_MS, type AwayCounts } from "../lib/away";
import { useNetNotice, type NetNote } from "../lib/netNotice";
import { pickPrimary, timerKind, type ActivityKind } from "../lib/priority";
import { bubbleItem, LOCK_ALERT, LOCK_MUSIC, SideBubble } from "./SideBubble";
import { createBatteryTiers, createBurst, createCcSessions, type Burst, type CcSession } from "../lib/notes";
import { BurstBump, BurstCenter, CpuBump, CpuCenter, DownloadBump, DownloadCenter, MusicStoppedBump, MusicStoppedCenter, QuotaBump, QuotaCenter, resumeMusic, SessionChip } from "./Notes";

/** Kartın gölgesi (notch-extra.css: 0 28px 72px) pencere bölgesinden kesilmesin: yanlara ve alta bu kadar pay (CSS px). */
const GOLGE_YAN = 72, GOLGE_ALT = 110;
import { useSpring } from "../motion/useSpring";
import { ApprovalBump, ApprovalCard, ApprovalCenter, ApprovalShort, ComposerCard, Lead, ProtrusionBump, ProtrusionCenter, type Suggestion } from "./Plugin";
import { LockCard, LockCenter, PanoCenter, PanoView, ShotBump, ShotCenter, STRIP_TXT, stripKind } from "./Pano";
import { Bars, FirstRunCard, ModulesCard, modulesKw, MusicBump, MusicCard, OsdBump } from "./IslandCards";
import { AdaLine, AlertBumpFid, AlertCenter, AsistanYokCard, DndRest, LoadingBody, HiddenCenter, JobDoneCenter, MeetingCard, MeetingCenter, OfflineRest, ShelfOpenCenter, ShelfSuggestRow } from "./Fidelity";
import { announceLine, announceNotif, announceWave } from "../lib/lineChan";
import { AMBER, CYAN, lineOf } from "../lib/line";
import { installKbModality } from "../lib/kbModality";
import { useFirstConnect, useIslandHidden } from "../hooks.fidelity";
import { EmptyBoard, ErrorCard, ErrorCenter, FirstConnectCard, FirstConnectCenter, LoadingCenter } from "./CardsExtra";

/** Kullanıcının açtığı kartlar. Kendiliğinden çıkan çıkıntılar (ses, uyarı, yeni parça) bunların altında kalır. */
export type IslandView = "music-card" | "modules" | "asistanyok" | "ilk" | "approval-card" | "composer" | "pano" | "raf" | "meeting" | "ilk2" | "hata";
export interface IslandInit {
  view?: IslandView | null;
  /** Önizleme: kendiliğinden kapanan çıkıntılar (ses, yeni parça) kapanmaz; ekran görüntüsü sabit kalsın. */
  pin?: boolean;
  /** Önizleme: açılışta yeni parça çıkıntısı aç. */
  autoMusic?: boolean;
  /** Önizleme: açılışta ses göstergesi. */
  osd?: VolumeOsd;
  /** Önizleme: imleç üstünde gibi. */
  hover?: boolean;
  /** Önizleme: açılışta Ctrl+Space'e bu soruyu gönder. */
  ask?: string;
  /** Önizleme: açılışta ekran alıntısı çıkıntısı (maket h1); kendiliğinden kapanmaz. */
  shot?: boolean;
  /** Önizleme: açılışta şarj / Bluetooth çıkıntısı (kendiliğinden kapanmaz) ve dosya sürüklenirken raf çıkıntısı. */
  charge?: boolean;
  bt?: { name: string; battery: number | null };
  shelfDrag?: boolean;
  /** Önizleme: şeritteki merkezi etiket ("Ara", "Peeka ayarları") gibi. */
  panel?: "search" | "settings";
  /** Önizleme (maket ky, kh, kb): Pano kartının yükleniyor / hata / boş hali. */
  card?: "ky" | "kh" | "kb";
  /** Önizleme (maket mz): açılışta maskot muzipliği oynar. */
  prank?: boolean;
  /** Önizleme (maket cev, bit): asistan çevrimdışı / iş bitti şeridi. */
  offline?: boolean;
  done?: { title: string; took: string };
  /** Önizleme: zamanlayıcı bitti kartı ("Süre doldu"). */
  timerDone?: string;
  /** Önizleme: bağlantı koptu / geri geldi çıkıntısı. */
  net?: NetNote;
  /** Önizleme: "Sen yokken" özeti. */
  away?: AwayCounts;
  /** Önizleme: bildirim yağmuru çıkıntısı; "Neden?" kartı için hata metni. */
  burst?: Burst;
  err?: string;
  /** Önizleme: "Müzik durdu" çıkıntısı. */
  stopped?: MusicStopped;
  /** Önizleme: "İndi" çıkıntısı. */
  dl?: DownloadDone;
  /** Önizleme: işlemci yoğun çıkıntısı. */
  cpu?: CpuHigh;
}

/** Windows ile kendiliğinden başlayınca Rust sayfayı `?autostart=1` ile açar: hoş geldin kartı çıkmaz (elle başlatılınca çıkar). */
const autoStarted = () => new URLSearchParams(location.search).get("autostart") === "1";

type Kind = "rest" | "hov" | "music" | "alert" | "osd" | "approval" | "plugin" | "shot" | "lock" | "charge" | "lowbat" | "burst" | "kota" | "mdur" | "indi" | "cpu" | "bt" | "timer" | "timerdone" | "net" | "sum" | "shelfdrag" | "panel" | "bit" | "ky" | "kh" | "kb" | IslandView;
interface Spec { key: string; mode: "peek" | "cik" | "kart"; kw?: number; label: string; node: ReactNode }

const HOVER_SPRING = { tepki: 0.3, sonum: 1 };
const OSD_MS = 1800;
// maskota tıklama: tokat önce görünsün, soru kutusu/Modüller ~180 ms sonra açılır (ezilme tepesi + geri yaylanma)
const SLAP_OPEN_MS = 180;
const DONE_MS = 3200; // iş bitti şeridi (maket bit)
const SHOT_MS = 4200; // ekran alıntısı çıkıntısı (maket h1: yaklaşık 4 sn)
const MUSIC_MS = 6000;

/** Şekil yeni anahtara geçince eski içeriği 140 ms soldurmak için son hali tutar (içerik girişi 380, çıkış 130 ms, §0i madde 8). */
function useOld(key: string, node: ReactNode, width?: number) {
  const last = useRef({ key, node, width });
  const [old, setOld] = useState<{ node: ReactNode; width?: number } | null>(null);
  if (last.current.key !== key) { setOld({ node: last.current.node, width: last.current.width }); last.current = { key, node, width }; } else last.current = { key, node, width };
  useEffect(() => { if (old === null) return; const t = setTimeout(() => setOld(null), 140); return () => clearTimeout(t); }, [old]);
  return old;
}

/** Kart katmanı: açılınca odak içeri, Tab içeride döner, Esc `onClose`, sökülünce odak açan öğeye döner. Çıkıntılar odak almaz (kendiliğinden gelirler). */
const NO_MODULES_BTN = new Set(["modules", "lock", "ilk", "ilk2", "ky"]);
function Layer({ spec, onClose, onModules, measure }: { spec: Spec; onClose: () => void; onModules: () => void; measure: (el: HTMLDivElement | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onClose, spec.mode === "kart", () => document.querySelector<HTMLElement>(".adaMerkez"));
  const set = useCallback((el: HTMLDivElement | null) => { ref.current = el; measure(el); }, [measure]);
  const kart = spec.mode === "kart";
  const mods = spec.key === "modules";
  // Her kartta görünür çıkış: × (fare ile, odaksız pencerede de çalışır); sekme çubuğu olmayan kartlarda ayrıca "Modüller". DOM'da sonda (odak ilk denetimde kalsın), görsel olarak üstte.
  const close = <button className="kapat" title="Kapat (Esc)" aria-label="Kapat" onClick={onClose}><X /></button>;
  return (
    <div ref={set} className={"adaIc m" + spec.mode + (kart && !mods ? " conBar" : "")} role={kart ? "dialog" : "group"} aria-label={spec.label} style={{ width: kart ? spec.kw : "max-content" }}>
      {spec.node}
      {kart && !mods && (<div className="kartBar">{!NO_MODULES_BTN.has(spec.key) && <button className="kapat modGit" onClick={onModules}><LayoutGrid />Modüller</button>}{close}</div>)}
    </div>
  );
}

function useSize(): [HTMLElement | null, (el: HTMLElement | null) => void, { w: number; h: number }] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!el) { setSize((s) => (s.w || s.h ? { w: 0, h: 0 } : s)); return; }
    const read = () => setSize((s) => (s.w === el.offsetWidth && s.h === el.offsetHeight ? s : { w: el.offsetWidth, h: el.offsetHeight }));
    const ro = new ResizeObserver(read);
    ro.observe(el);
    read();
    return () => ro.disconnect();
  }, [el]);
  return [el, setEl, size];
}

interface CenterOpts {
  time: string; media: Media | null; alert: Alert | null; osd: VolumeOsd | null; approval: ApprovalItem | null; plug: ProtrusionItem | null; composerLabel: string | null;
  net: NetNote | null; shot: ClipPlain | null; timerDone: string | null; main: ReturnType<typeof useMainAssistant>; locked: boolean; alertsN: number; done: { title: string; took: string } | null; meeting: ProtrusionItem | null; burst: Burst | null; stopped: MusicStopped | null; dl: DownloadDone | null; cpu: CpuHigh | null;
  /** Dinlenme ortası (maskot, "Pusula hazır", sayılar ya da saat); hangi kartta hangi parçanın görüneceğini Island seçer. */
  rest: ReactNode; battery: Status["battery"]; bt: BluetoothEvent | null; timer: TimerState | null; shelfCount: number; panel: "search" | "settings" | "status" | "start" | "mt" | null;
}
/* Kilitliyken şeritte ve baloncukta içerik yerine genel etiket: LOCK_MUSIC, LOCK_ALERT (SideBubble.tsx). */
const centerOf = (kind: Kind, o: CenterOpts): ReactNode => {
  const { media, alert, osd, approval, plug, composerLabel, main, rest } = o;
  switch (kind) {
    case "pano": return <PanoCenter />;
    case "lock": return <LockCenter />;
    case "shot": return <ShotCenter main={main} item={o.shot ?? undefined} />;
    case "approval": return approval && <ApprovalCenter a={approval} />;
    case "approval-card": return <ApprovalShort />;
    case "plugin": return plug && <ProtrusionCenter item={plug} />;
    case "charge": return o.battery && <ChargeCenter b={o.battery} />;
    case "lowbat": return o.battery && <LowBatteryCenter b={o.battery} />;
    case "burst": return o.burst && <BurstCenter b={o.burst} generic={o.locked} />;
    case "kota": return <QuotaCenter />;
    case "cpu": return o.cpu && <CpuCenter app={o.cpu.app} generic={o.locked} />;
    case "indi": return o.dl && <DownloadCenter name={o.dl.name} generic={o.locked} />;
    case "mdur": return o.stopped && <MusicStoppedCenter name={o.stopped.name} generic={o.locked} />;
    case "hata": return <ErrorCenter />;
    case "bt": return o.bt && <BtCenter name={o.bt.name} />;
    case "timer": return o.timer && <TimerCenter t={o.timer} />;
    case "sum": return <AwayCenter />;
    case "net": return <NetCenter lost={o.net !== "back"} />;
    case "timerdone": return <TimerDoneCenter label={o.locked ? null : o.timerDone} />;
    case "shelfdrag": return <ShelfCenter main={main} count={o.shelfCount} />;
    case "raf": return <ShelfOpenCenter />;
    case "bit": return o.done && <JobDoneCenter title={o.done.title} took={o.done.took} />;
    case "meeting": return <MeetingCenter main={main} />;
    case "ilk2": return <FirstConnectCenter />;
    case "ky": return <LoadingCenter title="Pano" />;
    case "kb": return <LoadingCenter title="Pano" icon={<Clipboard />} />;
    case "kh": return <ErrorCenter />;
    case "panel": return o.panel === "mt" ? <ApprovalShort /> : o.panel === "search"
      ? <span className="ms"><Search /><span className="b6">Ara</span><Kbd keys="Ctrl+K" /></span>
      : <span className="ms"><SettingsIcon /><span className="b6">Peeka ayarları</span></span>;
    case "composer": return <><span className="ms">{composerLabel ? <span className="l2">{composerLabel}</span> : <Kbd keys="Ctrl+Space" />}</span>{composerLabel && o.alertsN > 0 && <span className="t12 l3 num">{cap99(o.alertsN)} bildirim</span>}</>;
    case "music": return media && (
      <span className="ms">
        {main && <Lead plugin={{ id: main.id, name: main.name, main: true }} mascot="muzik" />}
        {o.locked ? <span className="b6">{LOCK_MUSIC}</span> : <>{media.art ? <img className="kapak" data-paylas="kapak" src={media.art} alt="" style={{ width: 18, height: 18, borderRadius: 5 }} /> : null}
        <span className="b6" data-paylas="baslik" title={trackTitle(media)}>{trackTitle(media)}</span><span className="l3" title={media.artist}>{media.artist}</span></>}<Bars />
      </span>
    );
    case "music-card": return <span className="ms">{main && <Lead plugin={{ id: main.id, name: main.name, main: true }} mascot="muzik" />}<Bars /><span className="l2">{media?.playing ? "Çalıyor" : "Duraklatıldı"}</span></span>;
    case "alert": return alert && <AlertCenter alert={alert} main={main} />;
    case "osd": return <span className="ms">{osd?.muted ? <VolumeX /> : <Volume2 />}{osd?.muted ? <span className="b6">Ses kapalı</span> : <><span className="b6">Ses</span>{osd?.device && <span className="l3">{osd.device}</span>}</>}</span>;
    case "ilk": return <span className="ms"><span className="b6">Peeka</span></span>;
    default: return rest;
  }
};

/**
 * Ada penceresi (760x620, saydam, sabit boy; pencere hiç boyutlanmaz): şeridin ortasındaki içerik, altından uzanan çıkıntı ve kart.
 * Şekil CSS'te yayla oynar; tıklanabilir yerleri `data-hit` ile Rust'a bildirilir. asistan bağlı değil (Dalga 3'e kadar hep böyle, karar 10):
 * ortada saat ve çalıyorsa müzik, asistan çizgisi yok.
 */
export function Island({ monitor, init }: { monitor: string; init?: IslandInit }) {
  const now = useNow();
  const { media, ready, position } = useMedia();
  const { alerts, top } = useAlerts();
  const [user, setUser] = useState<IslandView | null>(init?.view !== undefined ? init.view : firstRunDone() || autoStarted() ? null : "ilk");
  const [modStart, setModStart] = useState<string | undefined>(); // müzik çıkıntısı/ortası: Modüller Müzik sekmesinde açılır
  const [modPage, setModPage] = useState("genel"); // Modüller kartının etkin sekmesi: kart genişliği buna uyar
  const [modName, setModName] = useState("Genel"); // etkin sekmenin adı: kartın erişilebilir adı (F-03)
  const onModPage = useCallback((p: string, n: string) => { setModPage(p); setModName(n); }, []);
  const lock = useLock();
  const main = useMainAssistant();
  const plugins = usePlugins();
  const [status] = useStatus();
  const settings = useSettings();
  const timer = useTimer();
  const shelf = useShelf();
  const input = useInput();
  const [shot, setShot] = useState<ClipPlain | null>(null);
  const [hover, setHover] = useState(!!init?.hover);
  const [pinned, setPinned] = useState<ActivityKind | null>(null); // kullanıcının baloncuktan öne aldığı iş
  const [more, setMore] = useState(false); // baloncuğun "+N" listesi
  const [bubbleHover, setBubbleHover] = useState(false);
  const [mkHover, setMkHover] = useState(false); // imleç şerit maskotunda: ince "hov" çıkıntısı gövdeyi örtmesin, yerine sayı balonu çıkar
  const [kbIn, setKbIn] = useState(false); // klavye odağı çıkıntının içindeyken kendiliğinden kapanma durur (WCAG 2.2.1)
  const hold = hover || kbIn;
  const [netNote, dismissNet] = useNetNotice(status?.network, !!init?.pin || hold, init?.net ?? null);
  const [summary, setSummary] = useState<AwayCounts | null>(init?.away ?? null); // "Sen yokken" özeti (satır 38)
  const away = useRef(createAway()).current;
  const [osd, setOsd] = useState<VolumeOsd | null>(init?.osd ?? null);
  const [musicAuto, setMusicAuto] = useState(!!init?.autoMusic);
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const [tint, setTint] = useState<[string, string] | null>(null);
  const surf0 = useSurfaces();
  // asistanın takviminden toplantı hatırlatması (satır 22): bir eklenti çıkıntısı yokken onun yerine geçer; kilit ya da sunumda genel metin
  const reminder = useMeetingReminder(lock.locked || input.presentation);
  const surf = useMemo(() => (reminder && !surf0.protrusion ? { ...surf0, protrusion: reminder } : surf0), [surf0, reminder]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const composer = useComposer();
  // sohbet açıkken şerit gerçek hali söyler (Peeka metni, ad Peeka'nın kaydından): cevap sürerken "yanıtlıyor", yoksa "hazır"
  const last = composer.turns.at(-1);
  const composerLabel = last && surf.composer ? `${pluginName(surf.composer)} ${last.state === "wait" ? "yanıtlıyor" : "hazır"}` : null;
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const seeded = useRef(false);
  useEffect(() => { if (init?.ask && !seeded.current) { seeded.current = true; composer.send(init.ask, []); } }, [init?.ask, composer]);
  const pin = !!init?.pin;
  const [bt, dismissBt] = useBluetooth(pin || hold, 3000, init?.bt ?? null); // imleç üstündeyken kendiliğinden kapanma durur (O2)
  const shelfDrag = useShelfDrag() || !!init?.shelfDrag;
  const [fullscreen, setFullscreen] = useState(false);
  const hidden = useIslandHidden(); // Ctrl+Shift+A / sağ tık: ada 1 saat ya da yeniden basana dek gizli (Rust yönetir); onay ve güvenlik yine çıkıntı açar
  const [offline, setOffline] = useState(!!init?.offline);
  const [done, setDone] = useState<{ title: string; took: string } | null>(init?.done ?? null);
  const doneAt = useRef<number[]>([]);
  const [panelLabel, setPanelLabel] = useState<"search" | "settings" | "status" | "start" | "mt" | null>(init?.panel ?? null);
  // asistan ilk bağlandı (ilk2, hayatta bir kez)
  const [fc, ackFc] = useFirstConnect();
  useEffect(() => { if (fc) setUser((u) => (u === null ? "ilk2" : u)); }, [fc]);
  const consent = useConsent();
  // Pano kartının yüklenme durumu (ky: 800 ms'yi geçmezse hiç görünmez, kh: hata, kb: boş); önizleme `init.card` ile sabitler
  const forced = !!init?.card;
  const [probe, setProbe] = useState<"ok" | "loading" | "error" | "empty">(init?.card === "ky" ? "loading" : init?.card === "kh" ? "error" : init?.card === "kb" ? "empty" : "ok");
  const [probeErr, setProbeErr] = useState(init?.card === "kh" ? { title: "Claude Code'a ulaşamıyorum", detail: "Hook köprüsü yanıt vermiyor (zaman aşımı)." } : { title: "Pano açılamadı", detail: "" });
  const [tryN, setTryN] = useState(0);
  useEffect(() => {
    if (forced || user !== "pano") return;
    let live = true;
    setProbe((p) => (p === "error" ? "ok" : p));
    const slow = setTimeout(() => { if (live) setProbe((p) => (p === "ok" ? "loading" : p)); }, 800); // iskelet yalnız yükleme gerçekten uzarsa
    bridge.call("clip_list").then(() => { clearTimeout(slow); if (live) setProbe("ok"); }).catch((e) => { clearTimeout(slow); if (live) { setProbeErr({ title: "Pano açılamadı", detail: String(e) }); setProbe("error"); } });
    return () => { live = false; clearTimeout(slow); };
  }, [user, forced, tryN]);
  // şarj: fişe takılınca 3 sn; düşük pil: prizde değilken eşiğin altında, görülünce (Esc / Sonra) şarj olana dek susar
  const batt = status?.battery ?? null;
  const [charge, setCharge] = useState(!!init?.charge);
  const prevCharging = useRef<boolean | undefined>(undefined);
  useEffect(() => { if (!batt) return; if (prevCharging.current === false && batt.charging) setCharge(true); prevCharging.current = batt.charging; }, [batt]);
  useEffect(() => { if (!charge || pin || hold) return; const t = setTimeout(() => setCharge(false), 3000); return () => clearTimeout(t); }, [charge, pin, hold]);
  // düşük pil (satır 26): %20 ve %10 kademeleri birer kez, prize takılınca sıfırlanır; 15 sn sonra (imleç üstünde değilse) kalkar
  const tiers = useRef(createBatteryTiers()).current;
  const [battTier, setBattTier] = useState<10 | 20 | null>(null);
  useEffect(() => { if (!batt) return; const powered = batt.charging || batt.plugged, t = tiers.feed(batt.percent, powered); if (powered) setBattTier(null); else if (t) setBattTier(t); }, [batt, tiers]);
  useEffect(() => { if (!battTier || pin || hold) return; const t = setTimeout(() => setBattTier(null), 15_000); return () => clearTimeout(t); }, [battTier, pin, hold]);
  // bildirim yağmuru (33): 5 sn'de 6 yeni bildirim tek çıkıntı. Kota doldu (15): Claude Code `stop_failure`+`rate_limit`, 30 sn.
  const mir = useMirror();
  const burstFeed = useRef(createBurst()).current;
  const [burst, setBurst] = useState<Burst | null>(init?.burst ?? null);
  useEffect(() => { if (!mir.ready) return; const b = burstFeed.feed(mir.items, Date.now()); if (b && !mir.quiet) setBurst(b); }, [mir, burstFeed]);
  useEffect(() => { if (!burst || pin || hold) return; const t = setTimeout(() => setBurst(null), 8000); return () => clearTimeout(t); }, [burst, pin, hold]);
  const [quota, setQuota] = useState(false);
  // kulaklık ayrıldı, müzik durdu (Rust `music_stopped`): birkaç sn "Devam"
  // indirme bitti (Rust `download_done`): "İndi: ad", Aç / Klasörde göster; 8 sn
  // işlemci uzun süre %95 üstünde (Rust `cpu_high`; kararı Rust verir, sayfada zamanlayıcı yok): 10 sn
  const [cpuHigh, setCpuHigh] = useState<CpuHigh | null>(init?.cpu ?? null);
  useEffect(() => { if (!cpuHigh || pin || hold) return; const t = setTimeout(() => setCpuHigh(null), 10_000); return () => clearTimeout(t); }, [cpuHigh, pin, hold]);
  const [dl, setDl] = useState<DownloadDone | null>(init?.dl ?? null);
  useEffect(() => { if (!dl || pin || hold) return; const t = setTimeout(() => setDl(null), 8000); return () => clearTimeout(t); }, [dl, pin, hold]);
  const [stopped, setStopped] = useState<MusicStopped | null>(init?.stopped ?? null);
  useEffect(() => { if (!stopped || pin || hold) return; const t = setTimeout(() => setStopped(null), 8000); return () => clearTimeout(t); }, [stopped, pin, hold]);
  useEffect(() => { if (!quota || pin || hold) return; const t = setTimeout(() => setQuota(false), 30_000); return () => clearTimeout(t); }, [quota, pin, hold]);
  // Claude Code oturum sayısı (13) ve son hata (43): Peeka'nın kendi kancasından (cc_event)
  const sessCount = useRef(createCcSessions()).current;
  const [nSess, setNSess] = useState(0);
  const [sessList, setSessList] = useState<CcSession[]>([]);
  const [lastCc, setLastCc] = useState<{ tool: string | null; at: number } | null>(null);
  const [ccErr, setCcErr] = useState<{ tool: string | null; reason: string | null } | null>(init?.err ? { tool: init.err, reason: null } : null);
  const [, setTickSecond] = useState(0);
  // sessiz kalan Claude Code oturumu olay gelmese de düşer (dakikada bir)
  useEffect(() => { if (nSess === 0) return; const t = setInterval(() => { setNSess(sessCount.count(Date.now())); setSessList(sessCount.list(Date.now())); }, 60_000); return () => clearInterval(t); }, [nSess > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  useHitRects("island", monitor);

  // Rust'ın dikkat bütçesi `top`'a karar verir (rahatsız etme, tam ekran, toplantı); sayfa yalnız görülenleri eler.
  const alertRaw = pickProtrusion(alerts.filter((a) => a.id === top), seen);
  // Sunum (satır 37): kendiliğinden çıkıntı yok, içerik hep genel etiket (kilit yoluyla aynı: `priv`). Sayı "N bildirim" olarak şeritte kalır.
  const priv = lock.locked || input.presentation;
  const alert = alertRaw && input.presentation ? null : alertRaw && lock.locked ? { ...alertRaw, title: LOCK_ALERT, subtitle: null } : alertRaw; // kilitliyken uyarı metni yerine genel etiket; düğmeler (Aç/Sonra) çalışır
  // Eklentiler: onay (en yüksek öncelik) > ses > uyarı > eklenti çıkıntısı > müzik. Hangisinin görüneceğine Rust'ın dikkat bütçesi karar verdi (`approvalTop`, `protrusion`).
  const approvalTop = surf.approvals.find((a) => a.id === surf.approvalTop) ?? null;
  const approvalCard = surf.approvals.find((a) => a.id === detailId) ?? approvalTop ?? surf.approvals[0] ?? null;
  // Peeka kilitliyken Pano ve Modüller kartları açılmaz, yerinde kilit kartı durur (ADR-0063 §6); ekran alıntısı çıkıntısı da çıkmaz
  const view: IslandView | "lock" | null = lock.locked && (user === "pano" || user === "modules" || user === "music-card") ? "lock" : user === "meeting" && !surf.protrusion ? null : user;
  // Sunum modu / meşgul (Windows, `input_tick`): kendiliğinden açılan çıkıntılar (ekran alıntısı, Bluetooth, şarj, müzik) susar; onay, ses ve uyarıyı Rust'ın dikkat bütçesi zaten süzer
  const calm = input.presentation || input.busy;
  const shotNow = shot && !lock.locked && !calm ? shot : null;
  const viewK: Kind | null = view === "pano" ? (probe === "error" ? "kh" : probe === "empty" ? "kb" : probe === "loading" ? "ky" : "pano") : view;
  // Canlı işlerin sırası tek yerde (lib/priority.ts): en öncelikli ana şeritte, sıradaki yan baloncukta. Kısa geçici çıkıntılar (ses, alıntı, pil, Bluetooth, raf) ortayı ödünç alır, baloncuğa dokunmaz.
  const tickS = useSecond(!!timer?.running); // zamanlayıcının son 60 sn'si sırayı değiştirir
  const leftS = timer ? timerLeft(timer, tickS) : null;
  // Süre doldu (ses yok): sayaç 0'a inince ya da Rust zamanlayıcıyı sıfıra yakınken kaldırınca kart çıkar; Kapat / +5 dk / Esc'e dek kalır.
  const [timerDone, setTimerDone] = useState<{ label: string } | null>(init?.timerDone !== undefined ? { label: init.timerDone } : null);
  const lastTimer = useRef<{ label: string; left: number } | null>(null);
  const ackedAt = useRef(-1); // kapatılan bitmiş zamanlayıcının `at`'ı: aynı durum yeniden kart açmaz
  if (timer && leftS !== null) lastTimer.current = { label: timer.label, left: leftS };
  useEffect(() => {
    if (timer) { if (leftS !== null && leftS <= 0 && timer.at !== ackedAt.current) setTimerDone({ label: timer.label }); else if (leftS !== null && leftS > 0) setTimerDone(null); return; }
    const l = lastTimer.current; lastTimer.current = null;
    if (l && l.left <= 2) setTimerDone({ label: l.label }); // sayaç bitişe 2 sn varken zamanlayıcı kalktı: bitti (elle Bitir uzun süre kala olur)
  }, [timer, leftS === null ? null : leftS <= 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const closeTimerDone = useCallback(() => { ackedAt.current = timer?.at ?? -1; setTimerDone(null); }, [timer]);
  const prot = surf.protrusion;
  const acts: { kind: ActivityKind }[] = [];
  if (approvalTop) acts.push({ kind: "approval" });
  if (prot && (!input.presentation || prot === reminder)) acts.push({ kind: prot.icon === "calendar" ? "meeting" : prot.plugin.main ? "live" : "other" });
  if (alert) acts.push({ kind: "alert" });
  if (timerDone) acts.push({ kind: "timerEnd" });
  else if (timer && leftS !== null) acts.push({ kind: timerKind(timer.running, leftS) });
  if (netNote && !calm) acts.push({ kind: "net" });
  if (battTier) acts.push({ kind: battTier === 10 ? "batteryCrit" : "battery" });
  if (burst && !calm) acts.push({ kind: "burst" });
  if (quota) acts.push({ kind: "rateLimit" });
  if (stopped && !calm) acts.push({ kind: "musicStopped" });
  if (dl) acts.push({ kind: "download" });
  if (cpuHigh && !calm) acts.push({ kind: "cpu" });
  if (summary && !calm) acts.push({ kind: "summary" });
  if (shotNow) acts.push({ kind: "clip" });
  if (done && !calm) acts.push({ kind: "done" });
  if (media && (media.playing || musicAuto)) acts.push({ kind: "music" });
  // imleç adanın ya da baloncuğun üstündeyken kendiliğinden yer değişmez (belge 9. satır): son ana iş sabitlenir; onay yine öne geçer
  const frozen = hold || bubbleHover;
  const autoTop = useRef<ActivityKind | null>(null);
  const plan = pickPrimary(acts, pinned ?? (frozen ? autoTop.current : null));
  if (!frozen) autoTop.current = plan.primary?.kind ?? null;
  const pk = plan.primary?.kind;
  const planK: Kind | null = pk === "approval" ? "approval" : pk === "alert" ? "alert" : pk === "timerEnd" && timerDone ? "timerdone" : pk === "timer" || pk === "timerEnd" ? "timer" : pk === "net" ? "net" : pk === "battery" || pk === "batteryCrit" ? "lowbat" : pk === "burst" ? "burst" : pk === "rateLimit" ? "kota" : pk === "musicStopped" ? "mdur" : pk === "download" ? "indi" : pk === "cpu" ? "cpu" : pk === "summary" ? "sum" : pk === "done" ? "bit"
    : pk === "music" ? (pinned === "music" || (musicAuto && !calm) ? "music" : null) : pk === "live" || pk === "meeting" || pk === "other" ? "plugin" : null;
  const transient: Kind | null = osd ? "osd" : pk === "clip" ? "shot" : shelfDrag ? "shelfdrag" : bt && !calm ? "bt" : charge && !calm ? "charge" : null;
  const base: Kind = viewK ?? (pk === "approval" ? "approval" : transient ?? planK ?? (hover && !mkHover ? "hov" : "rest"));
  const pinnedLive = pinned !== null && acts.some((a) => a.kind === pinned);
  useEffect(() => { if (pinned !== null && !pinnedLive) setPinned(null); }, [pinned, pinnedLive]); // öne alınan iş bitti: sıra kendiliğinden döner
  // Ara / Ayarlar şerit sayfasında açıkken ortada kısa etiket (bir bilgi bir kez); başka bir şey çıkıntıdaysa o kalır
  const kind: Kind = (panelLabel === "search" || panelLabel === "settings" || panelLabel === "mt") && (base === "rest" || base === "hov") ? "panel" : base;
  const sadePanel = panelLabel === "status" || panelLabel === "start"; // durum / Başlat açıkken ortada maskot yok (tek maskot kartta ya da panelde)
  const meetingItem = surf.protrusion?.icon === "calendar" ? surf.protrusion : null;
  const sys = useSysmon(kind === "modules");
  useEffect(() => { if (kind !== "modules") { setModPage("genel"); setModName("Genel"); setModStart(undefined); } }, [kind]);
  const owner = useRef(surf.composer);
  owner.current = surf.composer;

  /* ---- olaylar ---- */
  const userRef = useRef(user);
  userRef.current = user;
  /** Ctrl+Space: açık şerit paneli (Ctrl+K...) kapanır, soru kutusu üstte açılır ve odağı alır (sürtünme 2 / R2-Y3). */
  const openAsk = (to: IslandView) => {
    sendX({ t: "island-click" });
    setUser(to);
    setTimeout(() => stage.current?.querySelector<HTMLElement>("[data-composer] input, [data-autofocus]")?.focus(), 90);
  };
  const [meetingOn, setMeetingOn] = useState(false);
  const [ccMood, setCcMood] = useState<Mood | null>(null);
  const ccFeed = useRef<ReturnType<typeof createCcMood> | null>(null);
  useEffect(() => { const f = createCcMood(setCcMood); ccFeed.current = f; return () => { f.dispose(); ccFeed.current = null; }; }, []);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hoverIntent = (on: boolean) => { if (hidden) on = false; clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => setHover(on), on ? 120 : 200); };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  useEffect(() => {
    const offs = [
      bridge.on("volume_osd", setOsd),
      bridge.on("notch://fullscreen", setFullscreen),
      bridge.on("music_stopped", setStopped),
      bridge.on("download_done", setDl),
      bridge.on("cpu_high", setCpuHigh),
      bridge.on("assistant_offline", setOffline),
      bridge.on("meeting_changed", setMeetingOn),
      bridge.on("cc_event", (e) => {
        ccFeed.current?.feed(e);
        setNSess(sessCount.feed(e, Date.now())); setSessList(sessCount.list(Date.now())); setLastCc({ tool: e.tool ?? null, at: Date.now() });
        if (e.kind === "stop_failure" && e.reason === "rate_limit") setQuota(true);
        if (e.kind === "tool_failed" || e.kind === "stop_failure") setCcErr({ tool: e.tool ?? null, reason: e.reason ?? null });
      }),
      // iş bitti: saatte en çok 3 (maskot kutlaması, §0i madde 19)
      bridge.on("job_done", (e) => { away.done(); const t = Date.now(); doneAt.current = doneAt.current.filter((x) => t - x < 3_600_000); if (doneAt.current.length >= 3) return; doneAt.current.push(t); setDone(e); }),
      bridge.on("clip_changed", (c) => { if (c.reason === "added" && c.item && c.item.kind !== "password" && stripKind(c.item)) setShot(c.item); }), // her görsel, dosya ve bağlantı; düz metin ve parola açmaz
      bridge.on("shortcut", (e) => {
        if (e.name === "ask") { const to = owner.current ? "composer" : "asistanyok"; if (userRef.current === to) setUser(null); else openAsk(to); }
        else if (e.name === "focus_island") { const t = stage.current?.querySelector<HTMLElement>(".sarkan"); (t && focusables(t)[0]) ? focusables(t)[0].focus() : center.current?.focus(); }
      }),
    ];
    return () => { offs.forEach((o) => o.then((f) => f())); };
  }, []);
  useEffect(() => { if (!done || pin || hold) return; const t = setTimeout(() => setDone(null), DONE_MS); return () => clearTimeout(t); }, [done, pin, hold]);
  useEffect(() => { if (!shot || pin || hold) return; const t = setTimeout(() => setShot(null), SHOT_MS); return () => clearTimeout(t); }, [shot, pin, hold]);
  useEffect(() => { if (init?.shot) bridge.call("clip_list").then((l) => setShot((l.find((c): c is ClipPlain => c.kind === "image" && c.screenshot) ?? null))).catch(() => undefined); }, [init?.shot]);
  useEffect(() => { if (!osd || pin || hold) return; const t = setTimeout(() => setOsd(null), OSD_MS); return () => clearTimeout(t); }, [osd, pin, hold]);
  // şerit sayfasından: açık panel etiketi ve "ilk açılışı tekrar göster"
  // panel-open: şerit paneli açılınca açık kart kapanır (Y5)
  useEffect(() => onX((m) => { if (m.t === "panel") setPanelLabel(m.panel); else if (m.t === "panel-open") setUser((u) => { if (u === "ilk") markFirstRun(); return null; }); else if (m.t === "firstrun") setUser("ilk"); else if (m.t === "welcome?") sendX({ t: "welcome", open: userRef.current === "ilk" }); else if (m.t === "ask") openAsk(owner.current ? "composer" : "asistanyok"); else if (m.t === "to-island") { const l = tabStops(); focusViaKeys(m.end ? l[l.length - 1] : l[0]); } }), []);
  // hoş geldin kartı açıkken şerit kurulum sihirbazını açmaz (bir şey bir kez): açık/kapalı bilgisi her değişimde şeride gider
  const welcomeOpen = user === "ilk";
  useEffect(() => { sendX({ t: "welcome", open: welcomeOpen }); }, [welcomeOpen]);
  // Tab sırası pencereler arası: adanın görünen denetimleri; sondan Tab şeridin sağ grubuna, baştan Shift+Tab sol gruba gider (kart açıkken odak tuzağı Tab'ı tutar)
  const tabStops = () => (stage.current ? focusables(stage.current).filter((el) => el.checkVisibility?.({ visibilityProperty: true }) ?? true) : []);
  const crossKey = (e: React.KeyboardEvent) => { if (tabLeaves(e, tabStops(), document.activeElement)) { e.preventDefault(); const side = e.shiftKey ? "left" : "right"; bridge.call("focus_strip", { monitor }).then(() => sendX({ t: "to-strip", side }), () => undefined); } }; // reddedilirse (odak Peeka'da değil) yerinde kalır

  /* ---- maskot: dinlenme ortasındaki 20 px, boştaki muziplik (saniyede bir yoklanır) ---- */
  const mascotRef = useRef<MascotHandle>(null);
  useEffect(() => { installKbModality(); }, []);
  useEffect(() => { if (!init?.prank) return; const t = setTimeout(() => mascotRef.current?.prank(), 800); return () => clearTimeout(t); }, [init?.prank]);
  const prankEnv = useRef({ on: false, dnd: false, presentation: false, meeting: false, music: false, cardOpen: false, fullscreen: false });
  const mainP = plugins.find((p) => p.main) ?? null;
  const asistanUp = !!main;
  // asistan bağlanınca "asistan bağlı değil" kartı kendiliğinden kapanır (R2-O3)
  const prevUp = useRef(asistanUp);
  useEffect(() => { if (asistanUp && !prevUp.current) setUser((u) => (u === "asistanyok" ? null : u)); prevUp.current = asistanUp; }, [asistanUp]);
  const asleep = !!mainP && !mainP.connected;
  const lastTurn = composer.turns.at(-1);
  const [justDone, setJustDone] = useState(false);
  useEffect(() => { if (lastTurn?.state !== "done") return; setJustDone(true); const t = setTimeout(() => setJustDone(false), 3000); return () => clearTimeout(t); }, [lastTurn?.id, lastTurn?.state]);
  // asistanın sayıları: şerit maskotunun hali ve üstüne gelince çıkan balon
  const [counts, setCounts] = useState<AssistantCounts | null>(null);
  const loadCounts = useCallback(() => { if (asistanUp) bridge.call("assistant_counts").then(setCounts).catch(() => undefined); }, [asistanUp]);
  useEffect(loadCounts, [loadCounts, surf.approvals.length]);
  const jobsN = counts?.jobs ?? 0, waitN = counts?.approvals ?? surf.approvals.length;
  const mood: Mood = justDone ? "done" : lastTurn?.state === "wait" ? (lastTurn.answer ? "speaking" : "thinking") : lastTurn?.state === "error" ? "error" : waitN > 0 ? "approval" : jobsN > 0 ? "thinking" : "idle";
  // 40 px asılı maskot her durumda aynı yerde: maskot Peeka'nın kendisi: asistan yoksa ya da bağlı değilse sakin idle, bağlıysa asıl hal; uyku yalnız boşta/pil ile (ortam halleri)
  const [idleMs, setIdleMs] = useState(0);
  useEffect(() => { const t = setInterval(() => setIdleMs(input.lastInputAgoMs()), 5000); return () => clearInterval(t); }, [input.lastInputAgoMs]);
  // "Sen yokken": rahatsız etme açık ya da 10 dk girdi yok = yokluk. Biterken yokluk boyunca yeni görünen bildirim, onay ve biten işler tek özet olur.
  const mirrorIds = mir.items.map((n) => n.id).join("|");
  const alertIds = alerts.map((a) => a.id).join("|"), approvalIds = surf.approvals.map((a) => a.id).join("|");
  const awayOn = !!status?.dnd || idleMs >= AWAY_IDLE_MS;
  useEffect(() => {
    const ids = (s: string) => (s ? s.split("|") : []);
    const r = away.sync(awayOn, [...ids(alertIds), ...ids(mirrorIds)], ids(approvalIds));
    if (r) { setSummary({ ...r }); setDone(null); } // biten işler özette sayılır: eski "iş bitti" şeridi yerini ona bırakır
  }, [awayOn, alertIds, mirrorIds, approvalIds, away]);
  useEffect(() => { if (!summary || calm || pin || hold) return; const t = setTimeout(() => setSummary(null), SUMMARY_MS); return () => clearTimeout(t); }, [summary, calm, pin, hold]);
  const awayText = summary ? awayLabel(summary, priv) : "";
  const openNotifs = () => { setSummary(null); announceNotif(); };
  const openBurst = () => { setBurst(null); announceNotif(); };
  // "Neden?" kartı (43): hata metni var olandır (sohbet turu hatası ya da kancadaki araç ve sebep); kilitliyken ya da sunumda ayrıntı gizli (yol ve sır sızmasın)
  const errTitle = lastTurn?.state === "error" ? "Cevap alınamadı" : "Claude Code hata verdi";
  const errRaw = lastTurn?.state === "error" && lastTurn.error ? lastTurn.error : ccErr ? `${ccErr.tool ?? "Bir araç"} başarısız oldu${ccErr.reason ? ` (${ccErr.reason})` : ""}.` : "";
  const errDetail = priv ? "Kilitliyken ayrıntı gizli." : errRaw || undefined;
  // Claude Code olayları (cc_event): sakin hal üstüne biner; asistanın onayı, işi, hatası her zaman önde
  // asistan yokken/uykudayken asistan halleri sakin; Claude Code olayları (Peeka'nın kendi kancası) yine maskotu sürer. Bağlıyken asistanın kendi onay/iş/hatası önde.
  const baseMood: Mood = mainP && !asleep && mood !== "idle" ? mood : ccMood ?? "idle";
  const moodShown = ambientMood({ base: baseMood, batteryPercent: batt?.percent ?? null, powered: !!batt && (batt.charging || batt.plugged), justPlugged: charge, idleMs });
  // maskot: tıklama = soru kutusu; dosya bırakma = yutar ve kutuda raf dosyaları ekli açılır; üstüne gelince sayılar
  const [autoShelf, setAutoShelf] = useState(false);
  const feed = () => { if (!owner.current) return; setAutoShelf(true); openAsk("composer"); };
  useEffect(() => { if (user !== "composer") setAutoShelf(false); }, [user]);
  // Sor kutusu açıkken ada klavye odağını alır; kapanınca önceki uygulamaya geri verir (ADR-0062 §1)
  const asking = user === "composer";
  useEffect(() => {
    if (!asking) return;
    bridge.call("typing_focus", { label: "island", on: true }).catch(() => undefined);
    return () => { bridge.call("typing_focus", { label: "island", on: false }).catch(() => undefined); };
  }, [asking]);
  useEffect(() => addHitProvider(() => mascotRef.current?.hitRect() ?? null), []);
  // Tauri'de bırakma Rust'a gider (rafa kopyalanır): raf büyüdüyse ve imleç maskottaysa maskot yutar
  const shelfN = useRef(shelf.length);
  useEffect(() => {
    const grew = shelf.length > shelfN.current; shelfN.current = shelf.length;
    const h = mascotRef.current?.hitRect(), c = input.cursor;
    if (grew && h && c && c.x >= h.x && c.x <= h.x + h.width && c.y >= h.y && c.y <= h.y + h.height) { mascotRef.current?.swallow(); feed(); }
  }, [shelf.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // demo kipinde `unsupported` dönen komut: kısa uyarı
  const [demoNot, setDemoNot] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const on = () => { setDemoNot(true); clearTimeout(t); t = setTimeout(() => setDemoNot(false), 2500); };
    addEventListener(UNSUPPORTED_EVENT, on);
    return () => { removeEventListener(UNSUPPORTED_EVENT, on); clearTimeout(t); };
  }, []);
  const restShown = kind === "rest" || kind === "hov";
  prankEnv.current = { on: (settings?.mascotPranks ?? true) && restShown, dnd: !!status?.dnd || input.busy, presentation: input.presentation, meeting: meetingOn || surf.protrusion?.icon === "calendar", music: !!media?.playing, cardOpen: !restShown, fullscreen };
  const lastInputAgoMs = input.lastInputAgoMs;
  useEffect(() => {
    const prank = createIdlePrank({
      now: Date.now, random: Math.random, enabled: () => prankEnv.current.on, lastInputAgoMs, fullscreen: () => prankEnv.current.fullscreen, dnd: () => prankEnv.current.dnd,
      presentation: () => prankEnv.current.presentation, meeting: () => prankEnv.current.meeting, cardOpen: () => prankEnv.current.cardOpen, musicPlaying: () => prankEnv.current.music,
    }, () => mascotRef.current?.prank());
    const t = setInterval(prank.poll, 1000);
    return () => clearInterval(t);
  }, [lastInputAgoMs]);

  // Ctrl+Space çipleri: yalnız öneri; tıklanınca eklenir (burada yalnız "Bu pencere", Pano ve Raf sonraki dalgalarda)
  useEffect(() => {
    if (user !== "composer") return;
    bridge.call("list_windows", { monitor }).then((ws) => { const w = ws.find((x) => x.active); setSuggestions(w ? [{ id: "window_image", label: `Bu pencere: ${w.name}` }] : []); }).catch(() => undefined);
  }, [user, monitor]);
  // onay cevaplanınca (ya da süresi dolunca) açık onay kartı kapanır
  const hadApproval = useRef(false); // yüzeyler eşzamansız yüklenir: kart ancak onay bir kez görüldükten sonra kaybolursa kapanır
  if (approvalCard) hadApproval.current = true;
  useEffect(() => { if (user === "approval-card" && hadApproval.current && !approvalCard) setUser(null); }, [user, approvalCard]);

  // yeni parça ya da çalmaya başlama: çıkıntı kendiliğinden açılır. İlk okuma sessizdir.
  const prevTrack = useRef<string | undefined>(undefined);
  const prevPlaying = useRef(false);
  useEffect(() => {
    if (!ready) return;
    const k = trackKey(media), first = prevTrack.current === undefined;
    if (media?.playing && !first && (k !== prevTrack.current || !prevPlaying.current)) setMusicAuto(true);
    prevTrack.current = k; prevPlaying.current = !!media?.playing;
  }, [media, ready]);
  useEffect(() => { if (!musicAuto || pin || hold) return; const t = setTimeout(() => setMusicAuto(false), MUSIC_MS); return () => clearTimeout(t); }, [musicAuto, pin, media, hold]);
  useEffect(() => { if (ready && !media) setMusicAuto(false); }, [media, ready]);
  // çalar kartı açıkken çalan kalkarsa (uygulama kapandı) şeritte "Duraklatıldı" takılı kalmaz
  useEffect(() => { if (ready && !media && user === "music-card") setUser(null); }, [media, ready, user]);

  // kart açıkken süre ve kalan süre her saniye ilerler
  useEffect(() => {
    if (!media?.playing || (kind !== "music" && kind !== "music-card" && kind !== "modules")) return;
    const t = setInterval(() => setTickSecond((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [media?.playing, kind]);

  // kapak renkleri yalnız kartta (ortam katmanı, hale)
  const cover = media?.art ?? null;
  useEffect(() => { let live = true; coverColors(cover).then((c) => { if (live) setTint(c); }); return () => { live = false; }; }, [cover]);

  /* ---- Esc: her basışta bir adım geri (kart → çıkıntısı → dinlenme) ---- */
  const back = useCallback(() => {
    if (more) return setMore(false);
    if (user === "music-card") { setUser(null); if (media) setMusicAuto(true); return; }
    if (user === "ilk") markFirstRun(); // Esc / × / dışarı tıklama "Geç" sayılır: kart her açılışta geri gelmesin
    if (user) return setUser(null);
    if (osd) return setOsd(null);
    if (done) return setDone(null);
    if (shot) return setShot(null);
    if (timerDone && kind === "timerdone") return closeTimerDone();
    if (netNote && kind === "net") return dismissNet();
    if (summary && kind === "sum") return setSummary(null);
    if (alert) return setSeen((s) => new Set(s).add(alert.id));
    if (battTier) return setBattTier(null);
    if (burst) return setBurst(null);
    if (quota) return setQuota(false);
    if (stopped) return setStopped(null);
    if (dl) return setDl(null);
    if (cpuHigh) return setCpuHigh(null);
    if (bt) return dismissBt();
    if (charge) return setCharge(false);
    if (musicAuto) return setMusicAuto(false);
    if (pinned) return setPinned(null);
  }, [user, osd, done, alert, shot, timerDone, closeTimerDone, netNote, dismissNet, summary, kind, musicAuto, media, battTier, burst, quota, stopped, dl, cpuHigh, bt, charge, dismissBt, more, pinned]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) back(); };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [back]);

  /* ---- içerik ---- */
  const { time, label } = clockParts(now);
  const pos = Math.floor(position()); // saniye: yay karelerinde kart girdisi değişmesin
  const musicCard = useMemo(() => media && <MusicCard media={media} pos={pos} />, [media, pos]);
  const openApproval = useCallback((id: string) => { setDetailId(id); setUser("approval-card"); }, []);
  const spec: Spec | null = (() => {
    switch (kind) {
      case "hov": return { key: "hov", mode: "peek", label: "Kartı aç", node: <button className="peek" tabIndex={-1} aria-label="Kartı aç" onClick={() => setUser("modules")}><i /></button> };
      case "music": return media && { key: "music", mode: "cik", label: "Müzik", node: <MusicBump media={media} pos={pos} /> };
      case "alert": return alert && { key: "alert:" + alert.id, mode: "cik", label: alert.title, node: <AlertBumpFid alert={alert} onLater={() => setSeen((s) => new Set(s).add(alert.id))} onDetail={() => setUser("modules")} /> };
      case "osd": return osd && { key: "osd", mode: "cik", label: "Ses", node: <OsdBump osd={osd} /> };
      case "shot": return shotNow && { key: "shot:" + shotNow.id, mode: "cik", label: shotNow.screenshot ? "Ekran alıntısı" : STRIP_TXT[stripKind(shotNow) ?? "image"], node: <ShotBump item={shotNow} main={main} big={hover} /> };
      case "lowbat": return batt && { key: "lowbat", mode: "cik", label: "Pil az", node: <LowBatteryBump b={batt} /> };
      case "burst": return burst && { key: "burst", mode: "cik", label: priv ? "Yeni bildirimler var" : `${burst.n} yeni bildirim`, node: <BurstBump onOpen={openBurst} /> };
      case "cpu": return cpuHigh && { key: "cpu", mode: "cik", label: priv || !cpuHigh.app ? "İşlemci çok yoğun" : `${flat(cpuHigh.app, 28)} çok yoruyor`, node: <CpuBump /> };
      case "indi": return dl && { key: "indi", mode: "cik", label: priv ? "İndirme bitti" : `İndi: ${flat(dl.name, 40)}`, node: <DownloadBump id={dl.id} generic={priv} /> };
      case "mdur": return stopped && { key: "mdur", mode: "cik", label: priv ? "Müzik durdu" : `Müzik durdu, ${stopped.name} ayrıldı`, node: <MusicStoppedBump onResume={() => { resumeMusic(); setStopped(null); }} /> };
      case "kota": return { key: "kota", mode: "cik", label: "Kota doldu", node: <QuotaBump onOk={() => setQuota(false)} /> };
      case "hata": return { key: "hata", mode: "kart", kw: 520, label: "Hata", node: <ErrorCard title={errTitle} hint="Bir şey ters gitti." detail={errDetail} retry="Tamam" onRetry={() => setUser(null)} /> };
      case "charge": return batt && { key: "charge", mode: "cik", label: "Şarj oluyor", node: <ChargeBump b={batt} /> };
      case "bt": return bt && bt.battery !== null ? { key: "bt", mode: "cik", label: "Bluetooth", node: <BtBump battery={bt.battery} /> } : null; // pil bildirmeyen cihazda yalnız şeritte "bağlandı"
      case "timer": return timer && { key: "timer", mode: "cik", label: "Zamanlayıcı", node: <TimerBump t={timer} /> };
      case "sum": return summary && { key: "sum", mode: "cik", label: awayText, node: <AwayBump text={awayText} onOpen={openNotifs} /> };
      case "net": return { key: "net:" + netNote, mode: "cik", label: netNote === "back" ? "Bağlantı geri geldi" : "Bağlantı koptu", node: <NetBump lost={netNote !== "back"} /> };
      case "timerdone": return timerDone && { key: "timerdone", mode: "cik", label: "Süre doldu", node: <TimerDoneBump label={priv ? "" : timerDone.label} onDone={closeTimerDone} /> };
      case "shelfdrag": return { key: "shelfdrag", mode: "cik", label: "Raf", node: <ShelfBump main={main} /> };
      case "raf": return { key: "raf", mode: "kart", kw: 620, label: "Raf", node: <><ShelfCard items={shelf} main={main} /><ShelfSuggestRow items={shelf} main={main} /></> };
      case "pano": return { key: "pano", mode: "kart", kw: 620, label: "Pano", node: <PanoView /> };
      case "lock": return { key: "lock", mode: "kart", kw: 520, label: "Peeka kilitli", node: <LockCard lock={lock} /> };
      case "approval": return approvalTop && { key: "approval:" + approvalTop.id, mode: "cik", label: approvalTop.title, node: <ApprovalBump a={approvalTop} dropMs={surf.dropStripMs} onlyDetail={surf.dropStripMs !== null} onDetail={() => { setDetailId(approvalTop.id); setUser("approval-card"); }} /> };
      case "plugin": return surf.protrusion && { key: "plugin:" + surf.protrusion.plugin.id, mode: "cik", label: surf.protrusion.title, node: <ProtrusionBump item={surf.protrusion} /> };
      case "approval-card": return approvalCard && { key: "approval-card:" + approvalCard.id, mode: "kart", kw: 620, label: approvalCard.title, node: <ApprovalCard a={approvalCard} /> };
      case "composer": return surf.composer && { key: "composer", mode: "kart", kw: 620, label: "Sor", node: <ComposerCard owner={surf.composer} turns={composer.turns} send={composer.send} suggestions={suggestions} autoShelf={autoShelf} /> };
      case "music-card": return musicCard && { key: "music-card", mode: "kart", kw: 520, label: "Müzik", node: musicCard };
      case "modules": return { key: "modules", mode: "kart", kw: modPage === "genel" && !surf.tabs.length && !surf.summary.length ? 620 : modulesKw(modPage, innerWidth), label: "Modüller: " + modName, node: <ModulesCard start={modStart} meeting={meetingItem} onPage={onModPage} onClose={back} media={media} pos={pos} sys={sys.tick} cpu={sys.cpu} surf={surf} shelf={shelf} main={main} onApproval={openApproval} timer={timer} /> };
      case "meeting": return meetingItem && { key: "meeting", mode: "kart", kw: 520, label: "Toplantı", node: <MeetingCard item={meetingItem} /> };
      case "ilk2": return { key: "ilk2", mode: "kart", kw: 520, label: `${mainP ? pluginName(mainP) : "Asistan"} bağlandı`, node: <FirstConnectCard onDone={() => { ackFc(); setUser(null); }} /> };
      case "ky": return { key: "ky", mode: "kart", kw: 620, label: "Pano okunuyor", node: <LoadingBody what="Pano okunuyor" /> };
      case "kb": return { key: "kb", mode: "kart", kw: 620, label: "Pano", node: <div className="govde"><EmptyBoard /></div> };
      case "kh": return { key: "kh", mode: "kart", kw: 520, label: "Hata", node: <ErrorCard title={probeErr.title} detail={probeErr.detail || undefined} onRetry={() => { if (!forced) { setProbe("loading"); setTryN((n) => n + 1); } }} /> };
      case "asistanyok": return { key: "asistanyok", mode: "kart", kw: 520, label: mainP ? `${pluginName(mainP)} bağlı değil` : "Asistan bağlı değil", node: <AsistanYokCard main={mainP} /> };
      case "ilk": return { key: "ilk", mode: "kart", kw: 520, label: "Peeka'ya hoş geldin", node: <FirstRunCard mascot={!!mainP} onDone={() => { markFirstRun(); setUser(null); }} /> };
      default: return null;
    }
  })();
  const centerKey = kind === "alert" ? "alert:" + alert?.id : kind === "approval" ? "approval:" + approvalTop?.id : kind === "plugin" ? "plugin:" + surf.protrusion?.title : kind === "rest" || kind === "hov" || kind === "modules" || kind === "asistanyok" ? "rest" + (sadePanel ? "-sade" : "") + (consent ? "-izin" : "") + (hidden ? "-gizli" : offline ? "-cevrimdisi" : status?.dnd ? "-dnd" : "") : kind === "panel" ? "panel:" + panelLabel : kind;
  // dinlenme ortası: asistan bağlıyken maskot + "Pusula hazır" + sayılar (a); değilken saat ve müzik (x0), asistan yüklü ama bağlı değilse uyuyan maskotla
  const approvalsN = surf.approvals.length;
  const rest = ((): ReactNode => {
    const lockIk = lock.locked && <Lock aria-label="Peeka kilitli" />;
    if (hidden && restShown) return <HiddenCenter />;
    if (consent && restShown) return <span className="ms"><ShieldCheck /><span className="b6">Eklenti izni</span></span>;
    if (asistanUp && mainP && restShown && offline) return <OfflineRest />;
    if (asistanUp && mainP && restShown && status?.dnd) return <DndRest approvals={approvalsN} until={status.dndUntil} lock={lockIk} />;
    if (asistanUp && kind !== "asistanyok" && mainP) {
      const card = kind === "modules" || sadePanel; // kart açıkken sayılar ve maskot kartta (bir bilgi bir kez)
      return (
        <>
          <span className="ms">{lockIk}{!card && <Mascot ref={mascotRef} size={40} mood={moodShown} isMainAssistant cursor={input.cursor} onFileDrop={feed} />}<span className="l2" title={composerLabel ?? `${pluginName(mainP)} hazır`}>{composerLabel ?? `${pluginName(mainP)} hazır`}</span></span>
          {!card && approvalsN > 0 && <span className="t12 b6 onaySay num">{cap99(approvalsN)} onay</span>}
          {alerts.length > 0 && <span className="t12 l3 num">{cap99(alerts.length)} bildirim</span>}
        </>
      );
    }
    return (
      <>
        <span className="ms">{lockIk}{restShown && !sadePanel && <Mascot ref={mascotRef} size={40} mood={moodShown} isMainAssistant cursor={input.cursor} />}<span className="b6 num">{time}</span></span>
        {approvalsN > 0 && <span className="t12 b6 onaySay num">{cap99(approvalsN)} onay</span>}{/* bağlantı koptuysa da bekleyen onay şeritte sayılır */}
        {media && (priv
          ? <span className="ms"><span className="l2">{LOCK_MUSIC}</span>{media.playing && <Bars />}</span>
          : <span className="ms">{media.art && <img className="kapak" src={media.art} alt="" style={{ width: 18, height: 18, borderRadius: 5 }} />}<span className="l2" title={trackTitle(media)}>{trackTitle(media)}</span>{media.playing && <Bars />}</span>)}
      </>
    );
  })();
  const centerNode = centerOf(kind, { time, media, alert, osd, approval: kind === "approval" ? approvalTop : null, plug: surf.protrusion, composerLabel: composerLabel, net: netNote, shot: shotNow, timerDone: timerDone?.label ?? null, main, locked: priv, alertsN: alerts.length, done, meeting: meetingItem, burst, stopped, dl, cpu: cpuHigh, rest, battery: batt, bt, timer, shelfCount: shelf.length, panel: panelLabel });

  const centerOld = useOld(centerKey, centerNode);
  const shapeOld = useOld(spec?.key ?? "none", spec?.node ?? null, spec?.mode === "kart" ? spec.kw : undefined);

  /* ---- ölçü ve yaylar ---- */
  const [, setCenterEl, cSize] = useSize();
  const [, setShapeEl, sSize] = useSize();
  // R1-9: panel (Ara, Ayarlar, Başlat, Durum, izin) açılıp kapanırken orta ada genişliği dinlenmedeki değerde kalır; yalnız kendi olayında değişir
  const panelOpen = panelLabel !== null || !!consent;
  const restW = useRef(0);
  if (!panelOpen && (kind === "rest" || kind === "hov") && cSize.w > 0) restW.current = cSize.w;
  const holdW = panelOpen && restW.current > 0 && (kind === "panel" || kind === "rest" || kind === "hov") ? restW.current : 0;
  const mw = Math.max(cSize.w, holdW);
  const mode = spec?.mode ?? "none";
  const tw = mode === "none" ? mw : mode === "peek" ? mw + 40 : mode === "kart" ? spec!.kw! : Math.max(mw + 24, sSize.w);
  const th = mode === "none" ? 0 : mode === "peek" ? 14 : sSize.h;
  const W = Math.max(0, useSpring(tw, YAY.kart));
  const H = Math.max(0, useSpring(th, YAY.kart));
  const bumpHover = hover && mode === "cik";
  const hv = useSpring(kind === "hov" || bumpHover ? 1 : 0, HOVER_SPRING);
  // asistan çizgisi: şerit sayfasına duyurulur (çıkıntının altında kesilir); ada çizgisi çıkıntının alt kenarında
  const ls = lineOf({ asistanUp, hidden: hidden && restShown, kind, mascot: surf.protrusion?.plugin.main ? surf.protrusion.mascot : null });
  const lineGap = mode === "none" ? 0 : Math.round(tw / 2 + Math.min(16, 8 + th * 0.12, th * 0.8));
  useEffect(() => { announceLine({ color: ls.color, mod: ls.mod, gap: lineGap }); }, [ls.color, ls.mod, lineGap]);
  // yeni onay, uyarı ya da toplantı çıkıntısı: şerit boyunca kısa dalga (Windows bildirimi dalga yapmaz)
  useEffect(() => {
    const c = kind === "approval" || kind === "alert" ? AMBER : kind === "plugin" && meetingItem ? CYAN : null;
    if (!c) return;
    const t = setTimeout(() => announceWave(c), 120);
    return () => clearTimeout(t);
  }, [centerKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = Math.min(H * 0.6, 34, 15 + Math.max(0, H - 40) * 0.3), f = Math.min(16, 8 + H * 0.12, H * 0.8);
  // kart rengi: müzikte kapaktan, onay kartında turuncu (maket c2)
  const ambient: [string, string] | null = kind === "music-card" ? tint : kind === "approval-card" ? ["#FF9F0A", "#FF9F0A"] : kind === "modules" ? ["#5E5CE6", "#5E5CE6"] : kind === "composer" ? ["#63E6E2", "#63E6E2"] : null;
  const glow = (kind === "modules" && modPage === "müzik" && tint) || ambient; // kart rengi sekmeler arasında sabit; yalnız kapak ışığı kapağı izler
  const shapeStyle = {
    left: "50%", transform: "translateX(-50%)", width: W, height: H, visibility: mode !== "none" || H >= 0.4 ? "visible" : "hidden",
    "--r": r + "px", "--f": f + "px", "--go": Math.min(1, H / 80), "--kt": Math.max(0, 1 - H / 70),
    ...(ambient ? { "--amb1": ambient[0], "--amb2": ambient[1], "--ambO": 1, "--t1": (glow ?? ambient)[0], "--t2": (glow ?? ambient)[1] } : { "--ambO": 0 }),
  } as unknown as CSSProperties;

  // tıklanabilir kutu: büyürken hemen hedef boyda, küçülürken yay bitene dek eski boyda (geçen tıklama kaybolmasın, saydam alan tıklama yutmasın)
  const box = useRef({ w: 0, h: 0 });
  const settled = Math.abs(W - tw) < 1 && Math.abs(H - th) < 1;
  box.current = settled ? { w: tw, h: th } : { w: Math.max(box.current.w, tw), h: Math.max(box.current.h, th) };

  // adanın içine tıklanınca açık şerit paneli kapansın (şerit bu mesajı dinler)
  useEffect(() => {
    const down = (e: PointerEvent) => { if ((e.target as Element | null)?.closest?.("#ada, .adaMerkez, .yanBal, .oturumChip")) sendX({ t: "island-click" }); };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, []);
  // dışarı tıklama kartı kapatır (pencere odaksız olsa da; başka pencereye tıklamayı Rust "notch://outside_press" ile bildirir)
  const cardOpen = mode === "kart" && kind !== "ilk" && kind !== "ilk2";
  useEffect(() => {
    if (!cardOpen) return;
    const down = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.("#ada, .adaMerkez, .yanBal, .oturumChip")) back(); };
    document.addEventListener("pointerdown", down);
    const off = onX((m) => { if (m.t === "outside") back(); });
    // asıl yol: ada penceresi dışarıya tıklamayı hiç görmez (saydam alan tıklamayı geçirir); Rust'ın imleç yoklaması bildirir, "island" kartın kendisidir
    const offPress = bridge.on("notch://outside_press", (m) => { if (m !== "island") back(); });
    return () => { document.removeEventListener("pointerdown", down); off(); offPress.then((f) => f()); };
  }, [cardOpen, back]);

  /* ---- paylaşılan öğe uçuşu: eski katmandaki yerinden yenisine ---- */
  const stage = useRef<HTMLDivElement>(null);
  const center = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const st = stage.current;
    if (!st) return;
    const olds = new Map<string, HTMLElement>();
    st.querySelectorAll<HTMLElement>("[data-eski] [data-paylas]").forEach((e) => olds.set(e.dataset.paylas!, e));
    if (!olds.size) return;
    st.querySelectorAll<HTMLElement>("[data-paylas]").forEach((e) => {
      if (e.closest("[data-eski]")) return;
      const o = olds.get(e.dataset.paylas!);
      if (o) { fly(e, o.getBoundingClientRect()); o.style.visibility = "hidden"; }
    });
  }, [centerKey, spec?.key]);

  useEffect(() => { announceCenterClock(kind === "asistanyok" || ((kind === "rest" || kind === "hov" || kind === "modules") && !asistanUp)); }, [kind, asistanUp]);

  const openMod = (tab?: string) => { setModStart(tab); setUser("modules"); };
  /** Tek kural (Y1/Y3/O11): çıkıntıya tıklamak kendi sekmesinde Modüller'i açar; açık kartta ortaya tıklamak kartı kapatır. */
  const onCenter = () => {
    if (hidden && restShown) bridge.call("island_hide", { on: false }).catch(() => undefined);
    else if (kind === "rest" || kind === "hov") setUser(asleep ? "asistanyok" : "modules");
    else if (kind === "panel") return;
    else if (kind === "bit") { setDone(null); announceNotif(); }
    else if (kind === "sum") openNotifs();
    else if (kind === "burst") openBurst();
    else if (kind === "kota") setQuota(false);
    else if (kind === "mdur") setStopped(null);
    else if (kind === "indi") setDl(null);
    else if (kind === "cpu") setCpuHigh(null);
    else if (kind === "plugin" && meetingItem) openMod("takvim");
    else if (kind === "music") openMod("müzik");
    else if (kind === "shot") { setShot(null); openMod("pano"); }
    else if (kind === "timer" || kind === "timerdone") openMod("zamanlayıcı");
    else if (kind === "shelfdrag") openMod("raf");
    else if (user) back();
    else openMod();
  };
  /** Sekme çubuğu olmayan karttan Modüller'e, kartın kendi sekmesiyle. */
  const toModules = () => openMod(user === "pano" ? "pano" : user === "raf" ? "raf" : user === "meeting" ? "takvim" : user === "music-card" ? "müzik" : undefined);
  const asistanRest = asistanUp && mainP && (kind === "rest" || kind === "hov" || kind === "modules");
  const ariaOverride = hidden && restShown ? "Ada gizli: Ctrl+Shift+A ile geri getir" : asleep && restShown ? `${mainP ? pluginName(mainP) : "Asistan"} bağlı değil. Başlatmak için aç` : null;
  const parts = asistanRest ? [`${pluginName(mainP)} hazır`, approvalsN ? `${cap99(approvalsN)} onay` : null, alerts.length ? `${cap99(alerts.length)} bildirim` : null].filter(Boolean)
    : [label.split(",")[1]?.trim(), media?.playing ? (priv ? LOCK_MUSIC : `${trackTitle(media)} çalıyor`) : null].filter(Boolean);
  // çıkıntı gösterilirken ekran okuyucuya söylenir (onay: hemen, öteki: sırayla) ve ada düğmesinin adı çıkıntıyı taşır (F-01, F-28)
  const bump = mode === "cik" && !!spec;
  useEffect(() => { if (!stage.current?.contains(document.activeElement)) setKbIn(false); }, [kind, spec?.key]); // odaklı öğe sökülünce blur gelmeyebilir
  const say = !bump ? "" : kind === "approval" && approvalTop ? `${pluginName(approvalTop.plugin)} izin istiyor: ${flat(approvalTop.title, 120)}`
    : kind === "alert" && alert ? [alert.title, alert.subtitle].filter(Boolean).join(", ") : kind === "music" && media ? (priv ? LOCK_MUSIC : `Çalıyor: ${trackTitle(media)}`) : spec!.label;
  // yan baloncuk: ana şeritten sonraki işler. Kart açıkken, sunum/meşgulken ve ada gizliyken yok. Kilitliyken yalnız genel simge.
  const bubbleCtx = { away: summary ? awayText : null, net: netNote, media, timer, alert, prot, done, locked: priv, battery: batt, burst, stopped, dl, cpu: cpuHigh };
  const sideItems = calm || mode === "kart" || (hidden && restShown) ? [] : plan.secondary.map((a) => bubbleItem(a.kind, bubbleCtx));
  const orta = Math.max(360, Math.min(424, Math.round(innerWidth * 0.4))); // ortadaki içerik ekranın ~%40'ından ve 424 px'ten geniş olmaz (R2-Y1; şerit sekmeleri adanın 176 px soluna kadar sığar, en çok 36 px binme); taşan metin üç nokta

  return (
    <div className="adaStage" ref={stage} onKeyDown={crossKey} data-yay={settled ? undefined : ""}
      onFocus={() => { if (document.documentElement.hasAttribute("data-kb")) setKbIn(true); }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKbIn(false); }}>
      <div className="srOnly" role="status" aria-live="polite" aria-atomic="true">{kind === "approval" ? "" : say}</div>
      <div className="srOnly" role="alert" aria-live="assertive" aria-atomic="true">{kind === "approval" ? say : ""}</div>
      {ambient && <div id="hale" style={{ width: W * 1.1, height: H * 1.15, ["--amb1" as string]: ambient[0], ["--ambO" as string]: 1 }} />}
      <button ref={center} className="adaMerkez" data-hit aria-expanded={mode === "kart" ? true : bump ? undefined : false} aria-label={ariaOverride ?? (bump ? `${say}. Modülleri aç` : `${parts.join(", ")}${mode === "kart" ? "" : ". Kartı aç"}`)}
        style={{ width: mw + 24, transform: `translateX(-50%) translateY(${hv * 0.5}px)`, filter: hv > 0.001 ? `brightness(${1 + hv * 0.28})` : undefined }}
        title={bumpHover ? "Modülleri aç" : undefined} onClick={(e) => { if (!(e.target as Element).closest?.(".mascot")) return onCenter(); setTimeout(moodShown === "error" && restShown ? () => setUser("hata") : owner.current ? () => openAsk("composer") : onCenter, SLAP_OPEN_MS); }}
        onPointerEnter={() => hoverIntent(true)} onPointerLeave={() => { hoverIntent(false); setMkHover(false); }}
        onPointerOver={(e) => { const on = !!(e.target as Element).closest?.(".mascot-hit"); if (on && !mkHover) loadCounts(); setMkHover(on); }}>
        {centerOld !== null && <span className="adaMk eski" data-eski aria-hidden="true" style={{ maxWidth: orta }}>{centerOld.node}</span>}
        <span key={centerKey} className="adaMk" ref={setCenterEl} style={{ maxWidth: orta, minWidth: holdW || undefined, justifyContent: holdW ? "center" : undefined }}>{centerNode}</span>
        {bumpHover && <span className="acIk" aria-hidden="true"><ArrowUpRight /></span>}
      </button>
      {mkHover && asistanUp && mainP && restShown && <div className="mkBalon" data-paint role="status">{[jobsN > 0 && `${jobsN} iş çalışıyor`, waitN > 0 && `${waitN} onay bekliyor`].filter(Boolean).join(" · ") || `${pluginName(mainP)} hazır`}</div>}
      <SideBubble items={sideItems} edge={Math.max(W, mw + 24) / 2 + 8} open={more} setOpen={setMore} onPick={setPinned} onHover={setBubbleHover} />
      {nSess >= 2 && !calm && mode !== "kart" && !(hidden && restShown) && <SessionChip n={nSess} list={sessList} edge={Math.max(W, mw + 24) / 2 + 8} last={lastCc} locked={priv} />}
      {settings?.demo && <span className="demoRozet" data-paint style={{ left: `calc(50% + ${(mw + 24) / 2 + 8}px)` }}>Demo</span>}
      {demoNot && <div className="mkBalon demoNot" data-paint role="status">Demo kipinde yok</div>}
      {mode !== "none" || H > 0.4 ? <div className="adaHit" data-hit style={{ width: box.current.w, height: box.current.h }} /> : null}
      {mode !== "none" || H > 0.4 ? <div className="adaHit adaGolge" data-paint style={{ width: box.current.w + 2 * GOLGE_YAN, height: box.current.h + GOLGE_ALT }} /> : null}
      <div id="ada" className="sarkan" style={shapeStyle} onPointerEnter={() => hoverIntent(true)} onPointerLeave={() => hoverIntent(false)}>
        <div className="kes">
          <div className="amb" />
          {shapeOld !== null && <div className="adaIc eski" data-eski aria-hidden="true" style={{ width: shapeOld.width ?? "max-content" }} ref={(el) => { if (el) el.inert = true; }}>{shapeOld.node}</div>}
          {spec && <Layer key={spec.key} spec={spec} onClose={back} onModules={toModules} measure={setShapeEl} />}
        </div>
        <AdaLine s={ls} hidden={H < 0.4} />
      </div>
    </div>
  );
}
