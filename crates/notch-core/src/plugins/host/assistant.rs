//! What only the main assistant can give the island (Fidelity 3; wire: `notch/docs/plugin-api.md` §11): the
//! status card's counts, the meeting card's calendar, the Claude Code bridge's health, the offline mode, a finished
//! job, the shelf suggestion; the owner's "Open" / "Add to Notes" back to it; the first-connect card and the
//! permission log. The main assistant pushes; Notch keeps the last value and the page reads it. Without a ready
//! main assistant every read is `NoMain` ("Assistant not connected"), before it has sent anything `NotYet`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{fail, notification, ConnId, Host, Out, OwnerErr, RpcErr, UiEvent};
use crate::plugins::registry::{PermissionEvent, PERMISSION_LOG_MAX};
use crate::plugins::{cc_hooks, code, items, Scope, MAX_MESSAGE};

/// Plugin -> Notch methods of this file, all main-assistant only, with the scope each needs.
pub(super) const METHODS: [(&str, Scope); 11] = [
    ("assistant.counts.set", Scope::CardModule),
    ("cc.sessions.set", Scope::CardModule),
    ("cc.event", Scope::IslandProtrusion),
    ("calendar.set", Scope::CardModule),
    ("claude.bridge.set", Scope::CardModule),
    ("assistant.offline", Scope::IslandProtrusion),
    ("meeting.set", Scope::IslandProtrusion),
    ("job.done", Scope::IslandProtrusion),
    ("shelf.suggestion", Scope::FilesDrop),
    // assistant slots (docs/plugin-api.md §11): events and last values for a build-time extension's own UI
    ("assistant.event", Scope::ComposerHandler),
    ("assistant.state.set", Scope::ComposerHandler),
];

/// `assistant.state.set`: at most this many keys, each value at most this large once serialized.
const MAX_STATE_KEYS: usize = 16;
const MAX_STATE_VALUE: usize = 64 * 1024;
/// `page.request`s still waiting for a reply; past this the oldest is forgotten (its page times out on its own).
const MAX_PAGES: usize = 32;
/// `assistant_reply` error code Peeka gives itself when the asked connection closed (the plugin's own codes pass
/// through as they came).
pub const PAGE_NOT_CONNECTED: i64 = -32022;

/// `assistant.event` type / `assistant.state.set` key: `^[a-z][a-z0-9_.]{0,31}$`.
fn slot_name(p: &Value, k: &str) -> Result<String, RpcErr> {
    let n = p.get(k).and_then(Value::as_str).unwrap_or_default();
    let mut cs = n.chars();
    let ok = n.len() <= 32
        && cs.next().is_some_and(|c| c.is_ascii_lowercase())
        && cs.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.');
    ok.then(|| n.to_string()).ok_or_else(|| bad(&format!("{k}: a-z first, then a-z 0-9 _ . (at most 32)")))
}

const MAX_COUNT: u64 = 9_999;
const MAX_CALENDAR: usize = 5;
/// `cc.sessions.set`: at most this many Claude Code sessions (no real desk comes near it).
const MAX_SESSIONS: usize = 32;
/// The main assistant's `cc.event`s win: Peeka's own hook pipe is ignored for this long after the last one (the
/// mascot's Claude Code state decays in the same 2 minutes).
const CC_MAIN_WINS_MS: u64 = 120_000;

/// `tool` / `reason` of `cc.event`: a short identifier (a tool name, a failure class), never free text.
fn cc_word(p: &Value, k: &str) -> Result<Option<String>, RpcErr> {
    match p.get(k) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v
            .as_str()
            .filter(|s| cc_hooks::word(s))
            .map(|s| Some(s.to_string()))
            .ok_or_else(|| bad("tool and reason: 64 characters at most, letters, digits, _ . : -")),
    }
}

