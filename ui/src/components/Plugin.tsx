// Eklentilerin bildirimsel çizimi (ADR-0062 §4.6): eklenti veri gönderir, Peeka çizer. Her metin düz metin (React kaçışı), `dangerouslySetInnerHTML`, bağlantı ve eklenti simgesi yok.
// Her öğenin başına eklentinin adını Peeka basar (`prefixed`); eklenti bunu değiştiremez.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlarmClock, Brain, Check, Circle, CircleCheck, CircleDot, ExternalLink, Ghost, List, Mic, MousePointerClick, Paperclip, Plus, ScanLine, ShieldAlert, StickyNote, Terminal, TriangleAlert, Users, Video, X, type LucideIcon } from "lucide-react";
import { bridge, type ActionDef, type ApprovalExt, type ApprovalItem, type Attached, type CardBlock, type ChoiceExt, type ComposerKind, type MeterBlock, type RowExt, type ProtrusionExt, type SummaryRowExt, type ModuleTab, type PluginRef, type ProtrusionItem, type SurfacesView } from "../bridge";
import { useClips, useDeadline, useSecond, useShelf, useStream, type Turn } from "../hooks";
import { AlertIcon, safeIcon } from "../lib/alertIcon";
import { Mascot } from "../mascot";
import { elapsed, flat, mascotOf, moodOf, plain, pluginName, prefixed, riskOf, safeImage } from "../lib/plugin";
import { useGuard } from "../lib/useGuard";
import { openJoinLink, REMINDER_PLUGIN, type ReminderItem } from "../lib/meetingReminder";
import { dative, shortApprovalTitle } from "../lib/cardsText";
import { useComposerKinds } from "../hooks.fidelity";
import { Transcript, phaseOf } from "./Voice";
import "./cards.css";
import { HoldButton } from "./common";

/* ---- kimlik: ad ön eki ve baş harf karosu / maskot ---- */

/** "asistan › Başlık": ön ek Peeka'nın, soluk renkte; başlık eklentinin ama ayraçlar düzleştirilmiş. */
export function Attr({ plugin, title, strong, dim }: { plugin: Pick<PluginRef, "name">; title?: unknown; strong?: boolean; /** Kaynak adı: başlık da soluk (maket c1: "Claude Code" yazı 3). */ dim?: boolean }) {
  const n = pluginName(plugin), t = flat(title);
  const same = !t || t.toLocaleLowerCase("tr") === n.toLocaleLowerCase("tr");
  return <span className="onEk" data-onek>{same ? <span className={strong ? "b6" : "l3"}>{n}</span> : <><span className="l3">{n} ›</span> <span className={strong ? "b6" : dim ? "l3" : undefined}>{t}</span></>}</span>;
}

/** Ana asistanın maskotu (tablodaki halde) ya da Peeka'nın çizdiği baş harf karosu. 24 px şerit (varsayılan), 56 px kart, 96 px büyük kart. `onPoke`: tıklama (zıplama sonrası). */
export function Lead({ plugin, mascot, size = 24, onPoke, still, hint }: { plugin: PluginRef; mascot?: unknown; size?: number; onPoke?: () => void; still?: boolean; /** Rozet yanı klavye ipucu (yalnız 56 px ve onay halinde görünür). */ hint?: ReactNode }) {
  const hal = mascotOf(plugin, mascot);
  if (hal) return <span className="leadMk" data-mk={hal} aria-hidden="true"><Mascot size={size} mood={moodOf(hal)} isMainAssistant onPoke={onPoke} still={still} badgeHint={hint} /></span>;
  return <span className={"basHarf" + (size < 28 ? " k" : size >= 56 ? " b" : "")} aria-hidden="true">{Array.from(pluginName(plugin))[0]?.toLocaleUpperCase("tr")}</span>;
}

/** Peeka'nın düğme stilleri: yalnız `default | primary | destructive`; renk serbest değil. */
const styleClass = (s: ActionDef["style"]) => (s === "primary" ? "mavi" : s === "destructive" ? "yikiciDolu" : "gri");

/** Koruma süresi dolmadan gelen tıklamayı yok sayan düğme. */
function GuardBtn({ className, onClick, children, ...rest }: { className: string; onClick: () => void; children: ReactNode } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "className">) {
  const guard = useGuard();
  return <button {...rest} ref={guard.ref} className={className} data-korumali onClick={guard(onClick)}>{children}</button>;
}

