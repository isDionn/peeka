// Sadakat denetimi 1 parçaları: asistan çizgisi ve dalgalar, ada çizgisi, toplantı kartı, asistan bağlı değil kartı, raf önerisi, uyarı/bütçe çıkıntısı, yeni dinlenme ortaları.
// Çıkıntı/kart parçaları Island.tsx'ten gelir; çizgi ve dalga şerit sayfasında çizilir (lineChan.ts köprüsü).
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Calendar, EyeOff, Inbox, Share, Sparkles, Video } from "lucide-react";
import { bridge, type Alert, type CalendarNext, type PluginInfo, type ProtrusionItem, type ShelfItem, type ShelfSuggestion } from "../bridge";
import { AlertIcon } from "../lib/alertIcon";
import { actionLabel } from "../lib/alerts";
import { flat, MASCOT_STATES, plain, pluginName } from "../lib/plugin";
import { accusative } from "../lib/cardsText";
import { askLabel } from "../hooks";
import { listenLine, LINE_IDLE, type LineState } from "../lib/lineChan";
import { lineVars } from "../lib/line";
import { useGuard } from "../lib/useGuard";
import { Mascot, type MascotHandle } from "../mascot";
import { REMINDER_PLUGIN, type ReminderItem } from "../lib/meetingReminder";
import { Attr, JoinButton, Lead } from "./Plugin";
import { NotchIk } from "./IslandCards";

const noop = () => undefined;
const refOf = (m: Pick<PluginInfo, "id" | "name">) => ({ id: m.id, name: m.name, main: true });

/* ---- asistan çizgisi (#cizgi) ve şerit dalgası: şerit sayfasında ---- */
export function StripLine({ shift = 0 }: { shift?: number }) {
  const [s, setS] = useState<LineState>(LINE_IDLE);
  useEffect(() => listenLine((m) => { if (m.k === "line") setS({ color: m.color, mod: m.mod, gap: m.gap }); }), []);
  const mask = s.gap > 0 ? `linear-gradient(90deg,#000 calc(50% - ${s.gap + 8}px),transparent calc(50% - ${s.gap}px),transparent calc(50% + ${s.gap}px),#000 calc(50% + ${s.gap + 8}px))` : undefined;
  return (
    <div id="cizgi" data-mod={s.mod} aria-hidden="true" style={{ ...lineVars(s), maskImage: mask, WebkitMaskImage: mask, transform: shift ? `translateY(${shift}px)` : undefined }}>
      <i className="sol" /><i className="sag" />
    </div>
  );
}

/** Uyarı gelince ortadan iki yana kısa ışık (maket dalgalandir); çizgi de bir an parlar. */
export function Waves() {
  const L = useRef<HTMLDivElement>(null), R = useRef<HTMLDivElement>(null);
  useEffect(() => listenLine((m) => {
    if (m.k !== "wave") return;
    const W = L.current?.parentElement?.offsetWidth ?? 1920;
    ([[L.current, -1], [R.current, 1]] as const).forEach(([el, yon]) => {
      if (!el?.animate) return;
      el.style.setProperty("--dc", m.color);
      el.animate([{ opacity: 0, transform: "translateX(0) scaleX(.6)" }, { opacity: 1, offset: .18 }, { opacity: 0, transform: `translateX(${yon * W * .5}px) scaleX(1.6)` }], { duration: 1100, easing: "cubic-bezier(.23,1,.32,1)" });
    });
    document.getElementById("cizgi")?.animate?.([{ filter: "brightness(1)" }, { filter: "brightness(2.2)", offset: .15 }, { filter: "brightness(1)" }], { duration: 900, easing: "ease-out" });
  }), []);
  return <><div className="dalgalan" ref={L} aria-hidden="true" /><div className="dalgalan" ref={R} aria-hidden="true" /></>;
}

/** Ada çıkıntısının alt kenarındaki çizgi (#ada içinde). */
export const AdaLine = ({ s, hidden }: { s: Pick<LineState, "color" | "mod">; hidden: boolean }) => (
  <div className="adaCizgi" data-mod={s.mod} aria-hidden="true" style={{ ...lineVars(s), ...(hidden ? { "--co": 0 } : null) } as CSSProperties}><i className="sol" /><i className="sag" /></div>
);

