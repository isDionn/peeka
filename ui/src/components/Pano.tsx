// Pano kartı ve Pano sekmesi (maket h, h1, h2, h3), Peeka kilit kartı (kl). ADR-0063: parola satırı maskeli; düz metin yalnız göz düğmesiyle,
// yalnız bu bileşenin state'inde ve en çok 5 sn durur (günlüğe, adrese, depolamaya, olaya hiçbir yerde yazılmaz).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { justPressed } from "../lib/justPressed";
import { AlignLeft, Check, Clipboard, Copy, Eye, EyeOff, File, FileImage, FileSpreadsheet, FileText, FileVideo, Fingerprint, KeyRound, Link, Lock, PanelTop, Pin, Scissors, Search, Sparkles, Terminal, Trash2 } from "lucide-react";
import { bridge, type ClipItem, type ClipPassword, type ClipPlain, type LockState, type PluginInfo } from "../bridge";
import { askLabel, useClips, useInput, useLock, useMainAssistant, useNow } from "../hooks";
import { ago, fileKind, hexOf, passwordSub, REVEAL_MS, safePreview, safeThumb } from "../lib/clip";
import { flat } from "../lib/plugin";
import { dative } from "../lib/cardsText";
import { sendX } from "../lib/xwin";
import { EmptyBoard } from "./CardsExtra";
import { Lead } from "./Plugin";
import { delOk } from "./common";
import "../fidelity-ayar.css";

/** Sabit, uydurma yer tutucu: gerçek parolayla ilgisi yok, yalnız bulanık metin görünümü için. Düz metin yalnız üstüne gelinince ya da klavye odağında gelir. */
const DUMMY = "a8F!k2Qm9Zr7vT";
const noop = () => undefined;

/** Satırın eylemleri yalnız üstüne gelince, odaktayken ya da seçiliyken görünür (sahip kararı 15). Görünmezken DOM'da da yoktur. */
function useActive(_selected: boolean, forced: boolean) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  return {
    active: hover || focus || forced, // seçili olmak tek başına eylem göstermez: iki satırda birden Sil görünmesin (O17)
    bind: {
      onPointerEnter: () => setHover(true),
      onPointerLeave: () => setHover(false),
      onFocus: () => setFocus(document.documentElement.hasAttribute("data-kb")), // yalnız klavyeyle odaklanınca; fare kullanıcısında hover tek kaynak
      onBlur: (e: React.FocusEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false); },
    },
  };
}

/** Dışarı sürüklenen öğenin kimliği (maket h2: kaynak küçük resim %35'e soluklaşır). Yerel Windows sürüklemesi sürerken sayfa olay almaz; bitişi `clip_drag_end` ya da ilk tuşsuz pointer olayı bildirir. */
let dragId: string | null = null;
const dragSubs = new Set<() => void>();
export function setPanoDrag(id: string | null) { dragId = id; dragSubs.forEach((f) => f()); }
const useDragId = () => useSyncExternalStore((f) => { dragSubs.add(f); return () => { dragSubs.delete(f); }; }, () => dragId);

/** Görsel ve dosya satırından 6 px sürüklenince dışarı sürükleme başlar (Windows'un yerel sürükleme resmi, Rust'ta). */
function useDragOut(id: string, on: boolean) {
  const start = useRef<[number, number] | null>(null);
  if (!on) return {};
  return {
    onPointerDown: (e: React.PointerEvent) => { if (e.button === 0 && !(e.target as HTMLElement).closest("button")) start.current = [e.clientX, e.clientY]; },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (s && e.buttons === 0) start.current = null; // tuş zaten bırakılmış
      else if (s && Math.hypot(e.clientX - s[0], e.clientY - s[1]) > 6) { start.current = null; setPanoDrag(id); bridge.call("clip_drag", { id }).catch(() => setPanoDrag(null)); }
    },
    onPointerUp: () => { start.current = null; },
  };
}

