//! Declarative items: the plugin sends data, Notch draws. Every item here is already clean when it
//! leaves this file: plain text only (control/bidi characters dropped, `<tag>`s stripped, `›`-like separators
//! flattened), icons only from Notch's own set, no link/HTML/icon-URL fields at all (the message is refused), colours
//! only through `state` / `style`, the plugin named by Notch in `plugin` (from the registry, never the payload; the page
//! draws "<plugin.name> › <title>"), and `mascot` only for the main assistant.

use base64::Engine;
use serde::Serialize;
use serde_json::{Map, Value};

use crate::alerts::{text as plain, ICONS};

pub const MAX_TABS: usize = 3;
pub const MAX_SUMMARY: usize = 3;
pub const MAX_IMAGE: usize = 256 * 1024;
pub const MAX_FREE_TEXT: usize = 2_000;
pub const MAX_EXPIRES_S: u64 = 3_600;
const DEFAULT_EXPIRES_S: u64 = 300;
const MAX_BLOCKS: usize = 40;
const MAX_ROWS: usize = 50;
const MAX_BUTTONS: usize = 4;
/// The mascot states Notch draws (Wave 5 sprites); anything else is ignored.
pub const MASCOT_STATES: [&str; 8] =
    ["drowsy", "listening", "speaking", "thinking", "happy", "tired", "surprised", "attention"];
/// Icon names the page draws as the main assistant's face (Fidelity.tsx `AlertCenter`): only the main assistant may send them.
pub const FACE_ICONS: [&str; 2] = ["tired", "attention"];
/// The tab / summary-row glyph names the page draws (Plugin.tsx `GLYPHS`); nothing else is a glyph.
pub const GLYPHS: [&str; 7] = ["ghost", "terminal", "users", "pointer", "brain", "list", "shield"];
/// Fields that would carry markup, a link or a picture: a message with any of them anywhere is refused.
const FORBIDDEN_FIELDS: [&str; 14] = [
    "html",
    "href",
    "url",
    "link",
    "links",
    "src",
    "svg",
    "css",
    "script",
    "iframe",
    "icon_url",
    "iconUrl",
    "image_url",
    "imageUrl",
];
/// Separator look-alikes a title could use to fake "Notch › …"; they become a plain '-'.
const SEPARATORS: [char; 10] = ['›', '‹', '»', '«', '❯', '❮', '⟩', '⟨', '〉', '〈'];

pub type Bad = String;

/// Who sent it: the display name Notch stamps, and whether it is the main assistant.
#[derive(Clone, Copy, Debug)]
pub struct Who<'a> {
    pub name: &'a str,
    pub main: bool,
}

/// Refuses any forbidden field, at any depth.
pub fn no_markup_fields(v: &Value) -> Result<(), Bad> {
    match v {
        Value::Object(o) => {
            if let Some(k) = o.keys().find(|k| FORBIDDEN_FIELDS.contains(&k.as_str())) {
                return Err(format!("'{k}' is not allowed: a plugin cannot send links, HTML or image icons"));
            }
            o.values().try_for_each(no_markup_fields)
        }
        Value::Array(a) => a.iter().try_for_each(no_markup_fields),
        _ => Ok(()),
    }
}

/// Removes `<tag …>` / `</tag>` / `<!…>` runs; a lone `<` (as in "a < b") stays.
fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('<') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        let tag = after.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || matches!(c, '/' | '!' | '?'));
        match (tag, after.find('>')) {
            (true, Some(end)) => rest = &after[end + 1..],
            _ => {
                out.push('<');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Display text: plain, tags stripped, separators flattened, trimmed and cut. None when nothing is left.
pub fn display(v: &Value, limit: usize) -> Option<String> {
    let s = strip_tags(&plain(v, limit * 4)?);
    let s: String = s.chars().map(|c| if SEPARATORS.contains(&c) { '-' } else { c }).collect();
    plain(&Value::String(s), limit)
}

/// Streamed text (`composer.delta`, transcripts): spaces and newlines kept (pieces are glued together), control and
/// bidi/zero-width characters dropped. Tags are NOT stripped here: an answer may be code (`Vec<String>`); the page
/// draws it as text, never as HTML.
pub fn stream_text(v: &Value) -> Option<String> {
    let s = v.as_str()?;
    let bad = |c: char| {
        (c.is_control() && c != '\n' && c != '\t')
            || matches!(c as u32, 0x200B..=0x200F | 0x202A..=0x202E | 0x2060..=0x2064 | 0x2066..=0x2069 | 0xFEFF)
    };
    Some(s.chars().filter(|c| !bad(*c)).collect())
}

/// The heading Notch draws: "<plugin name> › <title>".
pub fn heading(from: Who, title: &str) -> String {
    format!("{} › {}", from.name, title)
}

fn get<'a>(o: &'a Map<String, Value>, k: &str) -> &'a Value {
    o.get(k).unwrap_or(&Value::Null)
}

fn obj(v: &Value) -> Result<&Map<String, Value>, Bad> {
    v.as_object().ok_or_else(|| "expected an object".to_string())
}

fn need(o: &Map<String, Value>, k: &str, limit: usize) -> Result<String, Bad> {
    display(get(o, k), limit).ok_or_else(|| format!("'{k}' is required (plain text)"))
}

/// Optional text: absent/null = None, present but empty after cleaning = None too.
fn opt(o: &Map<String, Value>, k: &str, limit: usize) -> Option<String> {
    display(get(o, k), limit)
}