/* ---- şeridin ortası: yeni dinlenme ve olay halleri ---- */
export const HiddenCenter = () => <span className="ms gizliAda" title="Ada gizli: Ctrl+Shift+A ile geri getir"><EyeOff aria-label="Ada gizli: Ctrl+Shift+A ile geri getir" /></span>;
export const OfflineRest = () => <span className="ms"><Mascot size={24} mood="sleeping" isMainAssistant still /><span className="l2">Çevrimdışı</span></span>;

export function DndRest({ approvals, until, lock }: { approvals: number; until?: string | null; lock?: React.ReactNode }) {
  return (
    <>
      <span className="ms">{lock}<Mascot size={24} mood="quiet" isMainAssistant still /><span className="l2">Rahatsız etme</span></span>
      {approvals > 0 && <span className="t12 b6 onaySay num">{approvals} onay</span>}
      {until && <span className="t12 l3 num">{flat(until, 24)}</span>}
    </>
  );
}

/** İş bitti: yalnız şeritteki maskot bir kez zıplar, çıkıntı açılmaz. */
export function JobDoneCenter({ title, took }: { title: string; took: string }) {
  const mk = useRef<MascotHandle>(null);
  useEffect(() => { const t = setTimeout(() => mk.current?.hop(), 200); return () => clearTimeout(t); }, []);
  return <span className="ms"><span className="leadMk"><Mascot ref={mk} size={24} mood="done" isMainAssistant /></span><span className="b6">{flat(title, 60)}</span><span className="l3">{flat(took, 24)}</span></span>;
}

export const MeetingCenter = ({ main }: { main: PluginInfo | null }) => <span className="ms">{main && <Lead plugin={refOf(main)} mascot="hazir" />}<Calendar /><span className="b6">Toplantı</span></span>;
export const ShelfOpenCenter = () => <span className="ms"><Inbox /><span className="b6">Raf</span></span>;

/** Uyarı ortası: ana asistan bağlıysa ve uyarının simgesi maskot halıysa maskot (dikkat, yorgun), yoksa tek renk simge. */
export function AlertCenter({ alert, main }: { alert: Alert; main: PluginInfo | null }) {
  const hal = main && alert.icon && MASCOT_STATES.has(alert.icon) ? alert.icon : null;
  return <span className="ms">{hal ? <Lead plugin={refOf(main!)} mascot={hal} /> : <span className="ikK"><AlertIcon name={alert.icon} /></span>}<span className="b6">{alert.title}</span></span>;
}

/* ---- uyarı çıkıntısı: birincil düğme, bütçe/kota çubuğu ---- */
const BUDGET = "yorgun"; // bütçe ve kota uyarıları maskot halı "yorgun" ile gelir (asistan); düğme "Ayrıntı"
export function AlertBumpFid({ alert, onLater, onDetail }: { alert: Alert; onLater: () => void; onDetail: () => void }) {
  const level = alert.style === "level" && alert.progress !== null;
  const budget = alert.icon === BUDGET;
  const p = alert.progress;
  return (
    <div className="cik">
      {level && <><span className="hudiz"><b style={{ "--s": p } as CSSProperties} /></span><span className="num b6 t12">{Math.round((p ?? 0) * 100)}</span></>}
      {!level && p !== null && <span className="miniIlerle" style={{ "--y": p, width: budget ? 72 : undefined } as CSSProperties}><b style={budget ? { background: p >= 1 ? "var(--kirmizi)" : "var(--turuncu)" } : undefined} /></span>}
      {alert.subtitle && <span className="t12 l2" title={alert.subtitle}>{alert.subtitle}</span>}
      {alert.action && !budget && <button className="btn kk ana" onClick={() => bridge.call("open_alert", { id: alert.id }).catch(noop)}>{actionLabel(alert)}</button>}
      {budget ? <button className="btn kk gri" onClick={onDetail}>Ayrıntı</button> : !level && <button className="btn kk gri" onClick={onLater}>Sonra</button>}
    </div>
  );
}

