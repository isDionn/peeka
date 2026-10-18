// Peeka arayüzünün arka uçla (Rust/Tauri) konuştuğu TEK yer. Komut ve olay adları burada, Rust ajanı buna uyar.
// Tauri dışında (tarayıcı önizlemesi, testler) bridge.fake.ts devreye girer.
import { fakeBridge } from "./bridge.fake";
import type { COMMAND_NAMES, EVENT_NAMES } from "./commands.generated";
import type { PluginCommands, PluginEvents } from "./plugin-api";
import type { PluginRef } from "./plugin-api";
export * from "./plugin-api";

/* ---------- veri tipleri ---------- */
/** Bir monitörün şeridi. `id` Rust'ın verdiği kararlı kimlik; sayfa adresinde `?monitor=<id>` gelir. */
export interface MonitorInfo {
  id: string;
  primary: boolean;
  hasBattery: boolean;
  /** Wi-Fi/Bluetooth düğmesi Windows.Devices.Radios'tan erişim reddi alırsa 'denied': düğme ms-settings açar. */
  radios: "ok" | "denied";
  /** Parlaklık denetlenebiliyor mu (masaüstü monitörlerinde çoğu zaman yok). */
  brightness: boolean;
  /** Başlat panelinde görünen hesap adı. */
  user: string;
  /** Monitörün yenileme hızı (0 = Windows söylemedi). */
  hz: number;
}
/** Tek renk simge: data URL (SVG ya da PNG). Arayüz yalnız alfa maskesi olarak boyar. */
export interface AppRef { appId: string; name: string; icon: string; /** Dalga 5: renkli simge; Rust yalnız `colorIcons` açıkken gönderir. */ colorIcon?: string | null }
export interface WindowInfo extends AppRef { hwnd: number; title: string; active: boolean; monitor: string; /** Yönetici (yükseltilmiş) pencere: Peeka kapatamaz, menü Görev Yöneticisi'ni önerir. */ elevated?: boolean }
export type PinnedApp = AppRef;
/** Açık/kapalı ve neye bağlı olduğu. `name` (Wi-Fi ağı, Bluetooth aygıtı) henüz okunmuyor: null gelir, arayüz "Açık" yazar. */
export interface Radio { on: boolean; name: string | null }
/** Bağlantı düzeyi (Windows'un söylediği; Wi-Fi mi kablo mu henüz bilinmiyor). */
export type NetworkLevel = "unknown" | "none" | "local" | "internet" | "constrained";
/** Rust'taki tek `Status` tipi (notch-core status.rs). Windows'un veremediği her alan null: uydurma değer yok. */
export interface Status {
  volume: number | null; // 0..100, hoparlör yoksa null
  muted: boolean;
  brightness: number | null; // 0..100, denetlenemiyorsa null
  wifi: Radio | null; // bu makinede o radyo yoksa null
  bluetooth: Radio | null;
  dnd: boolean; // Peeka'nın kendi Rahatsız etme kipi
  /** Rahatsız etmenin biteceği saat ("18:00'e kadar"); Rust'ta bitiş saati yok, hep null (arayüz bitişsiz yazar). */
  dndUntil: string | null;
  network: NetworkLevel;
  battery: { percent: number | null; charging: boolean; /** Prizde (yüzdeyi 100'de charging false olur). */ plugged: boolean; remaining: string | null } | null; // pili olmayan makinede null
}
/** Kısayol adları (Rust `ShortcutId`). */
export type ShortcutId = "search" | "ask" | "focus_island" | "hide_island" | "emergency";
/** Komut hatası (Rust `CmdError`): Tauri'de `call` bu dizeyle reddedilir. */
/** `ignored`: ~300 ms korumasına takılan tıklama (istem açık kalır); `not_connected`: ana asistan bağlı değil. */
export type CmdError = "unknown" | "refused" | "invalid" | "io" | "unsupported" | "denied" | "missing" | "not_yet" | "ignored" | "not_connected";
export interface ShortcutException { appId: string; name: string; icon: string; keys: string }
export interface Settings extends ClipSettings {
  /** Boştaki maskot muziplikleri (45-90 dk'da bir, günde en çok 6). Varsayılan açık. */
  mascotPranks: boolean;
  /** Maskot işi bitince kutlar (varsayılan açık; sayfa saatte en çok 3 uygular). */
  celebrate: boolean;
  /** İndirilenler klasörü izlenir ve biten dosya için `download_done` gelir (yalnız ad ve boyut; içerik okunmaz, eklentiye gitmez). Varsayılan açık. */
  watchDownloads: boolean;
  /** Renkli uygulama simgeleri (karar 14: varsayılan kapalı, tek renk). */
  colorIcons: boolean;
  /** Windows ile başlar (HKCU Run, varsayılan açık). */
  autostart: boolean;
  /** Windows görev çubuğunun durumu (burada salt okunur; `taskbar_set_mode` ile değişir): tamamen / otomatik / Windows'unki kalsın. */
  taskbarHide: "full" | "auto" | "off";
  secondaryStrips: boolean;
  shortcuts: Record<ShortcutId, string>;
  shortcutExceptions: ShortcutException[];
  /** Ses tuşları yutulur, yalnız Peeka'nın göstergesi çıkar. */
  captureVolumeKeys: boolean;
  /** Basit uyarı HTTP uyarlayıcısı, varsayılan kapalı. */
  alertsApi: boolean;
  /** `notch --demo`: hiçbir şey kaydedilmez; şeritte "Demo" rozeti, bazı komutlar `unsupported`. Dosyada hiç yok. */
  demo?: boolean;
}
/** `paint`: görünür ama tıklanmaz (gölge, balon); Rust pencere bölgesini buna da açar. */
export interface Rect { x: number; y: number; w: number; h: number; paint?: true }
export type PowerAction = "lock" | "sleep" | "restart" | "shutdown";
/** Çalan parça (Rust `notch_core::media::Media`). Konum `positionAt` (Unix ms) anındaki değerdir: arayüz çalarken ileri taşır. `durationMs` 0 = oynatıcı süre vermiyor. */
export interface Media {
  title: string; artist: string; album: string; /** "Spotify", "Chrome" */ app: string; /** Kapak data URL'si ya da null. */ art: string | null;
  playing: boolean; positionMs: number; positionAt: number; durationMs: number; canNext: boolean; canPrevious: boolean; canSeek: boolean;
}
/** Peeka'nın uyarı listesi satırı (Rust `notch_core::alerts::Alert`). Metin düz metindir; bağlantı yalnız `open_alert` ile açılır. */
export interface Alert {
  id: string; title: string; subtitle: string | null; icon: string | null; color: string | null; progress: number | null;
  priority: number; /** http/https bağlantısı ya da `"task_manager"` (Rust Görev Yöneticisi'ni kendi yolundan açar). */ action: string | null; style: "standard" | "level"; expand: boolean; kind: "alert" | "approval";
  source: string; /** Unix ms; null = kaldırılana dek durur. */ expiresAt: number | null; /** Unix ms. */ updatedAt: number;
  /** Rust henüz göndermiyor (eklenti dalgası): "Gözden geçir" isteyen eklentinin onay kartı içeriği. */
  review?: { title: string; detail: string; items: { name: string; size: string }[] } | null;
}
/** `list_alerts` ve `alerts_changed` yükü (Rust `AlertsView`): sıralı liste, adayı şimdi açabilecek tek uyarı, gizli şeridi indirme süresi. */
export interface AlertsView { items: Alert[]; top: string | null; dropStripMs: number | null }
/** Sistem izleme ölçümü (Rust `SysmonTick`); okunamayan alan null (uydurma yok). Bellek bayt, ağ bayt/sn. */
export interface SysmonTick { cpu: number | null; gpu: number | null; memUsed: number | null; memTotal: number | null; down: number | null; up: number | null; /** En çok işlemci kullanan program (exe adı, ".exe" yok; aynı programın bütün işlemleri toplanır); ilk ölçüme kadar ya da kimse %1'i geçmiyorsa null. Kart açıkken ~10 sn'de bir yenilenir. */ topCpu: string | null }
/** Ses tuşu ya da ses değişimi: yalnız bizim ses göstergesi. */
export interface VolumeOsd { percent: number; muted: boolean; device?: string | null }

