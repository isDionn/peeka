/* =====================================================================================================================
 * EKLENTİ BLOĞU (Dalga 3, docs/eklenti-api.md). Rust'taki komut ve olaylar (commands.generated.ts) bunlarla
 * birebirdir; bridge.ts `AllCommands` / `AllEvents` üstünden denetler. Rust'ın verdiği ek alanlar (ör. `protrusionActions`) burada yok.
 * Eklenti yalnız veri gönderir; HTML, bağlantı ve simge gelmez. Kimlik (`plugin`) Peeka'nın kendi kaydından gelir, eklenti yükünden değil.
 * ================================================================================================================== */

/** Peeka'nın tuttuğu eklenti kimliği. `main` = sahibin seçtiği ana asistan (maskot yalnız ona açıktır). */
export interface PluginRef { id: string; name: string; main: boolean }
export type ButtonStyle = "default" | "primary" | "destructive";
export interface ActionDef { id: string; label: string; style?: ButtonStyle }
export type ProtrusionState = "idle" | "info" | "attention" | "done" | "danger" | "tired";
export interface ProtrusionItem {
  plugin: PluginRef; title: string; subtitle?: string | null; icon?: string | null; state: ProtrusionState; progress?: number | null;
  /** ISO zaman; sayacı Peeka sayar. */ timer?: { startedAt: string } | null; liveText?: { streamId: string } | null;
  /** Peeka'nın tablosundan hal adı; yalnız ana asistanda dikkate alınır. */ mascot?: string | null; actions?: ActionDef[];
}
export type CardBlock =
  | { type: "heading"; text: string }
  | { type: "text"; text: string }
  | { type: "list"; rows: { title: string; sub?: string | null; value?: string | null; state?: string | null }[] }
  | { type: "kv"; rows: { k: string; v: string }[] }
  | { type: "progress"; label?: string | null; value: number }
  | { type: "timer"; label?: string | null; startedAt: string }
  | { type: "buttons"; buttons: ActionDef[] }
  | { type: "image"; src: string };
export interface ModuleTab { plugin: PluginRef; id: string; title: string; icon?: string | null; blocks: CardBlock[] }
export interface SummaryRows { plugin: PluginRef; rows: { title: string; sub?: string | null; value?: string | null }[] }
export type ApprovalKind = "command" | "file" | "network" | "question" | "plan" | "other";
export type ApprovalOption = "allow" | "always" | "deny";
export interface ApprovalItem {
  plugin: PluginRef; id: string; source: string; title: string;
  /** `low` dışındaki her şey (alan yok, tanınmayan değer) yüksek sayılır; ayrıştırma arayüzde `riskOf`. */ risk?: unknown;
  kind: ApprovalKind; command?: string | null; cwd?: string | null; path?: string | null; detail?: string | null;
  options: ApprovalOption[]; alwaysLabel?: string | null; choices?: { id: string; label: string }[] | null; freeText?: boolean; /** Ana asistan dışındaki eklentinin yazı kutusunda Rust koyar: kutunun üstünde parola uyarısı. */ freeTextWarning?: boolean; expiresS?: number | null;
}
/** Eklentilerin ekrandaki hali (Rust birleştirir; dikkat bütçesi ve hız sınırı Rust'ta). */
export interface SurfacesView {
  protrusion: ProtrusionItem | null;
  approvals: ApprovalItem[];
  /** Çıkıntıda şimdi görünebilen onayın kimliği (en çok biri). */ approvalTop: string | null;
  /** Tam ekranda onay şeridinin ineceği süre (ms); null = inmez. */ dropStripMs: number | null;
  tabs: ModuleTab[]; summary: SummaryRows[];
  /** Ctrl+Space'in sahibi (composer.handler); yoksa null. `voice` = aynı eklenti voice.line'a da sahip. */ composer: (PluginRef & { voice: boolean }) | null;
}
export type ComposerAttachment = { kind: "window_image" | "clipboard_link" };
export interface ComposerEvent { turn: number; kind: "delta" | "chip" | "done" | "error"; text?: string; label?: string; chipKind?: "source" | "reminder" | "note"; message?: string }
export type Decision = "allow" | "always" | "deny" | "choice";
/** Onay penceresi isteği. Eklentiden yalnız ad, yayıncı, sürüm, kimlik ve `why` düz metin alınır; kapsam açıklamalarını ve düzeylerini Peeka kendi tablosundan yazar. */
export interface ConsentRequest {
  requestId: string; plugin: { id: string; name: string; publisher: string; version: string };
  program: { path: string; /** İmzalayan; null = imzasız. */ signedBy: string | null };
  /** Benzer olduğu eklenti ya da ayrılmış ad. */ lookalike: string | null;
  scopes: string[]; why: Record<string, string>; /** Unix ms. */ expiresAt: number;
}
export interface ConsentAnswer { requestId: string; allow: boolean; scopes: string[]; mainAssistant: boolean; never: boolean }
export interface PluginScopeState { scope: string; granted: boolean; /** Son 24 saat. */ uses24h: number }
export interface PluginInfo {
  id: string; name: string; publisher: string; version: string; connected: boolean; /** Unix ms. */ lastSeen: number | null; main: boolean;
  messages24h: number; approvals24h: number; scopes: PluginScopeState[]; lookalike: string | null;
  /** Ana asistanken "Başlat"ın açacağı exe (manifest `launch`), yoksa null. */ launch: string | null;
}
export interface ModuleEntry { id: string; title: string; icon: string; owner: string; on: boolean }

