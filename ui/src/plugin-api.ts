/* =====================================================================================================================
 * PLUGIN BLOCK (Wave 3, docs/plugin-api.md). The Rust commands and events (commands.generated.ts) match these
 * exactly; bridge.ts checks via `AllCommands` / `AllEvents`. Extra fields Rust sends (e.g. `protrusionActions`) aren't listed here.
 * A plugin sends data only; no HTML, links or icons. The identity (`plugin`) comes from Peeka's own registry, not the plugin payload.
 * ================================================================================================================== */

/** Plugin identity kept by Peeka. `main` = the main assistant the owner chose (only it gets the mascot). */
export interface PluginRef { id: string; name: string; main: boolean }
export type ButtonStyle = "default" | "primary" | "destructive";
export interface ActionDef { id: string; label: string; style?: ButtonStyle }
export type ProtrusionState = "idle" | "info" | "attention" | "done" | "danger" | "tired";
export interface ProtrusionItem {
  plugin: PluginRef; title: string; subtitle?: string | null; icon?: string | null; state: ProtrusionState; progress?: number | null;
  /** ISO time; Peeka runs the counter. */ timer?: { startedAt: string } | null; liveText?: { streamId: string } | null;
  /** State name from Peeka's table; honored only for the main assistant. */ mascot?: string | null; actions?: ActionDef[];
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
  /** Anything but `low` (missing field, unknown value) counts as high; parsed in the UI by `riskOf`. */ risk?: unknown;
  kind: ApprovalKind; command?: string | null; cwd?: string | null; path?: string | null; detail?: string | null;
  options: ApprovalOption[]; alwaysLabel?: string | null; choices?: { id: string; label: string }[] | null; freeText?: boolean; /** Set by Rust on a non-main-assistant plugin's text box: a password warning above the box. */ freeTextWarning?: boolean; expiresS?: number | null;
}
/** What plugins show on screen (Rust merges it; the attention budget and rate limit live in Rust). */
export interface SurfacesView {
  protrusion: ProtrusionItem | null;
  approvals: ApprovalItem[];
  /** Id of the approval that may show on the peek now (at most one). */ approvalTop: string | null;
  /** How long the approval strip drops down in fullscreen (ms); null = it doesn't. */ dropStripMs: number | null;
  tabs: ModuleTab[]; summary: SummaryRows[];
  /** Owner of Ctrl+Space (composer.handler); null if none. `voice` = the same plugin also holds voice.line. */ composer: (PluginRef & { voice: boolean }) | null;
}
export type ComposerAttachment = { kind: "window_image" | "clipboard_link" };
export interface ComposerEvent { turn: number; kind: "delta" | "chip" | "done" | "error"; text?: string; label?: string; chipKind?: "source" | "reminder" | "note"; message?: string }
export type Decision = "allow" | "always" | "deny" | "choice";
/** Consent window request. Only name, publisher, version, id and plain-text `why` come from the plugin; Peeka writes scope descriptions and levels from its own table. */
export interface ConsentRequest {
  requestId: string; plugin: { id: string; name: string; publisher: string; version: string };
  program: { path: string; /** Signer; null = unsigned. */ signedBy: string | null };
  /** The plugin or reserved name it resembles. */ lookalike: string | null;
  scopes: string[]; why: Record<string, string>; /** Unix ms. */ expiresAt: number;
}
export interface ConsentAnswer { requestId: string; allow: boolean; scopes: string[]; mainAssistant: boolean; never: boolean }
export interface PluginScopeState { scope: string; granted: boolean; /** Last 24 hours. */ uses24h: number }
export interface PluginInfo {
  id: string; name: string; publisher: string; version: string; connected: boolean; /** Unix ms. */ lastSeen: number | null; main: boolean;
  messages24h: number; approvals24h: number; scopes: PluginScopeState[]; lookalike: string | null;
  /** As main assistant, the exe "Launch" opens (manifest `launch`), or null. */ launch: string | null;
}
export interface ModuleEntry { id: string; title: string; icon: string; owner: string; on: boolean }

export interface PluginCommands {
  plugin_surfaces: { args: void; ret: SurfacesView };
  plugin_action: { args: { pluginId: string; actionId: string }; ret: void };
  /** `surface: "protrusion"` = the click came from the peek; at high risk Rust refuses every decision there (only "Details"). Otherwise it counts as the card. */
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
  /** Stream chunk (Rust merges every 50 ms): for `live_text`. */
  plugin_stream: { streamId: string; text: string; /** Who said the `voice.transcript` line (e.g. "You"); no label if absent. */ speaker?: string };
  composer_event: ComposerEvent;
  consent_changed: null;
}
export const PLUGIN_COMMAND_NAMES = [
  "plugin_surfaces", "plugin_action", "approval_answer", "composer_submit", "composer_voice", "consent_get", "consent_answer",
  "plugin_list", "plugin_set_scope", "plugin_set_main", "plugin_disconnect", "plugin_remove", "modules_get", "modules_set",
] as const satisfies readonly (keyof PluginCommands)[];
export const PLUGIN_EVENT_NAMES = ["plugin_surfaces_changed", "plugins_changed", "plugin_stream", "composer_event", "consent_changed"] as const satisfies readonly (keyof PluginEvents)[];
// The name lists match the interfaces exactly: tsc stops here if one is missing or extra.
const _cmds: Exclude<keyof PluginCommands, (typeof PLUGIN_COMMAND_NAMES)[number]> extends never ? true : never = true;
const _evts: Exclude<keyof PluginEvents, (typeof PLUGIN_EVENT_NAMES)[number]> extends never ? true : never = true;
void _cmds; void _evts;

/* ---- optional fields on plugin data (the plugin-api.ts types don't change; the UI reads these defensively) ---- */
/** A: approval `choices[].recommended` (preferred choice, preselected on the card + "recommended"), approval `shortTitle` (peek title). */
export interface ChoiceExt { recommended?: boolean }
export interface ApprovalExt { shortTitle?: string | null }
/** A: two-line live transcript on the peek (`plugin_stream`, `speaker` = "You" | plugin name). `liveText` still works (one line). */
export interface ProtrusionExt { transcript?: { streamId: string } | null; /** Short dim note beside the title on the strip (e.g. "draft ready"); the default for the ticket icon. */ note?: string | null }
/** A: a tab that also goes onto the "General" page (Claude Code box). `general` is the plugin wire field name. */
export interface TabExt { general?: boolean }
/** A: General summary row: icon name (from the allowed set), state, one action (e.g. Stop). */
export interface SummaryRowExt { icon?: string | null; state?: string | null; action?: ActionDef | null; /** Claude Code session id: the row gets "Open terminal". */ session?: string | null }
/** Optional session id on a list block row. */
export interface RowExt { session?: string | null }
/** A: quota bar block: `value` 0..1, `mark` threshold line 0..1, `note` reset text. */
export interface MeterBlock { type: "meter"; label: string; value: number; text?: string | null; note?: string | null; mark?: number | null }
