//! Assistant slots (docs/plugin-api.md §11): `assistant.event`, `assistant.state.set`, the `page.request` envelope, and
//! the one privacy gate in the app. Helpers are a copy of `tests.rs`'s (that file stays as it was).

use super::*;
use crate::test_util::Tmp;
use serde_json::json;

fn host() -> (Host, Tmp) {
    let tmp = Tmp::new();
    (Host::new(tmp.path().to_path_buf()), tmp)
}

fn rpc(id: u64, method: &str, params: Value) -> Vec<u8> {
    json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}).to_string().into_bytes()
}

fn sent(outs: &[Out]) -> Vec<Value> {
    outs.iter().filter_map(|o| if let Out::Send(_, l) = o { serde_json::from_str(l).ok() } else { None }).collect()
}

fn err_code(outs: &[Out]) -> Option<i64> {
    sent(outs).iter().find_map(|v| v["error"]["code"].as_i64())
}

fn ui(outs: &[Out]) -> Vec<&UiEvent> {
    outs.iter().filter_map(|o| if let Out::Ui(e) = o { Some(e) } else { None }).collect()
}

fn pair(h: &mut Host, conn: ConnId, id: &str, scopes: &[&str], main: bool, t: u64) {
    h.connect(conn, Client::default());
    let m = json!({"id":id,"name":id.rsplit('.').next().unwrap(),"publisher":"Sample","version":"1.0","api":1,"scopes":scopes});
    let outs = h.line(conn, &rpc(1, "hello", m), t);
    assert!(outs.contains(&Out::ConsentOpen), "{outs:?}");
    let req = h.consent_get(t).unwrap().request_id.parse().unwrap();
    h.consent_respond(req, true, None, main, false, t + GUARD_MS).unwrap();
}

const MAIN: &str = "dev.example.compass";
const OTHER: &str = "dev.example.other";
const SCOPES: [&str; 2] = ["composer.handler", "island.protrusion"];

fn main_host() -> (Host, Tmp) {
    let (mut h, t) = host();
    pair(&mut h, 1, MAIN, &SCOPES, true, 0);
    (h, t)
}

#[test]
fn assistant_event_goes_to_the_page_as_type_and_data() {
    let (mut h, _t) = main_host();
    let outs = h.line(1, &rpc(2, "assistant.event", json!({"type": "step.read", "data": {"path": "a.rs"}})), 1000);
    assert_eq!(ui(&outs), [&UiEvent::AssistantEvent(json!({"type": "step.read", "data": {"path": "a.rs"}}))]);
    for bad in [json!({"type": "Step", "data": {}}), json!({"type": "x", "data": 1}), json!({"type": "a".repeat(33), "data": {}})] {
        assert_eq!(err_code(&h.line(1, &rpc(3, "assistant.event", bad), 1000)), Some(code::INVALID_PARAMS));
    }
    pair(&mut h, 2, OTHER, &SCOPES, false, 2000);
    let outs = h.line(2, &rpc(4, "assistant.event", json!({"type": "x", "data": {}})), 3000);
    assert_eq!(err_code(&outs), Some(code::NOT_MAIN), "main assistant only");
}

#[test]
fn assistant_events_use_the_stream_bucket_not_the_control_limit() {
    let (mut h, _t) = main_host();
    for i in 0..120 {
        let outs = h.line(1, &rpc(10 + i, "assistant.event", json!({"type": "x", "data": {}})), 1000);
        assert!(err_code(&outs).is_none(), "{i}");
    }
}