export interface PluginCommands {
  plugin_surfaces: { args: void; ret: SurfacesView };
  plugin_action: { args: { pluginId: string; actionId: string }; ret: void };
  /** `surface: "protrusion"` = tıklama çıkıntıdan; yüksek riskte Rust orada her kararı reddeder (yalnız "Ayrıntı"). Yoksa kart sayılır. */
  approval_answer: { args: { pluginId: string; id: string; decision: Decision; choiceId?: string; text?: string; surface?: "protrusion" | "card" }; ret: void };
  composer_submit: { args: { text: string; attachments: ComposerAttachment[] }; ret: { turn: number } };
  composer_voice: { args: void; ret: void };
  consent_get: { args: void; ret: ConsentRequest | null };
  consent_answer: { args: ConsentAnswer; ret: void };
  plugin_list: { args: void; ret: PluginInfo[] };
  plugin_set_scope: { args: { id: string; scope: string; on: boolean }; ret: void };
  plugin_set_main: { args: { id: string | null }; ret: void };
  plugin_disconnect: { args: { id: string }; ret: void };
  plugin_remove: { args: { id: string }; ret: void };
  modules_get: { args: void; ret: ModuleEntry[] };
  modules_set: { args: { order: string[]; off: string[] }; ret: void };
}
export interface PluginEvents {
  plugin_surfaces_changed: SurfacesView;
  plugins_changed: null;
  /** Akış parçası (Rust 50 ms'de birleştirir): `live_text` için. */
  plugin_stream: { streamId: string; text: string; /** `voice.transcript` satırını kimin söylediği (ör. "Sen"); yoksa etiket çıkmaz. */ speaker?: string };
  composer_event: ComposerEvent;
  consent_changed: null;
}
export const PLUGIN_COMMAND_NAMES = [
  "plugin_surfaces", "plugin_action", "approval_answer", "composer_submit", "composer_voice", "consent_get", "consent_answer",
  "plugin_list", "plugin_set_scope", "plugin_set_main", "plugin_disconnect", "plugin_remove", "modules_get", "modules_set",
] as const satisfies readonly (keyof PluginCommands)[];
export const PLUGIN_EVENT_NAMES = ["plugin_surfaces_changed", "plugins_changed", "plugin_stream", "composer_event", "consent_changed"] as const satisfies readonly (keyof PluginEvents)[];
// Ad listeleri arayüzlerle birebir: biri eksik ya da fazlaysa tsc burada durur.
const _cmds: Exclude<keyof PluginCommands, (typeof PLUGIN_COMMAND_NAMES)[number]> extends never ? true : never = true;
const _evts: Exclude<keyof PluginEvents, (typeof PLUGIN_EVENT_NAMES)[number]> extends never ? true : never = true;
void _cmds; void _evts;

/* ---- eklenti verisine isteğe bağlı alanlar (plugin-api.ts tipleri değişmez; arayüz bu alanları savunmacı okur) ---- */
/** A: onay `choices[].recommended` (öncelikli seçenek, kartta önceden seçili + "önerilen"), onay `shortTitle` (çıkıntı başlığı). */
export interface ChoiceExt { recommended?: boolean }
export interface ApprovalExt { shortTitle?: string | null }
/** A: çıkıntıda iki satırlı canlı döküm (`plugin_stream`, `speaker` = "Sen" | eklenti adı). `liveText` aynen çalışır (tek satır). */
export interface ProtrusionExt { transcript?: { streamId: string } | null; /** Şeritte başlığın yanında soluk kısa not (ör. "taslak hazır"); ticket simgesinde varsayılan o. */ note?: string | null }
/** A: "Genel" sayfasına da giren sekme (Claude Code kutusu). */
export interface TabExt { genel?: boolean }
/** A: Genel özet satırı: simge adı (izinli kümeden), durum, tek eylem (ör. Durdur). */
export interface SummaryRowExt { icon?: string | null; state?: string | null; action?: ActionDef | null; /** Claude Code oturum kimliği: satırda "Terminali aç" çıkar. */ session?: string | null }
/** Liste bloğu satırının isteğe bağlı oturum kimliği. */
export interface RowExt { session?: string | null }
/** A: kota çubuğu bloğu: `value` 0..1, `mark` eşik çizgisi 0..1, `note` sıfırlanma metni. */
export interface MeterBlock { type: "meter"; label: string; value: number; text?: string | null; note?: string | null; mark?: number | null }
