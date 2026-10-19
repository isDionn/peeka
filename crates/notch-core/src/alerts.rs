//! Notch's own alert list (its field rules) and the attention budget
//! (owner decision 16) that decides which one alert may open the island by itself.
//!
//!
//! An alert WITH an expiry goes away by itself; an activity without one stays until removed. The same id replaces
//! the item. Text is plain text (the page draws it as text); a link is only ever an http(s) URL; nothing here runs
//! or opens anything. All times are Unix milliseconds passed in by the caller (tests use fixed numbers).

use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value;

use crate::presence::{self, Presence};

pub const ICONS: &[&str] = &[
    "bell",
    "chat",
    "mail",
    "call",
    "download",
    "upload",
    "timer",
    "clock",
    "calendar",
    "check",
    "error",
    "warning",
    "info",
    "code",
    "sync",
    "heart",
    "star",
    "mic",
    "camera",
    "location",
    "wifi",
    "bluetooth",
    "music",
    "volume",
    "mute",
    "battery",
    "charging",
    "headphones",
    "folder",
    "ticket",
    "video",
];
pub const MAX_ITEMS: usize = 50;
const MAX_ID: usize = 64;
const MAX_TITLE: usize = 120;
const MAX_SUBTITLE: usize = 300;
const MAX_ACTION: usize = 500;
const NOTIFY_MS: u64 = 5_000;
const MAX_DURATION_MS: u64 = 86_400_000;
/// A plugin (the HTTP adapter is one) gets 0-69; 70 and up are Notch's own and approvals.
pub const PLUGIN_MAX_PRIORITY: u8 = 69;
const DEFAULT_PRIORITY: u8 = 50;
/// How long an approval may drop the hidden strip in fullscreen (owner decision 16).
pub const DROP_STRIP_MS: u64 = 4_000;
/// How long the Focus Guard summary ("N held while you were busy") stays.
const HELD_MS: u64 = 8_000;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Style {
    #[default]
    Standard,
    /// A level bar (volume, battery).
    Level,
}

/// The ranks that matter to Notch: an approval outranks everything and alone passes DND and fullscreen.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    #[default]
    Alert,
    /// Wave 3 (`approvals.prompt`); nothing produces it yet.
    Approval,
}

/// What the alert's button opens. On the wire (`action: string | null`) a link is the URL itself and the Task
/// Manager the word `"task_manager"`; `open_alert` acts on this type, never on the string, so no input can turn one
/// into the other (a body's `"action": "task_manager"` is not a link and is dropped).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Action {
    /// A checked http(s) link (`web_link`).
    Link(String),
    /// `Taskmgr.exe` by its full path; the button says "Open in Task Manager".
    TaskManager,
}

impl Serialize for Action {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(match self {
            Action::Link(l) => l,
            Action::TaskManager => "task_manager",
        })
    }
}

pub const TASK_MANAGER_LABEL: &str = "Open in Task Manager";

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Alert {
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub icon: Option<String>,
    /// `#RRGGBB` or None (the island's own grey).
    pub color: Option<String>,
    /// 0..=1
    pub progress: Option<f64>,
    pub priority: u8,
    /// Opened only after the owner's click.
    pub action: Option<Action>,
    /// The button's text (bridge.ts `actionLabel`); Notch's own words only, None = "Open".
    pub action_label: Option<String>,
    pub style: Style,
    /// May open the island by itself when it arrives (the attention budget still decides).
    pub expand: bool,
    pub kind: Kind,
    /// "api", "volume", "power", "bluetooth".
    pub source: String,
    /// Unix ms; None = stays until removed.
    pub expires_at: Option<u64>,
    pub updated_at: u64,
}

impl Alert {
    /// One of Notch's own alerts (70-100), shown for `ms`.
    pub fn system(id: &str, source: &str, title: String, priority: u8, now: u64, ms: u64) -> Self {
        Self {
            id: id.into(),
            title,
            priority,
            source: source.into(),
            expires_at: Some(now + ms),
            updated_at: now,
            ..Self::default()
        }
    }
}

