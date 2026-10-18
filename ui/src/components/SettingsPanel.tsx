import { useEffect, useState, type CSSProperties } from "react";
import { ChevronRight, Clipboard, FileText, Ghost, Info, Keyboard, LayoutGrid, LayoutPanelTop, Lock, Plus, Puzzle, Trash2, X } from "lucide-react";
import { bridge, type AppRef, type MirrorBlocker, type MirrorState, type Settings, type ShortcutId } from "../bridge";
import { formatCombo } from "../lib/shortcut";
import { resetFirstRun } from "../lib/firstRun";
import { sendX } from "../lib/xwin";
import { AppIcon, HoldButton, Kbd, NO_INDENT, radioKeys, Row, Switch } from "./common";
import { Modules, Plugins } from "./PluginSettings";
import { PluginExtras } from "./PluginExtras";
import "../fidelity-ayar.css";

export type SettingsPage = "ayg" | "ayk" | "aye" | "aym" | "ayp" | "ays";
const NAV: [SettingsPage, string, typeof Keyboard][] = [["ayg", "Görünüm", LayoutPanelTop], ["ayk", "Kısayollar", Keyboard], ["aye", "Eklentiler", Puzzle], ["aym", "Modüller", LayoutGrid], ["ayp", "Pano", Clipboard], ["ays", "Maskot", Ghost]];

const TASKBAR_MODES: [Settings["taskbarHide"], string][] = [["full", "Tamamen gizle"], ["auto", "Otomatik gizle"], ["off", "Windows görev çubuğu kalsın"]];
/** Windows görev çubuğu kipi: Rust'tan okunur (`taskbarHide`), `taskbar_set_mode` ile yazılır; değişim olayı gelene dek seçim yerelde de tutulur. */
function TaskbarMode({ value }: { value: Settings["taskbarHide"] }) {
  const [mode, setMode] = useState(value);
  useEffect(() => setMode(value), [value]);
  return (
    <div className="seg cam segKucuk" role="radiogroup" aria-label="Windows görev çubuğu" onKeyDown={radioKeys}>
      {TASKBAR_MODES.map(([m, title]) => (
        <button key={m} className={"segb" + (mode === m ? " on" : "")} role="radio" aria-checked={mode === m} tabIndex={mode === m ? 0 : -1} onClick={() => { setMode(m); bridge.call("taskbar_set_mode", { mode: m }).catch(() => setMode(value)); }}>{title}</button>
      ))}
    </div>
  );
}

/** Engel nedeni: satır, Windows ayarı (yalnız Rust'ın izin listesindeki adres açılır) ve o açılamazsa elle yol. */
const BLOCKERS: Record<MirrorBlocker, { text: string; uri: string | null; link: string; manual: string }> = {
  dev_mode_off: { text: "Geliştirici Modu kapalı", uri: "ms-settings:developers", link: "Geliştirici ayarlarını aç", manual: "Windows Ayarları › Sistem › Geliştiriciler için" },
  not_registered: { text: "register.ps1 çalıştırılıp Peeka yeniden başlatılmalı", uri: null, link: "", manual: "" },
  access_denied: { text: "Windows izin vermedi", uri: "ms-settings:privacy-notifications", link: "Bildirim iznini aç", manual: "Windows Ayarları › Gizlilik › Bildirimler" },
};