/* ---------- arama ---------- */
export type SearchKind = "app" | "window" | "file" | "setting" | "plugin";
/** `app`/`window`: `icon` tek renk data URL. Diğer türlerde `icon` boş gelir (arayüz türe göre simge seçer). `plugin`: `plugin` + `group` ("Notlar") ad ön ekiyle çizilir. Boş sorguda Rust "son kullanılanlar"ı karışık türlerde döner. */
export interface SearchResult {
  id: string; kind: SearchKind; title: string; subtitle: string | null; appId: string; icon: string; hwnd: number | null;
  plugin?: PluginRef | null; group?: string | null;
}
export interface SearchIndexState { files: "on" | "off" }

/* ---------- pano ---------- */
export type ClipHint = "link" | "color" | "command";
interface ClipBase { id: string; createdAt: number; pinned: boolean; /** Kaynak uygulama adı. */ source: string | null }
/** Metin, görsel ya da dosya. `text`: metin değeri ya da dosya adı; görselde null. `thumb`: görsel küçük resmi (data URL). */
export interface ClipPlain extends ClipBase {
  kind: "text" | "image" | "file"; text: string | null; hint?: ClipHint | null; sub: string | null; thumb: string | null;
  /** Win+Shift+S ile alınan ekran alıntısı. */ screenshot: boolean; /** Dosya yerinde yok: satır soluk. */ missing?: boolean;
}
/** Parola sınıfı: içerik hiçbir listede, olayda ya da günlükte yok. `expiresAt` (Unix ms) ömrün bitişi. */
export interface ClipPassword extends ClipBase { kind: "password"; expiresAt: number }
export type ClipItem = ClipPlain | ClipPassword;
export type ClipChange = { reason: "added" | "removed" | "updated" | "expired" | "cleared"; item: ClipItem | null };
export interface ClipReveal { text: string; /** Rust'ın verdiği gösterme süresi; arayüz en çok 5000 ms uygular. */ ttlMs: number }
export interface LockState { locked: boolean; reason: "windows" | "manual" | "plugin" | null }
/** Ayarlar › Pano (Settings'e eklenir). */
export interface ClipSettings { clipHistory: boolean; clipMedia: boolean; clipPasswordMin: 5 | 15 | 30 | 60 }

