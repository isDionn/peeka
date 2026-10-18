import { useCallback, useEffect, useRef, useState } from "react";
import { justPressed, isTextEntry } from "../lib/justPressed";
import { bridge, inTauri, type Alert, type Notice } from "../bridge";
import { useClips, useHitRects, useLock, useMirror, useMonitor, usePins, useSettings, useStatus, useWindows } from "../hooks";
import { ContextMenu, QuitConfirm } from "./Menus";
import { NoticeReply, NoticeToast, NotificationList, ReviewCard } from "./Notifications";
import { SetupPanel, setupDone } from "./SetupWizard";
import { Panel } from "./common";
import { SearchPanel } from "./SearchPanel";
import { SettingsPanel, type SettingsPage } from "./SettingsPanel";
import { StartPanel } from "./StartPanel";
import { StatusCard } from "./StatusCard";
import { TrayList } from "./TrayList";
import "../panel-yuzey.css";
import { onX, sendX } from "../lib/xwin";
import { Strip, type MenuState, type PanelKind } from "./Strip";

export interface ShellInit { panel?: PanelKind | null; menu?: MenuState | null; review?: Alert | null; /** Önizleme: Ctrl+K açılışta bu yazıyla ve bu seçili satırla (maket ara1, ara2). */ query?: string; sel?: number; /** Önizleme: kur sihirbazı bu adımda (0 tabanlı). */ setupStep?: number; /** Önizleme: ilk açılışta kur sihirbazı kendiliğinden açılır (üründe yalnız Tauri'de). */ setup?: boolean }
const SETTINGS_PAGES: (PanelKind | null)[] = ["ayg", "ayk", "aye", "aym", "ayp", "ays"];