/** Ayarlar › Görünüm › Windows bildirimleri (isteğe bağlı, varsayılan kapalı). Anahtar `mirror_enable` / `mirror_disable`; engel varsa nedeni altında. */
function MirrorSetting() {
  const [st, setSt] = useState<MirrorState | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => { bridge.call("mirror_state").then(setSt).catch(() => undefined); }, []);
  const toggle = (v: boolean) => { setHint(null); bridge.call(v ? "mirror_enable" : "mirror_disable").then(setSt).catch(() => undefined); };
  const b = st?.enabled && st.blocker ? BLOCKERS[st.blocker] : null;
  const open = (uri: string, manual: string) => bridge.call("open_windows_settings", { uri }).then(() => setHint(null)).catch(() => setHint(manual));
  return (
    <>
      <Row title="Windows bildirimleri" sub="Sağ üstteki Bildirimler listesinde kart olur; şeritte dalga yok">
        <Switch on={!!st?.enabled} label="Windows bildirimleri" onChange={toggle} />
      </Row>
      {b && (
        <div className="sat mUyari" role="status" data-blocker={st!.blocker}>
          <div className="t12 l2">{b.text}</div>
          {b.uri && <button className="btn kk cam" style={{ alignSelf: "flex-start" }} onClick={() => open(b.uri!, b.manual)}>{b.link}</button>}
          {hint && <div className="t12 l3">Ayarlar açılamadı: {hint}</div>}
        </div>
      )}
    </>
  );
}

/** Ayarlar › Görünüm (maket ayg): iki kart. Maketin dışındaki ayarlar (ses tuşları, betik adresi, Windows bildirimleri, otomatik başlatma, görev çubuğu kipi) sahip kararlarının tek arayüzü; "Diğer ayarlar" altında durur. */
function Appearance({ settings }: { settings: Settings }) {
  const [more, setMore] = useState(false);
  const mode = settings.taskbarHide;
  return (
    <>
      <div className="t17 b6">Görünüm</div>
      <div className="liste cam" style={NO_INDENT}>
        <Row title="Şerit" sub="Hep görünür, tam ekranda gizlenir; ekranın üst 30 px'i ayrılır"><span className="t12 l2">Her zaman</span></Row>
        <Row title="Adayı geçici gizle" sub="1 saat ya da yeniden basana kadar; onaylar yine gelir"><Kbd keys={settings.shortcuts.hide_island} /></Row>
        <Row title="Renkli uygulama simgeleri" sub="Üstüne gelince gerçek renkli simge">
          <Switch on={settings.colorIcons} label="Renkli uygulama simgeleri" onChange={(v) => bridge.call("set_settings", { patch: { colorIcons: v } })} />
        </Row>
        <Row title="İkinci ekranlarda şerit" sub="Başlat, Ara, pencereler ve saat">
          <Switch on={settings.secondaryStrips} label="İkinci ekranlarda şerit" onChange={(v) => bridge.call("set_settings", { patch: { secondaryStrips: v } })} />
        </Row>
      </div>
      <div className="liste cam" style={NO_INDENT}>
        <Row title="Windows görev çubuğu" sub={`${mode === "off" ? "Windows'un kendi çubuğu açık" : mode === "auto" ? "Otomatik gizleniyor" : "Gizli"}. Acil kısayol ${settings.shortcuts.emergency}`}>
          <button className="btn kk cam" onClick={() => bridge.call("restore_taskbar")}>Görev çubuğunu geri getir</button>
        </Row>
        <Row title="Peeka'yı kilitle" sub="Pano ve eklenti kartları gizlenir">
          <button className="btn kk cam" onClick={() => bridge.call("lock_now").catch(() => undefined)}><Lock />Kilitle</button>
        </Row>
      </div>
      <button className="btn kk cam digerAyar" aria-expanded={more} onClick={() => setMore(!more)}><ChevronRight />Diğer ayarlar</button>
      {more && (
        <div className="liste cam" style={NO_INDENT}>
          <Row title="Görev çubuğu kipi" sub="Tamamen, otomatik ya da Windows'unki"><TaskbarMode value={mode} /></Row>
          <Row title="Ses tuşlarını yakala" sub="Windows'un göstergesi yerine yalnız Peeka'nın göstergesi çıkar">
            <Switch on={settings.captureVolumeKeys} label="Ses tuşlarını yakala" onChange={(v) => bridge.call("set_settings", { patch: { captureVolumeKeys: v } })} />
          </Row>
          <Row title="Betikler için uyarı adresi" sub="127.0.0.1 üzerinde basit uyarı HTTP'si; anahtar Peeka klasöründe">
            <Switch on={settings.alertsApi} label="Betikler için uyarı adresi" onChange={(v) => bridge.call("set_settings", { patch: { alertsApi: v } })} />
          </Row>
          <MirrorSetting />
          <Row title="İndirme bitti bildirimi" sub="İndirilenler klasörü izlenir; yalnız ad ve boyut okunur, içerik okunmaz">
            <Switch on={settings.watchDownloads} label="İndirme bitti bildirimi" onChange={(v) => bridge.call("set_settings", { patch: { watchDownloads: v } })} />
          </Row>
          <Row title="Windows ile başlat" sub="Oturum açılınca Peeka kendiliğinden başlar">
            <Switch on={settings.autostart} label="Windows ile başlat" onChange={(v) => bridge.call("set_settings", { patch: { autostart: v } })} />
          </Row>
        </div>
      )}
    </>
  );
}