/// Optional flag: absent/null = false, anything but a bool refuses the message.
fn flag(o: &Map<String, Value>, k: &str) -> Result<bool, Bad> {
    match get(o, k) {
        Value::Null => Ok(false),
        v => v.as_bool().ok_or_else(|| format!("'{k}' must be true/false")),
    }
}

/// Optional text that must be text when present (a number or object refuses the message), cut at `limit`.
fn opt_text(o: &Map<String, Value>, k: &str, limit: usize) -> Result<Option<String>, Bad> {
    match get(o, k) {
        Value::Null => Ok(None),
        v if v.is_string() => Ok(display(v, limit)),
        _ => Err(format!("'{k}' must be plain text")),
    }
}

/// `icon` plus the face names (`FACE_ICONS`), which only the main assistant may use.
pub fn face_or_icon(v: &Value, main: bool) -> Result<String, Bad> {
    match v.as_str().filter(|s| FACE_ICONS.contains(s)) {
        Some(_) if !main => Err("icon: tired/attention is for the main assistant only".into()),
        Some(f) => Ok(f.into()),
        None => icon(v),
    }
}

/// A name from Notch's icon set or ONE character; anything else (a URL, `data:`, `<svg>`) refuses the message.
pub fn icon(v: &Value) -> Result<String, Bad> {
    let ok = v.as_str().filter(|s| {
        let n = s.chars().count();
        ICONS.contains(s) || n == 1 || (n == 2 && s.ends_with('\u{FE0F}'))
    });
    ok.map(str::to_string).ok_or_else(|| "icon: only a Peeka icon name or a single character".into())
}

