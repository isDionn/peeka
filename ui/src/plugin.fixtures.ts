// Eklenti örnek verisi: sahte köprü, tarayıcı önizlemesi ve testler aynı kayıtları kullanır (maket durumları c1, c2, c2r, c3, j, eo, aye).
import type { ApprovalItem, CardBlock, ConsentRequest, MeterBlock, ModuleEntry, ModuleTab, PluginInfo, PluginRef, ProtrusionItem, SurfacesView } from "./plugin-api";

export const PUSULA: PluginRef = { id: "dev.example.pusula", name: "Pusula", main: true };
export const OTHER: PluginRef = { id: "com.example.asistan", name: "Örnek Asistan", main: false };

export const EMPTY_SURFACES: SurfacesView = { protrusion: null, approvals: [], approvalTop: null, dropStripMs: null, tabs: [], summary: [], composer: null };

export const APPROVAL_LOW: ApprovalItem = {
  plugin: PUSULA, id: "ap-1", source: "Claude Code", title: "api-sunucu izin istiyor", risk: "low", kind: "command",
  command: "npm run test -- --coverage", cwd: "~/projeler/api-sunucu", detail: "Opus, oturum kotasının %38'i",
  options: ["allow", "always", "deny"], alwaysLabel: "Bu klasörde npm test", expiresS: 300,
};
export const APPROVAL_HIGH: ApprovalItem = {
  ...APPROVAL_LOW, id: "ap-2", title: "api-sunucu yüksek riskli bir komut istiyor", risk: "high",
  command: "git push --force origin main", detail: "Uzak daldaki geçmişi siler, geri alınamaz.",
};
export const APPROVAL_CHOICE: ApprovalItem = {
  plugin: PUSULA, id: "ap-3", source: "Claude Code", title: "web-sitesi bir seçim bekliyor", risk: "low", kind: "plan",
  detail: "Header için hangi yol? Planı onaylarsan uygulamaya geçerim.", options: ["allow", "deny"],
  choices: [{ id: "genislet", label: "Var olan bileşeni genişlet" }, { id: "yeni", label: "Yeni bileşen yaz" }], freeText: true, expiresS: 600,
};

export const PROTRUSION: ProtrusionItem = {
  plugin: PUSULA, title: "Tasarım incelemesi", subtitle: "14:45, 13 dk sonra", icon: "calendar", state: "info", mascot: "hazir",
  actions: [{ id: "katil", label: "Katıl", style: "primary" }],
};

/** Maket dik / tik / kay: eklentiden gelen dikte, ticket ve kayıt çipleri (yalnız `live_text`, `timer`, düz alanlar). */
export const DIKTE: ProtrusionItem = { plugin: PUSULA, title: "Dikte", state: "info", mascot: "dinliyor", liveText: { streamId: "dikte-1" }, actions: [{ id: "bitir", label: "Bitir" }] };
export const TICKET: ProtrusionItem = { plugin: PUSULA, title: "Yeni ticket", subtitle: "Sırada 2 ticket", icon: "ticket", state: "attention", actions: [{ id: "ac", label: "Taslağı aç", style: "primary" }, { id: "sonra", label: "Sonra" }] };
export const KAYIT: ProtrusionItem = {
  plugin: PUSULA, title: "Kayıt", subtitle: "Tüm ekran, ses kapalı", state: "danger", timer: { startedAt: "2026-10-16T14:30:00Z" },
  actions: [{ id: "duraklat", label: "Duraklat" }, { id: "durdur", label: "Durdur", style: "destructive" }],
};

export const SURFACES_FULL: SurfacesView = {
  protrusion: null,
  approvals: [APPROVAL_LOW],
  approvalTop: "ap-1",
  dropStripMs: null,
  tabs: [
    { plugin: PUSULA, id: "pusula", title: "Pusula", icon: "ghost", blocks: [
      { type: "heading", text: "Masaüstünde çalışıyor" },
      { type: "list", rows: [{ title: "Faturaları klasöre taşıyor", sub: "adım 3/5", value: null }, { title: "3 not önerisi", sub: "Gözden geçir" }] },
      { type: "progress", label: "Adım 3/5", value: 0.6 },
      { type: "buttons", buttons: [{ id: "durdur", label: "Durdur", style: "destructive" }] },
    ] },
    { plugin: PUSULA, id: "claude", title: "Claude Code", icon: "terminal", blocks: [
      { type: "kv", rows: [{ k: "Oturum, 5 sa", v: "%38" }, { k: "Hafta", v: "%61" }] },
      { type: "text", text: "Bugün 1,2 M token, 84 cevap" },
    ] },
  ],
  summary: [{ plugin: PUSULA, rows: [{ title: "Masaüstünde çalışıyor", sub: "Faturaları klasöre taşıyor" }, { title: "Sırada 1 iş", value: "Ekip: 2 ajan" }] }],
  composer: { ...PUSULA, voice: true },
};

export const CONSENT: ConsentRequest = {
  requestId: "rq-1", plugin: { id: "dev.example.pusula", name: "Pusula", publisher: "Örnek", version: "2.1" },
  program: { path: "C:\\Program Files\\Pusula\\pusula.exe", signedBy: null },
  lookalike: "Pusula Core (bağlı eklenti)",
  scopes: ["island.protrusion", "approvals.prompt", "composer.handler", "windows.read"],
  why: {
    "island.protrusion": "Toplantı ve iş durumunu göstermek için", "approvals.prompt": "Claude Code izinleri için",
    "composer.handler": "Sohbet için", "windows.read": "Hangi uygulamada olduğunu anlamak için",
  },
  expiresAt: 0, // sahte köprü açılışta Date.now()+112 sn yazar (maketteki "1:52")
};