/* ---------- zamanlayıcı (Peeka'nın kendi zamanlayıcısı; maket zam) ---------- */
export interface TimerState {
  label: string;
  /** Toplam süre (sn). */ totalS: number;
  /** Kalan süre (sn); duraklatılmışsa dondu. */ remainingS: number;
  running: boolean;
  /** Rust'ın durumu yazdığı an (Unix ms): arayüz çalarken kalanı bu andan geriye sayar. */ at: number;
}
export type TimerAction = "pause" | "resume" | "add5" | "stop";

/* ---------- raf (maket g0, g) ---------- */
export interface ShelfItem { id: string; name: string; sub: string; kind: "pdf" | "video" | "sheet" | "image" | "other" }

/* ---------- Bluetooth kulaklık (maket bt): kutu pili yok ---------- */
export interface DownloadDone { id: string; name: string; size: number }
export interface FullscreenScreens { island: boolean; strips: string[] }
export interface ApprovalBadge { monitor: string; count: number }
export interface CpuHigh { app: string | null }
export interface MusicStopped { name: string; app: string | null }
export interface BluetoothEvent { name: string; /** 0..100; cihaz bildirmiyorsa null (yalnız "bağlandı"). */ battery: number | null }

/* ---------- mikrofon ve kamera gizlilik noktası ---------- */
export interface PrivacyState { mic: string[]; camera: string[] }

/* ---------- girdi (maskot muzipliği ve göz takibi) ---------- */
export interface InputTick {
  lastInputAgoMs: number; cursor: { x: number; y: number } | null;
  /** Windows sunum modu (QUNS_PRESENTATION_MODE): muziplik yok. */ presentation?: boolean;
  /** Windows meşgul (QUNS_BUSY, tam ekran D3D ya da Store uygulaması): muziplik yok. */ busy?: boolean;
}


/* ---------- Dalga 6: tepsi listesi, Windows bildirim aynası ---------- */
export interface TrayIcon { id: string; name: string; exe: string; promoted: boolean; /** PNG data URL (alfa tek renk boyanır); "" = yok. */ icon: string }
export type MirrorBlocker = "dev_mode_off" | "not_registered" | "access_denied";
export interface MirrorState { devMode: boolean; registered: boolean; access: string; enabled: boolean; on: boolean; blocker: MirrorBlocker | null }
/** Windows bildirimi. Kart yalnız sağ üstte; şerit dalgası yok (`ripple` hep false); `tile` alfa maskesi, `tileMono` hep true. */
export interface Notice { id: string; app: string; title: string; body: string | null; tile: string; tileMono: boolean; ripple: boolean; openLabel: string; canOpen: boolean; at: number; /** Bildirimde tek kullanımlık doğrulama kodu var ("Kodu kopyala" göster; Rust her zaman gönderir, eski sahtelerde yoktur). Kodun kendisi sayfaya AYRI bir alan olarak gelmez; yalnız `notif_copy_code` panoya koyar. Bildirim aynası varsayılan kapalıdır; kapalıyken hiç bildirim, dolayısıyla hiç kod yoktur. */ hasCode?: boolean }
/** `quiet`: rahatsız etme / tam ekran / sunum: hiçbir kart kendiliğinden açılmaz. */
export interface MirrorView { items: Notice[]; quiet: boolean }