/// `started_at`: an ISO 8601 time as text (the page parses it); only digits and `-:.TZ+`, at most 35 chars.
fn iso(v: &Value) -> Result<String, Bad> {
    v.as_str()
        .filter(|s| (10..=35).contains(&s.len()) && s.chars().all(|c| c.is_ascii_digit() || "-:.TZ+".contains(c)))
        .map(str::to_string)
        .ok_or_else(|| "started_at: an ISO 8601 time is expected".into())
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ButtonStyle {
    #[default]
    Default,
    Primary,
    Destructive,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Button {
    pub id: String,
    pub label: String,
    pub style: ButtonStyle,
}

fn buttons(v: &Value, max: usize) -> Result<Vec<Button>, Bad> {
    let list = match v {
        Value::Null => return Ok(vec![]),
        Value::Array(a) => a,
        _ => return Err("buttons must be a list".into()),
    };
    if list.len() > max {
        return Err(format!("at most {max} buttons"));
    }
    list.iter().map(button).collect()
}

fn button(b: &Value) -> Result<Button, Bad> {
    let o = obj(b)?;
    let style = match get(o, "style").as_str() {
        Some("primary") => ButtonStyle::Primary,
        Some("destructive") => ButtonStyle::Destructive,
        _ => ButtonStyle::Default,
    };
    Ok(Button { id: need(o, "id", 64)?, label: need(o, "label", 40)?, style })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    Idle,
    Info,
    Attention,
    Done,
    Danger,
    Tired,
}

/// Who an item is from, filled from Notch's own registry (never from the payload) each time a view is built.
/// The page draws "<name> › <title>" from it: the prefix is Notch's, the plugin's text cannot reach it.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct PluginRef {
    pub id: String,
    pub name: String,
    pub main: bool,
}

impl PluginRef {
    pub fn new(id: &str, from: Who) -> Self {
        Self { id: id.into(), name: from.name.into(), main: from.main }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    pub started_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveRef {
    /// "<plugin id>:<stream id>", the same key `plugin_stream` events carry.
    pub stream_id: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Protrusion {
    pub plugin: PluginRef,
    pub title: String,
    pub subtitle: Option<String>,
    pub icon: String,
    pub state: State,
    pub progress: Option<f64>,
    pub timer: Option<Started>,
    pub live_text: Option<LiveRef>,
    /// The two-line live transcript (plugin-api.ts `ProtrusionExt`); its text comes over `voice.transcript`.
    pub transcript: Option<LiveRef>,
    /// The faint short note next to the title.
    pub note: Option<String>,
    pub mascot: Option<String>,
    pub actions: Vec<Button>,
    #[serde(skip)]
    pub updated_at: u64,
}

pub fn protrusion(p: &Value, from: Who, plugin_id: &str, now: u64) -> Result<Protrusion, Bad> {
    no_markup_fields(p)?;
    let o = obj(p)?;
    let title = need(o, "title", 80)?;
    let state = match get(o, "state").as_str() {
        Some("idle") => State::Idle,
        Some("info") => State::Info,
        Some("attention") => State::Attention,
        Some("done") => State::Done,
        Some("danger") => State::Danger,
        Some("tired") => State::Tired,
        _ => return Err("state: idle|info|attention|done|danger|tired".into()),
    };
    let timer = match get(o, "timer") {
        Value::Null => None,
        t => Some(Started { started_at: iso(get(obj(t)?, "started_at"))? }),
    };
    let live_ref = |k: &str| -> Result<Option<LiveRef>, Bad> {
        match get(o, k) {
            Value::Null => Ok(None),
            t => {
                let id = display(get(obj(t)?, "stream_id"), 64).ok_or(format!("{k}.stream_id gerekli"))?;
                Ok(Some(LiveRef { stream_id: format!("{plugin_id}:{id}") }))
            }
        }
    };
    // Only the main assistant has a face; anyone else's mascot is silently ignored.
    let mascot = get(o, "mascot").as_str().filter(|m| from.main && MASCOT_STATES.contains(m)).map(str::to_string);
    Ok(Protrusion {
        plugin: PluginRef::new(plugin_id, from),
        title,
        subtitle: opt(o, "subtitle", 160),
        icon: face_or_icon(get(o, "icon"), from.main)?,
        state,
        progress: get(o, "progress").as_f64().filter(|f| f.is_finite()).map(|f| f.clamp(0.0, 1.0)),
        timer,
        live_text: live_ref("live_text")?,
        transcript: live_ref("transcript")?,
        note: opt_text(o, "note", 40)?,
        mascot,
        actions: buttons(get(o, "actions"), 2)?,
        updated_at: now,
    })
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub title: String,
    pub sub: Option<String>,
    pub value: Option<String>,
    pub state: Option<String>,
    /// A Claude Code session id (`session_window::valid_session`): the page shows "Open terminal" and calls
    /// `cc_focus_terminal {sessionId}`; Notch resolves it only through the main assistant's `cc.sessions.set`.
    pub session: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Block {
    Heading {
        text: String,
    },
    Text {
        text: String,
    },
    List {
        rows: Vec<Row>,
    },
    Kv {
        rows: Vec<Kv>,
    },
    Progress {
        value: f64,
        label: Option<String>,
    },
    Timer {
        #[serde(rename = "startedAt")]
        started_at: String,
        label: Option<String>,
    },
    Buttons {
        buttons: Vec<Button>,
    },
    /// A checked PNG/JPEG `data:` URL. shortcut: passed through after the magic-byte and size check, not
    /// re-encoded (the API says Notch re-encodes); add an image crate in Wave 4 if a decoder bug matters.
    Image {
        src: String,
    },
    /// A quota bar. The plugin sends `value` / `threshold` in 0..100; the page gets 0..1
    /// (plugin-api.ts `MeterBlock`: `note` = the reset text, `mark` = the threshold line).
    Meter {
        label: String,
        value: f64,
        note: Option<String>,
        mark: Option<f64>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Kv {
    pub k: String,
    pub v: String,
}

const STATES: [&str; 6] = ["idle", "info", "attention", "done", "danger", "tired"];

fn rows<T>(v: &Value, f: impl Fn(&Map<String, Value>) -> Result<T, Bad>) -> Result<Vec<T>, Bad> {
    let a = v.as_array().ok_or("rows must be a list")?;
    if a.len() > MAX_ROWS {
        return Err(format!("at most {MAX_ROWS} rows"));
    }
    a.iter().map(|r| f(obj(r)?)).collect()
}

fn image(v: &Value) -> Result<String, Bad> {
    let s = v.as_str().ok_or("image.data gerekli")?;
    let (head, b64) = s.split_once(',').ok_or("image: expected a data: URL")?;
    let png = head == "data:image/png;base64";
    if !png && head != "data:image/jpeg;base64" {
        return Err("image: PNG or JPEG only".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|_| "image: bad base64")?;
    let magic_ok = if png { bytes.starts_with(b"\x89PNG\r\n\x1a\n") } else { bytes.starts_with(&[0xFF, 0xD8, 0xFF]) };
    if bytes.len() > MAX_IMAGE || !magic_ok {
        return Err("image: 256 KB at most, a real PNG/JPEG".into());
    }
    Ok(s.to_string())
}

fn percent(v: &Value, k: &str) -> Result<f64, Bad> {
    let f = v.as_f64().filter(|f| f.is_finite()).ok_or_else(|| format!("{k}: a number 0..100"))?;
    Ok(f.clamp(0.0, 100.0) / 100.0)
}

/// One block; None = a type this Notch does not draw (the caller drops only that block and logs it).
fn block(b: &Value) -> Result<Option<Block>, Bad> {
    let o = obj(b)?;
    Ok(Some(match get(o, "type").as_str() {
        Some("heading") => Block::Heading { text: need(o, "text", 80)? },
        Some("text") => Block::Text { text: need(o, "text", 2_000)? },
        Some("list") => Block::List {
            rows: rows(get(o, "rows"), |r| {
                Ok(Row {
                    title: need(r, "title", 80)?,
                    sub: opt(r, "subtitle", 160),
                    value: opt(r, "value", 40),
                    state: get(r, "state").as_str().filter(|s| STATES.contains(s)).map(str::to_string),
                    session: session(r)?,
                })
            })?,
        },
        Some("kv") => {
            Block::Kv { rows: rows(get(o, "rows"), |r| Ok(Kv { k: need(r, "key", 40)?, v: need(r, "value", 160)? }))? }
        }
        Some("progress") => Block::Progress {
            value: get(o, "value").as_f64().filter(|f| f.is_finite()).ok_or("progress.value gerekli")?.clamp(0.0, 1.0),
            label: opt(o, "label", 80),
        },
        Some("timer") => Block::Timer { started_at: iso(get(o, "started_at"))?, label: opt(o, "label", 80) },
        Some("buttons") => Block::Buttons { buttons: buttons(get(o, "buttons"), MAX_BUTTONS)? },
        Some("image") => Block::Image { src: image(get(o, "data"))? },
        Some("meter") => Block::Meter {
            label: need(o, "label", 80)?,
            value: percent(get(o, "value"), "meter.value")?,
            note: opt_text(o, "reset_note", 80)?,
            mark: match get(o, "threshold") {
                Value::Null => None,
                t => Some(percent(t, "meter.threshold")?),
            },
        },
        _ => return Ok(None),
    }))
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Tab {
    pub plugin: PluginRef,
    pub id: String,
    pub title: String,
    pub icon: Option<String>,
    /// Also drawn on the "General" page (plugin-api.ts `TabExt`).
    pub general: bool,
    pub blocks: Vec<Block>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SummaryRow {
    pub title: String,
    pub sub: Option<String>,
    pub value: Option<String>,
    /// plugin-api.ts `SummaryRowExt`: a `GLYPHS` name, a `STATES` word, one button (goes back as `action`).
    pub icon: Option<String>,
    pub state: Option<String>,
    pub action: Option<Button>,
    /// As `Row::session`.
    pub session: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Module {
    pub plugin: PluginRef,
    pub tabs: Vec<Tab>,
    /// The "General" page's lines (at most 3).
    pub summary: Vec<SummaryRow>,
    pub updated_at: u64,
    /// Blocks of an unknown type that were left out (the host logs the count, never the content).
    #[serde(skip)]
    pub skipped: usize,
}

pub fn module(p: &Value, from: Who, plugin_id: &str, now: u64) -> Result<Module, Bad> {
    no_markup_fields(p)?;
    let o = obj(p)?;
    let tabs = get(o, "tabs").as_array().map(Vec::as_slice).unwrap_or_default();
    if tabs.len() > MAX_TABS {
        return Err(format!("at most {MAX_TABS} tabs"));
    }
    let mut skipped = 0;
    let mut out = vec![];
    for t in tabs {
        let t = obj(t)?;
        let title = need(t, "title", 24)?;
        let raw = get(t, "blocks").as_array().ok_or("blocks must be a list")?;
        if raw.len() > MAX_BLOCKS {
            return Err(format!("at most {MAX_BLOCKS} blocks per tab"));
        }
        let mut blocks = vec![];
        for b in raw {
            match block(b)? {
                Some(b) => blocks.push(b),
                None => skipped += 1,
            }
        }
        out.push(Tab {
            plugin: PluginRef::new(plugin_id, from),
            id: need(t, "id", 64)?,
            icon: match get(t, "icon") {
                Value::Null => None,
                i if i.as_str().is_some_and(|s| GLYPHS.contains(&s)) => i.as_str().map(str::to_string),
                i => Some(icon(i)?),
            },
            title,
            general: flag(t, "general")?,
            blocks,
        });
    }
    let summary = get(o, "summary").as_array().map(Vec::as_slice).unwrap_or_default();
    if summary.len() > MAX_SUMMARY {
        return Err(format!("at most {MAX_SUMMARY} summary rows"));
    }
    let mut rows = vec![];
    for s in summary {
        let row = match s {
            Value::Object(r) => summary_row(r)?,
            s => display(s, 120).map(|title| SummaryRow {
                title,
                sub: None,
                value: None,
                icon: None,
                state: None,
                action: None,
                session: None,
            }),
        };
        rows.extend(row);
    }
    Ok(Module { plugin: PluginRef::new(plugin_id, from), tabs: out, summary: rows, updated_at: now, skipped })
}

/// A `{title, subtitle?, value?, icon?, state?, action?}` row; None when the title is empty after cleaning.
fn summary_row(r: &Map<String, Value>) -> Result<Option<SummaryRow>, Bad> {
    let pick = |k: &str, allowed: &[&str], err: &str| match get(r, k) {
        Value::Null => Ok(None),
        v => v.as_str().filter(|s| allowed.contains(s)).map(|s| Some(s.to_string())).ok_or_else(|| err.to_string()),
    };
    let icon = pick("icon", &GLYPHS, "summary icon: ghost|terminal|users|pointer|brain|list|shield")?;
    let state = pick("state", &STATES, "summary state: idle|info|attention|done|danger|tired")?;
    let action = match get(r, "action") {
        Value::Null => None,
        a => Some(button(a)?),
    };
    let session = session(r)?;
    Ok(opt(r, "title", 120).map(|title| SummaryRow {
        title,
        sub: opt(r, "subtitle", 160),
        value: opt(r, "value", 40),
        icon,
        state,
        action,
        session,
    }))
}

/// A row's optional `session`: a plain Claude Code session id, else the message is refused.
fn session(r: &Map<String, Value>) -> Result<Option<String>, Bad> {
    match get(r, "session") {
        Value::Null => Ok(None),
        v => v
            .as_str()
            .filter(|s| crate::session_window::valid_session(s))
            .map(|s| Some(s.to_string()))
            .ok_or_else(|| "session: letters, digits, - and _ (128 at most)".into()),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Risk {
    Low,
    High,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalKind {
    Command,
    File,
    Network,
    Question,
    Plan,
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Opt {
    Allow,
    Always,
    Deny,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Choice {
    pub id: String,
    pub label: String,
    /// The preselected "recommended" choice (plugin-api.ts `ChoiceExt`).
    pub recommended: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Approval {
    pub plugin: PluginRef,
    pub id: String,
    /// The plugin's sub-source ("Claude Code"), drawn after the plugin's name; separators flattened.
    pub source: String,
    pub title: String,
    /// The protrusion's short heading (plugin-api.ts `ApprovalExt`), at most 24 characters.
    pub short_title: Option<String>,
    pub risk: Risk,
    pub kind: ApprovalKind,
    /// Code-box text, drawn as is (only control/bidi characters dropped; tags are NOT stripped: `echo <x>` is real).
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub path: Option<String>,
    pub detail: Option<String>,
    /// What the card offers; at high risk "always" is never here.
    pub options: Vec<Opt>,
    pub always_label: Option<String>,
    pub choices: Vec<Choice>,
    pub free_text: bool,
    /// A free-text box from a plugin that is NOT the main assistant: the card must show "This question is from <plugin.name>
    /// plugin; do not type passwords here" above the box (M-2: a plugin may phish for a token there).
    pub free_text_warning: bool,
    /// What the protrusion row may show: at high risk only "details".
    pub protrusion_actions: Vec<&'static str>,
    pub expires_s: u64,
    #[serde(skip)]
    pub shown_at: u64,
    #[serde(skip)]
    pub expires_at: u64,
}

/// Raw text for code boxes: control/bidi dropped, nothing else touched.
fn code(o: &Map<String, Value>, k: &str, limit: usize) -> Option<String> {
    plain(get(o, k), limit)
}

pub fn approval(p: &Value, from: Who, plugin_id: &str, now: u64) -> Result<Approval, Bad> {
    no_markup_fields(p)?;
    let o = obj(p)?;
    // The plugin's word only; missing or unknown is high.
    let risk = if get(o, "risk").as_str() == Some("low") { Risk::Low } else { Risk::High };
    let kind = match get(o, "kind").as_str() {
        Some("command") => ApprovalKind::Command,
        Some("file") => ApprovalKind::File,
        Some("network") => ApprovalKind::Network,
        Some("question") => ApprovalKind::Question,
        Some("plan") => ApprovalKind::Plan,
        Some("other") => ApprovalKind::Other,
        _ => return Err("kind: command|file|network|question|plan|other".into()),
    };
    let (command, cwd, path) = (code(o, "command", 4_000), code(o, "cwd", 1_024), code(o, "path", 1_024));
    if kind == ApprovalKind::Command && (command.is_none() || cwd.is_none()) {
        return Err("kind=command needs command and cwd".into());
    }
    if kind == ApprovalKind::File && path.is_none() {
        return Err("kind=file needs path".into());
    }
    let mut options = vec![];
    match get(o, "options") {
        Value::Null => options.extend([Opt::Allow, Opt::Deny]),
        Value::Array(a) => {
            for v in a {
                let opt = match v.as_str() {
                    Some("allow") => Opt::Allow,
                    Some("always") => Opt::Always,
                    Some("deny") => Opt::Deny,
                    _ => return Err("options: allow|always|deny".into()),
                };
                if !options.contains(&opt) {
                    options.push(opt);
                }
            }
        }
        _ => return Err("options must be a list".into()),
    }
    let always_label = opt(o, "always_label", 80);
    if options.contains(&Opt::Always) && always_label.is_none() {
        return Err("'always' needs always_label".into());
    }
    if risk == Risk::High {
        options.retain(|x| *x != Opt::Always); // Notch removes it; no "Always" at high risk
    }
    let choices = match get(o, "choices") {
        Value::Null => vec![],
        Value::Array(a) if a.len() <= 6 => a
            .iter()
            .map(|c| {
                let c = obj(c)?;
                Ok(Choice {
                    id: need(c, "id", 64)?,
                    label: need(c, "label", 80)?,
                    recommended: flag(c, "recommended")?,
                })
            })
            .collect::<Result<_, Bad>>()?,
        _ => return Err("choices: at most 6 {id, label}".into()),
    };
    let free_text = get(o, "free_text").as_bool().unwrap_or(false);
    let expires_s = get(o, "expires_s").as_u64().unwrap_or(DEFAULT_EXPIRES_S).clamp(10, MAX_EXPIRES_S);
    let title = need(o, "title", 120)?;
    let source = opt(o, "source", 40).unwrap_or_default();
    let protrusion_actions = match risk {
        Risk::High => vec!["details"],
        Risk::Low => {
            let mut a: Vec<&'static str> = vec![];
            if options.contains(&Opt::Allow) {
                a.push("allow");
            }
            a.extend(["deny", "details"]);
            a
        }
    };
    Ok(Approval {
        plugin: PluginRef::new(plugin_id, from),
        id: need(o, "id", 64)?,
        source,
        title,
        short_title: opt_text(o, "short_title", 24)?,
        risk,
        kind,
        command,
        cwd,
        path,
        detail: opt(o, "detail", 2_000),
        options,
        always_label: if risk == Risk::High { None } else { always_label },
        choices,
        free_text,
        free_text_warning: free_text && !from.main,
        protrusion_actions,
        expires_s,
        shown_at: now,
        expires_at: now + expires_s * 1000,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const MAIN: Who = Who { name: "Compass", main: true };
    const OTHER: Who = Who { name: "Sample", main: false };

    fn prot(v: Value, from: Who) -> Result<Protrusion, Bad> {
        protrusion(&v, from, "p", 0)
    }

    #[test]
    fn html_link_and_icon_fields_are_refused_and_tags_are_stripped() {
        for bad in [
            json!({"title":"x","state":"info","icon":"bell","html":"<b>x</b>"}),
            json!({"title":"x","state":"info","icon":"bell","actions":[{"id":"a","label":"Open","href":"https://x"}]}),
            json!({"title":"x","state":"info","icon":"bell","icon_url":"https://x/logo.png"}),
            json!({"title":"x","state":"info","icon":"https://x/logo.png"}),
            json!({"title":"x","state":"info","icon":"data:image/png;base64,AAAA"}),
            json!({"title":"x","state":"info","icon":"<svg/>"}),
        ] {
            assert!(prot(bad.clone(), OTHER).is_err(), "{bad}");
        }
        let p = prot(
            json!({"title":"<b>Derleme</b> <img src=x onerror=alert(1)>bitti","state":"done","icon":"check",
                            "subtitle":"a < b"}),
            OTHER,
        )
        .unwrap();
        assert_eq!(p.title, "Derleme bitti");
        assert_eq!(p.subtitle.as_deref(), Some("a < b"), "a lone < is text");
        assert_eq!(prot(json!({"title":"x","state":"info","icon":"★"}), OTHER).unwrap().icon, "★");
    }

    #[test]
    fn the_name_prefix_cannot_be_removed_or_faked() {
        // The page draws "<plugin.name> › <title>"; plugin.name is Notch's, a payload `plugin` field is ignored.
        let fake = json!({"id":"dev.notch","name":"Notch","main":true});
        let p = prot(
            json!({"title":"Notch › System update","state":"attention","icon":"bell","plugin":fake.clone()}),
            OTHER,
        )
        .unwrap();
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["plugin"], json!({"id":"p","name":"Sample","main":false}));
        assert_eq!(p.title, "Notch - System update", "no separator left to fake a second prefix");
        let p = prot(json!({"title":"\u{202e}»Windows","state":"info","icon":"bell"}), OTHER).unwrap();
        assert_eq!(p.title, "-Windows");
        let a = approval(
            &json!({"id":"1","title":"t","kind":"other","source":"Compass › Claude Code","plugin":fake}),
            OTHER,
            "p",
            0,
        )
        .unwrap();
        assert_eq!((a.plugin.name.as_str(), a.source.as_str()), ("Sample", "Compass - Claude Code"));
        let m = module(
            &json!({"tabs":[{"id":"t","title":"› Settings","blocks":[]}],"summary":["Notch: update"]}),
            OTHER,
            "p",
            0,
        )
        .unwrap();
        assert_eq!((m.tabs[0].title.as_str(), m.tabs[0].plugin.name.as_str()), ("- Settings", "Sample"));
        assert_eq!(m.summary[0].title, "Notch: update");
    }

    #[test]
    fn only_the_main_assistant_has_a_mascot() {
        let v = json!({"title":"x","state":"info","icon":"mic","mascot":"listening"});
        assert_eq!(prot(v.clone(), MAIN).unwrap().mascot.as_deref(), Some("listening"));
        assert_eq!(prot(v, OTHER).unwrap().mascot, None, "ignored, not refused");
        let unknown = json!({"title":"x","state":"info","icon":"mic","mascot":"https://x/face.gif"});
        assert_eq!(prot(unknown, MAIN).unwrap().mascot, None);
    }

    #[test]
    fn protrusion_shape_limits() {
        let ok = json!({"title":"x","state":"info","icon":"bell","progress":4,"timer":{"started_at":"2026-10-16T14:32:00Z"},
                        "actions":[{"id":"a","label":"Open","style":"primary"},{"id":"b","label":"Delete","style":"#f00"}]});
        let p = prot(ok, OTHER).unwrap();
        assert_eq!((p.progress, p.actions[1].style), (Some(1.0), ButtonStyle::Default), "colour is not free");
        assert!(prot(json!({"title":"x","state":"purple","icon":"bell"}), OTHER).is_err());
        let three = json!([{"id":"a","label":"1"},{"id":"b","label":"2"},{"id":"c","label":"3"}]);
        assert!(prot(json!({"title":"x","state":"info","icon":"bell","actions":three}), OTHER).is_err());
        assert!(prot(json!({"title":"x","state":"info","icon":"bell","timer":{"started_at":"javascript:1"}}), OTHER)
            .is_err());
    }

    #[test]
    fn card_module_at_most_three_tabs_and_checked_images() {
        let tab = |i: u8| json!({"id": format!("t{i}"), "title": "T", "blocks": [{"type":"text","text":"x"}]});
        assert!(module(&json!({"tabs":[tab(1),tab(2),tab(3)]}), OTHER, "p", 0).is_ok());
        assert!(module(&json!({"tabs":[tab(1),tab(2),tab(3),tab(4)]}), OTHER, "p", 0).is_err());
        assert!(module(&json!({"summary":["a","b","c","d"]}), OTHER, "p", 0).is_err());
        let png = format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\nrest")
        );
        let img = |d: &str| json!({"tabs":[{"id":"t","title":"T","blocks":[{"type":"image","data":d}]}]});
        assert!(module(&img(&png), OTHER, "p", 0).is_ok());
        let fake =
            format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(b"<svg onload=1>"));
        assert!(module(&img(&fake), OTHER, "p", 0).is_err(), "magic bytes");
        assert!(module(&img("data:image/svg+xml;base64,PHN2Zz4="), OTHER, "p", 0).is_err());
        let big = format!(
            "data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode([0xFF; MAX_IMAGE + 1])
        );
        assert!(module(&img(&big), OTHER, "p", 0).is_err());
        let link = json!({"tabs":[{"id":"t","title":"T","blocks":[{"type":"buttons","buttons":[{"id":"a","label":"x","url":"https://x"}]}]}]});
        assert!(module(&link, OTHER, "p", 0).is_err());
    }

    #[test]
    fn approval_risk_missing_or_unknown_is_high_and_high_has_no_always_and_details_only() {
        let base = json!({"id":"ap-1","source":"Claude Code","title":"Wants to run a command","kind":"command",
                          "command":"rm -rf build","cwd":"C:\\proje","options":["allow","always","deny"],
                          "always_label":"In this folder"});
        for risk in [Value::Null, json!("medium"), json!("LOW"), json!(0)] {
            let mut v = base.clone();
            v["risk"] = risk.clone();
            let a = approval(&v, MAIN, "p", 0).unwrap();
            assert_eq!(a.risk, Risk::High, "{risk}");
            assert_eq!(a.options, [Opt::Allow, Opt::Deny], "no 'Always' at high risk");
            assert_eq!((a.protrusion_actions.as_slice(), a.always_label.as_ref()), (["details"].as_slice(), None));
        }
        let mut low = base.clone();
        low["risk"] = json!("low");
        let a = approval(&low, MAIN, "p", 1000).unwrap();
        assert_eq!(a.options, [Opt::Allow, Opt::Always, Opt::Deny]);
        assert_eq!(a.protrusion_actions, ["allow", "deny", "details"]);
        assert_eq!((a.source.as_str(), a.expires_at, a.expires_s), ("Claude Code", 301_000, 300));
    }

    #[test]
    fn a_free_text_box_from_another_plugin_carries_the_warning_flag() {
        let q = json!({"id":"q","title":"Soru","kind":"question","free_text":true});
        assert!(!approval(&q, MAIN, "p", 0).unwrap().free_text_warning, "the main assistant's own box");
        let a = approval(&q, OTHER, "p", 0).unwrap();
        assert!(a.free_text && a.free_text_warning);
        assert_eq!(serde_json::to_value(&a).unwrap()["freeTextWarning"], json!(true));
        let no_box = json!({"id":"q","title":"Soru","kind":"question"});
        assert!(!approval(&no_box, OTHER, "p", 0).unwrap().free_text_warning, "no box, no warning");
    }

    #[test]
    fn sadakat_fields_pass_through_typed_and_capped() {
        // approvals.prompt: choices[].recommended, short_title (≤ 24).
        let base = json!({"id":"1","title":"t","kind":"question","short_title":"I have a question, could you answer please",
                          "choices":[{"id":"a","label":"A","recommended":true},{"id":"b","label":"B"}]});
        let a = approval(&base, MAIN, "p", 0).unwrap();
        assert_eq!((a.choices[0].recommended, a.choices[1].recommended), (true, false));
        assert_eq!(a.short_title.as_deref().map(|s| s.chars().count()), Some(24), "cut at 24");
        let v = serde_json::to_value(&a).unwrap();
        assert_eq!((v["shortTitle"].is_string(), &v["choices"][0]["recommended"]), (true, &json!(true)));
        for (k, bad) in [("short_title", json!(5)), ("choices", json!([{"id":"a","label":"A","recommended":"yes"}]))] {
            let mut x = base.clone();
            x[k] = bad;
            assert!(approval(&x, MAIN, "p", 0).is_err(), "{k}");
        }
        // island.protrusion: transcript {stream_id} like live_text, note (≤ 40).
        let p = prot(
            json!({"title":"x","state":"info","icon":"mic","transcript":{"stream_id":"v1"},
                            "note":"draft ready <b>!</b>"}),
            MAIN,
        )
        .unwrap();
        assert_eq!((p.transcript.unwrap().stream_id.as_str(), p.note.as_deref()), ("p:v1", Some("draft ready !")));
        assert_eq!(
            prot(json!({"title":"x","state":"info","icon":"mic","note":"n".repeat(99)}), MAIN)
                .unwrap()
                .note
                .unwrap()
                .len(),
            40
        );
        assert!(prot(json!({"title":"x","state":"info","icon":"mic","transcript":{}}), MAIN).is_err(), "stream_id");
        assert!(prot(json!({"title":"x","state":"info","icon":"mic","transcript":"v1"}), MAIN).is_err());
        assert!(prot(json!({"title":"x","state":"info","icon":"mic","note":7}), MAIN).is_err());
        // card.module: tab general, summary icon / state / action.
        let m = |v: Value| module(&v, OTHER, "p", 0);
        let tab = json!({"id":"cc","title":"Claude Code","icon":"terminal","general":true,"blocks":[]});
        let row =
            json!({"title":"Session","icon":"terminal","state":"attention","action":{"id":"stop","label":"Stop"}});
        let got = m(json!({"tabs":[tab.clone()],"summary":[row.clone(),"plain row"]})).unwrap();
        assert!(got.tabs[0].general && got.tabs[0].icon.as_deref() == Some("terminal"));
        let r = &got.summary[0];
        assert_eq!(
            (r.icon.as_deref(), r.state.as_deref(), r.action.as_ref().map(|b| b.id.as_str())),
            (Some("terminal"), Some("attention"), Some("stop"))
        );
        assert_eq!((got.summary[1].title.as_str(), got.summary[1].icon.as_ref()), ("plain row", None));
        let mut t = tab.clone();
        t["general"] = json!("yes");
        assert!(m(json!({"tabs":[t]})).is_err(), "general is a bool");
        for (k, bad) in [
            ("icon", json!("rocket")),
            ("icon", json!("https://x/i.png")),
            ("icon", json!(1)),
            ("state", json!("purple")),
            ("action", json!({"id":"a"})),
            ("action", json!({"id":"a","label":"x","url":"https://x"})),
        ] {
            let mut x = row.clone();
            x[k] = bad.clone();
            assert!(m(json!({"summary":[x]})).is_err(), "{k} {bad}");
        }
    }

    #[test]
    fn an_unknown_block_drops_only_itself_and_meter_is_bounded() {
        let blocks = |b: Value| module(&json!({"tabs":[{"id":"t","title":"T","blocks":b}]}), OTHER, "p", 0);
        let m =
            blocks(json!([{"type":"text","text":"stays"},{"type":"chart","data":[1,2]},{"type":"heading","text":"h"}]))
                .unwrap();
        assert_eq!((m.tabs[0].blocks.len(), m.skipped), (2, 1), "the card stays, one block goes");
        assert!(blocks(json!([{"type":"text"}])).is_err(), "a known type with bad fields still refuses");
        let meter = |v: Value| blocks(json!([v])).map(|m| m.tabs[0].blocks[0].clone());
        let got = meter(
            json!({"type":"meter","label":"5-hour","value":42,"reset_note":"resets at 14:30","threshold":80}),
        )
        .unwrap();
        assert_eq!(
            got,
            Block::Meter {
                label: "5-hour".into(),
                value: 0.42,
                note: Some("resets at 14:30".into()),
                mark: Some(0.8)
            }
        );
        let v = serde_json::to_value(&got).unwrap();
        assert_eq!(
            v,
            json!({"type":"meter","label":"5-hour","value":0.42,"note":"resets at 14:30","mark":0.8}),
            "the page's MeterBlock"
        );
        let at = |value: Value, threshold: Value| match meter(
            json!({"type":"meter","label":"x","value":value,"threshold":threshold}),
        ) {
            Ok(Block::Meter { value, mark, .. }) => Ok((value, mark)),
            other => Err(format!("{other:?}")),
        };
        assert_eq!(at(json!(-5), json!(null)), Ok((0.0, None)));
        assert_eq!(at(json!(150), json!(250)), Ok((1.0, Some(1.0))));
        assert_eq!(at(json!(100), json!(0)), Ok((1.0, Some(0.0))));
        assert!(at(json!("50"), json!(null)).is_err() && at(json!(null), json!(null)).is_err());
        assert!(at(json!(5), json!("80")).is_err());
        assert!(meter(json!({"type":"meter","value":5})).is_err(), "label");
        assert!(meter(json!({"type":"meter","label":"x","value":5,"reset_note":3})).is_err());
    }

    #[test]
    fn face_icons_and_dikkat_only_for_the_main_assistant() {
        for f in FACE_ICONS {
            let v = json!({"title":"x","state":"attention","icon":f});
            assert_eq!(prot(v.clone(), MAIN).unwrap().icon, f);
            assert!(prot(v, OTHER).is_err(), "{f}: refused for a non-main plugin");
        }
        let v = json!({"title":"x","state":"attention","icon":"warning","mascot":"attention"});
        assert_eq!(prot(v.clone(), MAIN).unwrap().mascot.as_deref(), Some("attention"));
        assert_eq!(prot(v, OTHER).unwrap().mascot, None);
        assert!(
            prot(json!({"title":"x","state":"info","icon":"surprised"}), MAIN).is_err(),
            "a mascot state is not an icon"
        );
        for i in ["ticket", "video"] {
            let v = json!({"title":"x","state":"attention","icon":i});
            assert_eq!(prot(v, OTHER).unwrap().icon, i, "{i}: the page draws it, any plugin may use it");
        }
    }

    #[test]
    fn approval_typed_fields() {
        let ok = |v: Value| approval(&v, MAIN, "p", 0);
        assert!(ok(json!({"id":"1","title":"t","kind":"command","command":"ls"})).is_err(), "cwd missing");
        assert!(ok(json!({"id":"1","title":"t","kind":"file"})).is_err(), "path missing");
        assert!(ok(json!({"id":"1","title":"t","kind":"exec"})).is_err());
        assert!(ok(json!({"id":"1","title":"t","kind":"other","options":["always"]})).is_err(), "always_label");
        assert!(ok(json!({"id":"1","title":"t","kind":"other","options":["run"]})).is_err());
        let seven: Vec<Value> = (0..7).map(|i| json!({"id": i.to_string(), "label": "x"})).collect();
        assert!(ok(json!({"id":"1","title":"t","kind":"question","choices":seven})).is_err());
        let a = ok(
            json!({"id":"1","title":"t","kind":"command","command":"echo <x> | more","cwd":"C:\\","expires_s":99999}),
        )
        .unwrap();
        assert_eq!((a.command.as_deref(), a.expires_at), (Some("echo <x> | more"), 3_600_000), "code is kept as is");
    }

    #[test]
    fn a_row_may_name_a_session_and_nothing_else_there() {
        let list = json!({"type":"list","rows":[{"title":"proje","session":"s-1"}]});
        let ok = json!({"tabs":[{"id":"cc","title":"Claude Code","blocks":[list]}],"summary":[{"title":"x","session":"s-2"}]});
        let m = module(&ok, OTHER, "p", 0).unwrap();
        let Block::List { rows } = &m.tabs[0].blocks[0] else { panic!("list") };
        assert_eq!((rows[0].session.as_deref(), m.summary[0].session.as_deref()), (Some("s-1"), Some("s-2")));
        for bad in [json!("../x"), json!(42), json!("a b")] {
            assert!(module(&json!({"summary":[{"title":"x","session":bad}]}), OTHER, "p", 0).is_err(), "{bad}");
        }
    }
}