/// `cc.event` params -> the page's `cc_event`; one check for the main assistant's call and Peeka's own hook.
fn cc_event(p: &Value) -> Result<UiEvent, RpcErr> {
    let kind = p
        .get("kind")
        .and_then(Value::as_str)
        .filter(|k| cc_hooks::CC_KINDS.contains(k))
        .ok_or_else(|| bad("kind: must be a known Claude Code event"))?;
    let sid = match p.get("sid") {
        None | Some(Value::Null) => None,
        Some(v) => Some(v.as_str().filter(|s| cc_hooks::is_sid(s)).ok_or_else(|| bad("sid: 8 lower-case hex characters"))?.to_string()),
    };
    let agent = match p.get("agent") {
        None | Some(Value::Null) => "claude",
        Some(v) => v.as_str().filter(|a| cc_hooks::AGENT_IDS.contains(a)).ok_or_else(|| bad("agent: must be a known agent"))?,
    };
    let origin = match p.get("origin") {
        None | Some(Value::Null) => None,
        Some(v) => Some(v.as_str().filter(|o| cc_hooks::ORIGINS.contains(o)).ok_or_else(|| bad("origin: terminal, desktop, cursor or vscode"))?.to_string()),
    };
    Ok(UiEvent::CcEvent { agent: agent.into(), kind: kind.into(), tool: cc_word(p, "tool")?, reason: cc_word(p, "reason")?, sid, origin })
}

/// fidelity-api.ts `AssistantCounts`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct AssistantCounts {
    pub jobs: u64,
    /// The "Notes" count.
    pub memory: u64,
    /// The "Waiting for approval" count (absent = 0, so an older bridge still works).
    pub approvals: u64,
}

/// bridge.ts `CalendarNext`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CalendarNext {
    pub detail: Option<String>,
    pub next: Vec<CalendarEntry>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CalendarEntry {
    pub time: String,
    pub title: String,
    pub source: String,
    /// ISO start with an offset (absent for all-day rows and for an older bridge): the reminder counts down to it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start: Option<String>,
    /// "Join" target: https on an allowlisted meeting host only (`meeting_link`), absent otherwise.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
}

/// The only hosts a calendar row's join link may point at (a subdomain counts); anything else is dropped.
const MEETING_HOSTS: [&str; 3] = ["teams.microsoft.com", "zoom.us", "meet.google.com"];

/// `2026-10-18T14:30:00+03:00`: date, time, optional fraction, then `Z` or an offset. The page parses it; this only
/// refuses what is not an instant.
fn iso_start(v: &Value) -> Option<String> {
    let s = v.as_str()?;
    let re = regex::Regex::new(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$").ok()?;
    re.is_match(s).then(|| s.to_string())
}

fn meeting_link(v: &Value) -> Option<String> {
    let s = crate::alerts::web_link(v)?;
    let url = url::Url::parse(&s).ok()?;
    let host = url.host_str()?.to_ascii_lowercase();
    let ok = url.scheme() == "https" && MEETING_HOSTS.iter().any(|h| host == *h || host.ends_with(&format!(".{h}")));
    ok.then_some(s)
}

/// fidelity-api.ts `BridgeState`; `last_event_ago_s` is aged by Notch from when the main assistant said it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeState {
    pub installed: bool,
    pub healthy: bool,
    pub last_event_ago_s: Option<u64>,
}

/// `assistant_open {kind}`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpenKind {
    Approval,
    Jobs,
    Memory,
}

/// The last values from the main assistant (`owner` = its id; another plugin becoming main never sees them).
#[derive(Debug, Default)]
pub(super) struct AssistantState {
    owner: String,
    counts: Option<AssistantCounts>,
    calendar: Option<CalendarNext>,
    bridge: Option<(BridgeState, u64)>,
    /// `cc.sessions.set`: session id -> its process id, the only pids "Open terminal" ever resolves.
    sessions: Vec<(String, u32)>,
    offline: bool,
    /// `meeting.set`: the owner is in a meeting (the attention budget goes quiet).
    meeting: bool,
    /// The open `shelf.suggest` request and its answer (None = not answered yet).
    shelf_req: u64,
    shelf_answer: Option<Option<String>>,
    /// When the main assistant last sent `cc.event`.
    main_cc: Option<u64>,
    /// `assistant.state.set`: the last value per key.
    state: BTreeMap<String, Value>,
}

fn bad(m: &str) -> RpcErr {
    fail(code::INVALID_PARAMS, m)
}

fn count(p: &Value, k: &str) -> Result<u64, RpcErr> {
    p.get(k)
        .and_then(Value::as_u64)
        .map(|n| n.min(MAX_COUNT))
        .ok_or_else(|| bad("jobs, memory and approvals must be numbers"))
}