/** Hatırlatmadaki "Katıl": bağlantıyı açar; açılamazsa düğme "Açılamadı" der (sessizce yutmaz). */
export function JoinButton({ link, className, label, focus, children }: { link: string; className: string; label: string; focus?: boolean; children?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  return <GuardBtn className={className} data-autofocus={focus ? true : undefined} onClick={() => { setFailed(false); openJoinLink(link).catch(() => setFailed(true)); }}>{children}{failed ? "Açılamadı" : plain(label, 24)}</GuardBtn>;
}

function ActionButtons({ plugin, actions, kk = true, video, link }: { plugin: PluginRef; actions?: ActionDef[]; kk?: boolean; /** Toplantı çıkıntısı: birincil düğmenin başında kamera simgesi. */ video?: boolean; /** Hatırlatma düğmesi eklentiye değil bu bağlantıya gider. */ link?: string }) {
  return <>{(actions ?? []).slice(0, 2).map((a) => plugin.id === REMINDER_PLUGIN.id ? (
    link ? <JoinButton key={a.id} link={link} className={"btn " + (kk ? "kk " : "") + styleClass(a.style)} label={a.label}><span className="dolu"><Video /></span></JoinButton> : null
  ) : (
    <GuardBtn key={a.id} className={"btn " + (kk ? "kk " : "") + styleClass(a.style)} onClick={() => bridge.call("plugin_action", { pluginId: plugin.id, actionId: a.id }).catch(() => undefined)}>{video && a.style === "primary" && <span className="dolu"><Video /></span>}{plain(a.label, 24)}</GuardBtn>
  ))}</>;
}

/** Düz metin sayacı (başlangıç zamanından Peeka sayar). */
export function Elapsed({ startedAt }: { startedAt: string }) {
  const now = useSecond();
  return <span className="num">{elapsed(startedAt, now)}</span>;
}

/* ---- island.protrusion ---- */

/** Şeridin ortası: maskot ya da baş harf karosu, simge, ad ön ekli başlık. */
export function ProtrusionCenter({ item }: { item: ProtrusionItem }) {
  const icon = safeIcon(item.icon);
  const rec = item.state === "danger" && !!item.timer; // kayıt çipi: kırmızı nokta ve sayaç şeritte
  const phase = item.plugin.main ? phaseOf(item.mascot) : null; // ses fazı (d1/d3) ya da dikte: dalga, faz rengi
  const note = plain((item as ProtrusionExt).note, 40) || (item.plugin.main && item.icon === "ticket" ? "taslak hazır" : ""); // şerit alt notu (maket tik)
  const title = phase && (item.mascot !== "dinliyor" || (item as ProtrusionExt).transcript) ? phase.label : item.title; // faz yazısı Peeka'nın tablosundan; dikte kendi başlığını korur
  return (
    <span className="ms" data-state={item.state} data-faz={phase ? item.mascot : undefined}>
      {(!item.plugin.main || mascotOf(item.plugin, item.mascot)) && !riding(item) && <Lead plugin={item.plugin} mascot={item.mascot} />}{/* asistanın maskotsuz çıkıntısında "A" karosu yok; ad ön eki kalır */}
      {rec ? <span className="kayNokta" aria-hidden="true" /> : icon && <span className="ikK pst"><AlertIcon name={icon} /></span>}
      <span className="b6"><Attr plugin={item.plugin} title={title} strong /></span>
      {item.timer && <span className="sayac l2"><Elapsed startedAt={item.timer.startedAt} /></span>}
      {note && <span className="l3">{note}</span>}
      {phase && <span className="dalga" style={{ "--faz": phase.color } as React.CSSProperties} aria-hidden="true">{Array.from({ length: 7 }, (_, i) => <i key={i} />)}</span>}
    </span>
  );
}

/** İlerleme çubuğu olan ana asistan çıkıntısında maskot çubukta ilerler (tek maskot: orta satırdaki Lead gizlenir). */
const riding = (item: ProtrusionItem) => item.plugin.main && !!mascotOf(item.plugin, item.mascot) && typeof item.progress === "number";

/** Çıkıntı satırı: alt başlık, ilerleme, sayaç, akan metin, en çok 2 düğme. */
export function ProtrusionBump({ item }: { item: ProtrusionItem }) {
  const { text: live, speaker } = useStream(item.liveText?.streamId);
  const p = typeof item.progress === "number" ? Math.min(1, Math.max(0, item.progress)) : null;
  const dictating = item.plugin.main && item.mascot === "dinliyor"; // dikte: tırnaklı canlı satır ve "Esc iptal"
  const tr = (item as ProtrusionExt).transcript?.streamId;
  if (tr) return <Transcript streamId={tr} name={item.plugin.name} />;
  return (
    <div className="cik" data-state={item.state}>
      {item.subtitle && <span className="t12 l2" title={plain(item.subtitle, 120)}>{plain(item.subtitle, 120)}</span>}
      {live && (dictating
        ? <span className="t12 l2 canliYazi">“{plain(live, 160)}”</span>
        : <span className="t12 l2 canliYazi">{plain(speaker, 24) && <span className="kim">{plain(speaker, 24)}</span>}{plain(live, 160)}</span>)}
      {p !== null && (riding(item)
        ? <span className="ilerleMk" style={{ "--y": p } as React.CSSProperties}><span className="miniIlerle"><b /></span><span className="binici"><Lead plugin={item.plugin} mascot={item.mascot} /></span></span>
        : <span className="miniIlerle" style={{ "--y": p } as React.CSSProperties}><b /></span>)}
      <ActionButtons plugin={item.plugin} actions={item.actions} video={item.icon === "calendar"} link={(item as ReminderItem).link} />
      {dictating && <span className="tus-ipucu"><kbd>Esc</kbd> iptal</span>}
    </div>
  );
}

/* ---- approvals.prompt ---- */

const codeOf = (a: ApprovalItem) => plain(a.command ?? a.path ?? "", 600);

/** Şeridin ortası (çıkıntı açıkken): turuncu nokta, başlık, yüksek riskte "yüksek risk", değilse ad ön ekli kaynak. */
export function ApprovalCenter({ a }: { a: ApprovalItem }) {
  const high = riskOf(a.risk) === "high";
  return (
    <span className="ms">
      <Lead plugin={a.plugin} mascot={a.kind === "question" ? "soru" : "onay"} />
      <span className="nab" />
      <span className="b6">{shortApprovalTitle(a as ApprovalItem & ApprovalExt)}</span>
      {high ? <span className="b6 l1">yüksek risk</span> : <Attr plugin={a.plugin} title={a.source} dim />}
    </span>
  );
}

/** Kart açıkken şeritte kısa etiket ("bir bilgi bir kez"). */
export const ApprovalShort = () => <span className="ms"><span className="nab" /><span className="b6">İzin</span></span>;

/**
 * Onay çıkıntısı. Düşük riskte "İzin ver" + "Ayrıntı"; yüksek riskte (ya da risk bilinmiyorsa), tam ekranda inen şeritte
 * ve seçenek/yazı isteyen sorularda yalnız "Ayrıntı" (cevap kartta).
 */
export function ApprovalBump({ a, onDetail, onlyDetail, dropMs }: { a: ApprovalItem; onDetail: () => void; onlyDetail?: boolean; dropMs?: number | null }) {
  const high = riskOf(a.risk) === "high";
  const simple = !a.choices?.length && !a.freeText;
  const direct = !high && !onlyDetail && simple && a.options.includes("allow");
  return (
    <div className="cik" style={dropMs ? ({ "--sure": dropMs + "ms", position: "relative" } as React.CSSProperties) : undefined}>
      {codeOf(a) && <span className="kodSatir" title={codeOf(a)}>{codeOf(a)}</span>}
      {direct && <GuardBtn className="btn kk ana" onClick={() => answer(a, "allow", {}, "protrusion")}>İzin ver</GuardBtn>}
      <button className={"btn kk " + (direct ? "gri" : "ana")} onClick={onDetail}>Ayrıntı</button>
      {dropMs ? <span className="sureCizgi" /> : null}
    </div>
  );
}

function answer(a: ApprovalItem, decision: "allow" | "always" | "deny" | "choice", extra: { choiceId?: string; text?: string } = {}, surface: "protrusion" | "card" = "card") {
  bridge.call("approval_answer", { pluginId: a.plugin.id, id: a.id, decision, surface, ...extra }).catch(() => undefined);
}

/** Onay kartı. Yüksek riskte "Reddet" varsayılan odakta, "İzin ver" 1,2 sn basılı tutulur ve "Her zaman" yoktur. */
export function ApprovalCard({ a }: { a: ApprovalItem }) {
  const high = riskOf(a.risk) === "high";
  const opts = new Set(a.options);
  if (high) opts.delete("always"); // yüksek riskte Peeka kaldırır
  const choices = (a.choices ?? []).slice(0, 6);
  const rec = choices.find((c) => (c as ChoiceExt).recommended === true)?.id ?? null; // önerilen seçenek kartta önceden seçili (maket c3)
  const [choice, setChoice] = useState<string | null>(rec);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false); // "Başka cevap yaz" yazı kutusunu açar
  const warnId = useId();
  const asks = choices.length > 0 || !!a.freeText;
  // radyo grubu: tek Tab durağı, ok tuşları gezer ve seçer (F-17)
  const radioKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = choices.findIndex((c) => c.id === e.currentTarget.dataset.id), n = (i + d + choices.length) % choices.length;
    setChoice(choices[n].id);
    (e.currentTarget.parentElement?.children[n] as HTMLElement | undefined)?.focus();
  };
  const code = codeOf(a);
  const left = useDeadline(a.id, a.expiresS);
  // N = Reddet, Y = İzin ver: düğmeyi tıklar, yani aynı koruma (600 ms + imleç kuralı) geçerli. Yüksek riskte Y yalnız basılı tutulan düğmeye odaklanır.
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat || t?.closest?.("input,textarea,[contenteditable]")) return;
      const k = e.key.toLowerCase();
      if (k !== "n" && k !== "y") return;
      const b = card.current?.querySelector<HTMLElement>(k === "n" ? "[data-kisa=red]" : high ? ".izinTut" : "[data-kisa=izin]");
      if (!b) return;
      e.preventDefault();
      if (k === "y" && high) b.focus(); else b.click();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [high]);
  const hint = high ? <span><kbd>N</kbd> Reddet / <kbd>Y</kbd> basılı tut</span> : <span><kbd>N</kbd> Reddet / <kbd>Y</kbd> İzin ver</span>;
  const reply = asks && (choice || text.trim()) ? () => answer(a, "choice", { choiceId: choice ?? undefined, text: text.trim() ? text.trim().slice(0, 2000) : undefined }) : null;
  const sub = [prefixed(a.plugin, a.source), a.detail ? plain(a.detail, 200) : ""].filter(Boolean).join(" · ");
  const open = <button className="btn cam ik" title="Editörde aç" aria-label="Editörde aç"><ExternalLink /></button>;
  const box = a.freeText && (typing || choices.length === 0) && (
    <>
      {a.freeTextWarning && <div className="uyariSatir t12" id={warnId}><TriangleAlert aria-hidden="true" />Bu soru {pluginName(a.plugin)} eklentisinden; buraya şifre yazma</div>}
      <div className="yazkutu cam"><input autoFocus={typing} value={text} maxLength={2000} placeholder="Başka cevap yaz" aria-label="Başka cevap yaz" aria-describedby={a.freeTextWarning ? warnId : undefined} onChange={(e) => setText(e.target.value)} /></div>
    </>
  );
  return (
    <div className="govde" ref={card} data-onay={high ? "yuksek" : "dusuk"}>
      <div className="mkBas">
        {high && <span className="uyariIk"><TriangleAlert /></span>}
        <Lead plugin={a.plugin} mascot={high ? "ciddi" : a.kind === "question" ? "soru" : "onay"} size={56} hint={hint} />
        <div style={{ flex: 1, minWidth: 0 }}><div className="t17 b6" title={flat(a.title)}>{flat(a.title)}</div><div className="t13 l2 b4" title={sub}>{sub}</div></div>
      </div>
      {code && <div className="kod cam">{code}{a.cwd ? <>{"\n"}<span className="l2">klasör: {plain(a.cwd, 300)}</span></> : null}</div>}
      {choices.length > 0 && (
        <div className="liste cam" style={{ "--girinti": "30px" } as React.CSSProperties} role="radiogroup" aria-label="Seçenekler">
          {choices.map((c, i) => (
            <button key={c.id} data-id={c.id} className={"sat" + (choice === c.id ? " sec" : "")} role="radio" aria-checked={choice === c.id} tabIndex={choice === c.id || (choice === null && i === 0) ? 0 : -1} onKeyDown={radioKey} onClick={() => setChoice(c.id)}>
              {choice === c.id ? <CircleDot /> : <Circle />}<span className="metin" style={{ textAlign: "left" }}>{flat(c.label, 120)}</span>{c.id === rec && <span className="t12 l3 oneriTag">önerilen</span>}
            </button>
          ))}
        </div>
      )}
      {choices.length === 0 && box}
      <div className="dugmeler">
        {high ? (
          <>
            <button className="btn ana" data-autofocus data-kisa="red" onClick={() => answer(a, "deny")}><X />Reddet</button>
            {opts.has("allow") && <HoldButton big guarded className="izinTut" label="İzin ver" icon={null} onDone={() => answer(a, "allow")} />}
          </>
        ) : asks ? (
          <>
            <GuardBtn className="btn ana" data-autofocus onClick={() => reply?.()} aria-disabled={!reply}>{a.kind === "plan" && opts.has("allow") ? "Planı onayla" : "Cevapla"}</GuardBtn>
            {a.freeText && choices.length > 0 && <button className="btn cam" aria-expanded={typing} disabled={typing} onClick={() => setTyping(true)}>Başka cevap yaz</button>}
            {opts.has("deny") && <GuardBtn className="btn cam yikici" data-kisa="red" onClick={() => answer(a, "deny")}><X />Reddet</GuardBtn>}
          </>
        ) : (
          <>
            {opts.has("allow") && <GuardBtn className="btn ana" data-autofocus data-kisa="izin" onClick={() => answer(a, "allow")}>İzin ver</GuardBtn>}
            {opts.has("always") && <GuardBtn className="btn cam" title={plain(a.alwaysLabel, 80)} onClick={() => answer(a, "always")}>Her zaman izin ver</GuardBtn>}
            {opts.has("deny") && <GuardBtn className="btn cam yikici" data-kisa="red" onClick={() => answer(a, "deny")}><X />Reddet</GuardBtn>}
          </>
        )}
        <span style={{ flex: 1 }} />
        {left !== null && <span className="t12 l3 num" role="timer">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>}
        {a.kind === "command" || a.kind === "file" || a.kind === "plan" ? open : null}
      </div>
      {choices.length > 0 && box}{/* yazı kutusu düğmelerin altında açılır: düğmeler yerinde kalır (R1-3) */}
      {!high && opts.has("always") && a.alwaysLabel && <div className="t12 l3 b4">Her zaman: {plain(a.alwaysLabel, 80)}</div>}
    </div>
  );
}