/** Ayarlar › Maskot (maket ays): muziplik ve kutlama aç/kapa, ilk açılışı tekrar göster. */
function MascotSettings({ settings }: { settings: Settings }) {
  return (
    <>
      <div className="t17 b6">Maskot</div>
      <div className="liste cam" style={NO_INDENT}>
        <Row title="Maskot muziplikleri" sub="45–90 dk'da bir, günde en çok 6; tam ekranda, rahatsız etmede ve toplantıda yok">
          <Switch on={settings.mascotPranks} label="Maskot muziplikleri" onChange={(v) => bridge.call("set_settings", { patch: { mascotPranks: v } })} />
        </Row>
        <Row title="İş bitince kutlama" sub="Saatte en çok 3">
          <Switch on={settings.celebrate} label="İş bitince kutlama" onChange={(v) => bridge.call("set_settings", { patch: { celebrate: v } })} />
        </Row>
        <Row title="İlk açılışı tekrar göster" sub="Peeka ve ana asistan tanıtımı">
          <button className="btn kk cam" onClick={() => { resetFirstRun(); sendX({ t: "firstrun" }); }}>Göster</button>
        </Row>
      </div>
      <div className="t12 l3 b4">Maskot Peeka'nın kendi karakteridir; ana asistan bağlı değilken uyur, hiç yokken görünmez.</div>
    </>
  );
}

const LIFETIMES = [5, 15, 30, 60] as const;
/** Ayarlar › Pano (maket ayp, ADR-0063 §3): parola ömrü yalnız kısaltılabilir (en çok 60 dk), "Hepsini sil" basılı tutunca. */
function ClipboardSettings({ settings }: { settings: Settings }) {
  const set = (patch: Partial<Settings>) => bridge.call("set_settings", { patch });
  return (
    <>
      <div className="t17 b6">Pano</div>
      <div className="liste cam" style={NO_INDENT}>
        <Row title="Pano geçmişi" sub="Son 24 saat, en çok 50 öğe, yalnız bu bilgisayarda"><Switch on={settings.clipHistory} label="Pano geçmişi" onChange={(v) => set({ clipHistory: v })} /></Row>
        <Row title="Görsel ve dosya da tut" sub="Dosyanın yeri tutulur, kendisi kopyalanmaz"><Switch on={settings.clipMedia} label="Görsel ve dosya da tut" onChange={(v) => set({ clipMedia: v })} /></Row>
        <Row title="Parola ömrü" sub="Şifreli (DPAPI) saklanır, sonra silinir">
          <div className="seg cam segKucuk segEsit" role="radiogroup" aria-label="Parola ömrü" onKeyDown={radioKeys}>
            {LIFETIMES.map((m) => <button key={m} className={"segb" + (settings.clipPasswordMin === m ? " on" : "")} role="radio" aria-checked={settings.clipPasswordMin === m} tabIndex={settings.clipPasswordMin === m ? 0 : -1} onClick={() => set({ clipPasswordMin: m })}>{m} dk</button>)}
          </div>
        </Row>
        <Row title="Hepsini sil" sub="Geri alınamaz"><HoldButton label="Hepsini sil" icon={<Trash2 />} danger onDone={() => { bridge.call("clip_clear", {}).catch(() => undefined); }} /></Row>
      </div>
    </>
  );
}