/* ---- kartlar ---- */
export function MeetingCard({ item }: { item: ProtrusionItem }) {
  const [cal, setCal] = useState<CalendarNext | null>(null);
  useEffect(() => { bridge.call("calendar_next").then(setCal).catch(noop); }, []);
  const guard = useGuard();
  const join = item.actions?.find((a) => a.style === "primary") ?? item.actions?.[0];
  return (
    <div className="govde">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t17 b6">{flat(item.title, 80)}</div>
          <div className="t13 b4 l2"><Attr plugin={item.plugin} title={cal?.detail ?? item.subtitle} /></div>
        </div>
        {join && item.plugin.id === REMINDER_PLUGIN.id ? ((item as ReminderItem).link && <JoinButton link={(item as ReminderItem).link!} className="btn mavi" label={join.label} focus><span className="dolu"><Video /></span></JoinButton>)
        : join && <button ref={guard.ref} className="btn mavi" data-autofocus data-korumali onClick={guard(() => bridge.call("plugin_action", { pluginId: item.plugin.id, actionId: join.id }).catch(noop))}><span className="dolu"><Video /></span>{plain(join.label, 24)}</button>}
      </div>
      {cal && cal.next.length > 0 && (
        <div className="liste cam" style={{ "--girinti": "52px" } as CSSProperties}>
          {cal.next.slice(0, 3).map((e) => <div className="sat" key={e.time + e.title}><span className="l3 num" style={{ width: 42 }}>{flat(e.time, 8)}</span><span className="metin">{flat(e.title, 60)}</span><span className="l3">{flat(e.source, 30)}</span></div>)}
        </div>
      )}
    </div>
  );
}

/** Ana asistan bağlı değil (x1): uyuyan maskot ve "<ad>'ı başlat" (yalnız ana eklentinin manifestinde `launch` varsa). Ana eklenti hiç yüklü değilse (`main` yok) Peeka'nın nötr simgesi ve düğme yok. */
export function AsistanYokCard({ main = null }: { main?: PluginInfo | null }) {
  const [err, setErr] = useState(false);
  const ad = main ? pluginName(main) : "Asistan";
  return (
    <div className="govde">
      <div className="mkOrta">
        {main ? <Mascot size={56} mood="sleeping" isMainAssistant /> : <NotchIk size={56} />}
        <div className="t15 b6">{ad} bağlı değil</div>
        <div className="t13 l2 b4">Peeka çalışmaya devam ediyor. {ad} açılınca soruların buraya gelir.</div>
        {main?.launch && <div className="dugmeler" style={{ marginTop: 4 }}><button className="btn ana" data-autofocus onClick={() => { setErr(false); bridge.call("assistant_start").catch(() => setErr(true)); }}>{accusative(ad)} başlat</button></div>}
        {err && <div className="t12 l3" role="alert">{ad} şimdi başlatılamadı</div>}
      </div>
    </div>
  );
}

/** Kart yükleniyor (ky): iskelet. Gösterme gecikmesi (800 ms) Island'da. */
export const LoadingBody = ({ what }: { what: string }) => (
  <div className="govde" role="status" aria-label={what}>
    <div className="mkBas"><Mascot size={56} mood="thinking" isMainAssistant /><span className="t13 l2 b4">{plain(what, 60)}</span></div>
    <div className="iskelet" /><div className="iskelet" style={{ width: "86%" }} /><div className="iskelet" style={{ width: "70%" }} />
  </div>
);

/** Seçili dosya için asistanın önerisi (g): öneri yoksa hiçbir şey çizilmez. */
export function ShelfSuggestRow({ items, main }: { items: ShelfItem[]; main: PluginInfo | null }) {
  const first = items[0]?.id;
  const [sug, setSug] = useState<ShelfSuggestion | null>(null);
  useEffect(() => { setSug(null); if (first && main) bridge.call("shelf_suggest", { id: first }).then(setSug).catch(noop); }, [first, main]);
  if (!main || !sug || sug.id !== first) return null;
  return (
    <div className="govde" style={{ paddingTop: 0, marginTop: -4 }}>
      <div className="oneri plat cam">
        <Lead plugin={refOf(main)} mascot="konusuyor" size={24} />
        <div style={{ flex: 1 }}>
          <div className="b4">{plain(sug.text, 200)}</div>
          <div className="dugmeler" style={{ marginTop: 10 }}>
            <button className="btn kk asistan" onClick={() => bridge.call("shelf_ask", { id: sug.id }).catch(noop)}><Sparkles />{askLabel(main)}</button>
            <button className="btn kk cam" onClick={() => bridge.call("shelf_memory", { id: sug.id }).catch(noop)}>Notlara ekle</button>
            <button className="btn kk cam" onClick={() => bridge.call("share_open", { id: sug.id }).catch(noop)}><Share />Paylaş</button>
          </div>
        </div>
      </div>
    </div>
  );
}