impl Host {
    /// One of `METHODS` from `pid`, already checked to be the main assistant holding the scope.
    pub(super) fn assistant_call(
        &mut self,
        pid: &str,
        method: &str,
        p: &Value,
        now: u64,
        out: &mut Vec<Out>,
    ) -> Result<Value, RpcErr> {
        if self.assistant.owner != pid {
            let old = self.assistant.owner.clone();
            self.assistant_forget(&old, out); // a new main assistant must not inherit the old one's offline / meeting
            self.assistant.owner = pid.into();
        }
        let s = &mut self.assistant;
        match method {
            "assistant.counts.set" => {
                let approvals = match p.get("approvals") {
                    None | Some(Value::Null) => 0,
                    Some(_) => count(p, "approvals")?,
                };
                s.counts = Some(AssistantCounts { jobs: count(p, "jobs")?, memory: count(p, "memory")?, approvals });
            }
            "calendar.set" => {
                let rows = p.get("next").and_then(Value::as_array).ok_or_else(|| bad("next listesi gerekli"))?;
                let mut next = vec![];
                for r in rows.iter().take(MAX_CALENDAR) {
                    let f = |k: &str, n: usize| r.get(k).and_then(|v| items::display(v, n));
                    let (Some(time), Some(title)) = (f("time", 16), f("title", 120)) else {
                        return Err(bad("every row needs time and title"));
                    };
                    let (start, link) = (r.get("start").and_then(iso_start), r.get("link").and_then(meeting_link));
                    next.push(CalendarEntry { time, title, source: f("source", 40).unwrap_or_default(), start, link });
                }
                let detail = p.get("detail").and_then(|v| items::display(v, 120));
                s.calendar = Some(CalendarNext { detail, next });
            }
            "claude.bridge.set" => {
                let b = |k: &str| p.get(k).and_then(Value::as_bool).ok_or_else(|| bad("installed and healthy are required"));
                let last = p.get("last_event_ago_s").and_then(Value::as_u64);
                s.bridge = Some((
                    BridgeState { installed: b("installed")?, healthy: b("healthy")?, last_event_ago_s: last },
                    now,
                ));
            }
            "cc.sessions.set" => {
                let rows =
                    p.get("sessions").and_then(Value::as_array).ok_or_else(|| bad("sessions listesi gerekli"))?;
                if rows.len() > MAX_SESSIONS {
                    return Err(bad("at most 32 sessions"));
                }
                let mut next = Vec::with_capacity(rows.len());
                for r in rows {
                    let id = r.get("id").and_then(Value::as_str).filter(|i| crate::session_window::valid_session(i));
                    let pid =
                        r.get("pid").and_then(Value::as_u64).and_then(|n| u32::try_from(n).ok()).filter(|n| *n > 4);
                    let (Some(id), Some(pid)) = (id, pid) else {
                        return Err(bad("every session needs id (letters, digits, - _) and pid (positive integer)"));
                    };
                    next.push((id.to_string(), pid));
                }
                s.sessions = next;
            }
            "cc.event" => {
                out.push(Out::Ui(cc_event(p)?));
                s.main_cc = Some(now);
            }
            "assistant.offline" => {
                let on = p.get("on").and_then(Value::as_bool).ok_or_else(|| bad("on gerekli"))?;
                if on != s.offline {
                    s.offline = on;
                    out.push(Out::Ui(UiEvent::AssistantOffline(on)));
                }
            }
            "meeting.set" => {
                let on = p.get("active").and_then(Value::as_bool).ok_or_else(|| bad("active gerekli (true/false)"))?;
                if on != s.meeting {
                    s.meeting = on;
                    out.push(Out::Ui(UiEvent::Meeting(on)));
                }
            }
            "job.done" => {
                let title = p.get("title").and_then(|v| items::display(v, 120)).ok_or_else(|| bad("title gerekli"))?;
                let took = p.get("took").and_then(|v| items::display(v, 40)).unwrap_or_default();
                let seconds = match p.get("seconds") {
                    None | Some(Value::Null) => None,
                    Some(v) => Some(
                        v.as_f64()
                            .filter(|f| f.is_finite() && *f >= 0.0)
                            .ok_or_else(|| bad("seconds: zero or a positive number"))? as u64,
                    ),
                };
                out.push(Out::Ui(UiEvent::JobDone { title, took, seconds }));
            }
            "shelf.suggestion" => {
                if p.get("request").and_then(Value::as_u64) != Some(s.shelf_req) || s.shelf_answer.is_some() {
                    return Ok(json!({"ok": false})); // an older or already answered request: dropped quietly
                }
                s.shelf_answer = Some(p.get("text").and_then(|v| items::display(v, 300)));
            }
            "assistant.event" => {
                let kind = slot_name(p, "type")?;
                let data = p.get("data").filter(|d| d.is_object()).ok_or_else(|| bad("data must be an object"))?;
                out.push(Out::Ui(UiEvent::AssistantEvent(json!({"type": kind, "data": data}))));
            }
            "assistant.state.set" => {
                let key = slot_name(p, "key")?;
                match p.get("value") {
                    None | Some(Value::Null) => {
                        s.state.remove(&key);
                    }
                    Some(v) => {
                        if v.to_string().len() > MAX_STATE_VALUE {
                            return Err(fail(code::TOO_LARGE, "value exceeds 64 KB"));
                        }
                        if !s.state.contains_key(&key) && s.state.len() >= MAX_STATE_KEYS {
                            return Err(bad("at most 16 keys; send null to drop one"));
                        }
                        s.state.insert(key, v.clone());
                    }
                }
                out.push(Out::Ui(UiEvent::SurfacesChanged));
            }
            _ => return Err(fail(code::NO_METHOD, "no such method")),
        }
        Ok(json!({"ok": true}))
    }