/// The body cannot become an alert at all (HTTP 422); the text is shown to the script.
#[derive(Debug, PartialEq, Eq)]
pub struct Invalid(pub &'static str);

/// Unicode format characters (Cf) and private use (Co) that `char::is_control` (Cc only) misses: bidi overrides,
/// zero-width joiners and BOMs among them. shortcut: unassigned code points (Cn) are kept; std has no table for them.
fn invisible(c: char) -> bool {
    matches!(c as u32,
        0xAD | 0x600..=0x605 | 0x61C | 0x6DD | 0x70F | 0x180E | 0x200B..=0x200F | 0x202A..=0x202E
        | 0x2060..=0x2064 | 0x2066..=0x206F | 0xFEFF | 0xFFF9..=0xFFFB | 0x110BD | 0x1D173..=0x1D17A
        | 0xE0001 | 0xE0020..=0xE007F | 0xE000..=0xF8FF | 0xF0000..=0x10FFFF)
}

/// Plain text: control, format and private-use characters dropped, trimmed, cut to `limit` chars. None when empty.
pub fn text(v: &Value, limit: usize) -> Option<String> {
    let clean: String = v.as_str()?.chars().filter(|c| !c.is_control() && !invisible(*c)).collect();
    let cut: String = clean.trim().chars().take(limit).collect();
    (!cut.is_empty()).then_some(cut)
}

fn number(v: &Value) -> Option<f64> {
    v.as_f64().filter(|f| f.is_finite()) // a JSON bool is not a number here
}

/// A name from ICONS, or ONE character (an emoji's variation selector or skin tone may ride along).
fn icon(v: &Value) -> Option<String> {
    let t = text(v, 8)?;
    let chars: Vec<char> = t.chars().collect();
    let modifier = |c: char| c == '\u{FE0F}' || ('\u{1F3FB}'..='\u{1F3FF}').contains(&c);
    let ok = ICONS.contains(&t.as_str()) || chars.len() == 1 || (chars.len() == 2 && modifier(chars[1]));
    ok.then_some(t)
}

fn color(v: &Value) -> Option<String> {
    let s = v.as_str()?;
    let ok = s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit());
    ok.then(|| s.to_string())
}

/// Only a plain web link: http(s) with a host, no spaces or control characters, no credentials, at most 500 chars.
pub fn web_link(v: &Value) -> Option<String> {
    let s = v.as_str()?;
    if s.is_empty() || s.chars().count() > MAX_ACTION || s.chars().any(|c| (c as u32) <= 32 || c as u32 == 127) {
        return None;
    }
    let url = url::Url::parse(s).ok()?;
    let ok = matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some_and(|h| !h.is_empty())
        && url.username().is_empty()
        && url.password().is_none();
    ok.then(|| s.to_string())
}

