import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Battery, BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, ChevronDown, Moon, Search, Volume2, VolumeX, Wifi, WifiOff } from "lucide-react";
import { bridge, type MonitorInfo, type PinnedApp, type Status, type WindowInfo } from "../bridge";
import { clockParts } from "../lib/clock";
import { dragLayout, mergePins, reorder, type StripItem } from "../lib/mergePins";
import { useNow, usePrivacy, useSurfaces } from "../hooks";
import { StripLine, Waves } from "./Fidelity";
import { onX, sendX, stripSides, tabLeaves, focusViaKeys } from "../lib/xwin";
import { installKbModality } from "../lib/kbModality";
import { listenLine } from "../lib/lineChan";
import { WindowPreview } from "./WindowPreview";
import { useCenterClock } from "../lib/centerClock";
import { YAY } from "../motion/spring";
import { useSpring } from "../motion/useSpring";
import { AppIcon, WinLogo } from "./common";
import "./strip-items.css";
import { PromotedTray } from "./TrayList";
import { IslandHiddenGlyph } from "./IslandHidden";
import { useIslandHidden } from "../hooks.fidelity";
import { cap99 } from "../lib/plugin";

export type PanelKind = "setup" | "start" | "status" | "search" | "ayg" | "ayk" | "aye" | "aym" | "ayp" | "ays" | "quit" | "notif" | "mt" | "tray";
export type MenuState = { kind: "app"; appId: string; x: number } | { kind: "strip"; x: number };

const GAP = 2;
const batteryIcon = (b: NonNullable<Status["battery"]>) =>
  b.charging ? <BatteryCharging /> : b.percent === null ? <Battery /> : b.percent <= 15 ? <BatteryLow /> : b.percent <= 40 ? <Battery /> : b.percent >= 90 ? <BatteryFull /> : <BatteryMedium />;

/** Pencere önceliği: etkin pencere varsa o, yoksa ilk pencere; uygulama etkinse sıradaki pencereye geç. */
export function pickWindow(item: StripItem): WindowInfo | null {
  if (!item.windows.length) return null;
  const i = item.windows.findIndex((w) => w.active);
  return item.windows[i < 0 ? 0 : item.windows.length > 1 ? (i + 1) % item.windows.length : i];
}

function activate(item: StripItem) {
  const w = pickWindow(item);
  if (w) bridge.call("activate_window", { hwnd: w.hwnd }); else bridge.call("launch_app", { appId: item.appId });
}

/** Sabit ve sekme aynı biçim: simge + ad, sabit genişlikli yuva (strip-items.css); uzun ad kısaltılır, tamamı title/aria-label'da. */
function ItemLabel({ item }: { item: StripItem }) {
  return (
    <>
      <span className="ikK">
        <AppIcon src={item.icon} color={item.colorIcon} />
        {item.windows.length > 1 && <span className="say num">{cap99(item.windows.length)}</span>}
      </span>
      <span className="sabitAd">{item.name}</span>
    </>
  );
}

/** Önizleme niyeti: öğe + öğenin kutusu (aç), `undefined` = çekildi (gecikmeyle kapat), `null` = hemen kapat. */
/** F-05: çok pencereli öğede Enter/Boşluk/Aşağı ok pencere seçiciyi açar (seçici Strip'te kb ile tutulur). */
type OpenPick = (item: StripItem, el: HTMLElement) => void;
const pickKeys = (e: React.KeyboardEvent, item: StripItem, el: HTMLElement, open: OpenPick) => {
  if (item.windows.length < 2 || !["Enter", " ", "ArrowDown"].includes(e.key)) return;
  e.preventDefault();
  open(item, el);
};
type HoverFn = (item: StripItem | null | undefined, el?: HTMLElement) => void;
const ariaOf = (item: StripItem) =>
  item.windows.length ? `${item.name}${item.windows.length > 1 ? `, ${item.windows.length} pencere` : ""}` : `${item.name}, sabit, kapalı`;