function Actions({ item, main, variant, revealed, onEye, notify }: { item: ClipItem; main: PluginInfo | null; variant: "row" | "thumb"; revealed: boolean; onEye: (id: string) => void; notify: (m: string) => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 1200); return () => clearTimeout(t); }, [copied]);
  const pw = item.kind === "password";
  const base = variant === "row" ? "mini" : "";
  const btn = (title: string, icon: ReactNode, onClick: () => void, extra = "", pressed?: boolean, disabled?: boolean) => (
    <button type="button" className={(base + " " + extra).trim()} title={title} aria-label={title} aria-pressed={pressed} disabled={disabled} onClick={(e) => { e.stopPropagation(); onClick(); }}>{icon}</button>
  );
  const id = item.id;
  return (
    <span className={variant === "row" ? "satEylem" : "eylem"}>
      {pw && btn(revealed ? "Gizle" : "Kısa süre göster", revealed ? <EyeOff /> : <Eye />, () => onEye(id), revealed ? "gozAcik" : "")}
      {btn(pw ? "Göstermeden geri kopyala" : "Geri kopyala", copied ? <Check /> : <Copy />, () => { bridge.call("clip_copy", { id }).then(() => { setCopied(true); notify("Kopyalandı"); }).catch(noop); })}
      {!pw && btn(item.pinned ? "Sabitlemeyi kaldır" : "Sabitle", <Pin />, () => { bridge.call("clip_pin", { id, on: !item.pinned }).catch(noop); }, item.pinned ? "acik" : "", item.pinned)}
      {!pw && btn(main ? askLabel(main) : "Asistan bağlı değil", <Sparkles />, () => { bridge.call("clip_share", { id }).then(() => notify("Gönderildi")).catch(() => notify("Asistan bağlı değil")); }, "sor", undefined, !main)}
      {btn("Sil", <Trash2 />, () => { if (delOk()) bridge.call("clip_delete", { id }).catch(noop); }, "sil")}
    </span>
  );
}

const FILE_ICON = { pdf: FileText, video: FileVideo, sheet: FileSpreadsheet, image: FileImage, other: File } as const;

/** Dosya türüne göre simge (Pano satırı ve Ctrl+K dosya sonucu). */
export function FileIcon({ name }: { name: string | null }) { const I = FILE_ICON[fileKind(name)]; return <I />; }

/** Satırın gövdesine tıklamak kopyalar (parola hariç: onu göz düğmesi ve "Göstermeden geri kopyala" yönetir). */
const copyBody = (id: string, notify: (m: string) => void) => { bridge.call("clip_copy", { id }).then(() => notify("Kopyalandı")).catch(noop); };

interface EntryProps { item: ClipItem; now: number; selected: boolean; main: PluginInfo | null; onSelect: (id: string) => void; notify: (m: string) => void }

/** Küçük resim kutusu (görsel öğeler, 4 sütun). */
function Thumb({ item, now, selected, main, onSelect, notify }: EntryProps & { item: ClipPlain }) {
  const { active, bind } = useActive(selected, false);
  const src = safeThumb(item.thumb);
  const drag = useDragOut(item.id, true);
  const dragging = useDragId();
  return (
    <div className={"pg cam" + (selected ? " sec" : "") + (dragging === item.id ? " surukleniyor" : "")} data-clip={item.id} tabIndex={selected ? 0 : -1} data-autofocus={selected ? "" : undefined} aria-label={`${item.sub ?? "Görsel"}, ${ago(item.createdAt, now)}`}
      {...bind} {...drag} onFocus={() => { bind.onFocus(); onSelect(item.id); }} onClick={() => { onSelect(item.id); copyBody(item.id, notify); }}>
      {src ? <img src={src} alt="" draggable={false} /> : <span className="pgYok"><FileImage /></span>}
      {active && <Actions item={item} main={main} variant="thumb" revealed={false} onEye={noop} notify={notify} />}
      <div className="alt"><span>{flat(item.sub, 40) || "Görsel"}</span><span className="num">{ago(item.createdAt, now)}</span></div>
    </div>
  );
}

function Tile({ item }: { item: ClipItem }) {
  if (item.kind === "password") return <span className="tip2 k-parola"><KeyRound /></span>;
  if (item.kind === "file") return <span className={"tip2 k-" + fileKind(item.text)}><FileIcon name={item.text} /></span>;
  if (item.kind === "image") { const s = safeThumb(item.thumb); return s ? <img className="renkKare kucukResim" src={s} alt="" /> : <span className="tip2 k-image"><FileImage /></span>; }
  const hex = hexOf(item);
  if (hex) return <span className="renkKare" style={{ background: hex }} />;
  const I = item.hint === "link" ? Link : item.hint === "command" ? Terminal : AlignLeft;
  return <span className="tip2"><I /></span>;
}