const SHORTCUT_ROWS: [ShortcutId, string][] = [["search", "Ara"], ["ask", "Asistana sor"], ["focus_island", "Onaya git"], ["hide_island", "Adayı geçici gizle"], ["emergency", "Görev çubuğunu geri getir (acil)"]];

/** Kısayol satırı: "Değiştir" sonraki tuş birleşimini yakalar (Esc vazgeçer); çakışmayı arka uç reddeder ve nedeni burada gösterilir. */
function ShortcutRow({ id, title, keys }: { id: ShortcutId; title: string; keys: string }) {
  const [rec, setRec] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!rec) return;
    const onKey = async (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Escape") return setRec(false);
      const combo = formatCombo(e);
      if (!combo) return;
      setRec(false);
      const r = await bridge.call("set_settings", { patch: { shortcuts: { [id]: combo } as Settings["shortcuts"] } });
      setErr(r.ok ? null : r.error ?? "Bu kısayol kullanılamıyor.");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [rec, id]);
  return (
    <div className="sat">
      <span className="metin">{title}{err && <span className="eoUyari" role="alert">{err}</span>}</span>
      {rec ? <span className="t12 l2">Tuşlara bas… (Esc: vazgeç)</span> : <Kbd keys={keys} />}
      <button className="btn kk cam" aria-label={`${title} kısayolunu değiştir`} onClick={() => { setErr(null); setRec(true); }}>Değiştir</button>
    </div>
  );
}

const HEAD = 3;
/** İstisna satırı: uygulama simgesi, ad, kısayol ("Ctrl+K, Ctrl+Space" gibi uygulamaya özel dizi olabilir); kaldırma düğmesi üstüne gelince çıkar. */
function ExceptionRow({ e, onRemove }: { e: Settings["shortcutExceptions"][number]; onRemove: () => void }) {
  return (
    <div className="sat">
      <span className="uyg"><AppIcon src={e.icon} size={13} /></span>
      <span className="metin">{e.name}</span>
      <span className="t12 l3">{e.keys}</span>
      <button className="mini" aria-label={`${e.name} istisnasını kaldır`} onClick={onRemove}><X /></button>
    </div>
  );
}