    /// `SurfacesView.assistantState`: the ready main assistant's last values (empty without one).
    pub fn assistant_state(&self) -> BTreeMap<String, Value> {
        self.assistant_of_main().map(|s| s.state.clone()).unwrap_or_default()
    }

    /// The page asks the main assistant (`assistant_request`): only a name on the brand's `page_requests` list with an
    /// object as params, wrapped as `page.request {method, params}` with Peeka's own id, so the page can never send a
    /// line that looks like one of Peeka's own notifications. The reply comes back through [`Host::line`].
    pub fn page_request(&mut self, method: &str, params: Value) -> Result<(u64, Vec<Out>), OwnerErr> {
        if !crate::brand::PAGE_REQUESTS.contains(&method) || !params.is_object() {
            return Err(OwnerErr::Invalid);
        }
        self.page_send(method, params)
    }

    /// [`Host::page_request`] after its allow-list check (tests use it directly: Peeka's own list is empty).
    pub(super) fn page_send(&mut self, method: &str, params: Value) -> Result<(u64, Vec<Out>), OwnerErr> {
        let (_, conn) = self.main_ready().ok_or(OwnerErr::NoMain)?;
        let id = self.page_req + 1;
        let inner = json!({"method": method, "params": params});
        let line = json!({"jsonrpc": "2.0", "id": id, "method": "page.request", "params": inner}).to_string();
        if line.len() > MAX_MESSAGE {
            return Err(OwnerErr::Invalid);
        }
        self.page_req = id;
        if self.pages.len() >= MAX_PAGES {
            if let Some(oldest) = self.pages.keys().min().copied() {
                self.pages.remove(&oldest);
            }
        }
        self.pages.insert(id, conn);
        Ok((id, vec![Out::Send(conn, line)]))
    }

    /// A method-less line answering a waiting `page.request` on the connection that was asked? Anything else is not
    /// a page reply (`line` handles it as before).
    pub(super) fn is_page_reply(&self, conn: ConnId, msg: &Value) -> bool {
        msg.get("method").is_none()
            && msg.get("id").and_then(Value::as_u64).is_some_and(|id| self.pages.get(&id) == Some(&conn))
    }

    /// Only the result or the error code go to the page, never the plugin's message text.
    pub(super) fn page_reply(&mut self, msg: &Value, len: usize) -> Vec<Out> {
        let Some(id) = msg.get("id").and_then(Value::as_u64) else { return vec![] };
        self.pages.remove(&id);
        let reply = match (msg.get("result"), msg.get("error")) {
            _ if len > MAX_MESSAGE => json!({"id": id, "error": {"code": code::TOO_LARGE}}),
            (Some(r), None) => json!({"id": id, "result": r}),
            (_, e) => {
                let c = e.and_then(|e| e.get("code")).and_then(Value::as_i64).unwrap_or(code::INVALID_REQUEST);
                json!({"id": id, "error": {"code": c}})
            }
        };
        vec![Out::Ui(UiEvent::AssistantReply(reply))]
    }

