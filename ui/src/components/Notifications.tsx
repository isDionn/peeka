import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, Folder, Sparkles, X } from "lucide-react";
import { bridge, type Alert, type Notice } from "../bridge";
import { useAlerts, useInput, useLock, useMainAssistant, useMirror } from "../hooks";
import { sendX } from "../lib/xwin";
import { ageLabel } from "../lib/alerts";
import { AlertIcon } from "../lib/alertIcon";
import { NotchIk } from "./IslandCards";
import { Lead } from "./Plugin";
import { initial, MASCOT_STATES, pluginName } from "../lib/plugin";
import { delOk, SAFE_ICON } from "./common";

/**
 * Bildirimde tek kullanımlık doğrulama kodu var (`hasCode`): "Kodu kopyala" `notif_copy_code` çağırır; Rust kodu panoya koyar ve 60 sn sonra siler.
 * Kodun rakamları sayfaya hiç gelmez, burada hiçbir yerde yazılmaz. Kilitliyken düğme yok. Ret sessiz.
 */
function useCopyCode(n: Notice) {
  const lock = useLock();
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(false), 5000); return () => clearTimeout(t); }, [done]);
  return { show: !!n.hasCode && !lock.locked, done, run: () => bridge.call("notif_copy_code", { id: n.id }).then(() => setDone(true)).catch(() => undefined) };
}
const CODE_DONE = "Kopyalandı · 60 sn sonra silinecek";

/**
 * R1-5: silinen satırın yeri kısa süre tutulur (boş yer), alttaki satır hemen imlecin altına kaymaz; art arda "kaldır" yanlış öğeyi silmez.
 * Boşluk imleç listeden çıkınca ya da 600 ms sonra kapanır. shortcut: boşluk indeksi tıklama anındaki DOM sırasından gelir; çok hızlı çoklu silmede sıra sapabilir, yalnız görünüm.
 */
const HOLD_MS = 600;
function useHeldSlots() {
  const [holds, setHolds] = useState<{ key: number; at: number; h: number; id: string }[]>([]);
  const seq = useRef(0);
  const release = (key: number) => setHolds((h) => h.filter((x) => x.key !== key));
  const hold = (e: { currentTarget: HTMLElement }, id: string) => {
    const row = e.currentTarget.closest<HTMLElement>(".bild");
    if (!row?.parentElement) return;
    const key = ++seq.current;
    setHolds((h) => [...h, { key, id, at: Array.prototype.indexOf.call(row.parentElement!.children, row), h: row.offsetHeight }]);
    setTimeout(() => release(key), HOLD_MS);
  };
  /** Satırlara boşlukları ekler; kaynak öğe hâlâ listedeyse (silme henüz dönmedi) boşluk eklenmez. */
  const fill = (rows: React.ReactElement[]) => {
    const out = [...rows];
    for (const x of [...holds].sort((a, b) => a.at - b.at)) {
      if (rows.some((r) => r.key === x.id)) continue;
      out.splice(Math.min(x.at, out.length), 0, <div key={"bos-" + x.key} className="bildBos" style={{ height: x.h }} aria-hidden="true" />);
    }
    return out;
  };
  return { hold, fill, clear: () => setHolds([]) };
}