/* ---------- Sadakat 3 (Rust `fidelity.rs`, `plugins/host/assistant.rs`) ---------- */
export type RecentKind = "pdf" | "video" | "sheet" | "image" | "other" | "app";
/** Başlat "Önerilenler": son kullanılan dosyalar (Windows Son Kullanılanlar). `sub`: "Az önce", "3 sa önce", "Dün". Rust uygulama satırı göndermez. */
export interface RecentItem { id: string; name: string; sub: string; kind: RecentKind; icon?: string }
/** Ana asistanın durum kartındaki sayılar. `memory`: "Notlar" sayısı; `approvals`: "Onay bekliyor" sayısı (Rust hep gönderir, eski köprüde 0). */
export interface AssistantCounts { jobs: number; memory: number; approvals?: number }
/** Claude Code hook köprüsü (ana asistanın bildirdiği). `lastEventAgoS`: son olaydan beri sn, hiç olay yoksa null. */
export interface BridgeState { installed: boolean; healthy: boolean; lastEventAgoS: number | null }
/** İzin geçmişi satırı (yeniden eskiye): kim hangi kapsamı ne zaman aldı ya da bıraktı. `at` Unix ms. */
export interface PermissionEvent { at: number; plugin: string; scope: string; granted: boolean }
/** `open_tray` sonucu + renkli simge (`colorIcons` açıkken). Rust rozet sayısı VERMEZ: `badge` yoksa rozet çizilmez. */
export interface TrayIconX extends TrayIcon { badge?: number; colorIcon?: string | null }
/** `start`: ISO zaman (gün boyu satırda yok); `link`: yalnız toplantı konaklarında https (Rust süzer). İkisi de eski köprüde yok. */
export interface CalendarNext { detail: string | null; next: { time: string; title: string; source: string; start?: string; link?: string }[] }
export interface ShelfSuggestion { id: string; text: string }
/** Ctrl+Space eklerinin türleri; sayfa yalnız türü gönderir, yolu Rust çözer. `window_image` Rust'ta `not_yet`. */
export type ComposerKind = "window_image" | "screen_image" | "file" | "clipboard_link" | "shelf";
export interface Attached { kind: ComposerKind; label: string }