    /// A connection closed: its waiting page requests end now (the page stops waiting).
    pub(super) fn page_gone(&mut self, conn: ConnId, out: &mut Vec<Out>) {
        let mut gone: Vec<u64> = self.pages.iter().filter(|(_, c)| **c == conn).map(|(id, _)| *id).collect();
        gone.sort_unstable();
        for id in gone {
            self.pages.remove(&id);
            out.push(Out::Ui(UiEvent::AssistantReply(json!({"id": id, "error": {"code": PAGE_NOT_CONNECTED}}))));
        }
    }

    /// The main assistant's values, only while it is the ready main assistant.
    fn assistant_of_main(&self) -> Result<&AssistantState, OwnerErr> {
        let (pid, _) = self.main_ready().ok_or(OwnerErr::NoMain)?;
        (self.assistant.owner == pid).then_some(&self.assistant).ok_or(OwnerErr::NotYet)
    }

    pub fn assistant_counts(&self) -> Result<AssistantCounts, OwnerErr> {
        self.assistant_of_main()?.counts.ok_or(OwnerErr::NotYet)
    }

    pub fn calendar_next(&self) -> Result<CalendarNext, OwnerErr> {
        self.assistant_of_main()?.calendar.clone().ok_or(OwnerErr::NotYet)
    }

    pub fn claude_bridge(&self, now: u64) -> Result<BridgeState, OwnerErr> {
        let (b, at) = self.assistant_of_main()?.bridge.ok_or(OwnerErr::NotYet)?;
        let aged = b.last_event_ago_s.map(|s| s + now.saturating_sub(at) / 1000);
        Ok(BridgeState { last_event_ago_s: aged, ..b })
    }

    /// One line from Peeka's own agent hook pipe (`peeka.exe --cc-hook`). None = not a valid `cc.event`;
    /// Some(empty) = valid, but the ready main assistant sent its own `cc.event` within the last 2 minutes (it wins:
    /// no double reaction while it forwards the same hook).
    pub fn cc_hook(&self, line: &[u8], now: u64) -> Option<Vec<Out>> {
        let p = serde_json::from_slice::<Value>(line).ok()?;
        let ev = cc_event(&p).ok()?;
        // the main assistant forwards Claude Code only: another agent's line always goes
        let claude = matches!(&ev, UiEvent::CcEvent { agent, .. } if agent == "claude");
        let main_live = claude
            && self.main_ready().is_some_and(|(pid, _)| pid == self.assistant.owner)
            && self.assistant.main_cc.is_some_and(|t| now.saturating_sub(t) < CC_MAIN_WINS_MS);
        // The main assistant's `cc.event` never carries an edit, so the edit goes out even while it wins.
        let n = |k: &str| p.pointer(&format!("/edit/{k}")).and_then(Value::as_u64).and_then(|v| u32::try_from(v).ok());
        let edit = p.pointer("/edit/file").and_then(Value::as_str).filter(|f| cc_hooks::is_rel(f)).zip(n("add").zip(n("del")));
        let sid = match &ev { UiEvent::CcEvent { kind, sid, .. } if kind == "post_tool" => Some(sid.clone()), _ => None };
        let edit = sid.zip(edit).map(|(sid, (f, (add, del)))| Out::Ui(UiEvent::CcEdit { sid, file: f.into(), add, del }));
        Some(if main_live { vec![] } else { vec![Out::Ui(ev)] }.into_iter().chain(edit).collect())
    }

    /// "Open terminal": the pid the main assistant announced for `session` (Unknown = it never did).
    pub fn cc_session_pid(&self, session: &str) -> Result<u32, OwnerErr> {
        let s = self.assistant_of_main()?;
        s.sessions.iter().find(|(id, _)| id == session).map(|&(_, pid)| pid).ok_or(OwnerErr::Unknown)
    }

    /// The status card's "Open": `assistant.open {kind}` to the main assistant (it opens its own window).
    pub fn assistant_open(&self, kind: OpenKind) -> Result<Vec<Out>, OwnerErr> {
        let (_, conn) = self.main_ready().ok_or(OwnerErr::NoMain)?;
        Ok(vec![Out::Send(conn, notification("assistant.open", json!({ "kind": kind })))])
    }