/** Liste satırı: metin, bağlantı, renk, komut, dosya ve parola. */
function Row({ item, now, selected, main, onSelect, shown, onEye, onPeek, onHide, notify }: EntryProps & { shown: string | null; onEye: (id: string) => void; onPeek: (id: string) => void; onHide: () => void }) {
  const pw = item.kind === "password";
  const revealed = shown !== null;
  const { active, bind } = useActive(selected, revealed);
  const drag = useDragOut(item.id, item.kind === "file" || item.kind === "image");
  const time = ago(item.createdAt, now);
  let body: ReactNode;
  if (pw) {
    const p: ClipPassword = item;
    body = (
      <div style={{ flex: 1, minWidth: 0 }}>
        {revealed ? <div className="metin num">{shown}</div> : <div className="metin num" role="img" aria-label="Gizli parola">{DUMMY}</div>}
        <div className="t12 l3 b4">{revealed ? "5 sn sonra yeniden gizlenir" : passwordSub(p.source, p.expiresAt, now)}</div>
      </div>
    );
  } else if (item.kind === "file" || item.kind === "image") {
    body = <div style={{ flex: 1, minWidth: 0 }}><div className="metin">{flat(item.text ?? item.sub, 120)}</div>{item.kind === "file" && item.sub && <div className="t12 l3 b4">{flat(item.sub, 120)}</div>}</div>;
  } else {
    body = <span className={"metin b4 num" + (item.hint === "command" ? " komut" : "")}>{flat(item.text, 200)}</span>;
  }
  return (
    <div className={"sat" + (dragId === item.id ? " surukleniyor" : "") + (pw ? " gizli" : "") + (revealed ? " acik" : "") + (selected ? " sec" : "") + (active ? " etkin" : "") + (!pw && item.missing ? " soluk" : "")}
      data-clip={item.id} tabIndex={selected ? 0 : -1} data-autofocus={selected ? "" : undefined} {...bind} {...drag}
      // parola: üstüne gelince / klavye odağında düz metin gelir (bir girişte bir çağrı, pointermove'da değil); çıkınca ya da odak gidince anında silinir
      onPointerEnter={() => { bind.onPointerEnter(); if (pw) onPeek(item.id); }} onPointerLeave={() => { bind.onPointerLeave(); if (pw) onHide(); }}
      onBlur={(e) => { bind.onBlur(e); if (pw && !e.currentTarget.contains(e.relatedTarget as Node | null) && !justPressed()) onHide(); }}
      onFocus={() => { bind.onFocus(); onSelect(item.id); if (pw && document.documentElement.hasAttribute("data-kb")) onPeek(item.id); }} onClick={() => { onSelect(item.id); if (!pw) copyBody(item.id, notify); }}>
      <Tile item={item} />
      {body}
      {!pw && item.pinned && <Pin className="sabitIk" aria-label="Sabit" />}
      <span className="t12 l3 num zaman">{time}</span>
      {active && <Actions item={item} main={main} variant="row" revealed={revealed} onEye={onEye} notify={notify} />}
    </div>
  );
}

const Empty = () => <EmptyBoard />;

/**
 * Pano kartı gövdesi (ada kartı ve Modüller'in Pano sekmesi). Görünürken Rust'a `clip_visible` bildirir: ada penceresi yakalamadan hariç tutulur (ADR-0063 §7).
 * Göz düğmesi: değer 5 sn gösterilir; süre dolunca, yeniden basınca, pencere odağı gidince, kart sökülünce, kilit gelince ya da öğe düşünce state'ten silinir.
 */
