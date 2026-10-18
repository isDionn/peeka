//! The plugin host: one state for every connection, the pending consent, the plugins' items and the owner's
//! commands. Pure: the caller passes bytes and Unix ms in and runs the [`Out`]s it gets back (send a line, close a
//! connection, emit a UI event, touch the alert list). `crates/notch-app/src/plugins.rs` is that caller; the tests here are.
//!
//! Every method of a connected plugin is checked against the registry at the moment of the call, so turning a scope
//! off or removing a plugin in Settings takes effect on its very next message.

use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::consent::{Answer, Client, Consent, ConsentView};
use super::items::{self, Approval, Module, Opt, PluginRef, Protrusion, Risk, SummaryRow, Tab, Who};
use super::limits::{self, Batch, Coalescer, StreamKey, Window};
use super::registry::{self, Record, Registry};
use super::{code, manifest, names, share, Scope, API_VERSION, GUARD_MS, MAX_CARD_MESSAGE, MAX_MESSAGE, MAX_SUBMIT};
use crate::alerts::{Alert, Attention, Kind};
use crate::lock::{Lock, LockState, Reason};
use crate::presence;

mod assistant;
mod demo;
pub use assistant::{AssistantCounts, BridgeState, CalendarEntry, CalendarNext, OpenKind};

pub type ConnId = u64;

const PAIRING_MAX: usize = 3;
/// Across all ids and exes (L-3): a plugin cycling fresh ids from copies of itself still gets no consent stream.
const PAIRING_MAX_ALL: usize = 6;
const PAIRING_WINDOW_MS: u64 = 600_000;
const MAX_APPROVALS: usize = 20;
const MAX_ALERTS: usize = 20;
const MAX_ATTACHMENTS: usize = 10;
const MAX_COMPOSER_TEXT: usize = 16_000;
/// A `composer.submit` attachment's inline text: at most this per attachment, and all inlined copies together.
const INLINE_MAX: usize = 256 * 1024;
const INLINE_BUDGET: usize = 256 * 1024;
const APPROVAL_PRIORITY: u8 = 90;
const BUSY_RETRY_S: u64 = 30;
const SWEEP_MS: u64 = 60_000;
const STREAM_METHODS: [&str; 3] = ["composer.delta", "voice.transcript", "live_text.append"];
/// Known methods whose source comes in a later wave: the scope is checked, then "not yet".
const LATER: [&str; 4] = ["media.read", "windows.read", "notifications.post", "notifications.read"];
/// `search.results`: at most this many rows per plugin and query.
const SEARCH_MAX: usize = 8;

/// What the UI hears about; `crates/notch-app` turns each into its `emit("…")` (names: `notch/ui/src/plugin-api.ts`).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum UiEvent {
    /// `plugins_changed` (null): the page calls `plugin_list` again.
    PluginsChanged,
    /// `consent_changed` (null): the page calls `consent_get` (None = no window).
    ConsentChanged,
    /// `plugin_surfaces_changed`: payload = `Host::surfaces_view` (built by the caller, it needs the alert list).
    SurfacesChanged,
    /// `composer_event`.
    Composer(ComposerEvent),
    /// `plugin_stream`.
    Stream(StreamPiece),
    /// `lock_changed` (`LockState`): Notch's own lock changed.
    LockChanged(LockState),
    /// `assistant_offline` (bool): the main assistant's offline mode.
    AssistantOffline(bool),
    /// `meeting_changed` (bool): the main assistant's `meeting.set`; the caller also sets `Attention.meeting`.
    Meeting(bool),
    /// `job_done` (`{title, took, seconds}`), only while Settings' `celebrate` is on (the caller checks).
    JobDone { title: String, took: String, seconds: Option<u64> },
    /// `first_connect` (null): a main assistant reached Notch for the first time ever.
    FirstConnect,
    /// `cc_event` (`{agent, kind, tool, reason, sid}`): the main assistant's `cc.event` or Peeka's own hook, one coding
    /// agent's hook event for the mascot; `agent` is one of `cc_hooks::AGENT_IDS` (absent on the wire = `claude`).
    CcEvent { agent: String, kind: String, tool: Option<String>, reason: Option<String>, sid: Option<String> },
    /// `cc_edit` (`{sid, file, add, del}`): an Edit/Write inside the session cwd, from Peeka's own hook only. `file` is
    /// relative to the cwd; the app strips it while locked or presenting.
    CcEdit { sid: Option<String>, file: String, add: u32, del: u32 },
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum Out {
    Send(ConnId, String),
    Close(ConnId),
    Ui(UiEvent),
    /// Into Notch's alert list: `system` = `put_system` (approvals, 70+), else `put` (0-69).
    AlertPut {
        alert: Alert,
        system: bool,
    },
    AlertRemove(String),
    /// Every alert whose `source` is this.
    AlertClear(String),
    /// A consent is waiting: open the window (when not fullscreen; the tick retries).
    ConsentOpen,
    ConsentClose,
    /// Only plugin id, method and result code; at most one a minute per connection.
    Log(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComposerKind {
    Delta,
    Chip,
    Done,
    Error,
}

/// plugin-api.ts `ComposerEvent`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerEvent {
    pub turn: u64,
    pub kind: ComposerKind,
    /// delta: the merged text since the last delta.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// chip
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// chip: source|reminder|note
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chip_kind: Option<String>,
    /// error
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// The turn hit 64 KB; the rest was cut.
    pub truncated: bool,
}

impl ComposerEvent {
    fn new(turn: u64, kind: ComposerKind) -> Self {
        Self { turn, kind, text: None, label: None, chip_kind: None, message: None, truncated: false }
    }
}

/// plugin-api.ts `plugin_stream`: a merged piece of `live_text` / `voice.transcript`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamPiece {
    /// "<plugin id>:<stream id>" (= `ProtrusionItem.liveText.streamId`).
    pub stream_id: String,
    /// Appended since the last piece (the page glues them).
    pub text: String,
    pub truncated: bool,
    /// The stream ended.
    pub done: bool,
    /// `voice.transcript`'s `speaker` (e.g. "You"), passed through; none = no label.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceView {
    pub plugin_id: String,
    /// idle|listening|speaking|thinking
    pub state: String,
}

/// plugin-api.ts `composer`: Ctrl+Space's owner.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ComposerOwner {
    #[serde(flatten)]
    pub plugin: PluginRef,
    /// The same plugin also holds `voice.line` ("Sesle sor").
    pub voice: bool,
}

/// plugin-api.ts `SummaryRows`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SummaryRows {
    pub plugin: PluginRef,
    pub rows: Vec<SummaryRow>,
}

/// plugin-api.ts `SurfacesView`: what the island, the approvals and the Modules card draw.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfacesView {
    /// At most one plugin protrusion (the main assistant's first), None while the attention budget says quiet.
    pub protrusion: Option<Protrusion>,
    pub approvals: Vec<Approval>,
    /// The approval the alert list's attention budget lets open the island now (at most one).
    pub approval_top: Option<String>,
    /// Over a fullscreen app the strip comes down this long for `approval_top`; None = it does not.
    pub drop_strip_ms: Option<u64>,
    /// Plugin tabs, in the owner's Modules order, without the ones turned off.
    pub tabs: Vec<Tab>,
    pub summary: Vec<SummaryRows>,
    pub composer: Option<ComposerOwner>,
    /// Extra (not in plugin-api.ts yet): protrusions waiting behind the shown one, the voice line, `lock.signal`.
    pub waiting: usize,
    pub voice: Option<VoiceView>,
    pub locked: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeState {
    pub scope: Scope,
    /// Granted and not turned off.
    pub granted: bool,
    pub uses_24h: u32,
}

/// plugin-api.ts `PluginInfo` (Settings › Plugins): counts only, never content.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub publisher: String,
    pub version: String,
    pub connected: bool,
    pub last_seen: Option<u64>,
    pub main: bool,
    pub messages_24h: u32,
    pub approvals_24h: u32,
    pub scopes: Vec<ScopeState>,
    /// The paired plugin or reserved name this one looks like.
    pub lookalike: Option<String>,
    /// The exe "Launch" runs while this plugin is the main assistant (shown so the owner sees what it is).
    pub launch: Option<String>,
}

/// plugin-api.ts `ModuleEntry`: a Modules card tab (Notch's own or a plugin's) in Settings › Modules.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ModuleEntry {
    pub id: String,
    pub title: String,
    pub icon: String,
    pub owner: String,
    pub on: bool,
}