/* ---------- komutlar: Rust'ta #[tauri::command] adı = anahtar ---------- */
export interface Commands {
  get_monitor: { args: { monitor: string }; ret: MonitorInfo };
  list_windows: { args: { monitor: string }; ret: WindowInfo[] };
  get_pins: { args: void; ret: PinnedApp[] };
  /** Sabit uygulamaların sırası; sabitle / kaldır / sürükle-sırala hepsi bunu çağırır. */
  set_pins: { args: { appIds: string[] }; ret: PinnedApp[] };
  activate_window: { args: { hwnd: number }; ret: void };
  close_window: { args: { hwnd: number }; ret: void };
  new_window: { args: { appId: string }; ret: void };
  launch_app: { args: { appId: string }; ret: void };
  list_apps: { args: void; ret: AppRef[] };
  /** Dalga 4: dosya, ayar ve eklenti sonuçları da gelir, boş sorgu = son kullanılanlar (wave4-api.ts). */
  search: { args: { query: string }; ret: SearchResult[] };
  /** Arama sonucunu aç: uygulamayı başlat ya da pencereyi öne getir. */
  open_result: { args: { id: string }; ret: void };
  get_status: { args: void; ret: Status };
  set_volume: { args: { value: number }; ret: void };
  set_brightness: { args: { value: number }; ret: void };
  /** Erişim reddi `denied` hatasıyla döner: arayüz o zaman ms-settings sayfasını açar. */
  set_radio: { args: { kind: "wifi" | "bluetooth"; on: boolean }; ret: void };
  set_dnd: { args: { on: boolean }; ret: void };
  /** Windows ayarları bağlantısı. Rust yalnız sabit listeyi kabul eder: ms-settings:, :network-wifi, :bluetooth, :quiethours. */
  open_windows_settings: { args: { uri: string }; ret: void };
  /** Gizli simgeler oku: salt okunur tepsi listesi (Dalga 0 test 4 yedeği). */
  open_tray: { args: { monitor: string }; ret: TrayIcon[] };
  power: { args: { action: PowerAction }; ret: void };
  restore_taskbar: { args: void; ret: void };
  /** Peeka'dan çık (arayüz kendi onay sorusunu sorduktan sonra). */
  quit: { args: void; ret: void };
  get_settings: { args: void; ret: Settings };
  set_settings: { args: { patch: Partial<Settings> }; ret: { ok: boolean; error: string | null } };
  /** Tıklanabilir dikdörtgenler (pencere içi CSS piksel). Dışı tıklamayı alttaki pencereye geçirir. Şerit ve ada sayfaları ortak kullanır. */
  report_hit_rects: { args: { page: "strip" | "island"; monitor: string; rects: Rect[] }; ret: void };
  get_media: { args: void; ret: Media | null };
  /** `seek` için `positionMs` gerekir. */
  media_control: { args: { action: "play_pause" | "next" | "previous" | "seek"; positionMs?: number }; ret: void };
  /** Öncelik yüksekten düşüğe, eşitte yeni önce (Rust sıralar; arayüz yine de sıralar). */
  list_alerts: { args: void; ret: AlertsView };
  dismiss_alert: { args: { id: string }; ret: void };
  /** Uyarının `action` bağlantısını (yalnız kontrol edilmiş http/https) Rust açar. */
  open_alert: { args: { id: string }; ret: void };
  clear_alerts: { args: void; ret: void };
  /** Sistem izleme kartı açılınca başlar, kapanınca durur; ölçümler `sysmon_tick` olayıyla gelir. */
  sysmon_start: { args: void; ret: void };
  sysmon_stop: { args: void; ret: void };
  /** Görev çubuğu kipi elle (acil kısayolun "kapalı"sını da kaldırır). Arayüzde düğmesi henüz yok. */
  taskbar_set_mode: { args: { mode: "full" | "auto" | "off" }; ret: void };
  /* Dalga 4: arama, pano, kilit */
  search_index_state: { args: void; ret: SearchIndexState };
  /** Arama sonucunu aç (uygulama, pencere, dosya, ayar, eklenti sonucu; Rust türü kimlikten bilir). */
  search_open: { args: { id: string }; ret: void };
  /** "Asistana sor": ana asistan bağlı değilse `not_connected`. Rust ada kartında Ctrl+Space sohbetini bu metinle açar. */
  search_ask: { args: { query: string }; ret: { turn: number } };
  clip_list: { args: void; ret: ClipItem[] };
  /** Geri kopyala. Parolada göstermeden çalışır; Peeka panoya "izleme dışı" işaretleriyle koyar. Kilitliyken `denied`. */
  clip_copy: { args: { id: string }; ret: void };
  clip_pin: { args: { id: string; on: boolean }; ret: void };
  clip_delete: { args: { id: string }; ret: void };
  /** `passwords: true` = yalnız parolalar (Ayarlar › Pano "Parolaları hepsini sil"); alansız ya da false = her şey ("Hepsini sil"). */
  clip_clear: { args: { passwords?: boolean }; ret: void };
  /** Parola düz metni, en çok 5 sn için. Kilitliyken `denied`. */
  clip_reveal: { args: { id: string }; ret: ClipReveal };
  /** Tek seferlik paylaşım: ana asistana. Parolada `denied`, bağlı değilse `not_connected`. */
  clip_share: { args: { id: string }; ret: void };
  /** Ekran alıntısını Windows'un düzenleyicisinde aç. */
  clip_edit: { args: { id: string }; ret: void };
  /** Dışarı sürükleme başlat (Windows'un yerel sürükleme resmi, görsel ve dosyada). */
  clip_drag: { args: { id: string }; ret: void };
  /** Görsel ya da dosya parçasını varsayılan uygulamayla aç (görsel geçici kopyadan). Kilitliyken, parolada ve çalıştırılabilir dosyada `denied`; dosya yoksa `missing`; metinde `invalid`. */
  clip_open: { args: { id: string }; ret: void };
  /** Görsel ya da dosya parçasını rafa koy (`shelf_changed` gelir). Kilitliyken ve parolada `denied`, metinde `invalid`. */
  clip_to_shelf: { args: { id: string }; ret: void };
  /** Görsel parçanın büyük önizlemesi: PNG data URL, uzun kenar en çok 1024 px (küçükse olduğu gibi). Kilitliyken `denied`, görsel değilse `invalid`. */
  clip_preview: { args: { id: string }; ret: string };
  /** Biten indirmeyi varsayılan uygulamayla aç. Kilitliyken ve çalıştırılabilir dosyada (exe, bat, ps1, lnk...) `denied`; Rust'ın bildirmediği kimlik ya da dosya silinmişse `missing`. */
  download_open: { args: { id: string }; ret: void };
  /** Biten indirmeyi Gezgin'de seçili göster. Kilitliyken `denied`, kimlik/dosya yoksa `missing`. */
  download_show_in_folder: { args: { id: string }; ret: void };
  /** Pano kartı ya da Pano sekmesi görünür/kapalı: Rust ada penceresine `WDA_EXCLUDEFROMCAPTURE`ı açar, kapanınca kaldırır. Sayfa `on: true` cevabını ilk kareden ÖNCE bekler; dönen değer: ada şimdi yakalamadan hariç mi. `false`, hata ya da cevapsızlık = hariç değil: sayfa kartı çizer ama parola satırlarını HİÇ çizmez (güvenli taraf). */
  clip_visible: { args: { on: boolean }; ret: boolean };
  lock_state: { args: void; ret: LockState };
  lock_now: { args: void; ret: void };
  /** Sahibin Peeka'da kilit kartındaki "Kilidi aç" tıklaması: "Kilitle" ve eklenti kilidini kaldırır; Windows kilidi Windows açılınca kalkar. */
  lock_release: { args: void; ret: void };
  /* Dalga 5 */
  /** Pencerenin anlık görüntüsü (PrintWindow, PW_RENDERFULLCONTENT) PNG data URL olarak; simge durumundaki pencere için önbellek. */
  window_preview: { args: { hwnd: number }; ret: string };
  /** Windows paylaşım penceresini aç (Yakın paylaşım ayrı yok). Rafta dosya kimliğiyle. */
  share_open: { args: { id: string }; ret: void };
  shelf_list: { args: void; ret: ShelfItem[] };
  /** Raftaki dosyayı ana asistana sor (tek seferlik paylaşım); bağlı değilse `not_connected`. */
  shelf_ask: { args: { id: string }; ret: void };
  timer_get: { args: void; ret: TimerState | null };
  timer_control: { args: { action: TimerAction }; ret: void };
  privacy_get: { args: void; ret: PrivacyState };
  /* Dalga 6 */
  /** Yeni zamanlayıcı (çalıyorsa yerini alır). 0 sn ya da 24 saat üstü `invalid`. */
  timer_start: { args: { label: string; seconds: number }; ret: TimerState };
  /** Tepsi listesi (Dalga 0 test 4 gelene dek yedek). */
  tray_open: { args: { id: string }; ret: void };
  mirror_state: { args: void; ret: MirrorState };
  mirror_enable: { args: void; ret: MirrorState };
  mirror_disable: { args: void; ret: MirrorState };
  mirror_list: { args: void; ret: MirrorView };
  mirror_dismiss: { args: { id: string }; ret: void };
  mirror_open_app: { args: { id: string }; ret: void };
  /** "Asistan yanıtlasın": yalnız ana asistana, tek seferlik. Kilitliyken `denied`, asistan yoksa `not_connected`. */
  mirror_ask: { args: { id: string }; ret: { turn: number } };
  /** "Kodu kopyala": bildirimdeki tek kullanımlık kodu panoya koyar (parolayla aynı "geçmişe/buluta/izlemeye girme" işaretleriyle, Peeka'nın kendi panosuna girmez); 60 sn sonra pano hâlâ o kodu tutuyorsa silinir. Kilitliyken `denied`; kimlik ya da kod yoksa `missing`. Kod sayfaya dönmez, günlüğe yazılmaz. */
  notif_copy_code: { args: { id: string }; ret: void };
  /* Sadakat 3 */
  /** Başlat "Önerilenler" (en çok 8; sayfa 4 gösterir). */
  recent_files: { args: void; ret: RecentItem[] };
  open_recent: { args: { id: string }; ret: void };
  /** Başlat sabitleri. Windows 11 listeyi okutmaz: Rust hep BOŞ döner, boş = sayfa kendi listesine (şerit sabitleri + uygulamalar) düşer. */
  start_pins: { args: void; ret: AppRef[] };
  /** Windows Başlat menüsünü aç (Win tuşu). */
  open_start_menu: { args: void; ret: void };
  /** "Uygulamadan çık": o uygulamanın bütün pencerelerine kapat gönderir (zorla öldürmez). */
  quit_app: { args: { appId: string }; ret: void };
  /** Adayı 1 saat gizle (`on: true`) ya da geri getir. */
  island_hide: { args: { on: boolean }; ret: void };
  island_hidden: { args: void; ret: boolean };
  /** `open_tray` + renkli simge; rozet sayısı yok. */
  tray_icons: { args: { monitor: string }; ret: TrayIconX[] };
  /** Ana asistanın son bildirdiği sayılar; ondan önce `not_yet`. */
  assistant_counts: { args: void; ret: AssistantCounts };
  assistant_open: { args: { kind: "approval" | "jobs" | "memory" }; ret: void };
  calendar_next: { args: void; ret: CalendarNext };
  claude_bridge_state: { args: void; ret: BridgeState };
  /** Ayarlar'daki "Kur": Peeka'nın kendi Claude Code kancası (`peeka.exe --cc-hook`) settings.json'a birleştirilir; yalnız elle tıklanınca, demo kipinde `refused`. Hata nedeni `notch://notice` ile gelir. */
  claude_bridge_install: { args: void; ret: BridgeState };
  /** "Kaldır": yalnız Peeka'nın kendi girdileri gider. */
  claude_bridge_remove: { args: void; ret: BridgeState };
  permission_history: { args: void; ret: PermissionEvent[] };
  /** Ana asistan ilk bağlandı mı (hayatta bir kez); `first_connect_ack` ile söner. */
  first_connect_get: { args: void; ret: boolean };
  first_connect_ack: { args: void; ret: void };
  /** Raftaki dosya için ana asistanın önerisi; öneri yoksa (ya da 3 sn içinde gelmezse) null. */
  shelf_suggest: { args: { id: string }; ret: ShelfSuggestion | null };
  /** "Notlara ekle": raftaki dosyayı ana asistana verir (tek seferlik). */
  shelf_memory: { args: { id: string }; ret: void };
  /** "Başlat": Rust ana asistanın manifestindeki `launch` exe'sini açar (yalnız sahibin tıklamasıyla); ana asistan, `launch` ya da dosya yoksa `missing`. */
  assistant_start: { args: void; ret: void };
  /** Rust'ın `composer_submit`te kabul ettiği ek türleri. */
  composer_kinds: { args: void; ret: ComposerKind[] };
  /** "Terminali aç": satırın `session` kimliğiyle Claude Code'un terminal penceresini öne getirir. Hata: `unknown` | `not_connected` | `missing` | `refused` | `unsupported` (demo). */
  cc_focus_terminal: { args: { sessionId: string }; ret: void };
  /** Yönetici pencere menüsü ve uyarı düğmesi: Görev Yöneticisi'ni açar. */
  open_task_manager: { args: void; ret: void };
  /** Tab sırası pencereler arası: yalnız odak zaten bir Peeka penceresindeyken verilir (başka uygulamadan odak çalınmaz); aksi `refused`. Ada son denetimden çıkınca `monitor` şeridine. */
  focus_strip: { args: { monitor: string }; ret: void };
  /** Şerit Tab ile geri verince ada penceresine (tek, tüm ekranlar için) odak. */
  focus_island: { args: void; ret: void };
  /** Yazı yazılan panel (Ara, Sor kutusu) açılınca `on` true: pencere klavye odağını yalnız şimdi alabilir; kapanınca false: odak önceki uygulamaya geri verilir. `label` = "island" | "strip-<monitor>". Hata `unknown` (başka etiket/pencere yok) ya da `refused`. */
  typing_focus: { args: { label: string; on: boolean }; ret: void };
  /** Ekran görüntüsü al; iptal = null. */
  composer_scan: { args: void; ret: Attached | null };
  /** Dosya seçici; iptal = null. */
  composer_attach_file: { args: void; ret: Attached | null };
}
export type CommandName = keyof Commands;
// Rust'ın listesiyle (commands.generated.ts) birebir: biri eksik ya da fazlaysa tsc burada durur. Eklenti komut ve olayları
// (plugin-api.ts) da Rust'ta (Dalga 3), denetim ikisini birlikte kapsar.
type GeneratedName = (typeof COMMAND_NAMES)[number];
const _sameCommands: [Exclude<keyof AllCommands, GeneratedName>, Exclude<GeneratedName, keyof AllCommands>] extends [never, never] ? true : never = true;
void _sameCommands;
type GeneratedEvent = (typeof EVENT_NAMES)[number];
const _sameEvents: [Exclude<keyof AllEvents, GeneratedEvent>, Exclude<GeneratedEvent, keyof AllEvents>] extends [never, never] ? true : never = true;
void _sameEvents;
export type AllCommands = Commands & PluginCommands;
export type AllEvents = Events & PluginEvents;
type ArgsOf<K extends keyof AllCommands> = AllCommands[K]["args"];
export type CallArgs<K extends keyof AllCommands> = ArgsOf<K> extends void ? [] : [args: ArgsOf<K>];