/** Sabitler: sürükleyerek sıralanır (3 px eşik), hepsi sabit genişlikli yuvada. */
function Pins({ items, pins, onMenu, onReorder, onHover, onPick }: { items: StripItem[]; pins: PinnedApp[]; onMenu: (appId: string, x: number) => void; onReorder: (ids: string[]) => void; onHover: HoverFn; onPick: OpenPick }) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; dx: number; shifts: number[]; to: number } | null>(null);
  const moved = useRef(false);

  const down = (e: React.PointerEvent, from: number) => {
    if (e.button !== 0) return;
    const kids = [...(box.current?.children ?? [])] as HTMLElement[];
    const widths = kids.map((k) => k.offsetWidth + GAP);
    const x0 = e.clientX;
    moved.current = false;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!moved.current && Math.abs(dx) < 3) return;
      moved.current = true;
      const { to, shifts, dx: cdx } = dragLayout(widths, from, dx);
      setDrag({ from, dx: cdx, shifts, to });
    };
    const up = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      if (moved.current) {
        const { to } = dragLayout(widths, from, ev.clientX - x0);
        if (to !== from) onReorder(reorder(pins.map((p) => p.appId), from, to));
        setDrag(null);
      }
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  return (
    <div className="sabitler" ref={box} role="tablist" aria-label="Sabitlenmiş uygulamalar ve açık pencereleri">
      {items.map((item, i) => {
        const open = item.windows.length > 0;
        const style: CSSProperties | undefined = drag
          ? i === drag.from
            ? { transform: `translateX(${drag.dx}px)`, zIndex: 3, transition: "none" }
            : { transform: `translateX(${drag.shifts[i]}px)`, transition: "transform .38s cubic-bezier(.34,1.36,.64,1)" }
          : undefined;
        return (
          <button key={item.appId} role="tab" aria-selected={item.active} aria-label={ariaOf(item)} title={item.name + (open ? "" : " (sabit, kapalı)")}
            className={"sabit" + (open ? " acikSabit" : "") + (item.active ? " aktif" : "") + (drag?.from === i ? " tutuyor" : "")}
            data-app={item.appId} style={style}
            onPointerDown={(e) => { onHover(null); down(e, i); }} onPointerEnter={(e) => onHover(item, e.currentTarget)} onPointerLeave={() => onHover(undefined)}
            onKeyDown={(e) => pickKeys(e, item, e.currentTarget, onPick)} onKeyUp={(e) => { if (e.key === " " && item.windows.length > 1) e.preventDefault(); }}
            onClick={() => { if (!moved.current) activate(item); moved.current = false; }}
            onContextMenu={(e) => { e.preventDefault(); onMenu(item.appId, e.currentTarget.getBoundingClientRect().left); }}>
            <ItemLabel item={item} />
          </button>
        );
      })}
    </div>
  );
}

/** Seçim kapsülü: etkin öğenin arkasında yayla kayar, değişince üstünden ışık geçer (akan vurgu). */
function SelectionPill({ host, watch }: { host: React.RefObject<HTMLElement | null>; watch: string }) {
  const [box, setBox] = useState({ x: 0, w: 0, on: false });
  const measure = useCallback(() => {
    const el = host.current;
    const a = el?.querySelector<HTMLElement>(".sabit.aktif, .sekmeA.aktif");
    if (!el || !a) return setBox((b) => (b.on ? { ...b, on: false } : b));
    const x = a.getBoundingClientRect().left - el.getBoundingClientRect().left, w = a.getBoundingClientRect().width;
    setBox((b) => (b.on && b.x === x && b.w === w ? b : { x, w, on: true }));
  }, [host]);
  // watch değişince (etkin öğe, pencere sayısı) yeniden ölç; ref'ler bağlandıktan sonra çalışsın diye passive effect
  useEffect(measure, [measure, watch]);
  useEffect(() => {
    const ro = new ResizeObserver(measure);
    if (host.current) ro.observe(host.current);
    return () => ro.disconnect();
  }, [host, measure]);
  const x = useSpring(box.x, YAY.sekme);
  const w = useSpring(box.w, YAY.sekme);
  return (
    <span className="sekmePil" aria-hidden="true" style={{ transform: `translateX(${x}px)`, width: Math.max(0, w), opacity: box.on ? 1 : 0, transition: "opacity .2s" }}>
      <i key={watch} style={{ animation: "isik .62s var(--ease) both" }} />
    </span>
  );
}

export interface StripProps {
  monitor: MonitorInfo;
  windows: WindowInfo[];
  pins: PinnedApp[];
  status: Status | null;
  openPanel: PanelKind | null;
  onPanel: (k: PanelKind) => void;
  onMenu: (m: MenuState) => void;
  onReorder: (ids: string[]) => void;
  /** Ortadaki boşluğa konan içerik (yalnız önizleme: ada sayfası ayrı pencere, orada DOM sırası Tab sırasını kurar). */
  center?: React.ReactNode;
}