let lastH = 0; // son çizilen yükseklik: cevap beklerken yer tutucu kartı çökertmez
export function PanoView({ bare, onReady }: { bare?: boolean; onReady?: () => void }) {
  const all = useClips();
  const main = useMainAssistant();
  const now = useNow().getTime();
  const [sel, setSel] = useState<string | null>(null);
  const [shown, setShown] = useState<{ id: string; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seq = useRef(0);
  const root = useRef<HTMLDivElement>(null);

  // Yakalama hariç tutma kart çizilmeden önce açılır: ilk kare Rust'ın cevabından sonra gelir. Cevap `true` değilse (reddedildi, hata, Rust yok)
  // pencere ekran yakalamasına açık olabilir: parola satırları hiç çizilmez (güvenli taraf, ADR-0063 §7).
  const [excluded, setExcluded] = useState<boolean | null>(null); // null = cevap bekleniyor
  useLayoutEffect(() => {
    let live = true;
    bridge.call("clip_visible", { on: true }).then((ok) => ok === true, () => false).then((ok) => { if (live) setExcluded(ok); });
    return () => { live = false; bridge.call("clip_visible", { on: false }).catch(noop); };
  }, []);
  useEffect(() => { if (excluded !== null) onReady?.(); }, [excluded]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { if (root.current) lastH = root.current.offsetHeight; });
  const base = excluded ? all : all.filter((c) => c.kind !== "password");
  // süzgeç: yazdıkça daralır; parola satırı içeriğiyle değil yalnız kaynak uygulama adıyla eşleşir (içerik zaten istemcide yok)
  const [fq, setFq] = useState("");
  const needle = fq.trim().toLocaleLowerCase("tr");
  const items = needle ? base.filter((c) => (c.kind === "password" ? [c.source] : [c.source, c.text, c.sub]).some((v) => v?.toLocaleLowerCase("tr").includes(needle))) : base;
  const [note, setNote] = useState<string | null>(null); // kopyala / gönder geri bildirimi (1,6 sn)
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((m: string) => { setNote(m); clearTimeout(noteTimer.current); noteTimer.current = setTimeout(() => setNote(null), 1600); }, []);
  useEffect(() => () => clearTimeout(noteTimer.current), []);

  // sürükleme bitince kaynak yeniden açılır: Rust olayı ya da tuşsuz ilk pointer olayı (yerel sürükleme bitmiştir)
  const dragging = useDragId();
  useEffect(() => {
    if (!dragging) return;
    const off = bridge.on("clip_drag_end", () => setPanoDrag(null));
    const end = (e: PointerEvent) => { if (e.type === "pointerup" || e.buttons === 0) setPanoDrag(null); };
    window.addEventListener("pointerup", end); window.addEventListener("pointermove", end);
    return () => { off.then((f) => f()); window.removeEventListener("pointerup", end); window.removeEventListener("pointermove", end); };
  }, [dragging]);

  const hide = useCallback(() => { seq.current++; clearTimeout(timer.current); setShown(null); }, []);
  // pencere odağı gidince gizlenir; tıklamadan hemen sonra odağın önceki uygulamaya geri verilmesi sayılmaz
  useEffect(() => { const off = () => { if (!justPressed()) hide(); }; window.addEventListener("blur", off); return () => { window.removeEventListener("blur", off); hide(); }; }, [hide]);
  useEffect(() => { if (shown && !items.some((c) => c.id === shown.id)) hide(); }, [items, shown, hide]);
  const reveal = useCallback(async (id: string) => {
    if (shown?.id === id) return hide();
    hide();
    const mine = seq.current;
    try {
      const r = await bridge.call("clip_reveal", { id });
      if (mine !== seq.current) return; // bu arada gizlendi ya da başka öğe istendi
      setShown({ id, text: r.text });
      timer.current = setTimeout(hide, Math.min(r.ttlMs, REVEAL_MS));
    } catch { /* kilitli ya da öğe yok: gösterilmez */ }
  }, [shown, hide]);
  // Sunum sürerken üstüne gelmek hiçbir şeyi göstermez (göz düğmesi de kapalı); kilitliyken Rust zaten `denied` döner.
  const sunum = useInput().presentation;
  useEffect(() => { if (sunum) hide(); }, [sunum, hide]);
  const peek = useCallback((id: string) => { if (!sunum && shown?.id !== id) void reveal(id); }, [sunum, shown, reveal]);

  const images = items.filter((c): c is ClipPlain => c.kind === "image").slice(0, 8);
  const rows = items.filter((c) => !images.includes(c as ClipPlain));
  const order = [...images, ...rows];
  const cur = order.some((c) => c.id === sel) ? sel : order[0]?.id ?? null;

  const onKey = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (!el.dataset.clip) return; // yalnız öğenin kendisi odaktayken
    const i = order.findIndex((c) => c.id === el.dataset.clip);
    const go = (k: number) => root.current?.querySelector<HTMLElement>(`[data-clip="${order[Math.max(0, Math.min(order.length - 1, k))]?.id}"]`)?.focus();
    if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); go(i + 1); }
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); go(i - 1); }
    else if (e.key === "Enter") { e.preventDefault(); bridge.call("clip_copy", { id: el.dataset.clip }).catch(noop); }
    else if (e.key === "Delete") { e.preventDefault(); go(i === order.length - 1 ? i - 1 : i + 1); bridge.call("clip_delete", { id: el.dataset.clip }).catch(noop); }
  };

  if (excluded === null) return <div className={bare ? "panoIc" : "govde"} aria-busy="true" style={{ minHeight: lastH || undefined }} />;
  return (
    <div className={bare ? "panoIc" : "govde"} ref={root} onKeyDown={onKey}>
      {base.length === 0 ? <Empty /> : (
        <>
          <div className="yazkutu cam panoSuz">
            <Search className="l3" />
            <input value={fq} onChange={(e) => setFq(e.target.value)} placeholder="Panoda ara" aria-label="Panoda ara" autoComplete="off"
              onKeyDownCapture={(e) => { if (e.key === "Escape" && fq) { e.preventDefault(); e.stopPropagation(); setFq(""); } }}
              onKeyDown={(e) => { if (e.key === "ArrowDown" && order[0]) { e.preventDefault(); root.current?.querySelector<HTMLElement>(`[data-clip="${order[0].id}"]`)?.focus(); } }} />
          </div>
          {order.length === 0 && <div className="bosSonuc" role="status">Eşleşme yok</div>}
          {images.length > 0 && (
            <div className="panoGorseller">{images.map((c) => <Thumb key={c.id} item={c} now={now} selected={c.id === cur} main={main} onSelect={setSel} notify={notify} />)}</div>
          )}
          {rows.length > 0 && (
            <div className="liste cam panoListe" style={{ "--girinti": "36px" } as React.CSSProperties}>
              {rows.map((c) => <Row key={c.id} item={c} now={now} selected={c.id === cur} main={main} onSelect={setSel} notify={notify} shown={shown?.id === c.id ? shown.text : null} onEye={sunum ? noop : reveal} onPeek={peek} onHide={hide} />)}
            </div>
          )}
          <div className="t12 l3 b4" role="status">{note ?? <>Son 24 saat, yalnız bu bilgisayarda{!excluded && " · Parolalar gizli: pencere ekran yakalamasından saklanamadı"}</>}</div>
        </>
      )}
    </div>
  );
}