/** Bildirimler listesi (saate tıklayınca, sağ üst kart): Peeka'nın kendi uyarı listesi, tek renk uygulama karesi, "Listeyi temizle" yalnız listeyi boşaltır. */
export function NotificationList({ onReview, onClose }: { onReview: (a: Alert) => void; onClose?: () => void }) {
  const { alerts } = useAlerts();
  const mirror = useMirror().items;
  const total = alerts.length + mirror.length;
  const lock = useLock();
  const sunum = useInput().presentation; // sunum (satır 37): içerik kilitliyle aynı yolla gizlenir
  const hide = lock.locked || sunum;
  const main = useMainAssistant();
  const nowMs = bridge.now().getTime();
  const held = useHeldSlots();
  const rows = [
    ...alerts.map((a) => (
          <div key={a.id} role="listitem" className="bild plat cam">
            {main && a.icon && MASCOT_STATES.has(a.icon)
              ? <Lead plugin={{ id: main.id, name: main.name, main: true }} mascot={a.icon} size={24} />
              : <span className="uyg"><AlertIcon name={a.icon} /></span>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="b6">{a.title}</div>
              {a.subtitle && <div className="t12 l3 b4">{a.subtitle}</div>}
            </div>
            {a.review ? <button className="btn kk cam" onClick={() => onReview(a)}>Gözden geçir</button> : <span className="t12 l3">{ageLabel((nowMs - a.updatedAt) / 1000)}</span>}
            {a.action && <button className="mini" title="Bağlantıyı aç" aria-label={`${a.title}, bağlantıyı aç`} onClick={() => bridge.call("open_alert", { id: a.id }).catch(() => undefined)}><ArrowUpRight /></button>}
            <button className="mini" title="Kaldır" aria-label={`${a.title}, kaldır`} onClick={(e) => { if (delOk()) { held.hold(e, a.id); bridge.call("dismiss_alert", { id: a.id }); } }}><X /></button>
          </div>
    )),
    ...mirror.map((n) => <MirrorCard key={n.id} n={n} onClose={onClose} onHold={held.hold} />),
  ];
  return (
    <div className="govde">
      <div style={{ display: "flex", alignItems: "center" }}>
        <span className="t17 b6" style={{ flex: 1 }}>Bildirimler</span>
        <button className="btn kk cam" onClick={() => bridge.call("clear_alerts")}>Listeyi temizle</button>
      </div>
      {hide && <div className="bosSonuc" role="status">{lock.locked ? "Peeka kilitli" : "Sunum sürüyor"}: bildirim içerikleri gizli{total > 0 ? ` (${total} bildirim)` : ""}</div>}
      {/* kilitliyken Windows bildirimlerinin yalnız uygulama adı çizilir; başlık ve gövde DOM'a hiç girmez (Rust yine de gönderir) */}
      {hide && mirror.length > 0 && <div className="bilds" role="list">
        {mirror.map((n) => <div key={n.id} role="listitem" className="bild plat cam"><span className="uyg"><b aria-hidden="true">{initial(n.app)}</b></span><div style={{ flex: 1, minWidth: 0 }}><div className="b6">{n.app}</div><div className="t12 l3">{lock.locked ? "Kilitli" : "Gizli"}</div></div></div>)}
      </div>}
      {!hide && total === 0 && <div className="bosSonuc">Bildirim yok</div>}
      {!hide && <div className="bilds" role="list" onPointerLeave={held.clear}>{held.fill(rows)}</div>}
    </div>
  );
}

/**
 * Windows bildirimi (Dalga 6 aynası): yalnız burada, şeride dalga yok. Kare her zaman tek renk (alfa maskesi, `colorIcons`a bakmaz);
 * simge yoksa uygulama baş harfi. Düğmeler: "Uygulamayı aç" (`canOpen`), "asistan yanıtlasın" (yalnız ana asistana, bitince yanıt görünümü açılır).
 */
export function MirrorCard({ n, onClose, onHold }: { n: Notice; onClose?: () => void; onHold?: (e: { currentTarget: HTMLElement }, id: string) => void }) {
  const main = useMainAssistant();
  const code = useCopyCode(n);
  const [err, setErr] = useState<string | null>(null);
  const tile = SAFE_ICON.test(n.tile) ? ({ WebkitMaskImage: `url("${n.tile}")`, maskImage: `url("${n.tile}")` } as CSSProperties) : null;
  const ask = () => bridge.call("mirror_ask", { id: n.id }).then(() => { sendX({ t: "ask" }); onClose?.(); }).catch((e) => setErr(e === "not_connected" ? "Ana asistan bağlı değil" : "Şimdi yanıtlanamadı"));
  return (
    <div role="listitem" className="bild bildM plat cam" data-mirror={n.id}>
      <span className="uyg">{tile ? <span className="uygIk mono" style={tile} aria-hidden="true" /> : <b aria-hidden="true">{initial(n.app)}</b>}</span>
      <div className="mGovde">
        <div className="t12 l3 b4">{n.app}</div>
        <div className="b6">{n.title}</div>
        {n.body && <div className="t12 l2 mMetin">{n.body}</div>}
        <div className="mDugme">
          {n.canOpen && <button className="btn kk cam" onClick={() => bridge.call("mirror_open_app", { id: n.id }).then(() => onClose?.()).catch(() => setErr("Uygulama açılamadı"))}>{n.openLabel}</button>}
          <button className="btn kk cam" disabled={!main} title={main ? undefined : "Ana asistan bağlı değil"} onClick={ask}>{main ? pluginName(main) : "Asistan"} yanıtlasın</button>
          {code.show && <button className="btn kk cam" onClick={code.run}>Kodu kopyala</button>}
          {code.done && <span className="t12 l3" role="status">{CODE_DONE}</span>}
          {err && <span className="t12 l3" role="alert">{err}</span>}
        </div>
      </div>
      <button className="mini" title="Kaldır" aria-label={`${n.app}, ${n.title}, kaldır`} onClick={(e) => { if (delOk()) { onHold?.(e, n.id); bridge.call("mirror_dismiss", { id: n.id }).catch(() => undefined); } }}><X /></button>
    </div>
  );
}

/** Temizlik onayı (`mt`): neyin silineceğini gösterir. İlk 300 ms tıklama yok sayılır, "Vazgeç" varsayılan odak. */
export function ReviewCard({ alert, onClose }: { alert: Alert; onClose: () => void }) {
  const born = useRef(0);
  useEffect(() => { born.current = performance.now(); }, []);
  const r = alert.review!;
  const main = useMainAssistant();
  const confirm = () => {
    if (performance.now() - born.current < 300) return;
    // Silmeyi eklenti yapar (Dalga 3); Peeka bu dalgada yalnız uyarıyı listeden kaldırır.
    bridge.call("dismiss_alert", { id: alert.id }).then(onClose);
  };
  return (
    <div className="govde">
      <div className="mkBas">
        {main ? <Lead plugin={{ id: main.id, name: main.name, main: true }} mascot="onay" size={56} /> : <NotchIk size={56} />}
        <div style={{ flex: 1 }}><div className="t17 b6">{r.title}</div><div className="t13 l2 b4">{main ? pluginName(main) + " · " : ""}{r.detail}</div></div>
      </div>
      <div className="liste cam" style={{ "--girinti": "30px" } as React.CSSProperties}>
        {r.items.map((it) => <div key={it.name} className="sat"><Folder /><span className="metin">{it.name}</span><span className="t12 l3 num">{it.size}</span></div>)}
      </div>
      <div className="dugmeler">
        <button className="btn ana" onClick={confirm}>Sil</button>
        <button className="btn cam" data-autofocus onClick={onClose}>Vazgeç</button>
      </div>
    </div>
  );
}

/* ---- sağ üst Windows bildirim kartı (maket n, n2): 360 px, 6 sn sonra kapanır, süreyi alttaki ince çizgi gösterir ---- */
function NoticeShell({ children }: { children: React.ReactNode }) {
  return (
    <div id="sag" className="sarkan tost" data-hit role="dialog" aria-label="Windows bildirimi" style={{ width: 360 }}>
      <div className="kes"><div className="govde" style={{ position: "relative" }}>{children}</div></div>
    </div>
  );
}
const Tile = ({ n }: { n: Notice }) => {
  const tile = SAFE_ICON.test(n.tile) ? ({ WebkitMaskImage: `url("${n.tile}")`, maskImage: `url("${n.tile}")` } as CSSProperties) : null;
  return <span className="uyg">{tile ? <span className="uygIk mono" style={tile} aria-hidden="true" /> : <b aria-hidden="true">{initial(n.app)}</b>}</span>;
};

/** Gelen Windows bildirimi: "Uygulamayı aç", "asistan yanıtlasın", kapat. `onAsk` asistana verildikten sonra çağrılır (taslak görünümü). */
export function NoticeToast({ n, onClose, onAsk }: { n: Notice; onClose?: () => void; /** `mirror_ask` döndü; `turn` asistanın taslak turu. */ onAsk?: (turn: number) => void }) {
  const main = useMainAssistant();
  const code = useCopyCode(n);
  return (
    <NoticeShell>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Tile n={n} />
        <div style={{ flex: 1, minWidth: 0 }}><div className="b6">{n.title}</div>{n.body && <div className="t13 l2 b4">{n.body}</div>}</div>
        <span className="t12 l3">şimdi</span>
      </div>
      <div className="dugmeler">
        {n.canOpen && <button className="btn cam" style={{ flex: 1 }} onClick={() => bridge.call("mirror_open_app", { id: n.id }).then(() => onClose?.()).catch(() => undefined)}>{n.openLabel}</button>}
        <button className="btn asistan" style={{ flex: 1 }} disabled={!main} onClick={() => bridge.call("mirror_ask", { id: n.id }).then((r) => onAsk?.(r.turn)).catch(() => undefined)}><Sparkles />{main ? pluginName(main) : "Asistan"} yanıtlasın</button>
        <button className="btn cam ik" title="Kapat" aria-label="Kapat" onClick={() => bridge.call("mirror_dismiss", { id: n.id }).then(() => onClose?.()).catch(() => undefined)}><X /></button>
      </div>
      {code.show && <div className="dugmeler"><button className="btn cam" style={{ flex: 1 }} onClick={code.run}>Kodu kopyala</button></div>}
      {code.done && <div className="t12 l3" role="status">{CODE_DONE}</div>}
      <span className="sureCizgi" style={{ "--sure": "6s" } as CSSProperties} />
    </NoticeShell>
  );
}

/** asistanın yanıt taslağı. Gönderim ikinci adımdır (asistan masaüstü işi, onaylı); `onSend` yoksa "Gönder" kapalıdır (arka uç yok). */
export function NoticeDraft({ n, draft, onClose, onSend, onEdit }: { n: Notice; draft: string; onClose?: () => void; onSend?: () => void; onEdit?: () => void }) {
  return (
    <NoticeShell>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}><Tile n={n} /><div style={{ flex: 1, minWidth: 0 }}><div className="b6">{n.title}</div><div className="t12 l2 b4">Taslak</div></div></div>
      <div className="taslak cam">{draft}</div>
      {!onSend && <div className="t12 l3">Gönderme henüz yok: asistan bunu ikinci adımda, onayınla yapacak.</div>}
      <div className="dugmeler">
        <button className="btn ana" style={{ flex: 1 }} disabled={!onSend} title={onSend ? undefined : "Gönderme henüz yok: asistan bunu ikinci adımda, onayınla yapacak"} onClick={onSend}>Gönder</button>
        <button className="btn cam" style={{ flex: 1 }} disabled={!onEdit} onClick={onEdit}>Düzenle</button>
        <button className="btn cam" style={{ flex: 1 }} onClick={onClose}>Vazgeç</button>
      </div>
    </NoticeShell>
  );
}

/** Taslak görünümü: asistanın o turdaki yanıtı `composer_event` ile akar; bitene dek "hazırlanıyor". */
export function NoticeReply({ n, turn, onClose }: { n: Notice; turn: number; onClose: () => void }) {
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    const off = bridge.on("composer_event", (e) => {
      if (e.turn !== turn) return;
      if (e.kind === "delta") setText((t) => t + (e.text ?? ""));
      else setDone(true);
    });
    return () => { off.then((f) => f()); };
  }, [turn]);
  return <NoticeDraft n={n} draft={done || text ? text.trim() || "Taslak üretilemedi." : "Taslak hazırlanıyor…"} onClose={onClose} />;
}
