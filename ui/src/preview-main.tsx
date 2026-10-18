import { createRoot } from "react-dom/client";
import { fakeBridge } from "./bridge.fake";
import type { ClipPlain } from "./bridge";
import { Island, type IslandInit } from "./components/Island";
import { Shell, type ShellInit } from "./components/Shell";
import { ConsentWindow } from "./components/Consent";
import { SURFACES_J, VOICE_ASISTAN, VOICE_SEN, VOICE_SPEAKING, VOICE_THINKING, withRecommended } from "./plugin.fixtures";
import { setPanoDrag } from "./components/Pano";
import { param } from "./main-common";
import { MODULES, PLUGINS, APPROVAL_CHOICE, APPROVAL_HIGH, APPROVAL_LOW, PUSULA, CONSENT, DIKTE, KAYIT, PROTRUSION, SURFACES_FULL, TICKET } from "./plugin.fixtures";
import "./preview.css";

const disk = (await fakeBridge.call("list_alerts")).items.find((a) => a.id === "disk");
const DURUM: Record<string, ShellInit> = {
  a: {}, aye: { panel: "aye" }, aym: { panel: "aym" }, m: { panel: "notif" }, mt: { panel: "mt", review: disk }, o: { panel: "status" }, w2: { panel: "start" }, ara0: { panel: "search" }, ara1: { panel: "search", query: "ekran", sel: 1 }, ara2: { panel: "search", query: "xqz" }, ayp: { panel: "ayp" }, ays: { panel: "ays" }, ayg: { panel: "ayg" }, tepsi: { panel: "tray" }, ayk: { panel: "ayk" }, y: { panel: "quit" },
  // Sadakat 3: sr şerit menüsü, p1 uygulama menüsü (kur, y1, y2, gz aşağıda özel yerleşimle)
  kur: { panel: "setup", setup: true, setupStep: 1 }, y1: { panel: "tray" },
  sr: { menu: { kind: "strip", x: 960 } }, p1: { menu: { kind: "app", appId: "discord", x: 626 } },
};
// ada durumları (maket kimlikleri): b1 müzik çıkıntısı, b2 çalar, e ses göstergesi, hov üstüne gelme, x0 asistan bağlı değil (dinlenme), x1 Ctrl+Space, ilk ilk açılış, u uyarı, j Sistem kartı
const ADA: Record<string, IslandInit> = {
  b1: { autoMusic: true, pin: true }, b2: { view: "music-card" }, e: { osd: { percent: 64, muted: false, device: "Buds Pro" }, pin: true }, hov: { hover: true },
  x1: { view: "asistanyok" }, ilk2: {}, ky: { view: "pano", card: "ky" }, kh: { view: "pano", card: "kh" }, kb: { view: "pano", card: "kb" }, h: { view: "pano" }, h2: { view: "pano" }, h3: { view: "pano" }, h1: { shot: true, pin: true }, kl: { view: "modules" }, ilk: { view: "ilk" }, j: { view: "modules" },
  c2: { view: "approval-card" }, c2r: { view: "approval-card" }, c3: { view: "approval-card" }, s: { view: "composer" },
  d2: { view: "composer", ask: "Yarın sabahki toplantıyı hatırlat, notları da hazırla." },
  // Dalga 5: şarj, düşük pil, Bluetooth, zamanlayıcı, dikte, ticket, kayıt, toplantı, raf (sürüklerken / kart), Ara etiketi
  mz: { prank: true }, e0: { osd: { percent: 0, muted: true, device: null }, pin: true }, f: { view: "meeting" }, bit: { done: { title: "Haftalık özet hazır", took: "4 dk sürdü" }, pin: true }, cev: { offline: true }, x0: {},
  // kopya şeridi: k1 görsel, k1b görsel + imleç üstünde (büyük önizleme), k2 dosya, k3 bağlantı (açılışta sahte kopya olayı)
  k1: { pin: true }, k1b: { pin: true, hover: true }, k2: { pin: true }, k3: { pin: true },
  // zamanlayıcı: zs son 60 sn (müzik baloncukta), sd "Süre doldu"
  zs: { autoMusic: true, pin: true }, sd: { timerDone: "Odak", pin: true },
  // ağ: ag koptu, ag2 geri geldi
  ag: { net: "lost", pin: true }, ag2: { net: "back", pin: true },
  // "Sen yokken" özeti
  sy: { away: { notif: 3, approval: 1, done: 2 }, pin: true },
  // bildirim yağmuru (by), iki Claude Code oturumu (os: iki session_start), hata kartı + "Neden?" (hn)
  by: { burst: { n: 6, apps: ["Discord", "Outlook", "Teams"] }, pin: true }, os: { pin: true }, hn: { view: "hata", err: "Bash" },
  sarj: { charge: true, pin: true }, pil: {}, bt: { bt: { name: "Buds Pro", battery: 80 }, pin: true }, zam: {}, dik: {}, tik: {}, kay: {}, f0: {}, g0: { shelfDrag: true, pin: true }, g: { view: "raf" },
};
const durum = param("durum", "a");
// eklenti durumları (maket kimlikleri): c1/c1r izin çıkıntısı, c2/c2r/c3 izin kartı, t3 tam ekranda inen şerit, s Ctrl+Space, d2 sohbet, j Modüller, eo onay penceresi
const ONAY = { c1: APPROVAL_LOW, c2: APPROVAL_LOW, t3: APPROVAL_LOW, c1r: APPROVAL_HIGH, c2r: APPROVAL_HIGH, c3: APPROVAL_CHOICE } as const;
if (durum in ONAY) { const a = ONAY[durum as keyof typeof ONAY]; fakeBridge.setSurfaces({ approvals: [a], approvalTop: a.id, dropStripMs: durum === "t3" ? 4000 : null }); }
// maket DINLEN(): dinlenmede "1 onay" sayısı (kart ya da çıkıntı açmaz: dikkat bütçesi onayı çıkıntıya taşımadı)
if (["a", "hov", "mz", "i", "m", "n", "n2", "t1", "t2", "dnd"].includes(durum)) fakeBridge.setSurfaces({ approvals: [APPROVAL_LOW], approvalTop: null });
if (durum === "dnd") fakeBridge.setStatus({ dnd: true, dndUntil: "18:00'e kadar" });
// x0: asistan yüklü ama bağlı değil (maskot uyur); ?baglantisiz hiç yüklü değil
if (durum === "x0" || durum === "x1") fakeBridge.setPlugins(PLUGINS.map((p) => (p.main ? { ...p, connected: false } : p)));
// tam ekran: t1 şerit yukarı kaçar, t2 imleç üst kenarda (şerit gelir), t3 onay şeridi iner
if (durum === "t1" || durum === "t2" || durum === "t3") setTimeout(() => { fakeBridge.emit("notch://fullscreen", true); fakeBridge.emit("fullscreen_screens", { island: true, strips: ["m1"] }); }, 300);
if (durum === "t2") setTimeout(() => dispatchEvent(new MouseEvent("mousemove", { clientX: 900, clientY: 2 })), 700);
if (durum === "s" || durum === "d2") fakeBridge.setSurfaces({ composer: { ...PUSULA, voice: true } });
if (durum === "j") fakeBridge.setSurfaces(SURFACES_FULL);
// Sadakat 2 (ekleme): j Genel = asistan | Claude Code | Sistem verisi, c3 önerilen seçenek, d1/d3 ses çıkıntısı ve canlı döküm (Sen, sonra asistan)
if (durum === "j") fakeBridge.setSurfaces(SURFACES_J);
if (durum === "s" || durum === "d2") fakeBridge.setShelf([{ id: "f1", name: "sunum-taslak.pdf", sub: "2,4 MB, az önce", kind: "pdf" }, { id: "f2", name: "ekran-kaydı.mp4", sub: "38 MB, 2 dk önce", kind: "video" }]); // "Raftaki 2 dosya" çipi
if (durum === "c3") fakeBridge.setSurfaces({ approvals: [withRecommended(APPROVAL_CHOICE)], approvalTop: APPROVAL_CHOICE.id });
if (durum === "d1" || durum === "d3") {
  fakeBridge.setSurfaces({ protrusion: durum === "d1" ? VOICE_THINKING : VOICE_SPEAKING });
  setTimeout(() => { fakeBridge.emit("plugin_stream", { streamId: "ses", text: VOICE_SEN, speaker: "Sen" }); if (durum === "d3") fakeBridge.emit("plugin_stream", { streamId: "ses", text: VOICE_ASISTAN, speaker: "Pusula" }); }, 300);
}
if (durum === "yk") fakeBridge.setSurfaces({ protrusion: { ...PROTRUSION, title: "Yedek yükleniyor", subtitle: "2,4 GB / 4 GB", icon: null, mascot: "dusunuyor", progress: 0.6, actions: [] } });
// yb: Claude çalışıyor (ana şeritte "Claude · Düşünüyor… 0:06") + müzik çalıyor (yan baloncuk: kapak). yb2: üstüne zamanlayıcı ("+1" rozeti). Sınama için sahte köprü pencereye açılır (yalnız bu önizleme sayfası).
if (durum === "yb" || durum === "yb2") fakeBridge.setSurfaces({ protrusion: { plugin: PUSULA, title: "Claude · Düşünüyor…", icon: "code", state: "info", mascot: "ciddi", timer: { startedAt: new Date(Date.now() - 6000).toISOString() } } });
if (durum === "yb2") fakeBridge.setTimer({ label: "Odak", totalS: 1500, remainingS: 1452, running: true });
if (durum === "os") setTimeout(() => { fakeBridge.emit("cc_event", { kind: "session_start" }); fakeBridge.emit("cc_event", { kind: "session_start" }); fakeBridge.emit("cc_event", { kind: "pre_tool", tool: "Edit" }); }, 400);
Object.assign(window, { fakeBridge });
const KOPYA_RESIM = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5E5CE6"/><stop offset="1" stop-color="#63E6E2"/></linearGradient></defs><rect width="160" height="100" fill="url(#g)"/><circle cx="52" cy="42" r="18" fill="#fff" fill-opacity=".7"/><path d="M0 100 L60 60 L100 84 L130 66 L160 90 V100Z" fill="#000" fill-opacity=".35"/></svg>');
const KOPYA: Record<string, ClipPlain> = {
  k1: { id: "k1", createdAt: Date.now(), pinned: false, source: "Paint", kind: "image", text: null, sub: "Görsel", thumb: KOPYA_RESIM, screenshot: false },
  k2: { id: "k2", createdAt: Date.now(), pinned: false, source: "Gezgin", kind: "file", text: "rapor-q3.xlsx", sub: "1,2 MB", thumb: null, screenshot: false },
  k3: { id: "k3", createdAt: Date.now(), pinned: false, source: "Chrome", kind: "text", text: "https://ornek.com/raporlar/q3-ozet", hint: "link", sub: null, thumb: null, screenshot: false },
};
const kopyaId = durum === "k1b" ? "k1" : durum;
if (kopyaId in KOPYA) setTimeout(() => fakeBridge.addClip(KOPYA[kopyaId]), 600);
if (durum === "ilk2") fakeBridge.setFirstConnect(true);
if (durum === "eo") fakeBridge.setConsent(CONSENT);
// Dalga 5 maket durumları: veriyi Rust yerine sahte köprü verir
if (durum === "sarj") fakeBridge.setBattery({ percent: 78, charging: true, plugged: true, remaining: "1 sa" });
if (durum === "pil") fakeBridge.setBattery({ percent: 12, charging: false, plugged: false, remaining: "25 dk" });
if (durum === "zs") fakeBridge.setTimer({ label: "Odak", totalS: 1500, remainingS: 45, running: true });
if (durum === "zam") { fakeBridge.setMedia(null); fakeBridge.setTimer({ label: "Odak", totalS: 1500, remainingS: 1452, running: true }); } // maket zam: zamanlayıcı tek iş (müzik çalarken yan baloncuğa iner, bkz. yb2)
if (durum === "dik") { fakeBridge.setSurfaces({ protrusion: DIKTE }); setTimeout(() => fakeBridge.emit("plugin_stream", { streamId: "dikte-1", text: "yarın sabah dokuzda ekiple toplanalım", speaker: "Sen" }), 300); }
if (durum === "tik") fakeBridge.setSurfaces({ protrusion: TICKET });
if (durum === "kay") fakeBridge.setSurfaces({ protrusion: { ...KAYIT, timer: { startedAt: new Date(Date.now() - 134_000).toISOString() } } });
if (durum === "f0" || durum === "f") fakeBridge.setSurfaces({ protrusion: PROTRUSION });
if (durum === "g0" || durum === "g") fakeBridge.setShelf([{ id: "f1", name: "sunum-taslak.pdf", sub: "2,4 MB, az önce", kind: "pdf" }, { id: "f2", name: "ekran-kaydı.mp4", sub: "38 MB, 2 dk önce", kind: "video" }]);
if (param("mik", "") !== "") fakeBridge.setPrivacy({ mic: ["Chrome"], camera: [] });
if (param("onizleme", "") !== "") fakeBridge.setPreviewDelay(+param("onizleme", "0"));
if (durum === "u") fakeBridge.pushAlert({ id: "cpu", title: "Chrome işlemciyi zorluyor", subtitle: "30 sn'dir %100", icon: "dikkat", action: "task_manager", priority: 70 });
if (durum === "q1") fakeBridge.pushAlert({ id: "q1", title: "Günlük bütçe %80", subtitle: "Otomatik işler durdu, senin isteklerin sürer", icon: "yorgun", progress: 0.8, priority: 70 });
if (durum === "q2") fakeBridge.pushAlert({ id: "q2", title: "Claude kotası doldu", subtitle: "1 sa 10 dk sonra yeniden kullanılabilir", icon: "yorgun", progress: 1, priority: 70 });
// Dalga 4: kl Peeka kilitli; ?baglantisiz ana asistan yok (asistana sor satırı kalkar); ?dizin=kapali Windows Arama dizini kapalı. h3'te göz düğmesine basılır (kendiliğinden gösterme yok).
if (durum === "kl") fakeBridge.setLocked(true, "manual");
if (param("kilitli", "") !== "") fakeBridge.setLocked(true, "manual"); // herhangi bir durum kilitliyken (kilitli şeritte müzik ya da uyarı)
if (param("baglantisiz", "") !== "") fakeBridge.setPlugins([]);
if (param("dizin", "") === "kapali") fakeBridge.setFilesIndex(false);
// Dalga 6: ?bildirim=1 Windows bildirimi (m), ?ayna=ok|dev|reg|izin Ayarlar anahtarı açık ve engel (ayg)
if (param("bildirim", "") !== "") {
  fakeBridge.pushNotice({ id: "win.1", app: "Teams", title: "Ayşe Demir", body: "Toplantı 15:00'e alındı, sunum dosyasını da paylaşır mısın?", tile: "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="3"/></svg>') });
  fakeBridge.pushNotice({ id: "win.2", app: "Outlook", title: "Haftalık rapor", body: "Ek: rapor-q3.xlsx", canOpen: false });
}
const ayna = param("ayna", "");
if (ayna) { fakeBridge.setMirror({ enabled: true, ...(ayna === "dev" ? { devMode: false } : ayna === "reg" ? { registered: false } : ayna === "izin" ? { access: "denied" } : {}) }); }
// Sadakat 3: gz adayı geçici gizler (şerit ortasında yalnız göz simgesi), h2 pano öğesi sürükleniyor (kaynak soluk)
// n / n2: gelen Windows bildirimi Shell'de sağ üst kart olur; n2'de "asistan yanıtlasın"a basılmış gibi taslak görünümü
if (durum === "n" || durum === "n2") {
  setTimeout(() => fakeBridge.pushNotice({ id: "win.d", app: "Discord", title: "Deniz", body: "Akşam 8 uygun mu?" }), 400);
  if (durum === "n2") setTimeout(() => document.querySelector<HTMLElement>(".tost .btn.asistan")?.click(), 1000);
}
if (durum === "aye") fakeBridge.setPlugins([PLUGINS[0]]);
if (durum === "aym") fakeBridge.call("modules_set", { order: MODULES.map((m) => m.id), off: ["zamanlayıcı"] });
if (durum === "gz") fakeBridge.call("island_hide", { on: true });
if (durum === "h2") setPanoDrag("c2");
const monitor = param("monitor", "m1");

/** Ada ya da, geçici gizliyken, tek göz simgesi (üretimde şerit/ada sayfası aynı kancayla yapar). */
function Center({ monitor: m, init }: { monitor: string; init: IslandInit }) {
  return <div className="adaPencere"><Island monitor={m} init={init} /></div>;
}
function Coklu() {
  const mon = (id: string, w: number, ad: string, ac: string) => {
    const k = w / 1920;
    return (
      <div className="mon">
        <div className="yuz" style={{ width: w, height: 1080 * k }}><iframe title={ad} src={`?durum=a&monitor=${id}&saat=${param("saat", "")}`} style={{ transform: `scale(${k})` }} /></div>
        <p><b>{ad}</b>{ac}</p>
      </div>
    );
  };
  return (
    <div className="coklu"><div className="monitorler">
      {mon("m1", 1040, "Ana ekran", "Tam şerit: Başlat, sabitler, bu ekranın pencereleri, sağda ses, ağ, pil ve saat.")}
      {mon("m2", 720, "İkinci ekran", "Aynı ince şerit: Başlat ve Ara (panel bu ekranda açılır), bu ekrandaki pencereler ve saat. Ada, asistan çizgisi ve durum simgeleri yok.")}
    </div></div>
  );
}

createRoot(document.getElementById("root")!).render(
  durum === "k" ? <Coklu /> : durum === "eo" ? <div className="ekran"><div className="duvar" /><Shell monitor={monitor} center={<div className="adaPencere"><Island monitor={monitor} init={{ view: null }} /></div>} /><ConsentWindow /></div> : <div className="ekran"><div className="duvar" /><Shell monitor={monitor} init={DURUM[durum]} center={monitor === "m1" ? <Center monitor={monitor} init={{ view: null, ...ADA[durum] }} /> : undefined} /></div>,
);