#[test]
fn assistant_state_keeps_the_last_value_per_key_with_limits_and_clears_with_the_main() {
    let (mut h, _t) = main_host();
    let set = |h: &mut Host, k: &str, v: Value| h.line(1, &rpc(2, "assistant.state.set", json!({"key": k, "value": v})), 1000);
    assert!(ui(&set(&mut h, "context", json!({"model": "m"}))).contains(&&UiEvent::SurfacesChanged));
    set(&mut h, "context", json!({"model": "n"}));
    let v = h.surfaces_view(&Default::default(), None, None);
    assert_eq!(serde_json::to_value(&v).unwrap()["assistantState"], json!({"context": {"model": "n"}}));
    assert!(!v.private);
    for i in 1..16 {
        assert!(err_code(&set(&mut h, &format!("k{i}"), json!(i))).is_none());
    }
    assert_eq!(err_code(&set(&mut h, "k16", json!(1))), Some(code::INVALID_PARAMS), "17th key");
    assert!(err_code(&set(&mut h, "k1", json!(2))).is_none(), "an existing key still updates");
    set(&mut h, "k1", Value::Null);
    assert!(err_code(&set(&mut h, "k16", json!(1))).is_none(), "null dropped one");
    let big = json!("x".repeat(64 * 1024));
    assert_eq!(err_code(&set(&mut h, "big", big)), Some(code::TOO_LARGE), "64 KB value");
    assert_eq!(err_code(&set(&mut h, "Bad", json!(1))), Some(code::INVALID_PARAMS));
    h.lock_set(crate::lock::Reason::Plugin, true);
    let locked = h.surfaces_view(&Default::default(), None, None);
    assert!(locked.assistant_state.is_empty() && locked.private, "nothing while locked");
    h.lock_set(crate::lock::Reason::Plugin, false);
    // the owner picks another main assistant: the values go (and the new one never sees them)
    pair(&mut h, 2, OTHER, &SCOPES, false, 2000);
    h.set_main(Some(OTHER)).unwrap();
    assert!(h.assistant_state().is_empty());
    h.set_main(Some(MAIN)).unwrap();
    assert!(h.assistant_state().is_empty(), "gone, not hidden");
    set(&mut h, "context", json!(1));
    assert_eq!(h.assistant_state().len(), 1);
    h.disconnect(1, 3000);
    assert!(h.assistant_state().is_empty(), "disconnect clears");
}

#[test]
fn page_requests_need_a_brand_name_an_object_and_a_main_assistant() {
    let (mut h, _t) = host();
    assert!(crate::brand::PAGE_REQUESTS.is_empty(), "Peeka's own build has no page request path");
    assert_eq!(h.page_request("x.list", json!({})).unwrap_err(), OwnerErr::Invalid, "not on the brand list");
    assert_eq!(h.page_send("x.list", json!({})).unwrap_err(), OwnerErr::NoMain);
    pair(&mut h, 1, MAIN, &SCOPES, true, 0);
    let (id, outs) = h.page_send("x.list", json!({"q": 1})).unwrap();
    assert_eq!(sent(&outs), [json!({"jsonrpc": "2.0", "id": id, "method": "page.request", "params": {"method": "x.list", "params": {"q": 1}}})]);
    assert!(matches!(outs[0], Out::Send(1, _)), "to the main assistant's connection");
    let big = json!({"t": "x".repeat(64 * 1024)});
    assert_eq!(h.page_send("x.list", big).unwrap_err(), OwnerErr::Invalid, "too large");
}

#[test]
fn page_replies_only_from_the_connection_asked_for_a_waiting_id_with_code_only() {
    let (mut h, _t) = main_host();
    pair(&mut h, 2, OTHER, &SCOPES, false, 1000);
    let (id, _) = h.page_send("x.list", json!({})).unwrap();
    let reply = |r: Value| r.to_string().into_bytes();
    let wrong = h.line(2, &reply(json!({"jsonrpc": "2.0", "id": id, "result": {"items": [1]}})), 2000);
    assert!(ui(&wrong).is_empty(), "another connection: not a reply");
    let unknown = h.line(1, &reply(json!({"jsonrpc": "2.0", "id": id + 1, "result": 1})), 2000);
    assert!(ui(&unknown).is_empty() && err_code(&unknown) == Some(code::INVALID_REQUEST), "unknown id: as before");
    let ok = h.line(1, &reply(json!({"jsonrpc": "2.0", "id": id, "result": {"items": [1]}})), 2000);
    assert_eq!(ui(&ok), [&UiEvent::AssistantReply(json!({"id": id, "result": {"items": [1]}}))]);
    assert!(ui(&h.line(1, &reply(json!({"jsonrpc": "2.0", "id": id, "result": 2})), 2000)).is_empty(), "answered once");
    let (id, _) = h.page_send("x.list", json!({})).unwrap();
    let err = h.line(1, &reply(json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32050, "message": "secret text"}})), 2000);
    assert_eq!(ui(&err), [&UiEvent::AssistantReply(json!({"id": id, "error": {"code": -32050}}))], "the message never");
}