/* ---------- olaylar: Rust emit adı = anahtar ---------- */
export interface Events {
  windows_changed: { monitor: string };
  pins_changed: null;
  status_changed: Status;
  settings_changed: Settings;
  /** Genel kısayol basıldı; `monitor` imlecin olduğu ekran, yalnız o ekranın şeridi tepki verir. */
  shortcut: { name: Exclude<ShortcutId, "emergency">; monitor: string };
  media_changed: Media | null;
  alerts_changed: AlertsView;
  sysmon_tick: SysmonTick;
  volume_osd: VolumeOsd;
  /** Şeritler tam ekran yüzünden gizli mi (Rust). */
  "notch://fullscreen": boolean;
  /** Rust'tan kısa düz metin bildirimi. */
  "notch://notice": string;
  /** Şeridin dışında fare basıldı (gerçek pencere): basılan şeridin monitörü, "" = şerit değil. */
  "notch://outside_press": string;
  /* Dalga 4 */
  clip_changed: ClipChange;
  lock_changed: LockState;
  /* Dalga 5 */
  /** Pil/şarj/bluetooth için ayrı olay yok: şarj ve düşük pil `status_changed`ten türer. */
  bluetooth_connected: BluetoothEvent;
  /** Kulaklık ayrıldı ve çalan müzik duraklatıldı ("Müzik durdu" + "Devam": `media_control` play_pause). `app`: çalar uygulama adı, bilinmiyorsa null. Müzik hoparlörden çalmaya devam ediyorsa gelmez. */
  music_stopped: MusicStopped;
  /** İşlemci en az 60 sn boyunca %95 ve üstünde kaldı (arka planda 15 sn'de bir tek ucuz okuma; ölçülen maliyet ~%0,001 çekirdek). `app`: en çok kullanan programın exe adı (".exe" yok), belli değilse null. 10 dk'da en çok bir kez. */
  cpu_high: CpuHigh;
  /** Tam ekran uygulamanın neyi gizlediği, monitör bazında (39): ikinci ekrandaki tam ekran video yalnız o ekranın şeridini gizler, ana ada susmaz. `island`: ada gizli mi (`notch://fullscreen` ile aynı değer); `strips`: gizlenen şeritlerin monitör numaraları. Şerit sayfası kendi monitörünü bu listeden okuyabilir. */
  fullscreen_screens: FullscreenScreens;
  /** Bir onay beklerken fare başka bir monitördeyse (40): o monitörün ikincil şeridinde "N onay" rozeti (ada penceresi yalnız birincil ekranda kalır; kartı o ekranda açmak bu olayda yok, arayüz işi). `null` = rozet yok. Şeridi olmayan ya da tam ekranla gizlenmiş monitörde gelmez. */
  approval_badge: ApprovalBadge | null;
  /** İndirilenler klasöründe yeni bir dosya bitti (boyutu iki bakışta aynı kaldı; .crdownload/.part/.tmp sayılmaz). Yol yok: `id` ile `download_open` / `download_show_in_folder`. `watchDownloads` kapalıyken ve kilitliyken gelmez. */
  download_done: DownloadDone;
  privacy_changed: PrivacyState;
  input_tick: InputTick;
  timer_changed: TimerState | null;
  shelf_changed: null;
  /** Sürüklenen dosya adaya geldi / gitti (Windows sürükleme olayı Rust'ta); açıkken raf çıkıntısı iki bırakma hedefini gösterir. */
  shelf_drag: boolean;
  notifications_changed: MirrorView;
  /* Sadakat 3 */
  island_hidden_changed: boolean;
  /** Pano sürüklemesi bitti (bırakıldı ya da vazgeçildi): kaynak küçük resim yeniden açılır. */
  clip_drag_end: null;
  /** Ana asistan ilk kez bağlandı. */
  first_connect: null;
  /** İş bitti (`celebrate` açıkken; şeritte maskot zıplar, saatte en çok 3). */
  job_done: { title: string; took: string; /** Süre sn olarak (2 dakika kuralı için); ana asistan göndermediyse null. */ seconds?: number | null };
  /** Ana asistanın çevrimdışı kipi. */
  assistant_offline: boolean;
  /** Toplantı var mı (ana asistan `meeting.set`): maskot muzipliği susar. */
  meeting_changed: boolean;
  /** Ana asistanın `cc.event`i: bir Claude Code kanca olayı (maskot halini sürer). `tool` araç adı, `reason` hata sınıfı; serbest metin yok. */
  cc_event: { kind: string; tool?: string | null; reason?: string | null; sid?: string | null };
}
export type EventName = keyof Events;