export const PLUGINS: PluginInfo[] = [
  {
    id: "dev.example.pusula", name: "Pusula", publisher: "Örnek", version: "2.1", connected: true, lastSeen: null, main: true, messages24h: 312, approvals24h: 4, lookalike: null, launch: "C:\Program Files\Pusula\pusula.exe",
    scopes: [
      { scope: "island.protrusion", granted: true, uses24h: 41 }, { scope: "approvals.prompt", granted: true, uses24h: 4 },
      { scope: "composer.handler", granted: true, uses24h: 12 }, { scope: "card.module", granted: true, uses24h: 255 }, { scope: "windows.read", granted: true, uses24h: 0 },
    ],
  },
  {
    id: "com.example.asistan", name: "Örnek Asistan", publisher: "Örnek", version: "1.2.0", connected: false, lastSeen: null, main: false, messages24h: 3, approvals24h: 0, lookalike: "Pusula", launch: null,
    scopes: [{ scope: "island.protrusion", granted: true, uses24h: 3 }, { scope: "card.module", granted: false, uses24h: 0 }],
  },
];

export const MODULES: ModuleEntry[] = [
  ["layout-grid", "Genel", 1, "Peeka"], ["music", "Müzik", 1, "Peeka"], ["clipboard", "Pano", 1, "Peeka"], ["inbox", "Raf", 1, "Peeka"], ["calendar", "Takvim", 1, "Peeka"],
  ["timer", "Zamanlayıcı", 1, "Peeka"], ["cpu", "Sistem", 1, "Peeka"], ["bell", "Bildirimler", 1, "Peeka"],
  ["ghost", "Pusula", 1, "Pusula eklentisi"], ["terminal", "Claude Code", 1, "Pusula eklentisi"], ["users", "Ekip", 1, "Pusula eklentisi"],
].map(([icon, title, on, owner]) => ({ id: String(title).toLocaleLowerCase("tr"), title: String(title), icon: String(icon), owner: String(owner), on: !!on }));

/* ---- örnek veri: maket c3, j, d1, d3 ---- */
const meter = (m: Omit<MeterBlock, "type">): CardBlock => ({ type: "meter", ...m }) as unknown as CardBlock;

/** c3: ilk seçenek önerilen (kartta önceden seçili). */
export const withRecommended = (a: ApprovalItem): ApprovalItem => ({ ...a, choices: (a.choices ?? []).map((c, i) => ({ ...c, recommended: i === 0 })) });

const CLAUDE_TAB = {
  plugin: PUSULA, id: "claude", title: "Claude Code", icon: "terminal", genel: true, blocks: [
    meter({ label: "Oturum, 5 sa", value: 0.38, text: "%38", note: "2 sa 14 dk sonra sıfırlanır" }),
    meter({ label: "Hafta", value: 0.61, text: "%61", note: "3 gün sonra sıfırlanır", mark: 0.8 }),
    { type: "text", text: "Bugün 1,2 M token, 84 cevap" },
    { type: "list", rows: [
      { title: "api-sunucu", sub: "izin bekliyor", state: "waiting" }, { title: "web-sitesi", sub: "Header.tsx düzenliyor", state: "running" }, { title: "veri-temizlik", sub: "bitti, 10 dk önce", state: "done" },
    ] },
  ],
} as ModuleTab;
/** j: Pusula | Claude Code | Sistem. Özet satırları maketteki sırayla (çalışıyor, not, sıra); onay satırı onay şemasından araya girer. */
export const SURFACES_J: SurfacesView = {
  protrusion: null, approvals: [{ plugin: PUSULA, id: "ap-j", source: "Claude Code", title: "Ekran kaydını Drive'a yükle", risk: "low", kind: "other", options: ["allow", "deny"], expiresS: null }], approvalTop: null, dropStripMs: null,
  tabs: [
    { plugin: PUSULA, id: "pusula", title: "Pusula", icon: "ghost", blocks: [{ type: "heading", text: "Masaüstünde çalışıyor" }, { type: "text", text: "Faturaları klasöre taşıyor, adım 3/5" }] },
    CLAUDE_TAB,
    { plugin: PUSULA, id: "ekip", title: "Ekip", icon: "users", blocks: [{ type: "text", text: "2 ajan çalışıyor, 1 iş sırada" }] },
  ],
  summary: [{ plugin: PUSULA, rows: [
    { title: "Masaüstünde çalışıyor", sub: "Faturaları klasöre taşıyor, adım 3/5", icon: "pointer", state: "attention", action: { id: "durdur", label: "Durdur", style: "destructive" } },
    { title: "3 not önerisi", value: "Gözden geçir", icon: "brain" },
    { title: "Sırada 1 iş", value: "Ekip: 2 ajan çalışıyor", icon: "list" },
  ] as unknown as SurfacesView["summary"][number]["rows"] }],
  composer: { ...PUSULA, voice: true },
};

/** d1 (düşünüyor) ve d3 (konuşuyor): çıkıntıda iki satırlı döküm; akış `plugin_stream` ile gelir (önizleme "Sen" ve "Pusula" satırlarını yayar). */
export const VOICE_THINKING = { plugin: PUSULA, title: "Düşünüyorum", state: "info", mascot: "dusunuyor", transcript: { streamId: "ses" } } as ProtrusionItem;
export const VOICE_SPEAKING = { plugin: PUSULA, title: "Konuşuyorum", state: "info", mascot: "konusuyor", transcript: { streamId: "ses" } } as ProtrusionItem;
export const VOICE_SEN = "Yarın sabahki toplantıyı hatırlat, notları da hazırla.";
export const VOICE_ASISTAN = "Tamam, 09:15'te hatırlatıyorum. Son üç toplantı notunu özetleyip yeni bir nota koydum.";