/// Body of `POST /notify` (`notify`) or `/activity` -> (alert, names of the optional fields that were dropped).
/// Bad VALUES of optional fields are dropped and named; a body with neither title nor progress is `Invalid`.
pub fn parse(body: &Value, notify: bool, now: u64, fallback_id: String) -> Result<(Alert, Vec<&'static str>), Invalid> {
    let obj = body.as_object().ok_or(Invalid("expected a JSON object"))?;
    let null = Value::Null;
    let get = |k: &str| obj.get(k).unwrap_or(&null);
    let mut dropped = vec![];
    let mut keep = |name: &'static str, parsed: Option<String>| {
        if !get(name).is_null() && parsed.is_none() {
            dropped.push(name);
        }
        parsed
    };
    let subtitle = keep("subtitle", text(get("subtitle"), MAX_SUBTITLE));
    let icon = keep("icon", icon(get("icon")));
    let color = keep("color", color(get("color")));
    let action = keep("action", web_link(get("action"))).map(Action::Link);
    let progress = number(get("progress"));
    let duration = number(get("duration")).filter(|d| *d > 0.0);
    let priority = number(get("priority"));
    for (name, ok) in
        [("progress", progress.is_some()), ("duration", duration.is_some()), ("priority", priority.is_some())]
    {
        if !get(name).is_null() && !ok {
            dropped.push(name);
        }
    }
    let progress = progress.map(|p| p.clamp(0.0, 1.0));
    let title = text(get("title"), MAX_TITLE);
    if title.is_none() && progress.is_none() {
        return Err(Invalid("send at least 'title' or 'progress'"));
    }
    let ms = duration.map(|d| ((d * 1000.0) as u64).min(MAX_DURATION_MS)).or(notify.then_some(NOTIFY_MS));
    let alert = Alert {
        id: text(get("id"), MAX_ID).unwrap_or(fallback_id),
        title: title.unwrap_or_default(),
        subtitle,
        icon,
        color,
        progress,
        priority: priority.map_or(DEFAULT_PRIORITY, |p| p.clamp(0.0, f64::from(PLUGIN_MAX_PRIORITY)) as u8),
        action,
        style: if get("style").as_str().is_some_and(|s| s.eq_ignore_ascii_case("level")) {
            Style::Level
        } else {
            Style::Standard
        },
        expand: get("expand").as_bool().unwrap_or(notify),
        kind: Kind::Alert,
        action_label: None,
        source: "api".into(),
        expires_at: ms.map(|ms| now + ms),
        updated_at: now,
    };
    Ok((alert, dropped))
}

/// What may open the island right now (owner decision 16). `fullscreen` = the strips are hidden.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Attention {
    pub dnd: bool,
    /// The main assistant's `meeting.set` (false again when it disconnects).
    pub meeting: bool,
    pub fullscreen: bool,
    /// A known call app holds the microphone (`privacy::call_active`); never carries a name.
    pub call: bool,
    pub presence: Presence,
}

/// Focus Guard (B2): a fullscreen app is in front or a call is on.
pub fn busy(ctx: &Attention) -> bool {
    ctx.fullscreen || ctx.call
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Gate {
    /// May open the island by itself.
    Show,
    /// Stays in the list and the count only.
    Wait,
    /// An approval over a fullscreen app: the strip comes down for `DROP_STRIP_MS`.
    DropStrip,
}

pub fn gate(a: &Alert, ctx: &Attention) -> Gate {
    let approval = a.kind == Kind::Approval;
    if ctx.fullscreen {
        // Never over an exclusive D3D game: a topmost window could minimise it; the approval waits in the count.
        return if approval && presence::may_drop_for_approval(ctx.presence) { Gate::DropStrip } else { Gate::Wait };
    }
    if approval {
        return Gate::Show;
    }
    // An activity without an expiry never opens the island by itself: it would hold it open for good.
    let quiet = ctx.dnd || ctx.meeting || ctx.call || presence::quiet(ctx.presence);
    if a.expand && a.expires_at.is_some() && !quiet {
        Gate::Show
    } else {
        Gate::Wait
    }
}

/// `alerts_changed` / `list_alerts` payload: the whole list (approvals first, then priority, then newest), the one
/// alert that may open the island now (at most one) and whether it drops the hidden strip.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertsView {
    pub items: Vec<Alert>,
    pub top: Option<String>,
    pub drop_strip_ms: Option<u64>,
}

#[derive(Default)]
pub struct AlertList {
    items: HashMap<String, Alert>,
    next: u64,
    /// Focus Guard: alerts that would have opened the island while busy -> their duration, restored afterwards.
    held: HashMap<String, u64>,
}

impl AlertList {
    /// A fresh id for a body without one.
    pub fn new_id(&mut self) -> String {
        self.next += 1;
        format!("a{}", self.next)
    }