/* ---- card.module ---- */

function Block({ b, plugin }: { b: CardBlock | MeterBlock; plugin: PluginRef }) {
  switch (b.type) {
    case "heading": return <div className="t15 b6">{plain(b.text, 120)}</div>;
    case "text": return <div className="t13 l2 b4">{plain(b.text, 1000)}</div>;
    case "list": return b.rows.some((r) => r.state) ? (
      // oturum listesi (maket j): durum göstergesi + ad + soluk açıklama, çizgisiz
      <div className="oturumlar">
        {b.rows.slice(0, 12).map((r, i) => (
          <div className="sat" key={i}><RowState state={r.state} /><b>{plain(r.title, 80)}</b><span className="t12 l3" style={{ flex: 1 }}>{plain(r.sub, 100)}</span>{r.value && <span className="t12 l3">{plain(r.value, 60)}</span>}<TerminalBtn id={(r as RowExt).session} /></div>
        ))}
      </div>
    ) : (
      <div className="liste cam" style={{ "--girinti": "0" } as React.CSSProperties}>
        {b.rows.slice(0, 12).map((r, i) => (
          <div className="sat" key={i}><div className="metin"><div>{plain(r.title, 120)}</div>{r.sub && <div className="t12 l3 b4">{plain(r.sub, 160)}</div>}</div>{r.value && <span className="t12 l3">{plain(r.value, 60)}</span>}<TerminalBtn id={(r as RowExt).session} /></div>
        ))}
      </div>
    );
    case "meter": return <Meter m={b} />;
    case "kv": return <div>{b.rows.slice(0, 12).map((r, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between" }}><span>{plain(r.k, 80)}</span><span className="num b6">{plain(r.v, 80)}</span></div>)}</div>;
    case "progress": return <><div style={{ display: "flex", justifyContent: "space-between" }}><span>{plain(b.label, 80)}</span><span className="num b6">{Math.round(Math.min(1, Math.max(0, b.value || 0)) * 100)}%</span></div><div className="olc" style={{ "--o": Math.round(Math.min(1, Math.max(0, b.value || 0)) * 100) + "%" } as React.CSSProperties}><b /></div></>;
    case "timer": return <div style={{ display: "flex", justifyContent: "space-between" }}><span>{plain(b.label, 80)}</span><span className="b6"><Elapsed startedAt={b.startedAt} /></span></div>;
    case "buttons": return <div className="dugmeler"><ActionButtons plugin={plugin} actions={b.buttons} kk={false} /></div>;
    case "image": { const src = safeImage(b.src); return src ? <img className="blokGorsel" src={src} alt="" /> : null; }
    default: return null;
  }
}

/** Rust'ın `cc_focus_terminal` hata adları. */
const FOCUS_ERR: Record<string, string> = {
  unknown: "Bu oturum artık yok", not_connected: "Asistan bağlı değil", missing: "Terminal penceresi bulunamadı",
  refused: "Windows pencereyi öne getirmedi", unsupported: "Demo kipinde yok",
};
export const focusErrText = (e: unknown) => FOCUS_ERR[String(e)] ?? "Terminal açılamadı";

/** Oturum satırının "Terminali aç" düğmesi; hata satırın içinde Türkçe yazılır. `id` yoksa hiçbir şey çizmez. */
function TerminalBtn({ id }: { id?: string | null }) {
  const [err, setErr] = useState<string | null>(null);
  if (!id) return null;
  return <>
    <button className="btn kk cam" onClick={() => bridge.call("cc_focus_terminal", { sessionId: id }).then(() => setErr(null)).catch((e) => setErr(focusErrText(e)))}>Terminali aç</button>
    {err && <span className="t12 l3" role="status">{err}</span>}
  </>;
}

/** Oturum durumu: turuncu nokta (izin bekliyor), dönen halka (çalışıyor), yeşil onay (bitti); başka değer boş yer tutar. */
function RowState({ state }: { state?: string | null }) {
  return state === "waiting" ? <span className="nab" aria-label="izin bekliyor" /> : state === "running" ? <span className="halka" aria-label="çalışıyor" />
    : state === "done" ? <span className="tikYesil" aria-label="bitti"><CircleCheck /></span> : <span className="durumBos" />;
}

/** Kota çubuğu (ADR-0059): ad + yüzde, çubuk (isteğe bağlı eşik çizgisi), soluk sıfırlanma metni. */
function Meter({ m }: { m: MeterBlock }) {
  const v = Math.min(1, Math.max(0, Number.isFinite(m.value) ? m.value : 0));
  const mark = typeof m.mark === "number" && m.mark > 0 && m.mark < 1 ? m.mark : null;
  return (
    <div className="kota">
      <div className="kotaSat"><span>{plain(m.label, 80)}</span><span className="num b6">{plain(m.text, 24) || Math.round(v * 100) + "%"}</span></div>
      <div className="olc" style={{ "--o": Math.round(v * 100) + "%" } as React.CSSProperties}><b />{mark !== null && <i className="esik" style={{ left: mark * 100 + "%" }} />}</div>
      {m.note && <div className="t12 l3 b4">{plain(m.note, 80)}</div>}
    </div>
  );
}

export const tabLabel = (t: ModuleTab) => prefixed(t.plugin, t.title);

/** Sekme / özet simgeleri: yalnız bu izinli küme (eklenti simge gönderemez; ad dışında bir şey çizilmez). Kümede olmayan ad ADR-0060 simgelerine düşer. */
const GLYPHS: Record<string, LucideIcon> = { ghost: Ghost, terminal: Terminal, users: Users, pointer: MousePointerClick, brain: Brain, list: List, shield: ShieldAlert };
const glyphOf = (n: unknown): LucideIcon | null => (typeof n === "string" && Object.hasOwn(GLYPHS, n) ? GLYPHS[n] : null);
/** Sekme düğmesindeki küçük simge (14 px). */
export function TabGlyph({ name }: { name?: string | null }) {
  const G = glyphOf(name), safe = safeIcon(name);
  return G ? <G /> : safe ? <AlertIcon name={safe} /> : null;
}

/** Kutu başlığı: ana asistanın "ghost" kutusu maskotla (24 px, durgun), öteki simgeyle, simgesiz kutu Lead ile. */
function BoxHead({ plugin, icon, children }: { plugin: PluginRef; icon?: string | null; children: ReactNode }) {
  const mk = icon === "ghost" || !icon;
  return <h4>{mk ? <Lead plugin={plugin} mascot="hazir" size={24} still /> : <TabGlyph name={icon} />}{children}</h4>;
}

/** Bir eklenti sekmesinin içeriği (blok listesi). */
export function TabBlocks({ tab }: { tab: ModuleTab }) {
  return (
    <div className="kutu cam blokKutu">
      <BoxHead plugin={tab.plugin} icon={tab.icon}><Attr plugin={tab.plugin} title={tab.title} /></BoxHead>
      {tab.blocks.slice(0, 20).map((b, i) => <Block key={i} b={b} plugin={tab.plugin} />)}
    </div>
  );
}

/** "Genel" sayfasında eklenti kutuları: özet satırları (en çok 3), araya o eklentinin onayları (300 ms koruması geçerli), satır simgeleri ve tek eylem (ör. Durdur). */
export function SummaryBoxes({ surf, onDetail }: { surf: SurfacesView; onDetail: (id: string) => void }) {
  // Cevaplanan onay satırı hemen kapanmaz: ~1,5 sn "Onaylandı / Reddedildi" yer tutucu, sonra kısa yükseklik animasyonuyla çekilir; alttaki düğme imlecin altına birden gelmez (R1-4)
  const [ans, setAns] = useState<Record<string, { text: string; leaving: boolean }>>({});
  const seen = useRef(new Map<string, ApprovalItem>());
  surf.approvals.forEach((x) => seen.current.set(x.id, x));
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const onAnswered = (x: ApprovalItem, text: string) => {
    setAns((c) => ({ ...c, [x.id]: { text, leaving: false } }));
    timers.current.push(window.setTimeout(() => setAns((c) => (c[x.id] ? { ...c, [x.id]: { ...c[x.id], leaving: true } } : c)), GHOST_MS));
    timers.current.push(window.setTimeout(() => { seen.current.delete(x.id); setAns((c) => { const { [x.id]: _, ...rest } = c; return rest; }); }, GHOST_MS + 260));
  };
  const live = new Set(surf.approvals.map((x) => x.id));
  const shown = [...seen.current.values()].filter((x) => live.has(x.id) || ans[x.id]);
  const ids = [...new Set([...surf.summary.map((s) => s.plugin.id), ...shown.map((x) => x.plugin.id)])];
  return <>{ids.map((id) => {
    const rows = surf.summary.find((s) => s.plugin.id === id);
    const plugin = rows?.plugin ?? shown.find((a) => a.plugin.id === id)!.plugin;
    const list = (rows?.rows ?? []).slice(0, 3);
    const row = (r: (typeof list)[number], i: number) => {
      const x = r as typeof r & SummaryRowExt, G = glyphOf(x.icon);
      return (
        <div className="sat" key={"r" + i}>
          {G && <span className={x.state === "attention" ? "turuncuIk" : "soluk"}><G /></span>}
          <div style={{ flex: 1, minWidth: 0 }}><div>{plain(r.title, 100)}</div>{r.sub && <div className="t12 l3 b4">{plain(r.sub, 140)}</div>}</div>
          {r.value && <span className="t12 l3">{plain(r.value, 60)}</span>}
          {x.action && <ActionButtons plugin={plugin} actions={[x.action]} />}
          <TerminalBtn id={x.session} />
        </div>
      );
    };
    return (
      <div className="kutu cam" key={id}>
        <BoxHead plugin={plugin}>{pluginName(plugin)}</BoxHead>
        {list.slice(0, 1).map(row)}
        {shown.filter((a) => a.plugin.id === id).map((a) => <ApprovalRow key={a.id} a={a} done={ans[a.id]} onDetail={() => onDetail(a.id)} onAnswered={onAnswered} />)}
        {list.slice(1).map((r, i) => row(r, i + 1))}
      </div>
    );
  })}</>;
}

const GHOST_MS = 1500;
function ApprovalRow({ a, onDetail, done, onAnswered }: { a: ApprovalItem; onDetail: () => void; done?: { text: string; leaving: boolean }; onAnswered: (a: ApprovalItem, text: string) => void }) {
  const direct = riskOf(a.risk) === "low" && !a.choices?.length && !a.freeText && a.options.includes("allow");
  if (done) return (
    <div className={"sat satBitti" + (done.leaving ? " git" : "")} role="status">
      <span style={{ color: done.text === "Onaylandı" ? "var(--yesil)" : "var(--l3)" }}><Check /></span>
      <div style={{ flex: 1, minWidth: 0 }}><div>{done.text}</div><div className="t12 l3 b4">{flat(a.title)}</div></div>
    </div>
  );
  return (
    <div className="sat">
      <span style={{ color: "var(--turuncu)" }}><ShieldAlert /></span>
      <div style={{ flex: 1, minWidth: 0 }}><div>Onay bekliyor</div><div className="t12 l3 b4">{flat(a.title)}</div></div>
      {direct && <GuardBtn className="btn kk ana" onClick={() => { answer(a, "allow", {}, "protrusion"); onAnswered(a, "Onaylandı"); }}>İzin ver</GuardBtn>}
      {direct ? <GuardBtn className="btn kk cam" onClick={() => { answer(a, "deny"); onAnswered(a, "Reddedildi"); }}>Reddet</GuardBtn> : <button className="btn kk ana" onClick={onDetail}>Ayrıntı</button>}
    </div>
  );
}

/* ---- composer.handler (Ctrl+Space) ---- */

export interface Suggestion { id: "window_image"; label: string }
interface Added { key: string; kind: ComposerKind; label: string }
const LINK = /^https?:\/\/\S+$/i;

/**
 * Ctrl+Space kutusu: yazı, öneri çipleri (tıklanınca eklenir), akan cevap, kaynak çipleri. Balonları ve çipleri Peeka çizer.
 * Çipler: "Bu pencere" (Island verir), "Panodaki bağlantı" ve "Raftaki N dosya" (kart kendi okur); tarama ve ataş düğmeleri Rust ek türlerini bildirince çıkar.
 */
/** Yazılmış ama gönderilmemiş taslak: kart kapanıp açılınca (Esc, ×, dışarı tıklama) kaybolmaz; gönderilince temizlenir (O4). */
let draftKeep = "";
export const resetComposerDraft = () => { draftKeep = ""; };

export function ComposerCard({ owner, turns, send, suggestions, autoShelf }: { owner: PluginRef & { voice: boolean }; turns: Turn[]; send: (text: string, attachments: { kind: "window_image" }[]) => void; suggestions: Suggestion[]; /** Maskota dosya bırakıldı: raf dosyaları kendiliğinden eklenir. */ autoShelf?: boolean }) {
  const [text, setTextRaw] = useState(draftKeep);
  const setText = (v: string) => { draftKeep = v; setTextRaw(v); };
  const [added, setAdded] = useState<Added[]>([]);
  const talking = turns.length > 0;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "nearest" }); }, [turns]);
  const kinds = useComposerKinds();
  const clips = useClips(), shelf = useShelf();
  const hasLink = clips.some((c) => c.kind === "text" && (c.hint === "link" || (c.text !== null && LINK.test(c.text.trim()))));
  const offers: Added[] = [
    ...suggestions.map((s): Added => ({ key: s.id, kind: s.id, label: s.label })),
    ...(hasLink && kinds.has("clipboard_link") ? [{ key: "clipboard_link", kind: "clipboard_link" as const, label: "Panodaki bağlantı" }] : []),
    ...(shelf.length > 0 && kinds.has("shelf") ? [{ key: "shelf", kind: "shelf" as const, label: `Raftaki ${shelf.length} dosya` }] : []),
  ];
  useEffect(() => { if (autoShelf && shelf.length > 0 && kinds.has("shelf")) setAdded((cur) => (cur.some((x) => x.key === "shelf") ? cur : [...cur, { key: "shelf", kind: "shelf", label: `Raftaki ${shelf.length} dosya` }])); }, [autoShelf, shelf.length, kinds]);
  const toggle = (o: Added) => setAdded((cur) => (cur.some((x) => x.key === o.key) ? cur.filter((x) => x.key !== o.key) : [...cur, o]));
  // Rust hassas pencerede taramayı `denied` ile reddeder ve nedenini notch://notice ile bildirir (Türkçe, biz çevirmeyiz)
  const [scanNote, setScanNote] = useState("");
  const notice = useRef({ text: "", at: 0 });
  useEffect(() => { const off = bridge.on("notch://notice", (t) => { notice.current = { text: plain(t, 200), at: Date.now() }; }); return () => { off.then((f) => f()); }; }, []);
  const attach = (cmd: "composer_scan" | "composer_attach_file") => { setScanNote(""); return bridge.call(cmd).then((r: Attached | null) => { if (r) setAdded((cur) => [...cur, { key: r.kind + ":" + cur.length, kind: r.kind, label: plain(r.label, 40) }]); }).catch((e) => {
    if (cmd === "composer_scan" && String(e) === "denied") setScanNote(Date.now() - notice.current.at < 3000 && notice.current.text ? notice.current.text : "Bu pencere hassas bir uygulamanın; taranmadı");
  }); };
  const go = () => {
    const t = text.trim();
    if (!t) return;
    // shortcut: ek türleri hooks.ts'te yalnız window_image; Rust diğerlerini composer_kinds ile bildirmeden çip/düğme çıkmaz, bu yüzden dar tipe çevrilir
    send(t, added.map(({ kind }) => ({ kind })) as { kind: "window_image" }[]);
    setText(""); setAdded([]);
  };
  const name = pluginName(owner), ask = `${dative(owner.name)} sor`;
  const clipBtn = kinds.has("file") && <button className="yuv" title="Dosya ekle" aria-label="Dosya ekle" onClick={() => void attach("composer_attach_file")}><Paperclip /></button>;
  const scanBtn = kinds.has("screen_image") && <button className="yuv" title="Ekran görüntüsü ekle" aria-label="Ekran görüntüsü ekle" onClick={() => void attach("composer_scan")}><ScanLine /></button>;
  const box = (
    <div className="yazkutu cam asistanKutu buyuk" onMouseDown={(e) => { if ((e.target as HTMLElement).closest("button,input")) return; e.preventDefault(); e.currentTarget.querySelector("input")?.focus(); }}>
      {talking && kinds.has("file") && <span className="l3 solIk" aria-hidden="true"><Paperclip /></span>}
      <input data-autofocus value={text} maxLength={4000} placeholder={`${ask}: bir soru, bir iş, bir hatırlatma`} aria-label={ask} title={name}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); go(); } }} />
      {scanBtn}{!talking && clipBtn}
      {owner.voice && <button className={"yuv" + (talking ? "" : " vurgu")} title="Sesle sor" aria-label="Sesle sor" onClick={() => bridge.call("composer_voice").catch(() => undefined)}><Mic /></button>}
    </div>
  );
  const chipOf = (o: Added, on: boolean) => on
    ? <button key={o.key} className="cip cam eklendi" aria-pressed="true" title="Kaldır" onClick={() => toggle(o)}><Check />{o.label}</button>
    : <button key={o.key} className="cip oneriCip" onClick={() => toggle(o)}><Plus />{o.label}</button>;
  const chips = talking ? (added.length > 0 ? <div className="dugmeler" style={{ gap: 6, flexWrap: "wrap" }}>{added.map((o) => chipOf(o, true))}</div> : null) : (
    <div className="dugmeler" style={{ gap: 6, flexWrap: "wrap" }}>
      {offers.map((o) => chipOf(o, added.some((x) => x.key === o.key)))}
      {added.filter((x) => !offers.some((o) => o.key === x.key)).map((o) => chipOf(o, true))}
      <span style={{ flex: 1 }} />
      <><span className="tus-ipucu"><kbd>↵</kbd> gönder</span><span className="tus-ipucu"><kbd>Esc</kbd> kapat</span></>
    </div>
  );
  // kutu ağaçta hep aynı yerde (en üst satır): ilk mesajdan sonra yeri ve odağı değişmez, sohbet altına açılır
  return (
    <div className="govde" data-composer>
      <div className="mkBas" style={{ alignItems: "flex-start" }}><Lead plugin={owner} mascot="dinliyor" size={56} /><div className="yazKol" style={{ paddingTop: 4 }}>{box}{scanNote && <div className="uyariSatir t12" role="status"><TriangleAlert aria-hidden="true" />{scanNote}</div>}{chips}</div></div>
      {talking && (
        <div className="sohbet">
          {turns.map((t) => (
            <div key={t.id} className="tur">
              {t.ask && <div className="balon ben">{plain(t.ask, 4000)}</div>}
              <div className="cevap" aria-live="polite">
                {plain(t.answer, 64_000) || (t.state === "wait" ? <span className="l3">…</span> : null)}
                {t.state === "error" && <div className="eoUyari" role="alert"><TriangleAlert />{plain(t.error, 200) || "Cevap alınamadı."}</div>}
                {t.chips.length > 0 && <div className="dugmeler" style={{ marginTop: 10, gap: 6, flexWrap: "wrap" }}>{t.chips.map((c, i) => <span key={i} className="cip cam" data-kind={c.kind}>{c.kind === "reminder" ? <AlarmClock /> : c.kind === "note" ? <StickyNote /> : <Brain />}{plain(c.label, 60)}</span>)}</div>}
              </div>
            </div>
          ))}
          <div ref={end} />
        </div>
      )}
    </div>
  );
}