/// Notch's own Modules tabs (id, title, icon). The ids are wire names (saved settings and UI; registry.rs maps the old
/// Turkish ids on load); plugin tabs are "<plugin id>/<tab id>".
pub const CORE_MODULES: [(&str, &str, &str); 8] = [
    ("general", "General", "layout-grid"),
    ("music", "Music", "music"),
    ("clipboard", "Clipboard", "clipboard"),
    ("shelf", "Shelf", "inbox"),
    ("calendar", "Calendar", "calendar"),
    ("timer", "Timer", "timer"),
    ("system", "System", "cpu"),
    ("notifications", "Notifications", "bell"),
];

/// A clipboard item as `clipboard.read` would return it. shortcut: no source yet (Wave 4 fills `Host::clipboard`); the
/// password filter below is what the API promises and is tested now.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ClipItem {
    pub kind: String,
    pub text: Option<String>,
    pub path: Option<String>,
    /// Password class: never leaves through any scope.
    #[serde(skip)]
    pub password: bool,
}

pub fn clip_visible(items: &[ClipItem]) -> Vec<ClipItem> {
    items.iter().filter(|i| !i.password).cloned().collect()
}

/// The owner's command could not be done.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OwnerErr {
    Unknown,
    /// Within 300 ms of display: ignored, the prompt stays.
    Ignored,
    Invalid,
    /// No main assistant connected (the UI says "Assistant not connected").
    NoMain,
    Io,
    /// The main assistant has not sent this yet.
    NotYet,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttachKind {
    Screenshot,
    File,
    Clip,
    WindowImage,
    Rack,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct Attachment {
    pub kind: AttachKind,
    pub path: Option<String>,
    pub text: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Surface {
    Protrusion,
    Card,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Allow,
    Always,
    Deny,
    Choice,
}

#[derive(Debug, PartialEq, Eq)]
enum Phase {
    New,
    Waiting,
    Ready(String),
}

#[derive(Debug)]
struct Conn {
    phase: Phase,
    client: Client,
    control: Window,
    stream: Window,
    opens: Window,
    logged_at: Option<u64>,
}

#[derive(Debug, Default)]
struct Usage([(u64, u32); 24]);

impl Usage {
    fn hit(&mut self, now: u64) {
        let h = now / 3_600_000;
        let slot = &mut self.0[(h % 24) as usize];
        if slot.0 != h {
            *slot = (h, 0);
        }
        slot.1 += 1;
    }

    fn last_24h(&self, now: u64) -> u32 {
        let h = now / 3_600_000;
        self.0.iter().filter(|(t, _)| h.saturating_sub(*t) < 24).map(|(_, n)| n).sum()
    }
}

struct RpcErr {
    code: i64,
    message: String,
    data: Option<Value>,
    close: bool,
}

fn fail(code: i64, message: impl Into<String>) -> RpcErr {
    RpcErr { code, message: message.into(), data: None, close: false }
}

fn retry(code: i64, message: &str, seconds: u64) -> RpcErr {
    RpcErr { code, message: message.into(), data: Some(json!({ "retry_after": seconds })), close: false }
}

fn closing(mut e: RpcErr) -> RpcErr {
    e.close = true;
    e
}

fn result_line(id: &Value, result: Value) -> String {
    json!({"jsonrpc": "2.0", "id": id, "result": result}).to_string()
}

fn error_line(id: &Value, e: &RpcErr) -> String {
    let mut err = json!({"code": e.code, "message": e.message});
    if let Some(d) = &e.data {
        err["data"] = d.clone();
    }
    json!({"jsonrpc": "2.0", "id": id, "error": err}).to_string()
}

pub fn notification(method: &str, params: Value) -> String {
    json!({"jsonrpc": "2.0", "method": method, "params": params}).to_string()
}

/// Which scope a method needs. None = no such method; Some(None) = any authenticated plugin.
fn scope_of(method: &str) -> Option<Option<Scope>> {
    Some(Some(match method {
        "ping" | "share.done" => return Some(None),
        "island.protrusion.set" | "island.protrusion.clear" | "live_text.append" => Scope::IslandProtrusion,
        "card.module.set" | "card.module.clear" => Scope::CardModule,
        "alerts.post" | "alerts.remove" => Scope::AlertsPost,
        "approvals.prompt" | "approvals.cancel" => Scope::ApprovalsPrompt,
        "composer.delta" | "composer.chip" | "composer.done" | "composer.error" => Scope::ComposerHandler,
        "voice.line" | "voice.transcript" => Scope::VoiceLine,
        "lock.signal" => Scope::LockSignal,
        "clipboard.read" => Scope::ClipboardRead,
        "media.read" => Scope::MediaRead,
        "windows.read" => Scope::WindowsRead,
        "notifications.post" => Scope::NotificationsPost,
        "notifications.read" => Scope::NotificationsRead,
        "search.results" => Scope::SearchProvider,
        m => return assistant::METHODS.iter().find(|(n, _)| *n == m).map(|&(_, s)| Some(s)),
    }))
}

struct Turn {
    plugin: String,
}

pub struct Host {
    data_dir: PathBuf,
    /// False in demo mode (`Host::demo`): `plugins.json` and the share folder are never written.
    persist: bool,
    pub reg: Registry,
    conns: HashMap<ConnId, Conn>,
    consent: Option<Consent>,
    /// (time, plugin id, exe path) of recent pairing requests.
    pairings: VecDeque<(u64, String, Option<String>)>,
    next_request: u64,
    protrusions: BTreeMap<String, Protrusion>,
    modules: BTreeMap<String, Module>,
    approvals: BTreeMap<(String, String), Approval>,
    alert_ids: HashMap<String, BTreeSet<String>>,
    turns: HashMap<u64, Turn>,
    next_turn: u64,
    streams: Coalescer,
    /// The last `speaker` per live stream (`voice.transcript`).
    speakers: HashMap<StreamKey, String>,
    usage: HashMap<(String, Scope), Usage>,
    /// Every message per plugin (Settings › Plugins shows the count).
    messages: HashMap<String, Usage>,
    voice: Option<VoiceView>,
    lock: Lock,
    last_sweep: u64,
    /// The clipboard's plugin view (`clip::ClipHistory::plugin_items`, never a password item), refreshed on every change.
    pub clipboard: Vec<ClipItem>,
    /// The Ctrl+K query the plugins were last asked (`search.query`) and what they answered.
    search_req: u64,
    search_hits: Vec<SearchHit>,
    assistant: assistant::AssistantState,
}

/// One `search.provider` row (`wave4-api.ts` `SearchResult` with `kind: "plugin"`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SearchHit {
    pub plugin: PluginRef,
    pub group: Option<String>,
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
}

pub fn approval_alert_id(plugin: &str, id: &str) -> String {
    format!("approval:{plugin}:{id}")
}

fn source(plugin: &str) -> String {
    format!("plugin:{plugin}")
}

impl Host {
    /// Loads `plugins.json` from `data_dir`.
    pub fn new(data_dir: PathBuf) -> Self {
        let reg = registry::load(&registry::path(&data_dir));
        Self::with(data_dir, reg, true)
    }

    fn with(data_dir: PathBuf, reg: Registry, persist: bool) -> Self {
        Self {
            data_dir,
            persist,
            reg,
            conns: HashMap::new(),
            consent: None,
            pairings: VecDeque::new(),
            next_request: 0,
            protrusions: BTreeMap::new(),
            modules: BTreeMap::new(),
            approvals: BTreeMap::new(),
            alert_ids: HashMap::new(),
            turns: HashMap::new(),
            next_turn: 0,
            streams: Coalescer::default(),
            speakers: HashMap::new(),
            usage: HashMap::new(),
            messages: HashMap::new(),
            voice: None,
            lock: Lock::default(),
            last_sweep: 0,
            clipboard: vec![],
            search_req: 0,
            search_hits: vec![],
            assistant: assistant::AssistantState::default(),
        }
    }

    fn save(&self, out: &mut Vec<Out>) {
        if self.persist && registry::save(&registry::path(&self.data_dir), &self.reg).is_err() {
            out.push(Out::Log("could not write the plugin registry (plugins.json)".into()));
        }
    }

    pub fn connect(&mut self, conn: ConnId, client: Client) {
        let c = Conn {
            phase: Phase::New,
            client,
            control: Window::default(),
            stream: Window::default(),
            opens: Window::default(),
            logged_at: None,
        };
        self.conns.insert(conn, c);
    }

    fn ready_conns(&self, plugin: &str) -> Vec<ConnId> {
        let mut v: Vec<ConnId> =
            self.conns.iter().filter(|(_, c)| c.phase == Phase::Ready(plugin.into())).map(|(k, _)| *k).collect();
        v.sort_unstable();
        v
    }

    fn conn_of(&self, plugin: &str) -> Option<ConnId> {
        self.ready_conns(plugin).into_iter().next()
    }

    /// At most one log line per connection per minute (a chatty plugin cannot flood the log).
    fn log(&mut self, conn: ConnId, now: u64, line: impl FnOnce() -> String, out: &mut Vec<Out>) {
        let Some(c) = self.conns.get_mut(&conn) else { return };
        if c.logged_at.is_none_or(|t| now.saturating_sub(t) >= 60_000) {
            c.logged_at = Some(now);
            out.push(Out::Log(line()));
        }
    }

    /// One NDJSON line from `conn` (without the newline).
    pub fn line(&mut self, conn: ConnId, raw: &[u8], now: u64) -> Vec<Out> {
        let mut out = vec![];
        if !self.conns.contains_key(&conn) {
            return out;
        }
        if raw.len() > MAX_CARD_MESSAGE {
            out.push(Out::Send(conn, error_line(&Value::Null, &fail(code::TOO_LARGE, "message exceeds 256 KB"))));
            out.push(Out::Close(conn));
            return out;
        }
        let Ok(msg) = serde_json::from_slice::<Value>(raw) else {
            out.push(Out::Send(conn, error_line(&Value::Null, &fail(code::PARSE, "not JSON"))));
            return out;
        };
        let id = msg.get("id").cloned();
        let rid = id.clone().unwrap_or(Value::Null);
        let method = msg.get("method").and_then(Value::as_str).map(str::to_string);
        let id_ok = id.as_ref().is_none_or(|i| i.is_string() || i.is_i64() || i.is_u64());
        let (Some(method), true, true) = (method, msg.get("jsonrpc") == Some(&json!("2.0")), id_ok) else {
            out.push(Out::Send(conn, error_line(&rid, &fail(code::INVALID_REQUEST, "not a JSON-RPC 2.0 request"))));
            return out;
        };
        let plugin = match &self.conns[&conn].phase {
            Phase::Ready(p) => p.clone(),
            _ => "-".into(),
        };
        let res = if raw.len() > MAX_MESSAGE && method != "card.module.set" {
            Err(fail(code::TOO_LARGE, "message exceeds 64 KB (only card.module.set may be 256 KB)"))
        } else {
            self.limit(conn, &method, now).and_then(|()| {
                let params = msg.get("params").cloned().unwrap_or(Value::Null);
                self.dispatch(conn, &method, &params, &rid, now, &mut out)
            })
        };
        match res {
            Ok(Some(result)) => {
                if id.is_some() {
                    out.push(Out::Send(conn, result_line(&rid, result)));
                }
            }
            Ok(None) => {}
            Err(e) => {
                // The plugin's own string never reaches the log (newlines, 64 KB): a known method name or "?".
                let shown = if scope_of(&method).is_some() || matches!(method.as_str(), "hello" | "auth") {
                    method.as_str()
                } else {
                    "?"
                };
                self.log(conn, now, || format!("plugin {plugin} {shown} -> {}", e.code), &mut out);
                if id.is_some() || e.close {
                    out.push(Out::Send(conn, error_line(&rid, &e)));
                }
                if e.close {
                    out.push(Out::Close(conn));
                }
            }
        }
        out
    }

    /// Control and stream messages in separate buckets. A stream message over 40/s is still taken:
    /// it is merged into the same 50 ms batch.
    fn limit(&mut self, conn: ConnId, method: &str, now: u64) -> Result<(), RpcErr> {
        let c = self.conns.get_mut(&conn).ok_or_else(|| fail(code::UNAUTHORIZED, "no such connection"))?;
        if STREAM_METHODS.contains(&method) {
            let _merged = c.stream.hit(now, limits::STREAM_MAX, limits::STREAM_WINDOW_MS).is_some();
            return Ok(());
        }
        match c.control.hit(now, limits::CONTROL_MAX, limits::CONTROL_WINDOW_MS) {
            Some(wait) => Err(retry(code::RATE, "too many messages", wait)),
            None => Ok(()),
        }
    }

    fn dispatch(
        &mut self,
        conn: ConnId,
        method: &str,
        p: &Value,
        rid: &Value,
        now: u64,
        out: &mut Vec<Out>,
    ) -> Result<Option<Value>, RpcErr> {
        let phase = match &self.conns[&conn].phase {
            Phase::New => None,
            Phase::Waiting => return Err(retry(code::BUSY, "the approval window is open, waiting for an answer", BUSY_RETRY_S)),
            Phase::Ready(p) => Some(p.clone()),
        };
        match (phase, method) {
            (None, "hello") => self.hello(conn, p, rid, now, out),
            (None, "auth") => self.auth(conn, p, now, out).map(Some),
            (None, _) => Err(closing(fail(code::UNAUTHORIZED, "send hello or auth first"))),
            (Some(_), "hello" | "auth") => Err(fail(code::INVALID_REQUEST, "already connected")),
            (Some(pid), m) => self.call(conn, &pid, m, p, now, out).map(Some),
        }
    }

    fn hello(
        &mut self,
        conn: ConnId,
        p: &Value,
        rid: &Value,
        now: u64,
        out: &mut Vec<Out>,
    ) -> Result<Option<Value>, RpcErr> {
        let m = manifest::parse(p).map_err(|e| closing(fail(code::INVALID_PARAMS, e)))?;
        if self.reg.blocked.contains(&m.id) {
            return Err(closing(fail(code::DENIED, "the owner chose not to be asked about this plugin again")));
        }
        let main_name =
            self.reg.main.as_deref().filter(|id| *id != m.id).and_then(|id| self.reg.get(id)).map(|r| r.name.clone());
        if names::reserved(&m.name, main_name.as_deref()) {
            return Err(closing(fail(
                code::INVALID_PARAMS,
                "this name is not allowed (Peeka, Windows, System, the main assistant's name, or a name starting with Peeka or the main assistant's name)",
            )));
        }
        if self.reg.plugins.iter().any(|r| r.id != m.id && names::same(&r.name, &m.name)) {
            return Err(closing(fail(code::INVALID_PARAMS, "this display name belongs to another plugin")));
        }
        if self.consent.is_some() {
            return Err(closing(retry(code::BUSY, "another approval is pending", BUSY_RETRY_S)));
        }
        let exe = self.conns[&conn].client.exe.clone();
        while self.pairings.front().is_some_and(|(t, _, _)| now.saturating_sub(*t) >= PAIRING_WINDOW_MS) {
            self.pairings.pop_front();
        }
        let same_source = |(_, id, e): &&(u64, String, Option<String>)| *id == m.id || (e.is_some() && *e == exe);
        if self.pairings.iter().filter(same_source).count() >= PAIRING_MAX {
            let oldest = self.pairings.iter().find(same_source).map_or(now, |(t, _, _)| *t);
            let wait = (PAIRING_WINDOW_MS - now.saturating_sub(oldest)).div_ceil(1000);
            return Err(closing(retry(code::RATE, "at most 3 pairing requests in 10 minutes", wait)));
        }
        if self.pairings.len() >= PAIRING_MAX_ALL {
            let wait = (PAIRING_WINDOW_MS - now.saturating_sub(self.pairings[0].0)).div_ceil(1000);
            return Err(closing(retry(code::RATE, "at most 6 pairing requests in 10 minutes (all plugins)", wait)));
        }
        self.pairings.push_back((now, m.id.clone(), exe));
        let lookalike = self.lookalike_of(&m.id, &m.name);
        let previous = self.reg.get(&m.id).map(|r| r.granted.clone()).unwrap_or_default();
        self.next_request += 1;
        let client = self.conns[&conn].client.clone();
        self.consent = Some(Consent {
            request: self.next_request,
            conn,
            rpc_id: rid.clone(),
            manifest: m,
            client,
            created: now,
            displayed: None,
            lookalike,
            previous,
        });
        if let Some(c) = self.conns.get_mut(&conn) {
            c.phase = Phase::Waiting;
        }
        out.push(Out::ConsentOpen);
        out.push(Out::Ui(UiEvent::ConsentChanged));
        Ok(None)
    }

    fn auth(&mut self, conn: ConnId, p: &Value, now: u64, out: &mut Vec<Out>) -> Result<Value, RpcErr> {
        let (id, token) = (p.get("id").and_then(Value::as_str), p.get("token").and_then(Value::as_str));
        let rec = id.zip(token).and_then(|(i, t)| self.reg.verify(i, t)).cloned();
        let Some(rec) = rec else { return Err(closing(fail(code::UNAUTHORIZED, "invalid id or token"))) };
        // One connection per plugin: the newer one wins.
        for old in self.ready_conns(&rec.id) {
            out.push(Out::Close(old));
            if let Some(c) = self.conns.get_mut(&old) {
                c.phase = Phase::New;
            }
        }
        if let Some(c) = self.conns.get_mut(&conn) {
            c.phase = Phase::Ready(rec.id.clone());
        }
        if let Some(r) = self.reg.get_mut(&rec.id) {
            r.last_seen = Some(now);
        }
        self.save(out);
        out.push(Out::Ui(UiEvent::PluginsChanged));
        if self.main_ready().is_some_and(|(m, _)| m == rec.id) {
            self.main_arrived(out);
        }
        let scopes: Vec<Scope> = rec.granted.iter().copied().filter(|s| rec.active(*s)).collect();
        Ok(json!({"scopes": scopes, "main_assistant": self.reg.is_main(&rec.id), "api_version": API_VERSION}))
    }

    fn call(
        &mut self,
        conn: ConnId,
        pid: &str,
        method: &str,
        p: &Value,
        now: u64,
        out: &mut Vec<Out>,
    ) -> Result<Value, RpcErr> {
        let need = scope_of(method).ok_or_else(|| fail(code::NO_METHOD, "no such method"))?;
        let rec = self.reg.get(pid).cloned().ok_or_else(|| closing(fail(code::UNAUTHORIZED, "plugin removed")))?;
        self.messages.entry(pid.into()).or_default().hit(now);
        if let Some(s) = need {
            if !rec.active(s) {
                return Err(fail(code::FORBIDDEN, format!("this method needs the '{}' scope", s.name())));
            }
            self.usage.entry((pid.into(), s)).or_default().hit(now);
        }
        if LATER.contains(&method) {
            return Err(fail(code::NO_METHOD, "this method has no source yet"));
        }
        let main = self.reg.is_main(pid);
        let assistant_only = assistant::METHODS.iter().any(|(n, _)| *n == method);
        if (method.starts_with("composer.") || method.starts_with("voice.") || assistant_only) && !main {
            return Err(fail(code::NOT_MAIN, "main assistant only"));
        }
        let who = Who { name: &rec.name, main };
        let bad = |e: items::Bad| fail(code::INVALID_PARAMS, e);
        let ok = Ok(json!({"ok": true}));
        match method {
            "ping" => Ok(json!({"pong": true})),
            "share.done" => Ok(
                json!({"ok": p.get("id").and_then(Value::as_str).is_some_and(|i| self.persist && share::done(&self.data_dir, i))}),
            ),
            "island.protrusion.set" => {
                let item = items::protrusion(p, who, pid, now).map_err(bad)?;
                if !self.protrusions.contains_key(pid) {
                    let c = self.conns.get_mut(&conn).ok_or_else(|| fail(code::UNAUTHORIZED, "no such connection"))?;
                    if let Some(w) = c.opens.hit(now, limits::PROTRUSION_OPENS_MAX, limits::PROTRUSION_WINDOW_MS) {
                        return Err(retry(code::RATE, "at most 6 peeks per minute", w));
                    }
                }
                self.protrusions.insert(pid.into(), item);
                out.push(Out::Ui(UiEvent::SurfacesChanged));
                ok
            }
            "island.protrusion.clear" => {
                if self.protrusions.remove(pid).is_some() {
                    out.push(Out::Ui(UiEvent::SurfacesChanged));
                }
                ok
            }
            "card.module.set" => {
                let m = items::module(p, who, pid, now).map_err(bad)?;
                if m.skipped > 0 {
                    let n = m.skipped;
                    self.log(conn, now, || format!("plugin {pid} card.module.set: {n} unknown blocks skipped"), out);
                }
                self.modules.insert(pid.into(), m);
                out.push(Out::Ui(UiEvent::SurfacesChanged));
                ok
            }
            "card.module.clear" => {
                if self.modules.remove(pid).is_some() {
                    out.push(Out::Ui(UiEvent::SurfacesChanged));
                }
                ok
            }
            "alerts.post" => self.alert_post(pid, who, p, now, out),
            "alerts.remove" => {
                let id = p.get("id").and_then(Value::as_str).ok_or_else(|| bad("id gerekli".into()))?;
                if self.alert_ids.get_mut(pid).is_some_and(|s| s.remove(id)) {
                    out.push(Out::AlertRemove(format!("{}:{id}", source(pid))));
                }
                ok
            }
            "approvals.prompt" => {
                let a = items::approval(p, who, pid, now).map_err(bad)?;
                let key = (pid.to_string(), a.id.clone());
                let mine = self.approvals.keys().filter(|(k, _)| k == pid).count();
                if !self.approvals.contains_key(&key) && mine >= MAX_APPROVALS {
                    return Err(fail(code::BUSY, "at most 20 pending approvals"));
                }
                out.push(Out::AlertPut { alert: approval_alert(&a), system: true });
                self.approvals.insert(key, a);
                out.push(Out::Ui(UiEvent::SurfacesChanged));
                ok
            }
            "approvals.cancel" => {
                let id = p.get("id").and_then(Value::as_str).unwrap_or_default();
                if self.approvals.remove(&(pid.to_string(), id.to_string())).is_some() {
                    out.push(Out::AlertRemove(approval_alert_id(pid, id)));
                    out.push(Out::Ui(UiEvent::SurfacesChanged));
                }
                ok
            }
            "composer.delta" | "composer.chip" | "composer.done" | "composer.error" => {
                self.composer(pid, method, p, now, out)
            }
            "voice.line" => {
                let state = p
                    .get("state")
                    .and_then(Value::as_str)
                    .filter(|s| ["idle", "listening", "speaking", "thinking"].contains(s));
                let state = state.ok_or_else(|| bad("state: idle|listening|speaking|thinking".into()))?;
                self.voice = Some(VoiceView { plugin_id: pid.into(), state: state.into() });
                out.push(Out::Ui(UiEvent::SurfacesChanged));
                ok
            }
            "voice.transcript" | "live_text.append" => {
                let stream = p
                    .get("stream_id")
                    .and_then(|v| items::display(v, 64))
                    .ok_or_else(|| bad("stream_id gerekli".into()))?;
                let text = p.get("text").and_then(items::stream_text).ok_or_else(|| bad("text gerekli".into()))?;
                let key = StreamKey::Live(pid.into(), stream);
                if let Some(who) = p.get("speaker").and_then(|v| items::display(v, 24)) {
                    self.speakers.insert(key.clone(), who);
                }
                self.streams.push(key.clone(), &text, now);
                if p.get("final").and_then(Value::as_bool) == Some(true) {
                    let b = self.streams.end(&key).unwrap_or(Batch { key, text: String::new(), truncated: false });
                    out.extend(self.batch_event(b, true));
                }
                ok
            }
            "lock.signal" => {
                if p.get("locked").and_then(Value::as_bool) != Some(true) {
                    return Err(bad("lock.signal only locks; the owner unlocks in Peeka".into()));
                }
                out.extend(self.lock_set(Reason::Plugin, true));
                ok
            }
            // Locked: nothing of the owner's goes out (§13 `lock.signal`); the plugin sees `locked` and an empty list.
            "clipboard.read" if self.lock.locked() => Ok(json!({"items": [], "locked": true})),
            "clipboard.read" => Ok(json!({"items": clip_visible(&self.clipboard)})),
            "search.results" => {
                let req = p.get("request").and_then(Value::as_u64);
                if req != Some(self.search_req) || self.lock.locked() {
                    return Ok(json!({"ok": false})); // an older query, or nobody asked (locked): dropped quietly
                }
                let group = p.get("group").and_then(|v| items::display(v, 40));
                let rows = p.get("items").and_then(Value::as_array).ok_or_else(|| bad("items gerekli".into()))?;
                self.search_hits.retain(|h| h.plugin.id != pid);
                for r in rows.iter().take(SEARCH_MAX) {
                    let (Some(id), Some(title)) = (
                        r.get("id").and_then(|v| items::display(v, 64)),
                        r.get("title").and_then(|v| items::display(v, 120)),
                    ) else {
                        return Err(bad("every row needs id and title".into()));
                    };
                    let subtitle = r.get("subtitle").and_then(|v| items::display(v, 200));
                    let plugin = self.plugin_ref(pid);
                    self.search_hits.push(SearchHit { plugin, group: group.clone(), id, title, subtitle });
                }
                ok
            }
            m if assistant_only => self.assistant_call(pid, m, p, now, out),
            _ => Err(fail(code::NO_METHOD, "no such method")),
        }
    }

    fn alert_post(&mut self, pid: &str, who: Who, p: &Value, now: u64, out: &mut Vec<Out>) -> Result<Value, RpcErr> {
        let bad = |e: String| fail(code::INVALID_PARAMS, e);
        items::no_markup_fields(p).map_err(bad)?;
        if p.get("action").is_some_and(|a| !a.is_null()) || p.get("color").is_some_and(|a| !a.is_null()) {
            return Err(bad("a plugin alert has no link (action) and no color".into()));
        }
        let notify = p.get("notify").and_then(Value::as_bool).unwrap_or(true);
        let id = p.get("id").and_then(|v| items::display(v, 64)).ok_or_else(|| bad("id gerekli".into()))?;
        let (mut a, _) = crate::alerts::parse(p, notify, now, id.clone()).map_err(|e| bad(e.0.into()))?;
        // The face icons are not in the alert set (HTTP senders never get them); the main assistant's ride along.
        if let Some(face) = p.get("icon").and_then(Value::as_str).filter(|s| items::FACE_ICONS.contains(s)) {
            a.icon = Some(items::face_or_icon(&Value::String(face.into()), who.main).map_err(bad)?);
        }
        // The one button a plugin may ask for: a fixed Notch action by name, never a link; the label is Notch's.
        match p.get("open").filter(|v| !v.is_null()) {
            None => {}
            Some(v) if v == "task_manager" => {
                a.action = Some(crate::alerts::Action::TaskManager);
                a.action_label = Some(crate::alerts::TASK_MANAGER_LABEL.into());
            }
            Some(_) => return Err(bad("open can only be \"task_manager\"".into())),
        }
        let mine = self.alert_ids.entry(pid.into()).or_default();
        if !mine.contains(&id) && mine.len() >= MAX_ALERTS {
            return Err(fail(code::BUSY, "at most 20 alerts"));
        }
        mine.insert(id.clone());
        a.id = format!("{}:{id}", source(pid));
        a.source = source(pid);
        a.title = items::heading(who, &items::display(&Value::String(a.title.clone()), 120).unwrap_or_default());
        a.subtitle = a.subtitle.and_then(|s| items::display(&Value::String(s), 300));
        out.push(Out::AlertPut { alert: a, system: false });
        Ok(json!({"ok": true}))
    }

    fn composer(&mut self, pid: &str, method: &str, p: &Value, now: u64, out: &mut Vec<Out>) -> Result<Value, RpcErr> {
        let turn = p.get("turn").and_then(Value::as_u64).filter(|t| self.turns.get(t).is_some_and(|x| x.plugin == pid));
        let turn = turn.ok_or_else(|| fail(code::INVALID_PARAMS, "unknown or closed turn"))?;
        let key = StreamKey::Composer(turn);
        match method {
            "composer.delta" => {
                let text = p
                    .get("text")
                    .and_then(items::stream_text)
                    .ok_or_else(|| fail(code::INVALID_PARAMS, "text gerekli"))?;
                self.streams.push(key, &text, now);
            }
            "composer.chip" => {
                let label = p
                    .get("label")
                    .and_then(|v| items::display(v, 60))
                    .ok_or_else(|| fail(code::INVALID_PARAMS, "label gerekli"))?;
                let kind = p
                    .get("kind")
                    .and_then(Value::as_str)
                    .filter(|k| ["source", "reminder", "note"].contains(k))
                    .unwrap_or("note");
                if let Some(b) = self.streams.take(&key) {
                    out.extend(self.batch_event(b, false));
                }
                let e = ComposerEvent {
                    label: Some(label),
                    chip_kind: Some(kind.into()),
                    ..ComposerEvent::new(turn, ComposerKind::Chip)
                };
                out.push(Out::Ui(UiEvent::Composer(e)));
            }
            _ => {
                if let Some(b) = self.streams.end(&key) {
                    out.extend(self.batch_event(b, false));
                }
                self.turns.remove(&turn);
                let e = if method == "composer.done" {
                    ComposerEvent::new(turn, ComposerKind::Done)
                } else {
                    let msg =
                        p.get("message").and_then(|v| items::display(v, 300)).unwrap_or_else(|| "Something went wrong".into());
                    ComposerEvent { message: Some(msg), ..ComposerEvent::new(turn, ComposerKind::Error) }
                };
                out.push(Out::Ui(UiEvent::Composer(e)));
            }
        }
        Ok(json!({"ok": true}))
    }

    fn batch_event(&mut self, b: Batch, done: bool) -> Option<Out> {
        let speaker = match &b.key {
            StreamKey::Live(..) if done => self.speakers.remove(&b.key),
            StreamKey::Live(..) => self.speakers.get(&b.key).cloned(),
            StreamKey::Composer(_) => None,
        };
        Some(Out::Ui(match b.key {
            StreamKey::Composer(turn) => UiEvent::Composer(ComposerEvent {
                text: Some(b.text),
                truncated: b.truncated,
                ..ComposerEvent::new(turn, ComposerKind::Delta)
            }),
            StreamKey::Live(plugin_id, stream_id) => UiEvent::Stream(StreamPiece {
                stream_id: format!("{plugin_id}:{stream_id}"),
                text: b.text,
                truncated: b.truncated,
                done,
                speaker,
            }),
        }))
    }

    /// Every 50 ms: stream batches, consent timeout, approval expiry, and (every minute) the share-folder sweep.
    pub fn tick(&mut self, now: u64) -> Vec<Out> {
        let mut out = vec![];
        if self.consent.as_ref().is_some_and(|c| c.timed_out(now)) {
            self.finish_consent(false, false, &mut out);
        }
        let expired: Vec<(String, String)> =
            self.approvals.iter().filter(|(_, a)| a.expires_at <= now).map(|(k, _)| k.clone()).collect();
        for (pid, id) in expired {
            self.approvals.remove(&(pid.clone(), id.clone()));
            if let Some(c) = self.conn_of(&pid) {
                out.push(Out::Send(c, notification("approvals.decision", json!({"id": id, "decision": "expired"}))));
            }
            out.push(Out::AlertRemove(approval_alert_id(&pid, &id)));
            out.push(Out::Ui(UiEvent::SurfacesChanged));
        }
        for b in self.streams.due(now, false) {
            out.extend(self.batch_event(b, false));
        }
        if now.saturating_sub(self.last_sweep) >= SWEEP_MS {
            self.last_sweep = now;
            if self.persist {
                share::sweep(&self.data_dir, std::time::SystemTime::now(), share::TTL);
            }
        }
        out
    }

    fn finish_consent(&mut self, granted: bool, never_ask: bool, out: &mut Vec<Out>) {
        let Some(c) = self.consent.take() else { return };
        if !granted {
            let e = fail(code::DENIED, "the owner denied it");
            if self.conns.contains_key(&c.conn) {
                out.push(Out::Send(c.conn, error_line(&c.rpc_id, &e)));
                out.push(Out::Close(c.conn));
            }
            if never_ask {
                self.reg.blocked.insert(c.manifest.id.clone());
                self.save(out);
            }
        }
        out.push(Out::ConsentClose);
        out.push(Out::Ui(UiEvent::ConsentChanged));
        out.push(Out::Ui(UiEvent::PluginsChanged));
    }

    pub fn disconnect(&mut self, conn: ConnId, now: u64) -> Vec<Out> {
        let mut out = vec![];
        let Some(c) = self.conns.remove(&conn) else { return out };
        if self.consent.as_ref().is_some_and(|x| x.conn == conn) {
            self.consent = None;
            out.push(Out::ConsentClose);
            out.push(Out::Ui(UiEvent::ConsentChanged));
        }
        if let Phase::Ready(pid) = c.phase {
            if self.ready_conns(&pid).is_empty() {
                self.drop_items(&pid, None, &mut out);
                if let Some(r) = self.reg.get_mut(&pid) {
                    r.last_seen = Some(now);
                }
                self.save(&mut out);
            }
            out.push(Out::Ui(UiEvent::PluginsChanged));
        }
        out
    }

    /// Removes what `pid` put up (only what needs `scope`, when given).
    fn drop_items(&mut self, pid: &str, scope: Option<Scope>, out: &mut Vec<Out>) {
        let has = |s: Scope| scope.is_none_or(|x| x == s);
        if has(Scope::IslandProtrusion) {
            self.meeting_end(pid, out);
            self.protrusions.remove(pid);
            self.streams.end_where(|k| !matches!(k, StreamKey::Live(p, _) if p == pid));
            self.speakers.retain(|k, _| !matches!(k, StreamKey::Live(p, _) if p == pid));
        }
        if has(Scope::CardModule) {
            self.modules.remove(pid);
        }
        if has(Scope::ApprovalsPrompt) {
            let keys: Vec<_> = self.approvals.keys().filter(|(p, _)| p == pid).cloned().collect();
            for k in keys {
                self.approvals.remove(&k);
                out.push(Out::AlertRemove(approval_alert_id(pid, &k.1)));
            }
            out.push(Out::Ui(UiEvent::SurfacesChanged));
        }
        if has(Scope::AlertsPost) {
            self.alert_ids.remove(pid);
            out.push(Out::AlertClear(source(pid)));
        }
        if has(Scope::ComposerHandler) {
            let turns: Vec<u64> = self.turns.iter().filter(|(_, t)| t.plugin == pid).map(|(k, _)| *k).collect();
            for t in turns {
                self.turns.remove(&t);
                self.streams.end(&StreamKey::Composer(t));
                let e = ComposerEvent {
                    message: Some("Connection lost".into()),
                    ..ComposerEvent::new(t, ComposerKind::Error)
                };
                out.push(Out::Ui(UiEvent::Composer(e)));
            }
        }
        if has(Scope::VoiceLine) && self.voice.as_ref().is_some_and(|v| v.plugin_id == pid) {
            self.voice = None;
        }
        if scope.is_none() {
            self.assistant_forget(pid, out);
        }
        out.push(Out::Ui(UiEvent::SurfacesChanged));
    }

    // ---------- the owner's side (Tauri commands) ----------

    pub fn consent_pending(&self) -> bool {
        self.consent.is_some()
    }

    /// The consent window asks what to draw; the first call starts the 300 ms guard and the 2 minutes.
    pub fn consent_get(&mut self, now: u64) -> Option<ConsentView> {
        self.consent.as_mut().map(|c| c.view(now))
    }

    pub fn consent_respond(
        &mut self,
        request: u64,
        allow: bool,
        scopes: Option<&[Scope]>,
        main: bool,
        never_ask: bool,
        now: u64,
    ) -> Result<Vec<Out>, OwnerErr> {
        let c = self.consent.as_ref().filter(|c| c.request == request).ok_or(OwnerErr::Unknown)?;
        let mut out = vec![];
        match c.answer(allow, scopes, main, never_ask, now) {
            Answer::Ignored => return Err(OwnerErr::Ignored),
            Answer::Deny { never_ask } => self.finish_consent(false, never_ask, &mut out),
            Answer::Allow { scopes, main } => {
                let (token, digest) = registry::new_token().map_err(|_| OwnerErr::Io)?;
                let (conn, rpc_id, m) = (c.conn, c.rpc_id.clone(), c.manifest.clone());
                let was_main = self.reg.is_main(&m.id);
                let before = self.reg.get(&m.id).map(|r| r.granted.clone()).unwrap_or_default();
                for s in scopes.difference(&before) {
                    self.log_permission(&m.name, *s, true, now);
                }
                for s in before.difference(&scopes) {
                    self.log_permission(&m.name, *s, false, now);
                }
                self.reg.upsert(Record {
                    id: m.id.clone(),
                    name: m.name,
                    publisher: m.publisher,
                    version: m.version,
                    digest,
                    granted: scopes.clone(),
                    disabled: BTreeSet::new(),
                    approved_at: now,
                    last_seen: Some(now),
                    launch: m.launch,
                });
                if main || (was_main && scopes.contains(&Scope::ComposerHandler)) {
                    self.reg.main = Some(m.id.clone());
                } else if was_main {
                    self.reg.main = None;
                }
                self.reg.blocked.remove(&m.id);
                self.save(&mut out);
                // The old pairing's connection goes, and nothing is routed to it while it closes.
                for old in self.ready_conns(&m.id) {
                    out.push(Out::Close(old));
                    if let Some(c) = self.conns.get_mut(&old) {
                        c.phase = Phase::New;
                    }
                }
                if let Some(cn) = self.conns.get_mut(&conn) {
                    cn.phase = Phase::Ready(m.id.clone());
                    let result = json!({"token": token, "scopes": scopes, "main_assistant": self.reg.is_main(&m.id)});
                    out.push(Out::Send(conn, result_line(&rpc_id, result)));
                }
                if self.main_ready().is_some_and(|(id, _)| id == m.id) {
                    self.main_arrived(&mut out);
                }
                self.finish_consent(true, false, &mut out);
            }
        }
        Ok(out)
    }

    /// "Remove": the digest goes, open connections close, everything it put up goes. Also lifts "never ask again".
    pub fn revoke(&mut self, id: &str, now: u64) -> Result<Vec<Out>, OwnerErr> {
        let mut out = vec![];
        if let Some(r) = self.reg.get(id).cloned() {
            for s in r.granted.iter().filter(|s| r.active(**s)) {
                self.log_permission(&r.name, *s, false, now);
            }
        }
        let known = self.reg.remove(id) | self.reg.blocked.remove(id);
        if !known {
            return Err(OwnerErr::Unknown);
        }
        for c in self.ready_conns(id) {
            out.push(Out::Close(c));
            if let Some(cn) = self.conns.get_mut(&c) {
                cn.phase = Phase::New;
            }
        }
        self.drop_items(id, None, &mut out);
        self.usage.retain(|(p, _), _| p != id);
        self.save(&mut out);
        out.push(Out::Ui(UiEvent::PluginsChanged));
        Ok(out)
    }

    /// "Disconnect": closes; the plugin may come back with its token.
    pub fn disconnect_plugin(&mut self, id: &str) -> Result<Vec<Out>, OwnerErr> {
        self.reg.get(id).ok_or(OwnerErr::Unknown)?;
        Ok(self.ready_conns(id).into_iter().map(Out::Close).collect())
    }

    /// A granted scope on or off; takes effect on the plugin's next message.
    pub fn set_scope(&mut self, id: &str, scope: Scope, on: bool, now: u64) -> Result<Vec<Out>, OwnerErr> {
        let r = self.reg.get_mut(id).ok_or(OwnerErr::Unknown)?;
        if !r.granted.contains(&scope) {
            return Err(OwnerErr::Invalid);
        }
        let changed = if on { r.disabled.remove(&scope) } else { r.disabled.insert(scope) };
        let name = r.name.clone();
        if changed {
            self.log_permission(&name, scope, on, now);
        }
        let mut out = vec![];
        if !on {
            self.drop_items(id, Some(scope), &mut out);
        }
        self.save(&mut out);
        out.push(Out::Ui(UiEvent::PluginsChanged));
        Ok(out)
    }

    /// The owner picks the main assistant (None = nobody). It must hold an active `composer.handler`.
    pub fn set_main(&mut self, id: Option<&str>) -> Result<Vec<Out>, OwnerErr> {
        if let Some(i) = id {
            let r = self.reg.get(i).ok_or(OwnerErr::Unknown)?;
            if !r.active(Scope::ComposerHandler) {
                return Err(OwnerErr::Invalid);
            }
        }
        let mut out = vec![];
        if let Some(old) = self.reg.main.clone().filter(|o| Some(o.as_str()) != id) {
            self.drop_items(&old, Some(Scope::ComposerHandler), &mut out);
            self.drop_items(&old, Some(Scope::VoiceLine), &mut out);
            self.assistant_forget(&old, &mut out); // its offline / meeting must not outlive its main role
        }
        self.reg.main = id.map(str::to_string);
        self.save(&mut out);
        out.push(Out::Ui(UiEvent::PluginsChanged));
        Ok(out)
    }

    fn main_ready(&self) -> Option<(String, ConnId)> {
        let id = self.reg.main.clone()?;
        let active = self.reg.get(&id).is_some_and(|r| r.active(Scope::ComposerHandler));
        active.then(|| id.clone()).zip(self.conn_of(&id))
    }

    /// Ctrl+Space's box was sent: one turn to the main assistant. Err(NoMain) = "Assistant not connected".
    pub fn composer_submit(
        &mut self,
        text: &str,
        attachments: &[Attachment],
        now: u64,
    ) -> Result<(u64, Vec<Out>), OwnerErr> {
        let (pid, conn) = self.main_ready().ok_or(OwnerErr::NoMain)?;
        let text = items::stream_text(&Value::String(text.into())).unwrap_or_default();
        if text.trim().is_empty() && attachments.is_empty() || text.chars().count() > MAX_COMPOSER_TEXT {
            return Err(OwnerErr::Invalid);
        }
        if attachments.len() > MAX_ATTACHMENTS {
            return Err(OwnerErr::Invalid);
        }
        let path_ok = |p: &str| {
            p.len() <= 1024 && !p.chars().any(char::is_control) && (p.get(1..3) == Some(":\\") || p.starts_with("\\\\"))
        };
        // A file/rack copy in the share folder also goes inline when it is small UTF-8 text: Claude Code's deny rules
        // close Notch's folder, so the path alone is unreadable for it (docs/plugin-api.md §13 "Ekler").
        let build = |inline: bool| -> Result<String, OwnerErr> {
            let mut list = vec![];
            let mut budget = INLINE_BUDGET;
            for a in attachments {
                let text_ok = |t: &String| t.len() <= INLINE_MAX;
                let mut item = match (&a.path, &a.text) {
                    (Some(p), None) if path_ok(p) => json!({"kind": a.kind_name(), "path": p}),
                    (Some(p), Some(t)) if path_ok(p) && a.kind == AttachKind::Clip && text_ok(t) => {
                        json!({"kind": "clip", "path": p, "text": t})
                    }
                    (None, Some(t)) if a.kind == AttachKind::Clip && text_ok(t) => json!({"kind": "clip", "text": t}),
                    _ => return Err(OwnerErr::Invalid),
                };
                if let (true, Some(p), None, AttachKind::File | AttachKind::Rack) = (inline, &a.path, &a.text, a.kind) {
                    if let Some(t) = share::small_text(&self.data_dir, Path::new(p), INLINE_MAX.min(budget)) {
                        budget -= t.len();
                        item["text"] = Value::String(t);
                    }
                }
                list.push(item);
            }
            Ok(notification("composer.submit", json!({"turn": self.next_turn + 1, "text": text, "attachments": list})))
        };
        let mut line = build(true)?;
        if line.len() > MAX_SUBMIT {
            line = build(false)?; // the inline copies never fail a turn: paths alone, then the plain cap
        }
        if line.len() > MAX_SUBMIT {
            return Err(OwnerErr::Invalid);
        }
        self.next_turn += 1;
        let turn = self.next_turn;
        self.turns.insert(turn, Turn { plugin: pid.clone() });
        self.usage.entry((pid, Scope::ComposerHandler)).or_default().hit(now);
        Ok((turn, vec![Out::Send(conn, line)]))
    }

    /// The owner answered an approval. Within 300 ms of it appearing: ignored. From the protrusion at high risk:
    /// refused (only "Details" is there). Only the offered options count; "deny" always works.
    #[allow(clippy::too_many_arguments)]
    pub fn approval_respond(
        &mut self,
        plugin: &str,
        id: &str,
        decision: Decision,
        choice_id: Option<&str>,
        text: Option<&str>,
        surface: Surface,
        now: u64,
    ) -> Result<Vec<Out>, OwnerErr> {
        let key = (plugin.to_string(), id.to_string());
        let a = self.approvals.get(&key).ok_or(OwnerErr::Unknown)?;
        if now < a.shown_at + GUARD_MS {
            return Err(OwnerErr::Ignored);
        }
        if surface == Surface::Protrusion && a.risk == Risk::High {
            return Err(OwnerErr::Invalid);
        }
        let offered = |o: Opt| a.options.contains(&o);
        let mut answer = json!({"id": id});
        match decision {
            Decision::Allow if offered(Opt::Allow) => answer["decision"] = json!("allow"),
            Decision::Always if offered(Opt::Always) && surface == Surface::Card => {
                answer["decision"] = json!("always")
            }
            Decision::Deny => answer["decision"] = json!("deny"),
            Decision::Choice => {
                let c = choice_id.filter(|c| a.choices.iter().any(|x| x.id == *c));
                let t = text
                    .filter(|_| a.free_text)
                    .map(|t| items::stream_text(&Value::String(t.into())).unwrap_or_default());
                if c.is_none() && t.is_none() || t.as_ref().is_some_and(|t| t.chars().count() > items::MAX_FREE_TEXT) {
                    return Err(OwnerErr::Invalid);
                }
                answer["decision"] = json!("choice");
                if let Some(c) = c {
                    answer["choice_id"] = json!(c);
                }
                if let Some(t) = t {
                    answer["text"] = json!(t);
                }
            }
            _ => return Err(OwnerErr::Invalid),
        }
        self.approvals.remove(&key);
        let mut out = vec![Out::AlertRemove(approval_alert_id(plugin, id)), Out::Ui(UiEvent::SurfacesChanged)];
        if let Some(c) = self.conn_of(plugin) {
            out.push(Out::Send(c, notification("approvals.decision", answer)));
        }
        Ok(out)
    }

    /// A plugin button (protrusion or a Modules tab): ~300 ms after the item last changed, it goes back as
    /// `action {id, surface, tab?}`; the plugin does the rest (Notch opens nothing).
    pub fn action(&mut self, plugin: &str, action: &str, now: u64) -> Result<Vec<Out>, OwnerErr> {
        let on_protrusion = self.protrusions.get(plugin).filter(|p| p.actions.iter().any(|b| b.id == action));
        let (updated, surface, tab) = match on_protrusion {
            Some(p) => (p.updated_at, "protrusion", None),
            None => {
                let m = self.modules.get(plugin).ok_or(OwnerErr::Unknown)?;
                let has = |t: &&Tab| {
                    t.blocks.iter().any(
                        |b| matches!(b, items::Block::Buttons { buttons } if buttons.iter().any(|x| x.id == action)),
                    )
                };
                let tab = m.tabs.iter().find(has).map(|t| t.id.clone());
                let in_summary = m.summary.iter().any(|r| r.action.as_ref().is_some_and(|b| b.id == action));
                if tab.is_none() && !in_summary {
                    return Err(OwnerErr::Unknown);
                }
                (m.updated_at, "module", tab)
            }
        };
        if now < updated + GUARD_MS {
            return Err(OwnerErr::Ignored);
        }
        let conn = self.conn_of(plugin).ok_or(OwnerErr::Unknown)?;
        let mut p = json!({"id": action, "surface": surface});
        if let Some(t) = tab {
            p["tab"] = json!(t);
        }
        Ok(vec![Out::Send(conn, notification("action", p))])
    }

    /// "Sesle sor" in the Ctrl+Space box: `voice.request {}` to the main assistant, if it holds `voice.line`.
    pub fn composer_voice(&mut self) -> Result<Vec<Out>, OwnerErr> {
        let (pid, conn) = self.main_ready().ok_or(OwnerErr::NoMain)?;
        if !self.reg.get(&pid).is_some_and(|r| r.active(Scope::VoiceLine)) {
            return Err(OwnerErr::Invalid);
        }
        Ok(vec![Out::Send(conn, notification("voice.request", json!({})))])
    }

    /// Ctrl+K typed: `search.query {request, query}` to every connected plugin holding `search.provider`; their
    /// `search.results` for this request collect until the caller takes them ([`Host::search_take`]).
    pub fn search_query(&mut self, query: &str) -> (u64, Vec<Out>) {
        self.search_req += 1;
        self.search_hits.clear();
        if self.lock.locked() {
            return (self.search_req, vec![]); // locked: the owner's typing stays in Notch (§13 `lock.signal`)
        }
        let line = notification("search.query", json!({"request": self.search_req, "query": query}));
        let ids: Vec<String> =
            self.reg.plugins.iter().filter(|r| r.active(Scope::SearchProvider)).map(|r| r.id.clone()).collect();
        let outs = ids.iter().filter_map(|id| self.conn_of(id)).map(|c| Out::Send(c, line.clone())).collect();
        (self.search_req, outs)
    }

    pub fn search_take(&self, request: u64) -> Vec<SearchHit> {
        if request == self.search_req {
            self.search_hits.clone()
        } else {
            vec![]
        }
    }

    /// The owner opened a plugin's row: `search.open {id}` to it (only a row it sent for the current query).
    pub fn search_open(&mut self, plugin: &str, id: &str) -> Result<Vec<Out>, OwnerErr> {
        if !self.search_hits.iter().any(|h| h.plugin.id == plugin && h.id == id) {
            return Err(OwnerErr::Unknown);
        }
        let active = self.reg.get(plugin).is_some_and(|r| r.active(Scope::SearchProvider));
        let conn = self.conn_of(plugin).filter(|_| active).ok_or(OwnerErr::Unknown)?;
        Ok(vec![Out::Send(conn, notification("search.open", json!({"id": id})))])
    }

    /// Notch's lock: Windows lock/unlock, the owner's "Kilitle", a plugin's `lock.signal`. The one
    /// place the lock changes, so `lock_changed` is emitted from here only.
    pub fn lock_set(&mut self, reason: Reason, on: bool) -> Vec<Out> {
        self.lock_out(|l| l.set(reason, on))
    }

    /// The owner's click in Notch: the button's and the plugins' lock go; a Windows lock stays.
    pub fn lock_release(&mut self) -> Vec<Out> {
        self.lock_out(Lock::release)
    }

    pub fn lock_state(&self) -> LockState {
        self.lock.state()
    }

    pub fn locked(&self) -> bool {
        self.lock.locked()
    }

    fn lock_out(&mut self, f: impl FnOnce(&mut Lock) -> bool) -> Vec<Out> {
        if !f(&mut self.lock) {
            return vec![];
        }
        vec![Out::Ui(UiEvent::LockChanged(self.lock.state())), Out::Ui(UiEvent::SurfacesChanged)]
    }

    fn plugin_ref(&self, id: &str) -> PluginRef {
        let name = self.reg.get(id).map(|r| r.name.clone()).unwrap_or_default();
        PluginRef { id: id.into(), name, main: self.reg.is_main(id) }
    }

    fn lookalike_of(&self, id: &str, name: &str) -> Option<String> {
        let others = self.reg.plugins.iter().filter(|r| r.id != id).map(|r| r.name.as_str());
        names::RESERVED.iter().copied().chain(others).find(|n| names::looks_like(name, n)).map(str::to_string)
    }

    /// Settings › Plugins (`plugin_list`): counts only, never content.
    pub fn plugin_list(&self, now: u64) -> Vec<PluginInfo> {
        let uses = |id: &str, s: Scope| self.usage.get(&(id.to_string(), s)).map_or(0, |u| u.last_24h(now));
        let mut v: Vec<PluginInfo> = self
            .reg
            .plugins
            .iter()
            .map(|r| PluginInfo {
                id: r.id.clone(),
                name: r.name.clone(),
                publisher: r.publisher.clone(),
                version: r.version.clone(),
                connected: self.conn_of(&r.id).is_some(),
                last_seen: r.last_seen,
                main: self.reg.is_main(&r.id),
                messages_24h: self.messages.get(&r.id).map_or(0, |u| u.last_24h(now)),
                approvals_24h: uses(&r.id, Scope::ApprovalsPrompt),
                scopes: r
                    .granted
                    .iter()
                    .map(|&s| ScopeState { scope: s, granted: r.active(s), uses_24h: uses(&r.id, s) })
                    .collect(),
                lookalike: self.lookalike_of(&r.id, &r.name),
                launch: r.launch.clone(),
            })
            .collect();
        v.sort_by(|a, b| b.main.cmp(&a.main).then(a.name.cmp(&b.name)));
        v
    }

    /// Whether Ctrl+Space has someone to talk to (false = the UI says "Assistant not connected").
    pub fn main_connected(&self) -> bool {
        self.main_ready().is_some()
    }

    /// `assistant_start`: the chosen main assistant's `launch`, connected or not.
    pub fn main_launch(&self) -> Option<&str> {
        self.reg.main.as_deref().and_then(|m| self.reg.get(m)).and_then(|r| r.launch.as_deref())
    }

    fn module_order(&self, id: &str) -> usize {
        self.reg.modules.order.iter().position(|x| x == id).unwrap_or(usize::MAX)
    }

    /// `plugin_surfaces`. `alert_top` / `drop_strip_ms` come from Notch's alert list (`AlertsView`): the attention
    /// budget there decides which approval may open the island and whether the hidden strip comes down.
    pub fn surfaces_view(&self, ctx: &Attention, alert_top: Option<&str>, drop_strip_ms: Option<u64>) -> SurfacesView {
        let quiet = ctx.dnd || ctx.meeting || ctx.fullscreen || presence::quiet(ctx.presence);
        let main = self.reg.main.as_deref();
        let pick = self.protrusions.values().max_by_key(|p| (Some(p.plugin.id.as_str()) == main, p.updated_at));
        let shown = pick.filter(|_| !quiet).map(|p| Protrusion { plugin: self.plugin_ref(&p.plugin.id), ..p.clone() });
        let mut approvals: Vec<Approval> =
            self.approvals.values().map(|a| Approval { plugin: self.plugin_ref(&a.plugin.id), ..a.clone() }).collect();
        approvals.sort_by_key(|a| a.shown_at);
        let approval_top = alert_top
            .and_then(|t| self.approvals.values().find(|a| approval_alert_id(&a.plugin.id, &a.id) == t))
            .map(|a| a.id.clone());
        let mut tabs: Vec<Tab> = self
            .modules
            .values()
            .flat_map(|m| m.tabs.iter().map(|t| Tab { plugin: self.plugin_ref(&m.plugin.id), ..t.clone() }))
            .filter(|t| !self.reg.modules.off.contains(&format!("{}/{}", t.plugin.id, t.id)))
            .collect();
        tabs.sort_by_key(|t| self.module_order(&format!("{}/{}", t.plugin.id, t.id)));
        let summary = self
            .modules
            .values()
            .filter(|m| !m.summary.is_empty())
            .map(|m| SummaryRows { plugin: self.plugin_ref(&m.plugin.id), rows: m.summary.clone() })
            .collect();
        let composer = self.main_ready().map(|(id, _)| ComposerOwner {
            voice: self.reg.get(&id).is_some_and(|r| r.active(Scope::VoiceLine)),
            plugin: self.plugin_ref(&id),
        });
        SurfacesView {
            waiting: self.protrusions.len() - usize::from(shown.is_some()),
            protrusion: shown,
            drop_strip_ms: approval_top.as_ref().and(drop_strip_ms),
            approval_top,
            approvals,
            tabs,
            summary,
            composer,
            voice: self.voice.clone(),
            locked: self.lock.locked(),
        }
    }

    /// Settings › Modules: Notch's tabs and every plugin tab, in the owner's order.
    pub fn modules_get(&self) -> Vec<ModuleEntry> {
        let off = &self.reg.modules.off;
        let mut v: Vec<ModuleEntry> = CORE_MODULES
            .iter()
            .map(|(id, title, icon)| ModuleEntry {
                id: id.to_string(),
                title: title.to_string(),
                icon: icon.to_string(),
                owner: "Peeka".into(),
                on: !off.contains(*id),
            })
            .collect();
        for m in self.modules.values() {
            let owner = format!("{} plugin", self.plugin_ref(&m.plugin.id).name);
            for t in &m.tabs {
                let id = format!("{}/{}", m.plugin.id, t.id);
                let icon = t.icon.clone().unwrap_or_else(|| "layout-grid".into());
                v.push(ModuleEntry { on: !off.contains(&id), id, title: t.title.clone(), icon, owner: owner.clone() });
            }
        }
        v.sort_by_key(|e| self.module_order(&e.id)); // stable: ids not in the order keep their place at the end
        v
    }

    pub fn modules_set(&mut self, order: Vec<String>, off: Vec<String>) -> Result<Vec<Out>, OwnerErr> {
        let ok = |l: &[String]| l.len() <= 64 && l.iter().all(|i| !i.is_empty() && i.len() <= 160);
        if !ok(&order) || !ok(&off) {
            return Err(OwnerErr::Invalid);
        }
        self.reg.modules = registry::ModulePrefs { order, off: off.into_iter().collect() };
        let mut out = vec![Out::Ui(UiEvent::SurfacesChanged)];
        self.save(&mut out);
        Ok(out)
    }
}

impl Attachment {
    fn kind_name(&self) -> &'static str {
        match self.kind {
            AttachKind::Screenshot => "screenshot",
            AttachKind::File => "file",
            AttachKind::Clip => "clip",
            AttachKind::WindowImage => "window_image",
            AttachKind::Rack => "rack",
        }
    }
}

/// The approval in Notch's alert list: it outranks everything, passes DND and drops the hidden strip for 4 s over a
/// fullscreen app, never over an exclusive D3D game (`alerts::gate`).
fn approval_alert(a: &Approval) -> Alert {
    Alert {
        id: approval_alert_id(&a.plugin.id, &a.id),
        title: if a.source.is_empty() { a.plugin.name.clone() } else { format!("{} › {}", a.plugin.name, a.source) },
        subtitle: Some(a.title.clone()),
        icon: Some("warning".into()),
        priority: APPROVAL_PRIORITY,
        expand: true,
        kind: Kind::Approval,
        source: source(&a.plugin.id),
        expires_at: Some(a.expires_at),
        updated_at: a.shown_at,
        ..Alert::default()
    }
}

#[cfg(test)]
pub(crate) mod tests;