    /// Drops what ran out; true = something did (the caller emits `alerts_changed`).
    pub fn prune(&mut self, now: u64) -> bool {
        let before = self.items.len();
        self.items.retain(|_, a| a.expires_at.is_none_or(|t| t > now));
        self.items.len() != before
    }

    /// Add or replace (same id). False = the list is full and this id is new (a script cannot grow it past 50).
    pub fn put(&mut self, mut a: Alert, now: u64) -> bool {
        self.prune(now);
        if !self.items.contains_key(&a.id) && self.items.len() >= MAX_ITEMS {
            return false;
        }
        a.updated_at = now;
        self.items.insert(a.id.clone(), a);
        true
    }

    /// One of Notch's own alerts: never refused for a full list - the lowest script item makes room.
    pub fn put_system(&mut self, mut a: Alert, now: u64) {
        self.prune(now);
        if !self.items.contains_key(&a.id) && self.items.len() >= MAX_ITEMS {
            let victim =
                self.items.values().filter(|x| x.source == "api").min_by_key(|x| x.priority).map(|x| x.id.clone());
            if let Some(id) = victim {
                self.items.remove(&id);
            }
        }
        a.updated_at = now;
        self.items.insert(a.id.clone(), a);
    }

    pub fn get(&self, id: &str) -> Option<&Alert> {
        self.items.get(id)
    }

    pub fn remove(&mut self, id: &str) -> bool {
        self.items.remove(id).is_some()
    }

    /// Removes every item from `source` (None = all); true = something went.
    pub fn clear(&mut self, source: Option<&str>) -> bool {
        let before = self.items.len();
        self.items.retain(|_, a| source.is_some_and(|s| a.source != s));
        self.items.len() != before
    }

    pub fn sorted(&self) -> Vec<Alert> {
        let mut list: Vec<Alert> = self.items.values().cloned().collect();
        list.sort_by(|a, b| {
            (b.kind == Kind::Approval)
                .cmp(&(a.kind == Kind::Approval))
                .then(b.priority.cmp(&a.priority))
                .then(b.updated_at.cmp(&a.updated_at))
                .then(a.id.cmp(&b.id))
        });
        list
    }

    /// Focus Guard, run before every view. While busy, an alert that would open the island stops running out (it is
    /// held); afterwards each gets its full time back, opens nothing itself, and one summary says how many were held.
    /// Approvals are never held. True = the list changed.
    pub fn focus(&mut self, ctx: &Attention, now: u64) -> bool {
        if busy(ctx) {
            let free = Attention { fullscreen: false, call: false, presence: Presence::Normal, ..*ctx };
            let mut changed = false;
            for a in self.items.values_mut().filter(|a| a.kind == Kind::Alert && gate(a, &free) == Gate::Show) {
                let ms = a.expires_at.take().unwrap_or(now).saturating_sub(a.updated_at);
                self.held.insert(a.id.clone(), ms);
                changed = true;
            }
            return changed;
        }
        if self.held.is_empty() {
            return false;
        }
        let mut n = 0;
        for (id, ms) in std::mem::take(&mut self.held) {
            if let Some(a) = self.items.get_mut(&id) {
                (a.expires_at, a.expand) = (Some(now + ms), false);
                n += 1;
            }
        }
        if n > 0 {
            let title = format!("{n} held while you were busy");
            let summary = Alert::system("system.focus", "focus", title, 70, now, HELD_MS);
            self.put_system(Alert { expand: true, icon: Some("bell".into()), ..summary }, now);
        }
        true
    }