function Shortcuts({ settings }: { settings: Settings }) {
  const [adding, setAdding] = useState(false);
  const [apps, setApps] = useState<AppRef[]>([]);
  useEffect(() => { if (adding) bridge.call("list_apps").then(setApps); }, [adding]);
  // kural: varsayılandan farklı kısayollu uygulamalar önce (tek tek görünür), varsayılanı kullananlar sonda tek satırda toplanır
  const def = settings.shortcuts.search;
  const ex = [...settings.shortcutExceptions].sort((a, b) => +(b.keys !== def) - +(a.keys !== def));
  const save = (list: Settings["shortcutExceptions"]) => bridge.call("set_settings", { patch: { shortcutExceptions: list } });
  const free = apps.filter((a) => !ex.some((e) => e.appId === a.appId));
  const [grouped, setGrouped] = useState(true); // ilk üçünün ötesi tek satırda toplanır, tıklayınca tek tek açılır
  const rest = ex.slice(HEAD);
  return (
    <>
      <div className="t17 b6">Kısayollar</div>
      <div className="liste cam" style={NO_INDENT}>
        {SHORTCUT_ROWS.map(([id, title]) => <ShortcutRow key={id} id={id} title={title} keys={settings.shortcuts[id]} />)}
      </div>
      <div className="bolumBas">
        <span>Bu uygulamalar öndeyken kısayollar uygulamaya gider</span>
        <button className="btn kk cam" aria-expanded={adding} onClick={() => setAdding(!adding)}><Plus />Ekle</button>
      </div>
      {adding && (
        <div className="liste cam istisnaEkle" role="group" aria-label="Eklenebilecek uygulamalar" style={{ "--girinti": "36px" } as CSSProperties}>
          {free.map((a) => (
            <button key={a.appId} className="sat" onClick={() => { save([...ex, { ...a, keys: settings.shortcuts.search }]); setAdding(false); }}>
              <AppIcon src={a.icon} /><span className="metin" style={{ textAlign: "left" }}>{a.name}</span>
            </button>
          ))}
          {!free.length && <div className="bosSonuc">Eklenecek uygulama kalmadı.</div>}
        </div>
      )}
      <div className="liste cam istisnalar" style={{ "--girinti": "36px" } as CSSProperties}>
        {ex.slice(0, HEAD).map((e) => <ExceptionRow key={e.appId} e={e} onRemove={() => save(ex.filter((x) => x.appId !== e.appId))} />)}
        {rest.length > 0 && !grouped && rest.map((e) => <ExceptionRow key={e.appId} e={e} onRemove={() => save(ex.filter((x) => x.appId !== e.appId))} />)}
        {rest.length > 0 && grouped && (
          <button className="sat istisnaGrup" aria-expanded={false} aria-label={`${rest.length} uygulama daha: ${rest.map((e) => e.name).join(", ")}. Tek tek göster`} onClick={() => setGrouped(false)}>
            <span className="uyg"><FileText /></span><span className="metin" title={rest.map((e) => e.name).join(", ")}>{rest.map((e) => e.name).join(", ")}</span>
            <span className="t12 l3">{rest.every((e) => e.keys === rest[0].keys) ? rest[0].keys : "çeşitli"}</span>
          </button>
        )}
      </div>
    </>
  );
}

function About({ settings, onQuit }: { settings: Settings; onQuit?: () => void }) {
  return (
    <>
      <div className="t17 b6">Hakkında</div>
      <div className="liste cam" style={NO_INDENT}>
        <Row title="Peeka" sub="Windows görev çubuğunun yerini alan şerit ve ada. Asistan ona eklenti olarak bağlanır." />
        <Row title="Acil kısayol" sub="Görev çubuğunu geri getirir"><Kbd keys={settings.shortcuts.emergency} /></Row>
        {onQuit && <Row title="Peeka'dan çık" sub="Windows görev çubuğu geri gelir; önce onay sorulur"><button className="btn kk cam yikici" onClick={onQuit}>Çık</button></Row>}
      </div>
    </>
  );
}

export function SettingsPanel({ page, onPage, settings, onQuit }: { page: SettingsPage; onPage: (p: SettingsPage) => void; settings: Settings; onQuit?: () => void }) {
  const [about, setAbout] = useState(false); // Hakkında sayfa kimliği taşımaz (maket: id boş); yerel durumla açılır
  return (
    <div className="govde">
      <div className="ayar">
        <nav className="ayarNav" aria-label="Ayarlar bölümleri">
          {NAV.map(([id, title, Icon]) => (
            <button key={id} className={"ayarB" + (!about && id === page ? " on" : "")} aria-current={!about && id === page ? "page" : undefined} data-autofocus={id === page ? "" : undefined} onClick={() => { setAbout(false); onPage(id); }}><Icon />{title}</button>
          ))}
          <button className={"ayarB" + (about ? " on" : "")} aria-current={about ? "page" : undefined} onClick={() => setAbout(true)}><Info />Hakkında</button>
        </nav>
        <div className="ayarIc">{about ? <About settings={settings} onQuit={onQuit} /> : page === "ayg" ? <Appearance settings={settings} /> : page === "ayk" ? <Shortcuts settings={settings} /> : page === "aye" ? <><Plugins /><PluginExtras /></> : page === "ayp" ? <ClipboardSettings settings={settings} /> : page === "ays" ? <MascotSettings settings={settings} /> : <Modules />}</div>
      </div>
    </div>
  );
}