/** Kart açıkken şeridin ortası (bir bilgi bir kez): "Pano 11 öğe". */
export function PanoCenter() {
  const items = useClips();
  return <span className="ms"><Clipboard /><span className="b6">Pano</span>{items.length > 0 && <span className="l3">{items.length} öğe</span>}</span>;
}

/** Çıkıntı açan kopya: her görsel, dosya ve bağlantı (düz metin açmaz). Parola ve hassas pencere Rust'ta zaten kaydedilmez. */
export type StripKind = "image" | "file" | "link";
export const stripKind = (c: ClipItem | null): StripKind | null => (c === null || c.kind === "password" ? null : c.kind === "image" ? "image" : c.kind === "file" ? "file" : c.hint === "link" ? "link" : null);
export const STRIP_TXT: Record<StripKind, string> = { image: "Görsel kopyalandı", file: "Dosya kopyalandı", link: "Bağlantı kopyalandı" };
const STRIP_ICON = { image: FileImage, file: File, link: Link } as const;

/** Win+Shift+S çıkıntısı (maket h1) ve öteki kopyalar: görselde küçük resim, dosyada/bağlantıda simge ve ad. */
export function ShotCenter({ main, item }: { main: PluginInfo | null; item?: ClipPlain }) {
  const k = stripKind(item ?? null) ?? "image", Ic = item?.screenshot ? Scissors : STRIP_ICON[k];
  return <span className="ms">{main && <Lead plugin={{ id: main.id, name: main.name, main: true }} mascot="hazir" size={24} />}<Ic /><span className="b6">{item?.screenshot || !item ? "Ekran alıntısı" : STRIP_TXT[k]}</span></span>;
}
/**
 * Kopya çıkıntısı (karar 2026-10-17). Üst satır hiç değişmez; `big` (imleç üstünde, yalnız görsel) altına büyük önizleme ve Kopyala / Tut ekler:
 * genişlik sabit 360 px olduğundan yalnız aşağı büyür, imlecin altında hiçbir şey kaymaz. Görselde büyük önizleme `clip_preview` ile; görsel ve dosyada Aç ve Rafa koy.
 */