export interface Bridge {
  call<K extends keyof AllCommands>(cmd: K, ...args: CallArgs<K>): Promise<AllCommands[K]["ret"]>;
  on<E extends keyof AllEvents>(evt: E, cb: (payload: AllEvents[E]) => void): Promise<() => void>;
  /** Saat: gerçekte `new Date()`, sahtede önizleme için dondurulabilir. */
  now(): Date;
}

/* ---------- gerçek (Tauri) uygulaması ---------- */
const tauriBridge: Bridge = {
  async call(cmd, ...args) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke(cmd, args[0] as Record<string, unknown> | undefined) as never;
  },
  async on(evt, cb) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen(evt, (e) => cb(e.payload as never));
  },
  now: () => new Date(),
};

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const base: Bridge = inTauri ? tauriBridge : fakeBridge;
/** Demo kipinde `unsupported` dönen her komut için ada kısa uyarı çıkarır ("Demo kipinde yok"). */
export const UNSUPPORTED_EVENT = "notch-unsupported";
export const bridge: Bridge = {
  ...base,
  call: (cmd, ...args) => base.call(cmd, ...args).catch((e) => { if (e === "unsupported" && typeof window !== "undefined") window.dispatchEvent(new Event(UNSUPPORTED_EVENT)); throw e; }),
};