/** Ada penceresinin yarı genişliği + boşluk (c1: sol kenar orta çizgiden 169 px). */
const ADA_YARI = 176;

export function Strip({ monitor, windows, pins, status, openPanel, onPanel, onMenu, onReorder, center }: StripProps) {
  const now = useNow();
  const centerClock = useCenterClock() && monitor.primary; // ada ortada saati gösteriyorsa sağdaki saat yalnız tarihi yazar
  const { date, time, label } = clockParts(now);
  // ikinci ekranda sabitler yok (referans k karesi): o ekrandaki pencereler yalnız sekme olur
  const { pinned, tabs } = useMemo(() => mergePins(monitor.primary ? pins : [], windows), [pins, windows, monitor.primary]);
  const left = useRef<HTMLDivElement>(null);
  const activeKey = [...pinned, ...tabs].filter((i) => i.active).map((i) => i.appId).join() + "|" + pinned.map((p) => p.appId + p.windows.length).join() + tabs.map((t) => t.appId + t.windows.length).join();
  // pencere önizlemesi: ~250 ms durunca açılır, çekilince ~200 ms sonra kapanır (ada üstüne gelme niyetiyle aynı yöntem)
  const [pv, setPv] = useState<{ item: StripItem; x: number; from?: HTMLElement } | null>(null);
  const pvTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hover: HoverFn = useCallback((item, el) => {
    clearTimeout(pvTimer.current);
    if (item === null) return setPv(null);
    if (item === undefined) { pvTimer.current = setTimeout(() => setPv(null), 200); return; }
    if (!item.windows.length || !el) return;
    const r = el.getBoundingClientRect();
    pvTimer.current = setTimeout(() => setPv({ item, x: r.left + r.width / 2 }), pv ? 0 : 250);
  }, [pv]);
  const pickByKey: OpenPick = useCallback((item, el) => {
    clearTimeout(pvTimer.current);
    const r = el.getBoundingClientRect();
    setPv({ item, x: r.left + r.width / 2, from: el });
    requestAnimationFrame(() => document.querySelector<HTMLElement>(".onizleme .kucuk.on, .onizleme .kucuk")?.focus());
  }, []);
  useEffect(() => () => clearTimeout(pvTimer.current), []);
  // klavyeyle açılan seçici: sol/sağ ok gezer, Esc kapatır ve odağı öğeye geri verir
  const from = pv?.from;
  useEffect(() => {
    if (!from) return;
    const key = (e: KeyboardEvent) => {
      const k = [...document.querySelectorAll<HTMLElement>(".onizleme .kucuk")];
      const i = k.indexOf(document.activeElement as HTMLElement);
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setPv(null); from.focus(); }
      else if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); k[(i + (e.key === "ArrowRight" ? 1 : -1) + k.length) % k.length]?.focus(); }
      else if (e.key === "Home" || e.key === "End") { e.preventDefault(); k[e.key === "Home" ? 0 : k.length - 1]?.focus(); }
    };
    addEventListener("keydown", key, true);
    return () => removeEventListener("keydown", key, true);
  }, [from]);
  const live = pv ? [...pinned, ...tabs].find((i) => i.appId === pv.item.appId) : null; // pencere kapanınca/yenilenince önizleme tazelenir
  const privacy = usePrivacy();
  const priv = [privacy.mic.length ? `Mikrofon: ${privacy.mic.join(", ")}` : "", privacy.camera.length ? `Kamera: ${privacy.camera.join(", ")}` : ""].filter(Boolean).join(". ");
  // tam ekran: şerit yukarı kaçar (t1), imleç üst kenara (4 px) değince gelir, 140 px altına inince ~500 ms sonra gider (t2); onay inerken (t3) görünür kalır
  const surf = useSurfaces();
  const [fs, setFs] = useState(false);
  const [edge, setEdge] = useState(false);
  useEffect(() => { installKbModality(); const off = bridge.on("fullscreen_screens", (s) => setFs(s.strips.includes(monitor.id))); return () => { off.then((f) => f()); }; }, [monitor.id]); // yalnız bu ekranın şeridi gizlenir (ikinci ekrandaki video ötekini gizlemez)
  // onay beklerken fare başka monitörün şeridindeyse o şeritte küçük rozet (mutlak konumlu: şeritte hiçbir şey kaymaz); null gelince kalkar
  const [badge, setBadge] = useState(0);
  useEffect(() => { const off = bridge.on("approval_badge", (b) => setBadge(b && b.monitor === monitor.id ? b.count : 0)); return () => { off.then((f) => f()); }; }, [monitor.id]);
  useEffect(() => {
    if (!fs) { setEdge(false); return; }
    let t: ReturnType<typeof setTimeout> | undefined;
    const move = (e: MouseEvent) => { if (e.clientY < 4) { clearTimeout(t); setEdge(true); } else if (e.clientY > 140) { clearTimeout(t); t = setTimeout(() => setEdge(false), 500); } };
    addEventListener("mousemove", move);
    return () => { removeEventListener("mousemove", move); clearTimeout(t); };
  }, [fs]);
  const dropping = surf.dropStripMs !== null && surf.approvals.length > 0;
  const shift = useSpring(fs && !edge && !dropping && !openPanel ? -(30 + 60) : 0, YAY.serit); // panel açıkken şerit yerinde kalır (O18)
  const slide = Math.abs(shift) > 0.05 ? `translateY(${shift}px)` : undefined;
  // ada sayfası "Bildirimleri aç" derse (iş bitti şeridine tıklama) saat paneli açılır
  useEffect(() => listenLine((m) => { if (m.k === "notif" && openPanel !== "notif") onPanel("notif"); }), [openPanel, onPanel]);
  const islandHidden = useIslandHidden();
  // Tab sırası pencereler arası: son sol denetimden Tab adaya, sağ grubun ilkinden Shift+Tab adanın sonuna; ada geri verince buraya düşer
  const bar = useRef<HTMLElement>(null);
  const crossTab = monitor.primary && !center && !islandHidden;
  useEffect(() => onX((m) => {
    if (m.t !== "to-strip" || !bar.current) return;
    const { left, right } = stripSides(bar.current);
    focusViaKeys(m.side === "right" ? right[0] : left[left.length - 1]);
  }), []);
  const crossKey = (e: React.KeyboardEvent) => {
    if (!crossTab || !bar.current) return;
    const { left, right } = stripSides(bar.current);
    if (tabLeaves(e, left, document.activeElement) && !e.shiftKey) { e.preventDefault(); bridge.call("focus_island").then(() => sendX({ t: "to-island" }), () => undefined); }
    else if (tabLeaves(e, right, document.activeElement) && e.shiftKey) { e.preventDefault(); bridge.call("focus_island").then(() => sendX({ t: "to-island", end: true }), () => undefined); }
  };
  // hit alanı: sekmeler adanın (yarım genişlik ~170) soluna sığar; sığmazsa flex ile birlikte daralırlar (adanın üstüne 10-36 px binme)
  const tabsBox = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = tabsBox.current, bar = document.querySelector("header.cubuk");
    if (!el || !bar) return;
    const fit = () => { el.style.maxWidth = Math.max(40, window.innerWidth / 2 - ADA_YARI - el.getBoundingClientRect().left) + "px"; };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [tabs.length, pinned.length, monitor.primary]);
  const trigger = (k: PanelKind) => ({ "data-panel-trigger": k, "aria-expanded": openPanel === k, onClick: () => onPanel(k) });

  return (
    <>
    <header ref={bar} className="cubuk" data-hit aria-label="Peeka şeridi" onKeyDown={crossKey} style={slide ? { transform: slide } : undefined}
      onContextMenu={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).closest(".bos")) { e.preventDefault(); onMenu({ kind: "strip", x: e.clientX }); } }}>
      {!monitor.primary && badge > 0 && <span className="onayRozet" role="status" aria-label={`${badge} onay bekliyor`}>{badge > 9 ? "9+" : badge} onay</span>}
      <div className="taraf" ref={left}>
        <SelectionPill host={left} watch={activeKey} />
        {monitor.primary && priv && <span className="gizlilikNokta" role="img" aria-label={priv} title={priv} data-yalniz={privacy.mic.length ? undefined : "kamera"} />}
        <button className={"tus tusIk" + (openPanel === "start" ? " acik" : "")} title="Başlat" aria-label="Başlat" aria-haspopup="dialog" {...trigger("start")}><WinLogo /></button>
        <button className={"tus tusIk" + (openPanel === "search" ? " acik" : "")} title="Ara (Ctrl+K)" aria-label="Ara" aria-haspopup="dialog" {...trigger("search")}><Search /></button>
        {monitor.primary && <Pins items={pinned} pins={pins} onReorder={onReorder} onHover={hover} onPick={pickByKey} onMenu={(appId, x) => onMenu({ kind: "app", appId, x })} />}
        {tabs.length > 0 && <span className="ayrac" />}
        <div className="sekmeler" ref={tabsBox} role="tablist" aria-label="Bu ekrandaki pencereler">
          {tabs.map((t) => (
            <button key={t.appId} className={"sekmeA" + (t.active ? " aktif" : "")} title={t.name} role="tab" aria-selected={t.active} aria-label={ariaOf(t)} data-app={t.appId}
              onPointerEnter={(e) => hover(t, e.currentTarget)} onPointerLeave={() => hover(undefined)} onPointerDown={() => hover(null)}
              onKeyDown={(e) => pickKeys(e, t, e.currentTarget, pickByKey)} onKeyUp={(e) => { if (e.key === " " && t.windows.length > 1) e.preventDefault(); }}
              onClick={() => activate(t)} onContextMenu={(e) => { e.preventDefault(); onMenu({ kind: "app", appId: t.appId, x: e.currentTarget.getBoundingClientRect().left }); }}>
              <ItemLabel item={t} />
            </button>
          ))}
        </div>
      </div>
      {/* ortadaki boşluk: ada penceresi */}
      <div className="bos" style={{ flex: 1, alignSelf: "stretch" }}>
        {/* ada sayfası ayrı pencere: orada gizliyken göz simgesini şerit sayfası çizer; önizlemede `center` (ada) kendi göz simgesini çizer */}
        {center ?? (monitor.primary && islandHidden ? <div style={{ display: "grid", placeItems: "center", height: "100%" }}><IslandHiddenGlyph /></div> : null)}
      </div>
      <div className="taraf">
        {monitor.primary && (
          <>
            <PromotedTray monitor={monitor.id} />
            <button className={"tus tusIk" + (openPanel === "tray" ? " acik" : "")} title="Gizli simgeler" aria-label="Gizli simgeler" aria-haspopup="dialog" {...trigger("tray")}><ChevronDown /></button>
            <button className={"tus durumGrup" + (openPanel === "status" ? " acik" : "")} aria-haspopup="dialog" aria-label={statusLabel(status)} title="Ses, ağ, pil ve diğer durumlar" {...trigger("status")}>
              {status?.dnd && <Moon />}
              {status?.muted ? <VolumeX /> : <Volume2 />}
              {status?.network === "none" ? <WifiOff /> : <Wifi />}
              {status?.battery && batteryIcon(status.battery)}
            </button>
          </>
        )}
        <button className={"tus" + (openPanel === "notif" ? " acik" : "")} title="Bildirimler" aria-label={`${label}, Bildirimler`} aria-haspopup="dialog" {...trigger("notif")}>
          <span className="l2">{date}</span>{!centerClock && <span className="b6 num">{time}</span>}
        </button>
      </div>
      {monitor.primary && <Waves />}
    </header>
    {monitor.primary && <StripLine shift={slide ? shift : 0} />}
    {pv && live && <WindowPreview item={live} x={pv.x} onEnter={() => clearTimeout(pvTimer.current)} onLeave={() => hover(undefined)} onPick={(w) => { setPv(null); bridge.call("activate_window", { hwnd: w.hwnd }); }} />}
    </>
  );
}

/** Bağlantı düzeyinin sade adı (durum kartı da kullanır). */
export const NET_LABEL: Record<Status["network"], string> = { internet: "İnternete bağlı", local: "Yalnız yerel ağ", constrained: "Bağlantı kısıtlı", none: "Ağ bağlantısı yok", unknown: "Ağ durumu bilinmiyor" };

function statusLabel(s: Status | null) {
  if (!s) return "Durum";
  const parts = [s.volume === null ? "Ses yok" : `Ses ${s.muted ? "kapalı" : "%" + s.volume}`, NET_LABEL[s.network]];
  if (s.battery) parts.push(`Pil${s.battery.percent === null ? "" : " %" + s.battery.percent}${s.battery.charging ? ", şarj oluyor" : ""}`);
  return parts.join(", ") + ". Durum kartını aç";
}