/** Çekirdek bu cümleyi "özetle" diye tanır (core notch_bridge/summary.py `asks_summary`); değiştirirsen orayı da bak. */
const SUMMARIZE_ASK = "Bu bağlantıyı özetle";
export function ShotBump({ item, main, big = false }: { item: ClipPlain; main: PluginInfo | null; big?: boolean }) {
  const k = stripKind(item) ?? "image", Ic = STRIP_ICON[k];
  // büyük önizleme: Rust'ın `clip_preview` PNG'si (en çok 1024 px); gelene dek küçük resim durur (kutu sabit, kayma yok). Kilitliyken reddedilir, sessizce küçük resimle kalır.
  const [prev, setPrev] = useState<string | null>(null);
  useEffect(() => { if (!big || k !== "image") return; let live = true; bridge.call("clip_preview", { id: item.id }).then((u) => { if (live) setPrev(safePreview(u)); }).catch(noop); return () => { live = false; }; }, [big, k, item.id]);
  const thumb = safeThumb(item.thumb), src = prev ?? thumb;
  const call = (cmd: "clip_share" | "clip_edit" | "clip_copy" | "clip_open" | "clip_to_shelf") => () => bridge.call(cmd, { id: item.id }).catch(noop); // kilitli/izinsiz ret sessiz
  const ask = main && <button className="btn kk asistan" onClick={call("clip_share")}><Sparkles />{askLabel(main)}</button>;
  const pin = <button className="btn kk gri" onClick={() => bridge.call("clip_pin", { id: item.id, on: true }).catch(noop)}><Pin />Tut</button>;
  // Bağlantı: "asistana özetlet" (yalnız ana asistan bağlıyken, kilitliyken yok). Rust bağlantıyı kendisi çözer (en yeni pano bağlantısı), sayfa metni arayüzden geçmez; cevap ada yanıt görünümünde açılır.
  const locked = useLock().locked;
  const summarize = k === "link" && main && !locked && (
    <button className="btn kk asistan" onClick={() => { bridge.call("composer_submit", { text: SUMMARIZE_ASK, attachments: [{ kind: "clipboard_link" }] }).then(() => sendX({ t: "ask" })).catch(noop); }}><Sparkles />{dative(main.name)} özetlet</button>
  );
  const openShelf = <><button className="btn kk gri" onClick={call("clip_open")}>Aç</button><button className="btn kk gri" onClick={call("clip_to_shelf")}>Rafa koy</button></>;
  return (
    <div className="cik shotCik">
      <div className="shotUst">
        {k === "image" ? thumb && <img className="alintiKucuk" src={thumb} alt={item.screenshot ? "Ekran alıntısı küçük resmi" : "Görsel küçük resmi"} /> : <span className="tip2 shotIk"><Ic /></span>}
        <span className="t12 l2">{k === "image" ? "Panoya kopyalandı" : flat(item.text ?? item.sub, 40)}</span>
        {ask}
        {item.screenshot ? <button className="btn kk gri" onClick={call("clip_edit")}>Düzenle</button> : k !== "image" && pin}
      </div>
      {big && k === "image" && (
        <div className="shotBuyuk">
          {src && <img className="shotBuyukResim" src={src} alt="Büyük önizleme" />}
          <div className="shotEylem"><button className="btn kk gri" onClick={call("clip_copy")}><Copy />Kopyala</button>{pin}{openShelf}</div>
        </div>
      )}
      {k === "file" && <div className="shotEylem">{openShelf}</div>}
      {summarize && <div className="shotEylem">{summarize}</div>}
    </div>
  );
}

const WHY: Record<NonNullable<LockState["reason"]>, string> = {
  windows: "Windows kilidini açınca kendiliğinden kalkar.", manual: "", plugin: "Bir eklenti kilitledi.",
};
/** Peeka kilitli (maket kl): yalnız gösterim. Pano, bildirim içerikleri ve eklenti kartları gizli; saat, sabitler ve pencereler çalışır. */
export function LockCard({ lock }: { lock: LockState }) {
  return (
    <div className="govde">
      <div className="mkOrta">
        <span className="notchIk" style={{ width: 56, height: 56 }}><PanelTop /></span>
        <div className="t15 b6">Peeka kilitli</div>
        <div className="t13 l2 b4">Pano, bildirim içerikleri ve eklenti kartları gizli. Saat, sabitler ve pencereler çalışır.</div>
        {lock.reason && WHY[lock.reason] && <div className="t12 l3 b4">{WHY[lock.reason]}</div>}
        {lock.reason !== "windows" && <button className="btn ana" data-autofocus onClick={() => bridge.call("lock_release").catch(noop)}><Fingerprint />Kilidi aç</button>}
      </div>
    </div>
  );
}
export const LockCenter = () => <span className="ms"><Lock /><span className="b6">Peeka kilitli</span></span>;