#[test]
fn at_most_32_page_requests_wait_and_a_disconnect_ends_them() {
    let (mut h, _t) = main_host();
    let ids: Vec<u64> = (0..33).map(|_| h.page_send("x.list", json!({})).unwrap().0).collect();
    let first = h.line(1, &json!({"jsonrpc": "2.0", "id": ids[0], "result": 1}).to_string().into_bytes(), 1000);
    assert!(ui(&first).is_empty(), "the oldest was dropped");
    let outs = h.disconnect(1, 2000);
    let gone: Vec<_> = ui(&outs).into_iter().filter(|e| matches!(e, UiEvent::AssistantReply(_))).collect();
    assert_eq!(gone.len(), 32);
    assert_eq!(gone[0], &UiEvent::AssistantReply(json!({"id": ids[1], "error": {"code": assistant::PAGE_NOT_CONNECTED}})));
}

/// One privacy gate in the app (`crates/notch-app/src/privacy.rs`), and every consumer goes through it.
#[test]
fn every_privacy_consumer_uses_the_one_gate() {
    // shortcut: reads the bin crate's source (never compiled under `--lib`), like cmd.rs's lock test.
    let privacy = include_str!("../../../../notch-app/src/privacy.rs");
    let plugins = include_str!("../../../../notch-app/src/plugins.rs");
    let commands = include_str!("../../../../notch-app/src/commands.rs");
    let extras = include_str!("../../../../notch-app/src/extras.rs");
    let clip = include_str!("../../../../notch-app/src/clip_history.rs");
    let live = include_str!("../../../../notch-app/src/live.rs");
    assert!(privacy.contains("pub fn closed(app: &AppHandle) -> bool"));
    for (file, src) in [("plugins", plugins), ("commands", commands), ("extras", extras), ("clip_history", clip), ("live", live)] {
        assert!(!src.contains("hide_passwords") && !src.contains("Presence::Presentation"), "{file}: a second gate");
    }
    let consumers = [
        ("SurfacesView.private / assistantState", plugins, "let private = crate::privacy::closed(app);"),
        ("assistant_request denied", commands, "cmd::unlocked(crate::privacy::closed(&app))?;\n    on_host(&app, |h, _| h.page_request("),
        ("assistant_reply while closed", plugins, "let v = if crate::privacy::closed(app) {"),
        ("assistant_event held", plugins, "Out::Ui(UiEvent::AssistantEvent(v)) => crate::privacy::event(app, v),"),
        ("a gate change emits surfaces and releases", plugins, "crate::privacy::release(app);"),
        ("sharing change emits surfaces", extras, "let _ = app.emit(\"privacy_changed\", next);\n        crate::plugins::emit_surfaces(app);"),
        ("screen tint", extras, "locked: crate::privacy::closed(&app),"),
        ("clipboard passwords", clip, "let hide = crate::privacy::closed(app);"),
        ("music meter", live, "crate::privacy::closed(&app)"),
        ("agent diff", commands, "pub fn cc_diff(app: AppHandle, sid: String) -> Res<serde_json::Value> {\n    cmd::unlocked(crate::privacy::closed(&app))?;"),
    ];
    for (what, src, line) in consumers {
        assert!(src.replace("\r\n", "\n").contains(line), "{what}");
    }
}