/** Bir monitörün şerit sayfası: şerit + altından sarkan paneller + sağ tık menüsü. Pencere şeritten uzun, tıklanabilir yerleri `data-hit` ile bildirilir. */
export function Shell({ monitor: monitorId, init, center }: { monitor: string; init?: ShellInit; center?: React.ReactNode }) {
  const monitor = useMonitor(monitorId);
  const windows = useWindows(monitorId);
  const [pins, setPins] = usePins();
  const [status, setStatus] = useStatus();
  const settings = useSettings();
  const [panel, setPanel] = useState<PanelKind | null>(init?.panel ?? null);
  const [menu, setMenu] = useState<MenuState | null>(init?.menu ?? null);
  const [review, setReview] = useState<Alert | null>(init?.review ?? null);
  const lock = useLock();
  const [toast, setToast] = useState<{ n: Notice; turn?: number } | null>(null);
  const [hoverToast, setHoverToast] = useState(false);
  const [trayRight, setTrayRight] = useState(8);
  useHitRects("strip", monitorId);
  // Windows bildirimi gelince sağ üst kart kendiliğinden açılır: yalnız ana şeritte, sessizken (rahatsız etme / tam ekran / sunum), kilitliyken ve başka panel açıkken değil
  const mirror = useMirror();
  const seenNotices = useRef<Set<string> | null>(null);
  const panelRef = useRef<PanelKind | null>(null);
  const primary = !!monitor?.primary;
  useEffect(() => {
    if (!mirror.ready) return;
    const ids = new Set(mirror.items.map((n) => n.id));
    const prev = seenNotices.current;
    seenNotices.current = ids;
    // yeni Windows bildirimi: sağ üstte kısa kart (6 sn); sessizken, kilitliyken ve başka panel açıkken çıkmaz
    const fresh = prev ? mirror.items.find((n) => !prev.has(n.id)) : undefined;
    if (fresh && primary && !mirror.quiet && !lock.locked) setToast((t) => (t || panelRef.current !== null ? t : { n: fresh }));
  }, [mirror, primary, lock.locked]);
  useEffect(() => { if (panel !== null || lock.locked) setToast(null); }, [panel, lock.locked]); // kilitlenince açık bildirim kartı da kapanır
  // yeni kopyalanan metin / dosya: ekran alıntısı çıkıntısı çıkmadığı için şeridin altında 1,6 sn "Panoya alındı" (R2-O1). Parola ve alıntı sayılmaz.
  const clips = useClips();
  const seenClips = useRef<Set<string> | null>(null);
  const [clipNote, setClipNote] = useState(false);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const prev = seenClips.current;
    seenClips.current = new Set(clips.map((c) => c.id));
    const now = bridge.now().getTime();
    if (prev && primary && clips.some((c) => !prev.has(c.id) && c.kind !== "password" && !(c.kind === "image" && c.screenshot) && now - c.createdAt < 5000)) {
      setClipNote(true);
      clearTimeout(noteTimer.current);
      noteTimer.current = setTimeout(() => setClipNote(false), 1600);
    }
  }, [clips, primary]);
  useEffect(() => () => clearTimeout(noteTimer.current), []);
  useEffect(() => {
    if (!toast || toast.turn !== undefined || hoverToast) return; // taslak görünümü kendiliğinden kapanmaz
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast, hoverToast]);
  useEffect(() => {
    if (!toast) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setToast(null); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [toast]);
  // ada sayfasındaki dişli: Ayarlar › Modüller
  useEffect(() => onX((m) => { if (m.t === "open-panel" && m.panel === "aym" && primary) setPanel("aym"); }), [primary]);
  // ilk açılışta kurulum sihirbazı (yalnız gerçek uygulamada ya da önizleme isteğiyle; bir kez)
  // Önce ada sayfasının hoş geldin kartı; o kapanınca (Geç / Başla / Esc) sihirbaz açılır. Ada cevap vermezse (2 sn) beklenmez.
  const [welcome, setWelcome] = useState<boolean | null>(null);
  useEffect(() => {
    const off = onX((m) => { if (m.t === "welcome") setWelcome(m.open); });
    sendX({ t: "welcome?" });
    const t = setTimeout(() => setWelcome((w) => w ?? false), 2000);
    return () => { off(); clearTimeout(t); };
  }, []);
  const setupAsked = useRef(false);
  useEffect(() => { if (primary && welcome === false && !setupAsked.current && (inTauri || init?.setup) && !setupDone()) { setupAsked.current = true; setPanel((p) => p ?? "setup"); } }, [primary, init?.setup, welcome]);
  // ada penceresi şeridin ortasında kısa etiketi gösterir ("bir bilgi bir kez"): hangi panelin açık olduğunu ona bildir
  panelRef.current = panel;
  useEffect(() => { if (monitor?.primary) sendX({ t: "panel", panel: panel === "search" ? "search" : SETTINGS_PAGES.includes(panel) ? "settings" : panel === "status" || panel === "start" || panel === "mt" ? panel : null }); if (monitor?.primary && panel) sendX({ t: "panel-open", panel }); }, [panel, monitor?.primary]);
  useEffect(() => {
    if (panel !== "tray") return;
    const el = document.querySelector('[data-panel-trigger="tray"]'); // panel okun altına, sağ kenarları hizalı oturur
    if (el) setTrayRight(Math.max(8, Math.round(window.innerWidth - el.getBoundingClientRect().right)));
  }, [panel, monitor]);

  // Ara açıkken ya da odak bir yazı alanındayken (Başlat'taki kutu, Ayarlar) şerit penceresi odağı tutar; bitince önceki uygulamaya geri verir (ADR-0062 §1)
  const [inText, setInText] = useState(false);
  useEffect(() => {
    const fin = (e: FocusEvent) => { if (isTextEntry(e.target)) setInText(true); };
    const fout = (e: FocusEvent) => { if (!isTextEntry(e.relatedTarget)) setInText(false); };
    document.addEventListener("focusin", fin);
    document.addEventListener("focusout", fout);
    return () => { document.removeEventListener("focusin", fin); document.removeEventListener("focusout", fout); };
  }, []);
  const searching = panel === "search" || (inText && panel !== null); // kapalı panelde odakta kalan gizli kutu sayılmaz
  useEffect(() => {
    if (!searching) return;
    const arg = { label: `strip-${monitorId}` };
    bridge.call("typing_focus", { ...arg, on: true }).catch(() => undefined);
    return () => { bridge.call("typing_focus", { ...arg, on: false }).catch(() => undefined); };
  }, [searching, monitorId]);

  const closeAll = useCallback(() => { setPanel(null); setMenu(null); }, []);
  const toggle = useCallback((k: PanelKind) => { setMenu(null); setPanel((p) => (p === k ? null : k)); }, []);

  useEffect(() => {
    const down = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest("[data-panel],.baglam,[data-panel-trigger]")) closeAll(); };
    document.addEventListener("pointerdown", down);
    const onBlur = () => { setMenu(null); setPanel((p) => (p === "setup" ? p : null)); }; // başka pencereye geçilince paneller kapanır; kurulum sihirbazı "Ayarları aç" ile Windows'a geçer, kapanmaz (O8)
    const onWinBlur = () => { if (!justPressed()) onBlur(); }; // tıklamadan sonra odağın geri verilmesi panel kapatmaz
    // Shift+F10 / Menü tuşu: şeritteki herhangi bir düğmeden Peeka menüsü (kilitle, çık, görev çubuğunu geri getir). Uygulama sekmeleri kendi menüsünü yerel contextmenu olayıyla açar (F-06)
    const strip = (e: KeyboardEvent) => {
      if (!(e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) return;
      const t = e.target as HTMLElement;
      if (!t.closest("header.cubuk") || t.closest(".sabit,.sekmeA")) return;
      e.preventDefault();
      setPanel(null);
      setMenu({ kind: "strip", x: t.getBoundingClientRect().left });
    };
    document.addEventListener("keydown", strip);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) closeAll(); }; // odak panelden çıkmış olsa da tek Esc üstteki paneli kapatır
    window.addEventListener("blur", onWinBlur);
    document.addEventListener("keydown", esc);
    const off = bridge.on("shortcut", (e) => { if (e.name === "search" && e.monitor === monitorId) toggle("search"); });
    // gerçek pencerede dışarı tıklama (başka uygulama, ada, öbür şerit) bu sayfaya gelmez ve şerit odak almaz: Rust bildirir, bulanıklaşma gibi kapatır
    const offPress = bridge.on("notch://outside_press", (m) => { if (m !== monitorId) onBlur(); });
    return () => { document.removeEventListener("pointerdown", down); window.removeEventListener("blur", onWinBlur); document.removeEventListener("keydown", esc); document.removeEventListener("keydown", strip); off.then((f) => f()); offPress.then((f) => f()); };
  }, [closeAll, toggle, monitorId]);

  const reorder = (ids: string[]) => {
    setPins((cur) => ids.map((id) => cur.find((p) => p.appId === id)!).filter(Boolean));
    bridge.call("set_pins", { appIds: ids }).then(setPins);
  };
  if (!monitor) return null;
  const close = () => setPanel(null);

  return (
    <>
      <Strip monitor={monitor} windows={windows} pins={pins} status={status} openPanel={panel} onPanel={toggle} onMenu={(m) => { setPanel(null); setMenu(m); }} onReorder={reorder} center={center} />
      <Panel side="left" width={600} label="Başlat" dataKind="start" open={panel === "start"} onClose={close}>
        <StartPanel monitor={monitor} pins={pins} onClose={close} onSettings={() => setPanel("ayg")} />
      </Panel>
      {monitor.primary && (
        <Panel side="right" width={360} label="Durum" dataKind="status" open={panel === "status"} onClose={close}>
          {status && <StatusCard monitor={monitor} status={status} setStatus={setStatus} onSettings={() => setPanel("ayg")} onQuit={() => setPanel("quit")} />}
        </Panel>
      )}
      {monitor.primary && (
        <Panel side="right" width={188} offset={trayRight} label="Gizli simgeler" dataKind="tray" open={panel === "tray"} onClose={close}>
          <TrayList monitor={monitor.id} onClose={close} />
        </Panel>
      )}
      <Panel side="right" width={400} label="Bildirimler" dataKind="notif" open={panel === "notif"} onClose={close}>
        <NotificationList onReview={(a) => { setReview(a); setPanel("mt"); }} onClose={close} />
      </Panel>
      <Panel side="center" width={520} amb="#FF9F0A" label="Temizlik onayı" dataKind="mt" open={panel === "mt" && !!review} onClose={close}>
        {review && <ReviewCard alert={review} onClose={close} />}
      </Panel>
      <Panel side="center" width={640} label="Ara" dataKind="search" open={panel === "search"} onClose={close}>
        <SearchPanel onClose={close} initialQuery={init?.query} initialSel={init?.sel} />
      </Panel>
      <Panel side="center" width={780} label="Peeka ayarları" dataKind="settings" open={SETTINGS_PAGES.includes(panel)} onClose={close}>
        {settings && <SettingsPanel page={panel === "ayk" || panel === "aye" || panel === "aym" || panel === "ayp" || panel === "ays" ? panel : "ayg"} onPage={(p: SettingsPage) => setPanel(p)} settings={settings} onQuit={() => setPanel("quit")} />}
      </Panel>
      <Panel side="center" width={400} label="Çıkış onayı" dataKind="quit" open={panel === "quit"} onClose={close}>
        <QuitConfirm onCancel={close} />
      </Panel>
      <SetupPanel open={panel === "setup"} onClose={close} startStep={init?.setupStep} />
      {clipNote && panel === null && <div className="panoNot" data-paint role="status">Panoya alındı</div>}
      {toast && (
        <div style={{ display: "contents" }} onPointerEnter={() => setHoverToast(true)} onPointerLeave={() => setHoverToast(false)}>
          {toast.turn === undefined
            ? <NoticeToast n={toast.n} onClose={() => setToast(null)} onAsk={(turn) => setToast({ n: toast.n, turn })} />
            : <NoticeReply n={toast.n} turn={toast.turn} onClose={() => setToast(null)} />}
        </div>
      )}
      {menu && (
        <ContextMenu menu={{ ...menu, x: Math.max(8, Math.min(menu.x, window.innerWidth - 248)) }} pins={pins} windows={windows} locked={lock.locked} onClose={() => setMenu(null)}
          onPins={reorder} onSettings={() => setPanel("ayg")} onQuit={() => setPanel("quit")} />
      )}
    </>
  );
}