    pub fn view(&self, ctx: &Attention) -> AlertsView {
        let items = self.sorted();
        let pick = items.iter().map(|a| (a, gate(a, ctx))).find(|(_, g)| *g != Gate::Wait);
        AlertsView {
            top: pick.map(|(a, _)| a.id.clone()),
            drop_strip_ms: pick.and_then(|(_, g)| (g == Gate::DropStrip).then_some(DROP_STRIP_MS)),
            items,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn alert(body: Value, notify: bool) -> Alert {
        parse(&body, notify, 1000, "gen".into()).unwrap().0
    }

    #[test]
    fn needs_title_or_progress() {
        assert!(parse(&json!({}), true, 0, "x".into()).is_err());
        assert!(parse(&json!([1, 2]), true, 0, "x".into()).is_err());
        let a = alert(json!({"progress": 2}), false);
        assert_eq!((a.progress, a.expires_at, a.id.as_str()), (Some(1.0), None, "gen"));
    }

    #[test]
    fn notify_defaults_to_five_seconds_and_activity_stays() {
        assert_eq!(alert(json!({"title": "x"}), true).expires_at, Some(6000));
        assert_eq!(alert(json!({"title": "x"}), false).expires_at, None);
        assert_eq!(alert(json!({"title": "x", "duration": 30}), false).expires_at, Some(31_000));
        assert_eq!(alert(json!({"title": "x", "duration": 1e9}), true).expires_at, Some(1000 + 86_400_000));
        let (a, dropped) = parse(&json!({"title": "x", "duration": -3}), true, 1000, "g".into()).unwrap();
        assert_eq!((a.expires_at, dropped), (Some(6000), vec!["duration"]));
    }

    #[test]
    fn priority_is_clamped_to_the_plugin_range_and_defaults_to_fifty() {
        assert_eq!(alert(json!({"title": "x"}), true).priority, 50);
        assert_eq!(alert(json!({"title": "x", "priority": 500}), true).priority, 69, "70+ is Notch's own");
        assert_eq!(alert(json!({"title": "x", "priority": -4}), true).priority, 0);
        assert_eq!(alert(json!({"title": "x", "priority": true}), true).priority, 50, "a bool is not a number");
    }

    #[test]
    fn an_action_is_a_web_link_or_nothing() {
        let long = format!("https://x.test/{}", "x".repeat(600));
        for link in [
            "file:///C:/Windows/System32/calc.exe",
            "javascript:alert(1)",
            "calc.exe",
            "ms-settings:",
            "ftp://x.test/a",
            "https://",
            "https://u:p@example.com/",
            "https://u@example.com/",
            "https://exa mple.com",
            "https://x.test/\n",
            "task_manager",
            long.as_str(),
        ] {
            let (a, dropped) = parse(&json!({"title": "x", "action": link}), true, 0, "g".into()).unwrap();
            assert_eq!((a.action, dropped), (None, vec!["action"]), "{link}");
        }
        let ok = alert(json!({"title": "x", "action": "https://example.com/build/7?a=1"}), true);
        assert_eq!(ok.action, Some(Action::Link("https://example.com/build/7?a=1".into())));
        assert_eq!(serde_json::to_value(&ok).unwrap()["action"], "https://example.com/build/7?a=1");
        let tm = Alert { action: Some(Action::TaskManager), ..Alert::default() };
        assert_eq!(serde_json::to_value(&tm).unwrap()["action"], "task_manager");
        assert!(alert(json!({"title": "x", "action": "http://127.0.0.1:3000"}), true).action.is_some());
    }

    #[test]
    fn colour_icon_style_and_text_are_sanitised() {
        let (a, dropped) = parse(
            &json!({"title": "a\u{202e}b\u{0}c\n", "subtitle": "<img src=x onerror=1>", "color": "red; x:url(1)",
                    "icon": "rocket", "style": "LEVEL"}),
            true,
            0,
            "g".into(),
        )
        .unwrap();
        assert_eq!(a.title, "abc", "bidi override and control characters gone");
        assert_eq!(a.subtitle.as_deref(), Some("<img src=x onerror=1>"), "stored as text; the page draws text");
        assert_eq!((a.color, a.icon, a.style), (None, None, Style::Level));
        assert_eq!(dropped, vec!["icon", "color"]);
        assert_eq!(alert(json!({"title": "x", "color": "#30D158"}), true).color.as_deref(), Some("#30D158"));
        assert_eq!(alert(json!({"title": "x", "color": "#abc"}), true).color, None, "#RRGGBB only");
        assert_eq!(alert(json!({"title": "x", "icon": "bell"}), true).icon.as_deref(), Some("bell"));
        assert_eq!(alert(json!({"title": "x", "icon": "🚀"}), true).icon.as_deref(), Some("🚀"));
        assert_eq!(alert(json!({"title": "x", "icon": "👍🏽"}), true).icon.as_deref(), Some("👍🏽"));
        assert_eq!(alert(json!({"title": "x", "icon": "ab"}), true).icon, None);
        assert!(
            parse(&json!({"title": "\u{200b}\u{feff}"}), true, 0, "g".into()).is_err(),
            "zero-width only = no title"
        );
        let long = alert(json!({"title": "t".repeat(500), "subtitle": "s".repeat(900), "id": "i".repeat(200)}), true);
        assert_eq!((long.title.len(), long.subtitle.unwrap().len(), long.id.len()), (120, 300, 64));
    }

    #[test]
    fn the_list_orders_by_priority_replaces_by_id_and_expires() {
        let mut l = AlertList::default();
        assert!(l.put(alert(json!({"id": "a", "title": "A", "priority": 10}), false), 1000));
        assert!(l.put(alert(json!({"id": "b", "title": "B", "priority": 60}), true), 1000));
        assert!(l.put(alert(json!({"id": "a", "title": "A2", "priority": 10}), false), 1001), "an update");
        let rows = l.sorted();
        assert_eq!(rows.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(), ["b", "a"]);
        assert_eq!(rows[1].title, "A2");
        assert!(!l.prune(5999) && l.prune(6000), "b ran out by itself");
        assert_eq!(l.sorted().len(), 1);
        assert!(l.remove("a") && !l.remove("a"));
    }

    #[test]
    fn the_list_is_bounded_and_a_script_cannot_starve_the_system_alerts() {
        let mut l = AlertList::default();
        for i in 0..MAX_ITEMS {
            assert!(l.put(alert(json!({"id": format!("s{i}"), "title": "x", "duration": 100}), false), 1));
        }
        assert!(!l.put(alert(json!({"id": "one-more", "title": "x"}), false), 1));
        l.put_system(Alert::system("system.volume", "volume", "Volume 30%".into(), 100, 1, 1600), 1);
        let rows = l.sorted();
        assert_eq!((rows.len(), rows[0].id.as_str()), (MAX_ITEMS, "system.volume"));
        assert!(l.clear(Some("api")) && l.sorted().len() == 1);
        assert!(l.clear(None) && l.sorted().is_empty());
    }

    fn sys(id: &str, priority: u8, expand: bool) -> Alert {
        Alert { expand, ..Alert::system(id, "power", "x".into(), priority, 0, 3000) }
    }

    #[test]
    fn attention_budget_one_self_opening_alert_and_quiet_times() {
        let mut l = AlertList::default();
        l.put_system(sys("low", 80, true), 0);
        l.put_system(sys("vol", 100, false), 0);
        l.put(Alert { expires_at: None, ..alert(json!({"id": "build", "title": "B", "expand": true}), false) }, 0);
        let normal = Attention::default();
        let v = l.view(&normal);
        assert_eq!(v.top.as_deref(), Some("low"), "the volume bar never opens it, an activity never holds it");
        assert_eq!(v.items[0].id, "vol", "the list itself is still by priority");
        assert_eq!(v.drop_strip_ms, None);
        for ctx in [
            Attention { dnd: true, ..normal },
            Attention { meeting: true, ..normal },
            Attention { presence: Presence::Presentation, ..normal },
            Attention { fullscreen: true, presence: Presence::Busy, ..normal },
        ] {
            assert_eq!(l.view(&ctx).top, None, "{ctx:?}");
        }
    }

    #[test]
    fn only_an_approval_passes_dnd_and_drops_the_strip_but_never_over_d3d() {
        let mut l = AlertList::default();
        l.put_system(sys("low", 100, true), 0);
        l.put_system(Alert { kind: Kind::Approval, ..sys("ok?", 70, false) }, 0);
        let v = l.view(&Attention { dnd: true, ..Attention::default() });
        assert_eq!((v.top.as_deref(), v.items[0].id.as_str()), (Some("ok?"), "ok?"), "approvals first");
        let full = Attention { fullscreen: true, presence: Presence::Busy, ..Attention::default() };
        assert_eq!(l.view(&full).drop_strip_ms, Some(4000));
        let d3d = Attention { presence: Presence::D3dFullscreen, ..full };
        assert_eq!((l.view(&d3d).top, l.view(&d3d).drop_strip_ms), (None, None), "waits in the count");
    }

    #[test]
    fn focus_guard_holds_while_busy_and_releases_one_summary() {
        let mut l = AlertList::default();
        l.put_system(sys("low", 80, true), 0);
        l.put(alert(json!({"id": "build", "title": "B"}), true), 1000); // notify: 5 s, expands
        l.put(alert(json!({"id": "quiet", "title": "Q", "expand": false}), true), 0);
        l.put(Alert { expires_at: None, ..alert(json!({"id": "act", "title": "A", "expand": true}), false) }, 0);
        l.put_system(Alert { kind: Kind::Approval, ..sys("ok?", 70, false) }, 0);
        for busy in [
            Attention { fullscreen: true, presence: Presence::Busy, ..Attention::default() },
            Attention { call: true, ..Attention::default() },
        ] {
            let mut l2 = AlertList { items: l.items.clone(), ..Default::default() };
            assert!(l2.focus(&busy, 1000) && !l2.focus(&busy, 1500), "held once");
            assert_eq!(l2.held.len(), 2, "low and build; not the quiet one, the activity or the approval");
            if busy.call {
                assert_eq!(l2.view(&busy).top.as_deref(), Some("ok?"), "an approval still comes through a call");
            }
            l2.prune(60_000);
            assert!(l2.get("build").is_some() && l2.get("low").is_some(), "held alerts do not run out");
            assert!(l2.get("quiet").is_none(), "the rest runs out as usual");
            assert!(l2.focus(&Attention::default(), 70_000), "released");
            let s = l2.get("system.focus").unwrap();
            assert_eq!(s.title, "2 held while you were busy");
            assert_eq!(l2.get("build").unwrap().expires_at, Some(75_000), "its full 5 s again");
            assert_eq!(l2.view(&Attention::default()).top.as_deref(), Some("system.focus"), "the only one that opens");
            assert!(!l2.focus(&Attention::default(), 71_000), "one summary only");
        }
    }

    #[test]
    fn focus_guard_says_nothing_when_nothing_was_held() {
        let mut l = AlertList::default();
        let call = Attention { call: true, ..Attention::default() };
        assert!(!l.focus(&call, 0) && !l.focus(&Attention::default(), 1));
        l.put(alert(json!({"id": "b", "title": "B"}), true), 2);
        assert!(l.focus(&call, 3));
        l.remove("b");
        assert!(l.focus(&Attention::default(), 4) && l.get("system.focus").is_none(), "gone meanwhile: no summary");
        let dnd = Attention { dnd: true, call: true, ..Attention::default() };
        l.put(alert(json!({"id": "c", "title": "C"}), true), 5);
        assert!(!l.focus(&dnd, 6), "DND already hides it; it runs out as usual");
    }

    #[test]
    fn the_view_serialises_camel_case() {
        let mut l = AlertList::default();
        l.put_system(sys("low", 80, true), 0);
        let v = serde_json::to_value(l.view(&Attention::default())).unwrap();
        assert_eq!(v["top"], "low");
        assert_eq!(v["items"][0]["expiresAt"], 3000);
        assert_eq!(v["items"][0]["kind"], "alert");
        assert!(v["dropStripMs"].is_null());
    }
}