    /// Asked BEFORE a shelf file is copied for the main assistant: Err(NoMain) without a ready one, false when it
    /// lacks `scope` (None = a scope-free one-shot share). Nothing is copied for a message that will not go.
    pub fn main_holds(&self, scope: Option<Scope>) -> Result<bool, OwnerErr> {
        let (pid, _) = self.main_ready().ok_or(OwnerErr::NoMain)?;
        Ok(scope.is_none_or(|s| self.reg.get(&pid).is_some_and(|r| r.active(s))))
    }

    /// The shelf card shows a file: `shelf.suggest {request, path}`, only if the main assistant holds `files.drop`
    /// (the file was dropped on the island). Returns the request to wait on, None = nobody may be asked.
    pub fn shelf_suggest(&mut self, path: &str) -> Result<(Option<u64>, Vec<Out>), OwnerErr> {
        if !self.main_holds(Some(Scope::FilesDrop))? {
            return Ok((None, vec![]));
        }
        let (pid, conn) = self.main_ready().ok_or(OwnerErr::NoMain)?;
        let mut out = vec![];
        if self.assistant.owner != pid {
            let old = self.assistant.owner.clone();
            self.assistant_forget(&old, &mut out);
            self.assistant.owner = pid;
        }
        self.assistant.shelf_req += 1;
        self.assistant.shelf_answer = None;
        let line = notification("shelf.suggest", json!({"request": self.assistant.shelf_req, "path": path}));
        out.push(Out::Send(conn, line));
        Ok((Some(self.assistant.shelf_req), out))
    }

    /// The answer to `request`: None = not yet, Some(None) = no suggestion.
    pub fn shelf_suggestion(&self, request: u64) -> Option<Option<String>> {
        (self.assistant.shelf_req == request).then(|| self.assistant.shelf_answer.clone()).flatten()
    }

    /// "Add to Notes" on the shelf card: the one file to the main assistant (one-shot, the owner's click).
    pub fn shelf_memory(&self, path: &str) -> Result<Vec<Out>, OwnerErr> {
        let (_, conn) = self.main_ready().ok_or(OwnerErr::NoMain)?;
        Ok(vec![Out::Send(conn, notification("shelf.memory", json!({ "path": path })))])
    }

    /// `pid`'s meeting is over (it left, or lost `island.protrusion`).
    pub(super) fn meeting_end(&mut self, pid: &str, out: &mut Vec<Out>) {
        if self.assistant.owner == pid && std::mem::take(&mut self.assistant.meeting) {
            out.push(Out::Ui(UiEvent::Meeting(false)));
        }
    }

    /// Disconnect or removal: the main assistant's values go with it (offline and meeting back to false).
    pub(super) fn assistant_forget(&mut self, pid: &str, out: &mut Vec<Out>) {
        if self.assistant.owner == pid {
            if self.assistant.offline {
                out.push(Out::Ui(UiEvent::AssistantOffline(false)));
            }
            self.meeting_end(pid, out);
            self.assistant = AssistantState::default();
        }
    }

    /// A plugin became the ready main assistant: the first time ever, the "first connection" card.
    pub(super) fn main_arrived(&mut self, out: &mut Vec<Out>) {
        if !self.reg.main_seen {
            self.reg.main_seen = true;
            self.reg.first_connect = true;
            self.save(out);
            out.push(Out::Ui(UiEvent::FirstConnect));
        }
    }

    pub fn first_connect_get(&self) -> bool {
        self.reg.first_connect
    }

    pub fn first_connect_ack(&mut self) -> Vec<Out> {
        let mut out = vec![];
        if self.reg.first_connect {
            self.reg.first_connect = false;
            self.save(&mut out);
        }
        out
    }

    pub(super) fn log_permission(&mut self, plugin: &str, scope: Scope, granted: bool, now: u64) {
        let log = &mut self.reg.permission_log;
        log.push(PermissionEvent { at: now, plugin: plugin.into(), scope, granted });
        let over = log.len().saturating_sub(PERMISSION_LOG_MAX);
        log.drain(..over);
    }

    /// Newest first.
    pub fn permission_history(&self) -> Vec<PermissionEvent> {
        self.reg.permission_log.iter().rev().cloned().collect()
    }
}
