//! The plugin API's security tests (yapim-plani "Dalga 3" Kapılar), run against the pure host with fixed times.

use super::*;
use crate::alerts::{gate, AlertList, Gate};
use crate::presence::Presence;
use crate::test_util::Tmp;
use serde_json::json;

fn host() -> (Host, Tmp) {
    let tmp = Tmp::new();
    (Host::new(tmp.path().to_path_buf()), tmp)
}

fn rpc(id: u64, method: &str, params: Value) -> Vec<u8> {
    json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}).to_string().into_bytes()
}

fn note(method: &str, params: Value) -> Vec<u8> {
    json!({"jsonrpc":"2.0","method":method,"params":params}).to_string().into_bytes()
}

fn sent(outs: &[Out]) -> Vec<Value> {
    outs.iter().filter_map(|o| if let Out::Send(_, l) = o { serde_json::from_str(l).ok() } else { None }).collect()
}

fn err_code(outs: &[Out]) -> Option<i64> {
    sent(outs).iter().find_map(|v| v["error"]["code"].as_i64())
}

fn closed(outs: &[Out], conn: ConnId) -> bool {
    outs.contains(&Out::Close(conn))
}

fn manifest(id: &str, name: &str, scopes: &[&str]) -> Value {
    json!({"id":id,"name":name,"publisher":"Örnek","version":"1.0","api":1,"scopes":scopes})
}

/// hello -> the window shows it at `t` -> the owner grants at `t + 300` with the default boxes. Returns the token.
fn pair(h: &mut Host, conn: ConnId, id: &str, name: &str, scopes: &[&str], main: bool, t: u64) -> String {
    h.connect(conn, Client::default());
    let outs = h.line(conn, &rpc(1, "hello", manifest(id, name, scopes)), t);
    assert!(outs.contains(&Out::ConsentOpen), "{outs:?}");
    let req = h.consent_get(t).unwrap().request_id.parse().unwrap();
    let outs = h.consent_respond(req, true, None, main, false, t + GUARD_MS).unwrap();
    sent(&outs).iter().find_map(|v| v["result"]["token"].as_str().map(str::to_string)).expect("token")
}

const MAIN: &str = "dev.example.pusula";
const ALL_MAIN: [&str; 6] =
    ["island.protrusion", "card.module", "approvals.prompt", "composer.handler", "voice.line", "lock.signal"];

#[test]
fn no_token_and_wrong_token_are_refused_and_closed() {
    let (mut h, _t) = host();
    h.connect(1, Client::default());
    let outs = h.line(1, &rpc(2, "island.protrusion.clear", json!({})), 0);
    assert_eq!(err_code(&outs), Some(code::UNAUTHORIZED));
    assert!(closed(&outs, 1), "no auth = no talk");
    let token = pair(&mut h, 2, MAIN, "Pusula", &ALL_MAIN, true, 0);
    h.connect(3, Client::default());
    let outs = h.line(3, &rpc(1, "auth", json!({"id": MAIN, "token": "AAAA"})), 1000);
    assert_eq!((err_code(&outs), closed(&outs, 3)), (Some(code::UNAUTHORIZED), true));
    let (other, _) = registry::new_token().unwrap();
    h.connect(4, Client::default());
    let outs = h.line(4, &rpc(1, "auth", json!({"id": MAIN, "token": other})), 1000);
    assert_eq!(err_code(&outs), Some(code::UNAUTHORIZED), "wrong token");
    h.connect(5, Client::default());
    let outs = h.line(5, &rpc(1, "auth", json!({"id": "dev.nobody", "token": token})), 1000);
    assert_eq!(err_code(&outs), Some(code::UNAUTHORIZED), "right token, other id: same answer");
    h.connect(6, Client::default());
    let outs = h.line(6, &rpc(1, "auth", json!({"id": MAIN, "token": token})), 1000);
    let r = &sent(&outs)[0]["result"];
    assert_eq!((r["main_assistant"].as_bool(), r["api_version"].as_u64()), (Some(true), Some(1)));
    assert!(closed(&outs, 2), "the older connection of the same plugin goes");
}

#[test]
fn out_of_scope_methods_are_forbidden_and_toggles_and_revoke_act_at_once() {
    let (mut h, _t) = host();
    pair(&mut h, 1, "com.example.a", "Örnek", &["island.protrusion"], false, 0);
    let card = json!({"tabs":[]});
    assert_eq!(err_code(&h.line(1, &rpc(2, "card.module.set", card), 1000)), Some(code::FORBIDDEN));
    assert_eq!(err_code(&h.line(1, &rpc(3, "keyboard.read", json!({})), 1000)), Some(code::NO_METHOD));
    let p = json!({"title":"x","state":"info","icon":"bell"});
    assert!(err_code(&h.line(1, &rpc(4, "island.protrusion.set", p.clone()), 1000)).is_none());
    h.set_scope("com.example.a", Scope::IslandProtrusion, false, 0).unwrap();
    assert_eq!(err_code(&h.line(1, &rpc(5, "island.protrusion.set", p.clone()), 1100)), Some(code::FORBIDDEN));
    assert!(h.surfaces_view(&Attention::default(), None, None).protrusion.is_none(), "its item went with the scope");
    assert_eq!(h.set_scope("com.example.a", Scope::CardModule, true, 0), Err(OwnerErr::Invalid), "never granted");
    h.set_scope("com.example.a", Scope::IslandProtrusion, true, 0).unwrap();
    assert!(err_code(&h.line(1, &rpc(6, "island.protrusion.set", p.clone()), 1200)).is_none());
    let outs = h.revoke("com.example.a", 0).unwrap();
    assert!(closed(&outs, 1) && h.reg.get("com.example.a").is_none());
    assert!(h.surfaces_view(&Attention::default(), None, None).protrusion.is_none());
}

#[test]
fn unknown_scope_is_refused_at_hello() {
    let (mut h, _t) = host();
    h.connect(1, Client::default());
    let outs = h.line(1, &rpc(1, "hello", manifest("com.x.y", "X", &["island.protrusion", "keyboard.read"])), 0);
    assert_eq!(err_code(&outs), Some(code::INVALID_PARAMS));
    assert!(closed(&outs, 1) && !h.consent_pending());
}

#[test]
fn control_messages_are_rate_limited_and_streams_do_not_count() {
    let (mut h, _t) = host();
    pair(&mut h, 1, MAIN, "Pusula", &ALL_MAIN, true, 0);
    let (turn, _) = h.composer_submit("selam", &[], 1000).unwrap();
    for i in 0..200 {
        h.line(1, &note("composer.delta", json!({"turn": turn, "text": "a"})), 1000 + i);
    }
    for i in 0..limits::CONTROL_MAX as u64 {
        assert!(err_code(&h.line(1, &rpc(i, "ping", json!({})), 10_500)).is_none(), "deltas used no control budget");
    }
    let outs = h.line(1, &rpc(99, "ping", json!({})), 10_500);
    assert_eq!(err_code(&outs), Some(code::RATE));
    assert_eq!(sent(&outs)[0]["error"]["data"]["retry_after"], 10);
    assert!(err_code(&h.line(1, &rpc(100, "ping", json!({})), 20_500)).is_none(), "window moved on");
}

#[test]
fn stream_deltas_are_coalesced_every_50_ms_and_nothing_is_dropped() {
    let (mut h, _t) = host();
    pair(&mut h, 1, MAIN, "Pusula", &ALL_MAIN, true, 0);
    let (turn, outs) = h.composer_submit("Bugün ne var?", &[], 1000).unwrap();
    let submit = &sent(&outs)[0];
    assert_eq!((submit["method"].as_str(), submit["params"]["turn"].as_u64()), (Some("composer.submit"), Some(turn)));
    for (i, w) in ["Bu", "gün ", "üç ", "toplantı", " var."].iter().enumerate() {
        assert!(h.line(1, &note("composer.delta", json!({"turn": turn, "text": w})), 2000 + i as u64).is_empty());
    }
    assert!(h.tick(2040).iter().all(|o| !matches!(o, Out::Ui(UiEvent::Composer(_)))), "not yet 50 ms");
    let deltas: Vec<_> = h
        .tick(2050)
        .into_iter()
        .filter_map(|o| if let Out::Ui(UiEvent::Composer(e)) = o { Some(e) } else { None })
        .collect();
    assert_eq!(deltas.len(), 1);
    assert_eq!(deltas[0].text.as_deref(), Some("Bugün üç toplantı var."));
    h.line(1, &note("composer.delta", json!({"turn": turn, "text": " Son"})), 2060);
    let outs = h.line(1, &note("composer.done", json!({"turn": turn})), 2061);
    let kinds: Vec<_> = outs
        .iter()
        .filter_map(|o| if let Out::Ui(UiEvent::Composer(e)) = o { Some((e.kind, e.text.clone())) } else { None })
        .collect();
    assert_eq!(kinds, [(ComposerKind::Delta, Some(" Son".into())), (ComposerKind::Done, None)], "flushed before done");
    let outs = h.line(1, &rpc(9, "composer.delta", json!({"turn": turn, "text": "late"})), 2100);
    assert_eq!(err_code(&outs), Some(code::INVALID_PARAMS), "a closed turn takes nothing");
}

#[test]
fn messages_over_64_kb_are_refused_except_card_module_up_to_256_kb() {
    let (mut h, _t) = host();
    pair(&mut h, 1, "com.example.a", "Örnek", &["island.protrusion", "card.module"], false, 0);
    let big = "x".repeat(70 * 1024);
    let outs = h.line(1, &rpc(2, "island.protrusion.set", json!({"title": big, "state":"info","icon":"bell"})), 1000);
    assert_eq!(err_code(&outs), Some(code::TOO_LARGE));
    assert!(!closed(&outs, 1), "refused, connection kept");
    let png = {
        use base64::Engine;
        let mut b = b"\x89PNG\r\n\x1a\n".to_vec();
        b.resize(150 * 1024, 0);
        format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(b))
    };
    let card = json!({"tabs":[{"id":"t","title":"Görsel","blocks":[{"type":"image","data":png}]}]});
    let outs = h.line(1, &rpc(3, "card.module.set", card), 1000);
    assert!(err_code(&outs).is_none(), "a 200 KB card with an image is fine: {outs:?}");
    let huge = vec![b' '; MAX_CARD_MESSAGE + 1];
    let outs = h.line(1, &huge, 1000);
    assert_eq!((err_code(&outs), closed(&outs, 1)), (Some(code::TOO_LARGE), true), "over 256 KB closes");
}

/// Pairs a `clipboard.read` plugin on connection 1 and returns what `clipboard.read` sent back (for `clip::tests`).
pub(crate) fn read_clipboard(h: &mut Host) -> String {
    h.connect(1, Client::default());
    h.line(1, &rpc(1, "hello", manifest("com.example.a", "Örnek", &["clipboard.read"])), 0);
    let req = h.consent_get(0).unwrap().request_id.parse().unwrap();
    h.consent_respond(req, true, Some(&[Scope::ClipboardRead]), false, false, 300).unwrap();
    let outs = h.line(1, &rpc(2, "clipboard.read", json!({})), 1000);
    format!("{} {outs:?}", sent(&outs)[0]["result"])
}

#[test]
fn clipboard_read_never_returns_the_password_class() {
    let (mut h, _t) = host();
    h.connect(1, Client::default());
    h.line(1, &rpc(1, "hello", manifest("com.example.a", "Örnek", &["clipboard.read"])), 0);
    let req = h.consent_get(0).unwrap().request_id.parse().unwrap();
    h.consent_respond(req, true, Some(&[Scope::ClipboardRead]), false, false, 300).unwrap();
    h.clipboard = vec![
        ClipItem { kind: "text".into(), text: Some("merhaba".into()), path: None, password: false },
        ClipItem { kind: "text".into(), text: Some("hunter2".into()), path: None, password: true },
    ];
    let outs = h.line(1, &rpc(2, "clipboard.read", json!({})), 1000);
    let items = sent(&outs)[0]["result"]["items"].clone();
    assert_eq!(items.as_array().unwrap().len(), 1);
    assert!(!items.to_string().contains("hunter2"));
    assert!(items[0].get("password").is_none(), "the flag itself does not leave either");
}

#[test]
fn high_risk_scopes_need_the_owners_tick() {
    let (mut h, _t) = host();
    pair(&mut h, 1, "com.example.a", "Örnek", &["island.protrusion", "clipboard.read"], false, 0);
    assert_eq!(err_code(&h.line(1, &rpc(2, "clipboard.read", json!({})), 1000)), Some(code::FORBIDDEN));
    assert!(!h.reg.get("com.example.a").unwrap().granted.contains(&Scope::ClipboardRead));
}

#[test]
fn html_link_and_icon_are_refused_over_the_pipe() {
    let (mut h, _t) = host();
    pair(&mut h, 1, "com.example.a", "Örnek", &["island.protrusion", "card.module", "alerts.post"], false, 0);
    for (m, p) in [
        ("island.protrusion.set", json!({"title":"x","state":"info","icon":"bell","html":"<script>"})),
        ("island.protrusion.set", json!({"title":"x","state":"info","icon":"https://x/y.png"})),
        (
            "card.module.set",
            json!({"tabs":[{"id":"t","title":"T","blocks":[{"type":"text","text":"x","link":"https://x"}]}]}),
        ),
        ("alerts.post", json!({"id":"a","title":"x","action":"https://evil.test"})),
        ("alerts.post", json!({"id":"a","title":"x","icon_url":"https://evil.test/i.png"})),
    ] {
        assert_eq!(err_code(&h.line(1, &rpc(2, m, p.clone()), 1000)), Some(code::INVALID_PARAMS), "{p}");
    }
    let outs = h.line(1, &rpc(3, "alerts.post", json!({"id":"b","title":"<b>Derleme</b> bitti"})), 1000);
    let Some(Out::AlertPut { alert, system: false }) = outs.iter().find(|o| matches!(o, Out::AlertPut { .. })) else {
        panic!("{outs:?}")
    };
    assert_eq!((alert.title.as_str(), alert.id.as_str()), ("Örnek › Derleme bitti", "plugin:com.example.a:b"));
    assert!(alert.priority <= crate::alerts::PLUGIN_MAX_PRIORITY && alert.kind == Kind::Alert);
}

#[test]
fn a_non_main_plugins_mascot_is_ignored_and_the_name_prefix_stays() {
    let (mut h, _t) = host();
    pair(&mut h, 1, MAIN, "Pusula", &ALL_MAIN, true, 0);
    pair(&mut h, 2, "com.example.a", "Örnek", &["island.protrusion"], false, 10);
    let p = |t: &str| json!({"title": t, "state":"info","icon":"mic","mascot":"dinliyor"});
    h.line(2, &rpc(1, "island.protrusion.set", p("Pusula › Dinliyorum")), 1000);
    let shown = h.surfaces_view(&Attention::default(), None, None).protrusion.unwrap();
    assert_eq!((shown.plugin.name.as_str(), shown.mascot.as_ref()), ("Örnek", None));
    assert_eq!(shown.title, "Pusula - Dinliyorum", "the page draws plugin.name › title; no fake separator left");
    h.line(1, &rpc(1, "island.protrusion.set", p("Dinliyorum")), 1100);
    let v = h.surfaces_view(&Attention::default(), None, None);
    let shown = v.protrusion.unwrap();
    assert_eq!((shown.plugin.name.as_str(), shown.mascot.as_deref(), v.waiting), ("Pusula", Some("dinliyor"), 1));
    assert!(shown.plugin.main);
    let quiet = h.surfaces_view(&Attention { dnd: true, ..Attention::default() }, None, None);
    assert_eq!((quiet.protrusion, quiet.waiting), (None, 2), "the attention budget comes first");
}

#[test]
fn lookalike_names_warn_and_duplicate_or_reserved_names_are_refused() {
    let (mut h, _t) = host();
    pair(&mut h, 1, MAIN, "Pusula", &ALL_MAIN, true, 0);
    h.connect(2, Client::default());
    let outs = h.line(2, &rpc(1, "hello", manifest("com.evil.a", "PUSULA", &["island.protrusion"])), 1000);
    assert_eq!((err_code(&outs), closed(&outs, 2)), (Some(code::INVALID_PARAMS), true), "same name, other id");
    for name in ["Notch", "windows", "Sistem", "Pusulâ", "Pusula › Claude Code", "Notch » Güvenlik", "Pusula > X"] {
        h.connect(3, Client::default());
        let outs = h.line(3, &rpc(1, "hello", manifest("com.evil.b", name, &["island.protrusion"])), 1000);
        assert_eq!(err_code(&outs), Some(code::INVALID_PARAMS), "{name}");
    }
    h.connect(4, Client::default());
    h.line(4, &rpc(1, "hello", manifest("com.evil.c", "Рusula", &["island.protrusion"])), 1000); // Cyrillic Р
    let v = h.consent_get(1000).unwrap();
    assert_eq!(v.lookalike.as_deref(), Some("Pusula"), "a confusable twin raises the warning");
    assert!(!v.repair);
}

#[test]
fn consent_and_approval_decisions_within_300_ms_are_ignored() {
    let (mut h, _t) = host();
    h.connect(1, Client::default());
    h.line(1, &rpc(1, "hello", manifest(MAIN, "Pusula", &ALL_MAIN)), 0);
    let req = h.consent_get(5_000).unwrap().request_id.parse().unwrap();
    assert_eq!(h.consent_respond(req, true, None, true, false, 5_299), Err(OwnerErr::Ignored));
    assert!(h.consent_pending(), "the window stays");
    let outs = h.consent_respond(req, true, None, true, false, 5_300).unwrap();
    assert!(sent(&outs)[0]["result"]["token"].is_string());
    let ap = json!({"id":"ap-1","source":"Claude Code","title":"Komut","risk":"low","kind":"command",
                    "command":"npm test","cwd":"C:\\p","options":["allow","deny"]});
    h.line(1, &rpc(2, "approvals.prompt", ap), 10_000);
    let r = |h: &mut Host, d, now| h.approval_respond(MAIN, "ap-1", d, None, None, Surface::Card, now);
    assert_eq!(r(&mut h, Decision::Allow, 10_299), Err(OwnerErr::Ignored));
    assert_eq!(r(&mut h, Decision::Deny, 10_100), Err(OwnerErr::Ignored), "any decision");
    let outs = r(&mut h, Decision::Allow, 10_300).unwrap();
    let d = sent(&outs).into_iter().find(|v| v["method"] == "approvals.decision").unwrap();
    assert_eq!((d["params"]["id"].as_str(), d["params"]["decision"].as_str()), (Some("ap-1"), Some("allow")));
}

#[test]
fn plugin_buttons_have_the_300_ms_guard_too() {
    let (mut h, _t) = host();
    pair(&mut h, 1, "com.example.a", "Örnek", &["island.protrusion", "card.module"], false, 0);
    let p = json!({"title":"x","state":"info","icon":"bell","actions":[{"id":"open","label":"Aç"}]});
    h.line(1, &rpc(1, "island.protrusion.set", p), 1000);
    assert_eq!(h.action("com.example.a", "open", 1200), Err(OwnerErr::Ignored));
    assert_eq!(h.action("com.example.a", "nope", 2000), Err(OwnerErr::Unknown));
    let outs = h.action("com.example.a", "open", 1300).unwrap();
    assert_eq!(sent(&outs)[0]["params"], json!({"id":"open","surface":"protrusion"}));
    let card =
        json!({"tabs":[{"id":"t","title":"T","blocks":[{"type":"buttons","buttons":[{"id":"b","label":"B"}]}]}]});
    h.line(1, &rpc(2, "card.module.set", card), 5000);
    assert_eq!(h.action("com.example.a", "b", 5299), Err(OwnerErr::Ignored));
    assert!(h.action("com.example.a", "b", 5300).is_ok());
}

#[test]
fn consent_timeout_is_deny_and_the_plugin_hears_it() {
    let (mut h, _t) = host();
    h.connect(1, Client::default());
    h.line(1, &rpc(7, "hello", manifest(MAIN, "Pusula", &ALL_MAIN)), 0);
    h.consent_get(1_000);
    assert!(h.tick(120_999).iter().all(|o| !matches!(o, Out::Close(_))));
    let outs = h.tick(121_000);
    assert_eq!((err_code(&outs), closed(&outs, 1)), (Some(code::DENIED), true));
    assert_eq!(sent(&outs)[0]["id"], 7, "the answer goes to the hello");
    assert!(!h.consent_pending() && outs.contains(&Out::ConsentClose));
    assert!(h.reg.get(MAIN).is_none() && !h.reg.blocked.contains(MAIN), "a timeout is not 'bir daha sorma'");
}

#[test]
fn deny_is_the_default_never_ask_blocks_and_one_window_at_a_time() {
    let (mut h, _t) = host();
    h.connect(1, Client::default());
    h.line(1, &rpc(1, "hello", manifest("com.a.b", "Bir", &["island.protrusion"])), 0);
    h.connect(2, Client::default());
    let outs = h.line(2, &rpc(1, "hello", manifest("com.c.d", "İki", &["island.protrusion"])), 10);
    assert_eq!((err_code(&outs), closed(&outs, 2)), (Some(code::BUSY), true));
    let req = h.consent_get(100).unwrap().request_id.parse().unwrap();
    let outs = h.consent_respond(req, false, None, false, true, 400).unwrap();
    assert_eq!(err_code(&outs), Some(code::DENIED));
    h.connect(3, Client::default());
    let outs = h.line(3, &rpc(1, "hello", manifest("com.a.b", "Bir", &["island.protrusion"])), 1000);
    assert_eq!(err_code(&outs), Some(code::DENIED), "blocked without a window");
    assert!(!h.consent_pending());
    h.revoke("com.a.b", 0).unwrap();
    assert!(!h.reg.blocked.contains("com.a.b"), "Kaldır lifts the block");
}

#[test]
fn at_most_three_pairing_requests_per_ten_minutes_per_id_or_exe() {
    let (mut h, _t) = host();
    let exe = Client { exe: Some("C:\\x\\a.exe".into()), ..Client::default() };
    for i in 0..3u64 {
        h.connect(i, exe.clone());
        h.line(i, &rpc(1, "hello", manifest(&format!("com.a.n{i}"), &format!("Ad{i}x"), &["island.protrusion"])), i);
        let req = h.consent_get(i).unwrap().request_id.parse().unwrap();
        h.consent_respond(req, false, None, false, false, i + 300).unwrap();
    }
    h.connect(9, exe);
    let outs = h.line(9, &rpc(1, "hello", manifest("com.a.zz", "Başka", &["island.protrusion"])), 1000);
    assert_eq!(err_code(&outs), Some(code::RATE), "same exe path");
}

#[test]
fn at_most_six_pairing_requests_per_ten_minutes_in_all() {
    let (mut h, _t) = host();
    for i in 0..6u64 {
        h.connect(i, Client::default());
        h.line(i, &rpc(1, "hello", manifest(&format!("com.a.n{i}"), &format!("Ad{i}x"), &["island.protrusion"])), i);
        let req = h.consent_get(i).unwrap().request_id.parse().unwrap();
        h.consent_respond(req, false, None, false, false, i + 300).unwrap();
    }
    h.connect(9, Client::default());
    let outs = h.line(9, &rpc(1, "hello", manifest("com.a.zz", "Başka", &["island.protrusion"])), 1000);
    assert_eq!((err_code(&outs), closed(&outs, 9)), (Some(code::RATE), true), "a fresh id each time");
    h.connect(10, Client::default());
    let outs = h.line(10, &rpc(1, "hello", manifest("com.a.zz", "Başka", &["island.protrusion"])), 600_000);
    assert!(err_code(&outs).is_none() && h.consent_pending(), "ten minutes later again");
}

#[test]
fn approvals_missing_risk_is_high_no_always_details_only_and_they_drop_the_strip() {
    let (mut h, _t) = host();
    pair(&mut h, 1, MAIN, "Pusula", &ALL_MAIN, true, 0);
    let ap = json!({"id":"ap-9","source":"Claude Code","title":"Komut çalıştırmak istiyor","kind":"command",
                    "command":"rm -rf build","cwd":"C:\\proje","options":["allow","always","deny"],"always_label":"Hep"});
    let outs = h.line(1, &rpc(2, "approvals.prompt", ap), 1000);
    let a = &h.surfaces_view(&Attention::default(), None, None).approvals[0];
    assert_eq!(
        (a.risk, a.options.as_slice(), a.protrusion_actions.as_slice()),
        (Risk::High, [Opt::Allow, Opt::Deny].as_slice(), ["details"].as_slice())
    );
    assert_eq!((a.plugin.name.as_str(), a.source.as_str()), ("Pusula", "Claude Code"));
    for d in [Decision::Allow, Decision::Deny] {
        let r = h.approval_respond(MAIN, "ap-9", d, None, None, Surface::Protrusion, 5000);
        assert_eq!(r, Err(OwnerErr::Invalid), "nothing but Ayrıntı on the protrusion at high risk");
    }
    let r = h.approval_respond(MAIN, "ap-9", Decision::Always, None, None, Surface::Card, 5000);
    assert_eq!(r, Err(OwnerErr::Invalid), "no Her zaman at high risk");
    // Into the alert list as an approval: the existing budget drops the hidden strip for 4 s, never over D3D.
    let Some(Out::AlertPut { alert, system: true }) = outs.into_iter().find(|o| matches!(o, Out::AlertPut { .. }))
    else {
        panic!()
    };
    assert_eq!((alert.kind, alert.priority), (Kind::Approval, 90));
    let mut list = AlertList::default();
    list.put_system(alert.clone(), 1000);
    let full = Attention { fullscreen: true, presence: Presence::Busy, ..Attention::default() };
    assert_eq!(crate::alerts::gate(&alert, &full), Gate::DropStrip);
    assert_eq!(list.view(&full).drop_strip_ms, Some(4000));
    let d3d = Attention { presence: Presence::D3dFullscreen, ..full };
    assert_eq!((list.view(&d3d).top, list.view(&d3d).drop_strip_ms), (None, None));
    let outs = h.approval_respond(MAIN, "ap-9", Decision::Allow, None, None, Surface::Card, 5000).unwrap();
    assert!(outs.contains(&Out::AlertRemove(approval_alert_id(MAIN, "ap-9"))));
}

#[test]
fn approvals_expire_and_the_plugin_hears_expired() {
    let (mut h, _t) = host();
    pair(&mut h, 1, MAIN, "Pusula", &ALL_MAIN, true, 0);
    h.line(1, &rpc(2, "approvals.prompt", json!({"id":"q","title":"Soru","kind":"question","expires_s":10})), 1000);
    assert!(sent(&h.tick(10_999)).is_empty());
    let outs = h.tick(11_000);
    assert_eq!(sent(&outs)[0]["params"], json!({"id":"q","decision":"expired"}));
    assert!(h.surfaces_view(&Attention::default(), None, None).approvals.is_empty());
}

#[test]
fn ctrl_space_goes_only_to_a_connected_main_assistant() {
    let (mut h, _t) = host();
    assert_eq!(h.composer_submit("selam", &[], 0).map(|x| x.0), Err(OwnerErr::NoMain));
    pair(&mut h, 1, "com.example.a", "Örnek", &["composer.handler"], false, 0);
    assert_eq!(h.composer_submit("selam", &[], 0).map(|x| x.0), Err(OwnerErr::NoMain), "not chosen as main");
    let outs = h.line(1, &note("composer.delta", json!({"turn":1,"text":"x"})), 10);
    assert!(sent(&outs).is_empty(), "a notification gets no answer");
    assert_eq!(err_code(&h.line(1, &rpc(3, "composer.delta", json!({"turn":1,"text":"x"})), 10)), Some(code::NOT_MAIN));
    h.set_main(Some("com.example.a")).unwrap();
    assert!(h.main_connected());
    let att = [Attachment { kind: AttachKind::File, path: Some("C:\\Users\\a\\rapor.pdf".into()), text: None }];
    assert!(h.composer_submit("özetle", &att, 0).is_ok());
    let bad = [Attachment { kind: AttachKind::File, path: Some("..\\..\\x".into()), text: None }];
    assert_eq!(h.composer_submit("x", &bad, 0).map(|x| x.0), Err(OwnerErr::Invalid));
    h.disconnect(1, 100);
    assert!(!h.main_connected() && h.reg.main.as_deref() == Some("com.example.a"), "still chosen, not connected");
    assert!(!h.plugin_list(100)[0].connected);
    assert_eq!(h.composer_submit("selam", &[], 200).map(|x| x.0), Err(OwnerErr::NoMain));
}

#[test]
fn small_text_copies_go_inline_with_their_path_and_never_break_the_turn() {
    let (mut h, t) = host();
    pair(&mut h, 1, "com.example.a", "Örnek", &["composer.handler"], true, 0);
    let path = |p: &std::path::Path| Some(p.to_string_lossy().into_owned());
    let (_, note) = share::put(t.path(), "toplantı notu".as_bytes(), "txt").unwrap();
    let (_, pic) = share::put(t.path(), &[0x89, b'P', b'N', b'G', 0xff], "png").unwrap();
    let att = [
        Attachment { kind: AttachKind::Rack, path: path(&note), text: None },
        Attachment { kind: AttachKind::File, path: path(&pic), text: None },
        Attachment { kind: AttachKind::Clip, path: path(&note), text: Some("baş kısmı".into()) },
    ];
    let (_, outs) = h.composer_submit("özetle", &att, 0).unwrap();
    let a = sent(&outs)[0]["params"]["attachments"].clone();
    assert_eq!(a[0], json!({"kind": "rack", "path": path(&note), "text": "toplantı notu"}));
    assert_eq!(a[1], json!({"kind": "file", "path": path(&pic)}), "a picture stays a path");
    assert_eq!(a[2], json!({"kind": "clip", "path": path(&note), "text": "baş kısmı"}));
    let big = "x".repeat(200 * 1024);
    let (_, b1) = share::put(t.path(), big.as_bytes(), "txt").unwrap();
    let (_, b2) = share::put(t.path(), big.as_bytes(), "txt").unwrap();
    let two = [
        Attachment { kind: AttachKind::File, path: path(&b1), text: None },
        Attachment { kind: AttachKind::File, path: path(&b2), text: None },
    ];
    let (_, outs) = h.composer_submit("x", &two, 0).unwrap();
    let a = sent(&outs)[0]["params"]["attachments"].clone();
    assert!(a[0]["text"].is_string() && a[1].get("text").is_none(), "256 KB inline in all: the second stays a path");
    // A full 256 KB clip text is carried whole (the owner's cap, 2026-10-17)...
    let full = Attachment { kind: AttachKind::Clip, path: None, text: Some("y".repeat(256 * 1024)) };
    let (_, outs) = h.composer_submit("x", &[full.clone()], 0).unwrap();
    assert_eq!(sent(&outs)[0]["params"]["attachments"][0]["text"].as_str().map(str::len), Some(256 * 1024));
    // ...one byte more is refused, and past the line cap the inline file copies drop first.
    let over = Attachment { kind: AttachKind::Clip, path: None, text: Some("y".repeat(256 * 1024 + 1)) };
    assert_eq!(h.composer_submit("x", &[over], 0).map(|x| x.0), Err(OwnerErr::Invalid));
    let more = Attachment { kind: AttachKind::Clip, path: None, text: Some("y".repeat(220 * 1024)) };
    let small = share::put(t.path(), "z".repeat(30 * 1024).as_bytes(), "txt").unwrap().1;
    let file = Attachment { kind: AttachKind::File, path: path(&small), text: None };
    let (_, outs) = h.composer_submit(&"z".repeat(15_000), &[file, full, more], 0).unwrap();
    assert!(sent(&outs)[0]["params"]["attachments"][0].get("text").is_none(), "over the line cap: inline copies dropped");
    let foreign = [Attachment { kind: AttachKind::File, path: Some("C:\\Users\\a\\not.txt".into()), text: None }];
    let (_, outs) = h.composer_submit("x", &foreign, 0).unwrap();
    assert!(sent(&outs)[0]["params"]["attachments"][0].get("text").is_none(), "only share-folder copies are read");
}

#[test]
fn main_assistant_is_the_owners_choice_and_needs_composer() {
    let (mut h, _t) = host();
    pair(&mut h, 1, "com.example.a", "Örnek", &["island.protrusion"], true, 0);
    assert!(h.reg.main.is_none(), "the tick without composer.handler does nothing");
    assert_eq!(h.set_main(Some("com.example.a")), Err(OwnerErr::Invalid));
    pair(&mut h, 2, MAIN, "Pusula", &ALL_MAIN, false, 10);
    assert!(h.reg.main.is_none(), "the plugin cannot make itself main");
    h.set_main(Some(MAIN)).unwrap();
    h.set_scope(MAIN, Scope::ComposerHandler, false, 0).unwrap();
    assert!(!h.main_connected(), "scope off = Ctrl+Space has nobody");
}

#[test]
fn usage_counts_without_content_and_disconnect_cleans_up() {
    let (mut h, _t) = host();
    pair(&mut h, 1, MAIN, "Pusula", &ALL_MAIN, true, 0);
    let p = json!({"title":"x","state":"info","icon":"bell"});
    for i in 0..3 {
        h.line(1, &rpc(i, "island.protrusion.set", p.clone()), 1000 + i);
    }
    let v = h.plugin_list(2000);
    let s = v[0].scopes.iter().find(|s| s.scope == Scope::IslandProtrusion).unwrap();
    assert_eq!((s.uses_24h, v[0].messages_24h), (3, 3));
    let info = serde_json::to_value(&v[0]).unwrap();
    assert!(info["messages24h"].is_number() && info["scopes"][0]["uses24h"].is_number(), "plugin-api.ts names");
    assert_eq!(h.plugin_list(2000 + 24 * 3_600_000)[0].scopes[0].uses_24h, 0, "a day later");
    let outs = h.disconnect(1, 3000);
    assert!(outs.contains(&Out::AlertClear("plugin:dev.example.pusula".into())));
    assert!(h.surfaces_view(&Attention::default(), None, None).protrusion.is_none());
    assert_eq!(h.reg.get(MAIN).unwrap().last_seen, Some(3000));
}

#[test]
fn lock_signal_only_locks() {
    let (mut h, _t) = host();
    pair(&mut h, 1, MAIN, "Pusula", &ALL_MAIN, true, 0);
    assert_eq!(err_code(&h.line(1, &rpc(1, "lock.signal", json!({"locked": false})), 10)), Some(code::INVALID_PARAMS));
    let outs = h.line(1, &rpc(2, "lock.signal", json!({"locked": true})), 10);
    let state = crate::lock::LockState { locked: true, reason: Some("plugin") };
    assert!(outs.contains(&Out::Ui(UiEvent::LockChanged(state))), "lock_changed comes from the one lock");
    assert!(h.surfaces_view(&Attention::default(), None, None).locked);
    h.lock_set(crate::lock::Reason::Windows, true);
    h.lock_set(crate::lock::Reason::Windows, false);
    assert!(h.locked(), "Windows unlock does not lift a plugin's lock");
    h.lock_release();
    assert!(!h.surfaces_view(&Attention::default(), None, None).locked);
}

#[test]
fn not_json_and_not_jsonrpc_get_their_codes() {
    let (mut h, _t) = host();
    h.connect(1, Client::default());
    assert_eq!(err_code(&h.line(1, b"{oops", 0)), Some(code::PARSE));
    assert_eq!(err_code(&h.line(1, br#"{"id":1,"method":"hello"}"#, 0)), Some(code::INVALID_REQUEST));
    assert_eq!(err_code(&h.line(1, br#"{"jsonrpc":"2.0","id":{},"method":"hello"}"#, 0)), Some(code::INVALID_REQUEST));
}

#[test]
fn surfaces_view_follows_plugin_api_ts_and_the_alert_lists_budget() {
    let (mut h, _t) = host();
    pair(&mut h, 1, MAIN, "Pusula", &ALL_MAIN, true, 0);
    let outs = h.line(1, &rpc(2, "approvals.prompt", json!({"id":"q","title":"Soru","kind":"question"})), 1000);
    let Some(Out::AlertPut { alert, .. }) = outs.into_iter().find(|o| matches!(o, Out::AlertPut { .. })) else {
        panic!()
    };
    let card = json!({"tabs":[{"id":"cc","title":"Claude Code","icon":"code","blocks":[
        {"type":"kv","rows":[{"key":"Model","value":"Opus"}]},{"type":"timer","started_at":"2026-10-16T14:32:00Z"}]}],
        "summary":[{"title":"2 iş","value":"çalışıyor"}]});
    h.line(1, &rpc(3, "card.module.set", card), 1000);
    h.line(
        1,
        &rpc(
            4,
            "island.protrusion.set",
            json!({"title":"x","state":"info","icon":"mic","live_text":{"stream_id":"s"}}),
        ),
        1000,
    );
    let v = serde_json::to_value(h.surfaces_view(&Attention::default(), Some(&alert.id), Some(4000))).unwrap();
    assert_eq!((v["approvalTop"].as_str(), v["dropStripMs"].as_u64()), (Some("q"), Some(4000)));
    assert_eq!(v["composer"], json!({"id": MAIN, "name": "Pusula", "main": true, "voice": true}));
    assert_eq!(v["tabs"][0]["blocks"][0]["rows"][0], json!({"k":"Model","v":"Opus"}));
    assert_eq!(v["tabs"][0]["blocks"][1]["startedAt"], "2026-10-16T14:32:00Z");
    assert_eq!(v["summary"][0]["rows"][0]["value"], "çalışıyor");
    assert_eq!(v["protrusion"]["liveText"]["streamId"], format!("{MAIN}:s"));
    assert_eq!(v["approvals"][0]["risk"], "high");
    assert!(v["approvals"][0].get("shownAt").is_none());
    let none = serde_json::to_value(h.surfaces_view(&Attention::default(), Some("other"), Some(4000))).unwrap();
    assert!(none["approvalTop"].is_null() && none["dropStripMs"].is_null(), "a non-approval top drops nothing");
    let ids: Vec<String> = h.modules_get().into_iter().map(|m| m.id).collect();
    assert_eq!((ids[0].as_str(), ids.last().unwrap().as_str()), ("genel", "dev.example.pusula/cc"));
    h.modules_set(vec!["dev.example.pusula/cc".into(), "genel".into()], vec!["dev.example.pusula/cc".into()]).unwrap();
    assert_eq!(h.modules_get()[0].id, "dev.example.pusula/cc");
    assert!(h.surfaces_view(&Attention::default(), None, None).tabs.is_empty(), "turned off in Settings › Modules");
    assert_eq!(sent(&h.composer_voice().unwrap())[0]["method"], "voice.request");
}

#[test]
fn a_re_pair_routes_to_the_new_connection_at_once() {
    let (mut h, _t) = host();
    pair(&mut h, 1, MAIN, "Pusula", &ALL_MAIN, true, 0);
    let outs = {
        h.connect(2, Client::default());
        h.line(2, &rpc(1, "hello", manifest(MAIN, "Pusula", &ALL_MAIN)), 1000);
        let req = h.consent_get(1000).unwrap().request_id.parse().unwrap();
        h.consent_respond(req, true, None, true, false, 1300).unwrap()
    };
    assert!(closed(&outs, 1), "the old pairing's connection goes");
    let (_, outs) = h.composer_submit("selam", &[], 1400).unwrap();
    assert!(matches!(outs[0], Out::Send(2, _)), "not to the closing one: {outs:?}");
}

#[test]
fn search_provider_query_results_and_open() {
    let (mut h, _t) = host();
    pair(&mut h, 1, "com.example.s", "Notlar", &["search.provider"], false, 0);
    let (req, outs) = h.search_query("kedi");
    assert_eq!(sent(&outs)[0]["method"], "search.query");
    assert_eq!(sent(&outs)[0]["params"], json!({"request": req, "query": "kedi"}));
    let rows = json!({"request": req, "group": "Notlar", "items": [{"id": "n1", "title": "<b>Kedi</b> notu"}]});
    h.line(1, &rpc(5, "search.results", rows), 10);
    let hits = h.search_take(req);
    assert_eq!((hits.len(), hits[0].title.as_str(), hits[0].group.as_deref()), (1, "Kedi notu", Some("Notlar")));
    let stale = json!({"request": req - 1, "items": [{"id": "x", "title": "eski"}]});
    h.line(1, &rpc(6, "search.results", stale), 11);
    assert_eq!(h.search_take(req).len(), 1, "an older query's answer is dropped");
    assert_eq!(h.search_open("com.example.s", "zzz"), Err(OwnerErr::Unknown), "only rows it sent");
    let outs = h.search_open("com.example.s", "n1").unwrap();
    assert_eq!(sent(&outs)[0]["params"], json!({"id": "n1"}));
    h.set_scope("com.example.s", Scope::SearchProvider, false, 0).unwrap();
    assert!(h.search_query("x").1.is_empty(), "scope off: not asked");
}

#[test]
fn locked_notch_sends_no_ctrl_k_query_and_no_clipboard_to_plugins() {
    let (mut h, _t) = host();
    pair(&mut h, 1, "com.example.s", "Notlar", &["search.provider"], false, 0);
    h.connect(2, Client::default());
    h.line(2, &rpc(1, "hello", manifest("com.example.a", "Örnek", &["clipboard.read"])), 0);
    let req = h.consent_get(0).unwrap().request_id.parse().unwrap();
    h.consent_respond(req, true, Some(&[Scope::ClipboardRead]), false, false, 300).unwrap();
    h.clipboard = vec![ClipItem { kind: "text".into(), text: Some("IBAN TR00".into()), path: None, password: false }];
    h.lock_set(Reason::Manual, true);
    let (req, outs) = h.search_query("gizli isim");
    assert!(outs.is_empty(), "locked: no search.query goes out");
    h.line(1, &rpc(5, "search.results", json!({"request": req, "items": [{"id": "n1", "title": "x"}]})), 10);
    assert!(h.search_take(req).is_empty());
    let outs = h.line(2, &rpc(2, "clipboard.read", json!({})), 1000);
    assert_eq!(sent(&outs)[0]["result"], json!({"items": [], "locked": true}));
    h.lock_release();
    assert_eq!(sent(&h.search_query("kedi").1).len(), 1, "unlocked: asked again");
    let outs = h.line(2, &rpc(3, "clipboard.read", json!({})), 2000);
    assert!(sent(&outs)[0]["result"]["items"].to_string().contains("IBAN"));
}

#[test]
fn voice_transcript_passes_its_speaker_through() {
    let (mut h, _t) = host();
    pair(&mut h, 1, MAIN, "Pusula", &ALL_MAIN, true, 0);
    let p = json!({"stream_id":"v","text":"merhaba","speaker":"Sen","final":true});
    let outs = h.line(1, &rpc(2, "voice.transcript", p), 1000);
    let piece = outs.iter().find_map(|o| match o {
        Out::Ui(UiEvent::Stream(s)) => Some(s.clone()),
        _ => None,
    });
    let piece = piece.expect("a final piece goes out at once");
    assert_eq!((piece.speaker.as_deref(), piece.done), (Some("Sen"), true));
    let outs = h.line(1, &rpc(3, "voice.transcript", json!({"stream_id":"v","text":"x","final":true})), 1100);
    let v = outs.iter().find_map(|o| match o {
        Out::Ui(UiEvent::Stream(s)) => serde_json::to_value(s).ok(),
        _ => None,
    });
    assert!(v.unwrap().get("speaker").is_none(), "forgotten after done; no speaker = no field");
}

/// Wave 6 `mirror_ask`: a mirrored Windows notification reaches nobody until the owner clicks "Asistan yanıtlasın";
/// then exactly its text goes once to the main assistant's connection, never to another plugin.
#[test]
fn a_mirrored_notification_goes_only_to_the_main_assistant_and_only_when_asked() {
    use crate::mirror::{Notice, RawToast, Store};
    let (mut h, _t) = host();
    pair(&mut h, 1, "com.example.main", "Ana", &["composer.handler"], true, 0);
    pair(&mut h, 2, "com.example.other", "Diğer", &["composer.handler", "island.protrusion"], false, 0);
    h.set_main(Some("com.example.main")).unwrap();
    let mut store = Store::default();
    let raw =
        RawToast { id: 5, app: "WhatsApp".into(), aumid: String::new(), texts: vec!["Ayşe".into(), "Selam".into()] };
    store.put(Notice::from_raw(&raw, String::new(), 1_000).unwrap());
    // The store cannot reach the host: nothing is sent until this call (the click).
    let text = store.ask_text("win.5").unwrap();
    let (_, outs) = h.composer_submit(&text, &[], 2_000).unwrap();
    let to: Vec<ConnId> = outs.iter().filter_map(|o| if let Out::Send(c, _) = o { Some(*c) } else { None }).collect();
    assert_eq!(to, [1], "only the main assistant's connection");
    let msg = &sent(&outs)[0];
    assert_eq!(
        (msg["method"].as_str(), msg["params"]["text"].as_str()),
        (Some("composer.submit"), Some("Windows bildirimi (WhatsApp): Ayşe\nSelam"))
    );
    h.set_main(None).unwrap();
    assert_eq!(h.composer_submit(&text, &[], 3_000).map(|x| x.0), Err(OwnerErr::NoMain), "no main: nobody gets it");
}

/* ---------- Sadakat 3: what only the main assistant gives (host/assistant.rs) ---------- */

const WITH_FILES: [&str; 5] =
    ["island.protrusion", "card.module", "composer.handler", "files.drop", "approvals.prompt"];

#[test]
fn assistant_reads_need_a_ready_main_assistant_then_its_push() {
    let (mut h, _t) = host();
    assert_eq!(h.assistant_counts(), Err(OwnerErr::NoMain));
    assert_eq!(h.calendar_next(), Err(OwnerErr::NoMain));
    assert_eq!(h.claude_bridge(0), Err(OwnerErr::NoMain));
    assert_eq!(h.assistant_open(OpenKind::Jobs), Err(OwnerErr::NoMain));
    assert_eq!(h.shelf_memory("C:\\x.pdf"), Err(OwnerErr::NoMain));
    assert_eq!(h.shelf_suggest("C:\\x.pdf").map(|r| r.0), Err(OwnerErr::NoMain));
    pair(&mut h, 1, MAIN, "Pusula", &ALL_MAIN, true, 0);
    assert_eq!(h.assistant_counts(), Err(OwnerErr::NotYet), "connected, nothing sent yet");
    let outs = h.line(1, &rpc(2, "assistant.counts.set", json!({"jobs": 2, "memory": 99_999})), 1000);
    assert_eq!(sent(&outs)[0]["result"]["ok"], true);
    assert_eq!(h.assistant_counts(), Ok(AssistantCounts { jobs: 2, memory: 9_999, approvals: 0 }), "capped; no approvals = 0");
    h.line(1, &rpc(20, "assistant.counts.set", json!({"jobs": 0, "memory": 1, "approvals": 3})), 1000);
    assert_eq!(h.assistant_counts().map(|c| c.approvals), Ok(3));
    for bad in [json!("3"), json!(-1), json!(1.5)] {
        let outs = h.line(1, &rpc(21, "assistant.counts.set", json!({"jobs": 0, "memory": 0, "approvals": bad})), 1000);
        assert_eq!(err_code(&outs), Some(code::INVALID_PARAMS), "{bad}");
    }
    assert_eq!(h.assistant_counts().map(|c| c.approvals), Ok(3), "a refused push keeps the last value");
    let cal =
        json!({"detail": "14:45, 30 dk", "next": [{"time": "16:00", "title": "Plan <b>x</b>", "source": "Takvim"}]});
    h.line(1, &rpc(3, "calendar.set", cal), 1000);
    let c = h.calendar_next().unwrap();
    assert_eq!((c.detail.as_deref(), c.next[0].title.as_str()), (Some("14:45, 30 dk"), "Plan x"), "tags stripped");
    let outs = h.line(1, &rpc(4, "calendar.set", json!({"next": [{"title": "no time"}]})), 1000);
    assert_eq!(err_code(&outs), Some(code::INVALID_PARAMS));
    // the join link and the ISO start (row 22): optional, kept only when valid; the link only on a meeting host over https.
    let row = |start: Value, link: Value| json!({"next": [{"time": "16:00", "title": "Plan", "start": start, "link": link}]});
    let ok = |h: &mut Host, id: u64, p: Value| {
        h.line(1, &rpc(id, "calendar.set", p), 1000);
        let e = h.calendar_next().unwrap().next.remove(0);
        (e.start, e.link)
    };
    let (start, link) = ok(&mut h, 30, row(json!("2026-10-18T16:00:00+03:00"), json!("https://teams.microsoft.com/l/meetup-join/x")));
    assert_eq!((start.as_deref(), link.as_deref()), (Some("2026-10-18T16:00:00+03:00"), Some("https://teams.microsoft.com/l/meetup-join/x")));
    let (_, link) = ok(&mut h, 31, row(json!("2026-10-18T16:00Z"), json!("https://us02web.zoom.us/j/123")));
    assert!(link.is_some(), "a subdomain of an allowed host");
    for bad in ["http://zoom.us/j/1", "https://evilzoom.us/j/1", "https://zoom.us.evil.com/j/1", "https://u:p@zoom.us/j/1", "javascript:alert(1)", "https://evil.com/?u=https://zoom.us"] {
        assert_eq!(ok(&mut h, 32, row(json!("x"), json!(bad))), (None, None), "{bad}");
    }
    assert_eq!(ok(&mut h, 33, row(json!("yarin 10:00"), json!(5))), (None, None), "not an instant, not a string");
    let bridge = json!({"installed": true, "healthy": true, "last_event_ago_s": 10});
    h.line(1, &rpc(5, "claude.bridge.set", bridge), 1000);
    assert_eq!(h.claude_bridge(6000).unwrap().last_event_ago_s, Some(15), "aged by Notch");
    let outs = h.assistant_open(OpenKind::Approval).unwrap();
    assert_eq!(sent(&outs)[0], json!({"jsonrpc": "2.0", "method": "assistant.open", "params": {"kind": "approval"}}));
    // offline: one event per change; the disconnect takes it (and every value) away.
    let on = Out::Ui(UiEvent::AssistantOffline(true));
    assert!(h.line(1, &rpc(6, "assistant.offline", json!({"on": true})), 1000).contains(&on));
    assert!(!h.line(1, &rpc(7, "assistant.offline", json!({"on": true})), 1000).contains(&on));
    let outs = h.line(1, &rpc(8, "job.done", json!({"title": "Faturalar taşındı", "took": "4 dk"})), 1000);
    let done =
        |seconds| Out::Ui(UiEvent::JobDone { title: "Faturalar taşındı".into(), took: "4 dk".into(), seconds });
    assert!(outs.contains(&done(None)));
    let body = json!({"title": "Faturalar taşındı", "took": "4 dk", "seconds": 240});
    assert!(h.line(1, &rpc(9, "job.done", body), 1000).contains(&done(Some(240))));
    let outs = h.line(1, &rpc(10, "job.done", json!({"title": "x", "seconds": "4 dk"})), 1000);
    assert_eq!(err_code(&outs), Some(code::INVALID_PARAMS), "seconds is a number");
    let body = json!({"title": "Faturalar taşındı", "took": "4 dk", "seconds": 240.7});
    assert!(h.line(1, &rpc(11, "job.done", body), 1000).contains(&done(Some(240))), "a float: floored");
    let outs = h.line(1, &rpc(12, "job.done", json!({"title": "x", "seconds": -1})), 1000);
    assert_eq!(err_code(&outs), Some(code::INVALID_PARAMS));
    let outs = h.disconnect(1, 2000);
    assert!(outs.contains(&Out::Ui(UiEvent::AssistantOffline(false))));
    assert_eq!(h.assistant_counts(), Err(OwnerErr::NoMain));
}

#[test]
fn meeting_set_quiets_the_attention_budget_and_goes_with_the_disconnect() {
    let (mut h, _t) = host();
    pair(&mut h, 1, MAIN, "Pusula", &["composer.handler", "alerts.post"], true, 0);
    let outs = h.line(1, &rpc(2, "meeting.set", json!({"active": true})), 1000);
    assert_eq!(err_code(&outs), Some(code::FORBIDDEN), "island.protrusion not granted");
    let (mut h, _t) = host();
    pair(&mut h, 1, MAIN, "Pusula", &["island.protrusion", "composer.handler", "alerts.post"], true, 0);
    for bad in [json!({}), json!({"active": "true"}), json!({"active": 1}), json!({"active": null})] {
        assert_eq!(
            err_code(&h.line(1, &rpc(3, "meeting.set", bad.clone()), 1000)),
            Some(code::INVALID_PARAMS),
            "{bad}"
        );
    }
    let on = Out::Ui(UiEvent::Meeting(true));
    assert!(h.line(1, &rpc(4, "meeting.set", json!({"active": true})), 1000).contains(&on));
    assert!(!h.line(1, &rpc(5, "meeting.set", json!({"active": true})), 1000).contains(&on), "one event per change");
    // What the caller does with the event: a meeting keeps a plugin alert and the protrusion off the island.
    let outs = h.line(1, &rpc(6, "alerts.post", json!({"id": "x", "title": "Yeni posta", "ms": 5000})), 1000);
    let alert = outs.iter().find_map(|o| if let Out::AlertPut { alert, .. } = o { Some(alert.clone()) } else { None });
    let alert = alert.expect("alert");
    let meeting = Attention { meeting: true, ..Attention::default() };
    assert_eq!((gate(&alert, &Attention::default()), gate(&alert, &meeting)), (Gate::Show, Gate::Wait));
    h.line(1, &rpc(7, "island.protrusion.set", json!({"title": "Dinliyorum", "state": "info", "icon": "mic"})), 1000);
    assert!(h.surfaces_view(&Attention::default(), None, None).protrusion.is_some());
    assert!(h.surfaces_view(&meeting, None, None).protrusion.is_none());
    assert!(h.disconnect(1, 2000).contains(&Out::Ui(UiEvent::Meeting(false))), "the disconnect ends the meeting");
    // Neither another main assistant nor the scope switched off leaves the meeting stuck on.
    let (mut h, _t) = host();
    let scopes = ["island.protrusion", "composer.handler"];
    pair(&mut h, 1, MAIN, "Pusula", &scopes, true, 0);
    pair(&mut h, 2, "com.example.b", "Örnek", &scopes, false, 0);
    h.line(1, &rpc(2, "meeting.set", json!({"active": true})), 1000);
    assert!(h.set_main(Some("com.example.b")).unwrap().contains(&Out::Ui(UiEvent::Meeting(false))));
    h.set_main(Some(MAIN)).unwrap();
    h.line(1, &rpc(3, "meeting.set", json!({"active": true})), 1000);
    let outs = h.set_scope(MAIN, Scope::IslandProtrusion, false, 1000).unwrap();
    assert!(outs.contains(&Out::Ui(UiEvent::Meeting(false))));
}

#[test]
fn cc_event_passes_only_known_kinds_and_plain_words() {
    let (mut h, _t) = host();
    pair(&mut h, 1, MAIN, "Pusula", &["composer.handler", "alerts.post"], true, 0);
    let outs = h.line(1, &rpc(2, "cc.event", json!({"kind": "prompt"})), 1000);
    assert_eq!(err_code(&outs), Some(code::FORBIDDEN), "island.protrusion not granted");
    let (mut h, _t) = host();
    pair(&mut h, 1, MAIN, "Pusula", &["island.protrusion", "composer.handler"], true, 0);
    let long = "a".repeat(65);
    for bad in [
        json!({}),
        json!({"kind": "rm -rf"}),
        json!({"kind": 5}),
        json!({"kind": "pre_tool", "tool": "Bash(rm -rf /)"}),
        json!({"kind": "pre_tool", "tool": long}),
        json!({"kind": "pre_tool", "tool": ""}),
        json!({"kind": "stop_failure", "reason": 7}),
        json!({"kind": "stop", "reason": "C:/Users/x"}),
        json!({"kind": "stop", "sid": "9c1d2e3f-raw-session-id"}),
        json!({"kind": "stop", "sid": "ABCDEF01"}),
    ] {
        assert_eq!(err_code(&h.line(1, &rpc(3, "cc.event", bad.clone()), 1000)), Some(code::INVALID_PARAMS), "{bad}");
    }
    let ev = |kind: &str, tool: Option<&str>, reason: Option<&str>| {
        Out::Ui(UiEvent::CcEvent { kind: kind.into(), tool: tool.map(Into::into), reason: reason.map(Into::into), sid: None })
    };
    assert!(h.line(1, &rpc(4, "cc.event", json!({"kind": "prompt"})), 1000).contains(&ev("prompt", None, None)));
    assert!(h
        .line(1, &rpc(8, "cc.event", json!({"kind": "stop", "sid": "0a1b2c3d"})), 1000)
        .contains(&Out::Ui(UiEvent::CcEvent { kind: "stop".into(), tool: None, reason: None, sid: Some("0a1b2c3d".into()) })));
    assert!(h
        .line(1, &rpc(5, "cc.event", json!({"kind": "pre_tool", "tool": "mcp__x__web.search"})), 1000)
        .contains(&ev("pre_tool", Some("mcp__x__web.search"), None)));
    assert!(h
        .line(1, &rpc(6, "cc.event", json!({"kind": "stop_failure", "reason": "rate_limit", "tool": null})), 1000)
        .contains(&ev("stop_failure", None, Some("rate_limit"))));
    // not the main assistant: refused before it reaches the page (covered by assistant_methods_are_main_only...)
    pair(&mut h, 2, "com.example.b", "Örnek", &["island.protrusion"], false, 0);
    assert_eq!(err_code(&h.line(2, &rpc(7, "cc.event", json!({"kind": "prompt"})), 1000)), Some(code::NOT_MAIN));
}

#[test]
fn peekas_own_hook_reaches_the_page_unless_the_main_assistant_sends_cc_event() {
    use crate::plugins::cc_hooks::hook_params;
    let (mut h, _t) = host();
    let ev = |kind: &str, tool: Option<&str>| {
        Out::Ui(UiEvent::CcEvent { kind: kind.into(), tool: tool.map(Into::into), reason: None, sid: None })
    };
    // the hook process's line, built from a raw Claude Code payload
    let raw = json!({"hook_event_name": "PreToolUse", "tool_name": "Grep", "tool_input": {"pattern": "parola"}});
    let line = hook_params(&raw, None).unwrap().to_string();
    assert_eq!(h.cc_hook(line.as_bytes(), 1000), Some(vec![ev("pre_tool", Some("Grep"))]), "no main assistant");
    for bad in [&b"{nope"[..], br#"{"kind":"rm"}"#, br#"{"kind":"pre_tool","tool":"C:\\x\\y"}"#, b""] {
        assert_eq!(h.cc_hook(bad, 1000), None, "{}", String::from_utf8_lossy(bad));
    }
    pair(&mut h, 1, MAIN, "Pusula", &["island.protrusion", "composer.handler"], true, 0);
    let prompt = br#"{"kind":"prompt"}"#;
    assert_eq!(h.cc_hook(prompt, 1000), Some(vec![ev("prompt", None)]), "main assistant connected but silent: ours shows");
    h.line(1, &rpc(2, "cc.event", json!({"kind": "prompt"})), 2000);
    assert_eq!(h.cc_hook(prompt, 3000), Some(vec![]), "the main assistant forwards Claude Code: ours is dropped");
    assert_eq!(h.cc_hook(prompt, 2000 + 120_000), Some(vec![ev("prompt", None)]), "2 min of main-assistant silence");
    h.line(1, &rpc(3, "cc.event", json!({"kind": "prompt"})), 200_000);
    h.disconnect(1, 200_500);
    assert_eq!(h.cc_hook(prompt, 201_000), Some(vec![ev("prompt", None)]), "main assistant gone: ours again");
}

#[test]
fn assistant_methods_are_main_only_and_scope_checked() {
    let (mut h, _t) = host();
    pair(&mut h, 1, "com.example.a", "Örnek", &["card.module", "island.protrusion"], false, 0);
    for m in [
        "assistant.counts.set",
        "calendar.set",
        "claude.bridge.set",
        "cc.sessions.set",
        "assistant.offline",
        "job.done",
        "meeting.set",
        "cc.event",
    ] {
        assert_eq!(err_code(&h.line(1, &rpc(2, m, json!({})), 1000)), Some(code::NOT_MAIN), "{m}");
    }
    pair(&mut h, 2, MAIN, "Pusula", &["composer.handler"], true, 2000);
    let outs = h.line(2, &rpc(3, "assistant.counts.set", json!({"jobs": 1, "memory": 1})), 3000);
    assert_eq!(err_code(&outs), Some(code::FORBIDDEN), "card.module not granted");
    let outs = h.line(2, &rpc(4, "shelf.suggestion", json!({"request": 1, "text": "x"})), 3000);
    assert_eq!(err_code(&outs), Some(code::FORBIDDEN), "files.drop not granted");
}

#[test]
fn a_shelf_file_is_copied_only_after_the_main_assistant_and_its_scope_are_checked() {
    let (mut h, _t) = host();
    assert_eq!(h.main_holds(None), Err(OwnerErr::NoMain), "no main assistant: no copy");
    pair(&mut h, 1, MAIN, "Pusula", &ALL_MAIN, true, 0);
    assert_eq!(h.main_holds(None), Ok(true), "a one-shot share needs no scope");
    assert_eq!(h.main_holds(Some(Scope::FilesDrop)), Ok(false), "shelf.suggest without files.drop: no copy");
    let (mut h, _t) = host();
    pair(&mut h, 1, MAIN, "Pusula", &WITH_FILES, true, 0);
    assert_eq!(h.main_holds(Some(Scope::FilesDrop)), Ok(true));
}

#[test]
fn shelf_suggestions_only_with_files_drop_and_only_for_the_open_request() {
    let (mut h, _t) = host();
    pair(&mut h, 1, MAIN, "Pusula", &ALL_MAIN, true, 0);
    let (req, outs) = h.shelf_suggest("C:\\R\\a.pdf").unwrap();
    assert_eq!((req, outs.len()), (None, 0), "no files.drop: the path is not sent");
    let (mut h, _t) = host();
    pair(&mut h, 1, MAIN, "Pusula", &WITH_FILES, true, 0);
    let (req, outs) = h.shelf_suggest("C:\\R\\a.pdf").unwrap();
    let req = req.unwrap();
    assert_eq!(sent(&outs)[0]["params"], json!({"request": req, "path": "C:\\R\\a.pdf"}));
    assert_eq!(h.shelf_suggestion(req), None, "not answered yet");
    let outs = h.line(1, &rpc(2, "shelf.suggestion", json!({"request": req + 1, "text": "eski"})), 1000);
    assert_eq!(sent(&outs)[0]["result"]["ok"], false, "another request: dropped");
    h.line(1, &rpc(3, "shelf.suggestion", json!({"request": req, "text": "Notlara ekleyeyim mi?"})), 1000);
    assert_eq!(h.shelf_suggestion(req), Some(Some("Notlara ekleyeyim mi?".into())));
    let next = h.shelf_suggest("C:\\R\\b.pdf").unwrap().0.unwrap();
    assert_eq!(h.shelf_suggestion(req), None, "an older request is gone");
    h.line(1, &rpc(4, "shelf.suggestion", json!({"request": next})), 1000);
    assert_eq!(h.shelf_suggestion(next), Some(None), "answered: nothing to suggest");
}

#[test]
fn first_connect_fires_once_in_a_lifetime() {
    let tmp = Tmp::new();
    let mut h = Host::new(tmp.path().to_path_buf());
    assert!(!h.first_connect_get());
    pair(&mut h, 1, "com.example.a", "Örnek", &["card.module"], false, 0);
    assert!(!h.first_connect_get(), "not the main assistant");
    let token = pair(&mut h, 2, MAIN, "Pusula", &ALL_MAIN, true, 1000);
    assert!(h.first_connect_get());
    h.first_connect_ack();
    assert!(!h.first_connect_get());
    let mut h = Host::new(tmp.path().to_path_buf());
    h.connect(3, Client::default());
    let outs = h.line(3, &rpc(1, "auth", json!({"id": MAIN, "token": token})), 5000);
    assert!(!outs.contains(&Out::Ui(UiEvent::FirstConnect)) && !h.first_connect_get(), "after a restart too");
}

#[test]
fn the_permission_log_names_scopes_never_secrets_and_is_capped() {
    let (mut h, _t) = host();
    pair(&mut h, 1, "com.example.a", "Örnek", &["island.protrusion", "card.module"], false, 7);
    h.set_scope("com.example.a", Scope::CardModule, false, 20).unwrap();
    h.set_scope("com.example.a", Scope::CardModule, false, 21).unwrap(); // no change, no row
    h.revoke("com.example.a", 30).unwrap();
    let log = h.permission_history();
    let rows: Vec<(u64, &str, bool)> = log.iter().map(|e| (e.at, e.scope.name(), e.granted)).collect();
    let granted = 7 + GUARD_MS;
    assert_eq!(
        rows,
        [
            (30, "island.protrusion", false),
            (20, "card.module", false),
            (granted, "card.module", true),
            (granted, "island.protrusion", true)
        ]
    );
    let text = serde_json::to_string(&log).unwrap();
    assert!(!text.contains("digest") && !text.contains("token") && text.contains("Örnek"));
    for i in 0..150 {
        h.log_permission("x", Scope::CardModule, i % 2 == 0, i);
    }
    assert_eq!(h.permission_history().len(), crate::plugins::registry::PERMISSION_LOG_MAX);
    assert_eq!(h.permission_history()[0].at, 149, "newest first, oldest dropped");
}

#[test]
fn a_plugin_alert_may_ask_for_the_task_manager_button_only_by_name() {
    let (mut h, _t) = host();
    pair(&mut h, 1, "com.example.a", "Örnek", &["alerts.post"], false, 0);
    let body = json!({"id": "cpu", "title": "Chrome işlemciyi zorluyor", "open": "task_manager"});
    let outs = h.line(1, &rpc(2, "alerts.post", body), 1000);
    let put = outs.iter().find_map(|o| if let Out::AlertPut { alert, .. } = o { Some(alert.clone()) } else { None });
    let put = put.unwrap();
    assert_eq!(put.action, Some(crate::alerts::Action::TaskManager));
    assert_eq!(put.action_label.as_deref(), Some(crate::alerts::TASK_MANAGER_LABEL));
    for open in [json!("C:\\Windows\\System32\\cmd.exe"), json!("https://example.com"), json!(true)] {
        let outs = h.line(1, &rpc(3, "alerts.post", json!({"id": "x", "title": "t", "open": open})), 1000);
        assert_eq!(err_code(&outs), Some(code::INVALID_PARAMS), "{open}");
    }
    let outs = h.line(1, &rpc(4, "alerts.post", json!({"id": "x", "title": "t", "action": "task_manager"})), 1000);
    assert_eq!(err_code(&outs), Some(code::INVALID_PARAMS), "no action field from a plugin, link or not");
}

#[test]
fn an_unknown_block_is_logged_by_count_and_a_summary_button_goes_back() {
    let (mut h, _t) = host();
    pair(&mut h, 1, "com.example.a", "Örnek", &["card.module"], false, 0);
    let card = json!({"tabs": [{"id": "t", "title": "T", "blocks": [{"type": "text", "text": "x"}, {"type": "gizli-tur"}]}],
                      "summary": [{"title": "Oturum", "action": {"id": "dur", "label": "Durdur"}}]});
    let outs = h.line(1, &rpc(2, "card.module.set", card.clone()), 1000);
    assert_eq!(sent(&outs)[0]["result"]["ok"], true, "the card is kept");
    let log = outs.iter().find_map(|o| if let Out::Log(l) = o { Some(l.clone()) } else { None }).unwrap();
    assert!(log.contains("1 bilinmeyen blok") && !log.contains("gizli-tur"), "a count, never the plugin's text: {log}");
    assert_eq!(h.modules["com.example.a"].tabs[0].blocks.len(), 1);
    let outs = h.action("com.example.a", "dur", 2000).unwrap();
    assert_eq!(sent(&outs)[0]["params"], json!({"id": "dur", "surface": "module"}), "no tab for a summary row");
    assert_eq!(h.action("com.example.a", "yok", 2000), Err(OwnerErr::Unknown));
    let logged = |outs: &[Out]| outs.iter().any(|o| matches!(o, Out::Log(_)));
    assert!(!logged(&h.line(1, &rpc(3, "card.module.set", card.clone()), 30_000)), "once a minute");
    assert!(logged(&h.line(1, &rpc(4, "card.module.set", card), 61_000)), "a minute later again");
}

#[test]
fn a_made_up_method_name_never_reaches_the_log() {
    let (mut h, _t) = host();
    h.connect(1, Client::default());
    let fake = "x\n[notch] eklenti dev.example.pusula auth -> 0";
    let outs = h.line(1, &rpc(1, fake, json!({})), 0);
    let log = outs.iter().find_map(|o| if let Out::Log(l) = o { Some(l.clone()) } else { None }).unwrap();
    assert_eq!(log, format!("eklenti - ? -> {}", code::UNAUTHORIZED));
    pair(&mut h, 2, "com.example.a", "Örnek", &["island.protrusion"], false, 0);
    let outs = h.line(2, &rpc(2, "clipboard.read", json!({})), 1000);
    let log = outs.iter().find_map(|o| if let Out::Log(l) = o { Some(l.clone()) } else { None }).unwrap();
    assert!(log.contains("clipboard.read"), "a real method name stays: {log}");
}

#[test]
fn only_the_main_assistant_may_use_the_face_icons_on_alerts() {
    let (mut h, _t) = host();
    pair(&mut h, 1, "com.example.a", "Örnek", &["alerts.post", "island.protrusion"], false, 0);
    pair(&mut h, 2, MAIN, "Pusula", &["alerts.post", "composer.handler"], true, 0);
    let icon_of = |outs: &[Out]| {
        outs.iter().find_map(|o| if let Out::AlertPut { alert, .. } = o { Some(alert.icon.clone()) } else { None })
    };
    for face in ["yorgun", "dikkat"] {
        let body = json!({"id": "q", "title": "Günlük bütçe %80", "icon": face});
        let outs = h.line(1, &rpc(2, "alerts.post", body.clone()), 1000);
        assert_eq!(err_code(&outs), Some(code::INVALID_PARAMS), "{face}: not for another plugin");
        assert_eq!(icon_of(&h.line(2, &rpc(3, "alerts.post", body), 1000)), Some(Some(face.to_string())));
        let p = json!({"title": "x", "state": "attention", "icon": face});
        assert_eq!(err_code(&h.line(1, &rpc(4, "island.protrusion.set", p), 1000)), Some(code::INVALID_PARAMS));
    }
    assert_eq!(
        icon_of(&h.line(1, &rpc(5, "alerts.post", json!({"id": "b", "title": "x", "icon": "bell"})), 1000)),
        Some(Some("bell".into()))
    );
}

#[test]
fn only_pids_the_main_assistant_announced_resolve() {
    let (mut h, _t) = host();
    assert_eq!(h.cc_session_pid("s-1"), Err(OwnerErr::NoMain));
    pair(&mut h, 1, "com.example.a", "Örnek", &["card.module"], false, 0);
    let fake = json!({"sessions": [{"id": "s-1", "pid": 4242}]});
    assert_eq!(err_code(&h.line(1, &rpc(2, "cc.sessions.set", fake.clone()), 500)), Some(code::NOT_MAIN));
    pair(&mut h, 2, MAIN, "Pusula", &ALL_MAIN, true, 1000);
    assert_eq!(h.cc_session_pid("s-1"), Err(OwnerErr::NotYet), "another plugin's claim is not kept");
    let outs = h.line(
        2,
        &rpc(3, "cc.sessions.set", json!({"sessions": [{"id": "s-1", "pid": 4242}, {"id": "s-2", "pid": 77}]})),
        1500,
    );
    assert_eq!(sent(&outs)[0]["result"]["ok"], true);
    assert_eq!((h.cc_session_pid("s-1"), h.cc_session_pid("s-2")), (Ok(4242), Ok(77)));
    assert_eq!(h.cc_session_pid("s-3"), Err(OwnerErr::Unknown), "never announced");
    for bad in [
        json!({"sessions": [{"id": "a/../b", "pid": 5}]}),
        json!({"sessions": [{"id": "s", "pid": 0}]}),
        json!({"sessions": [{"id": "s", "pid": 4}]}),
        json!({"sessions": [{"id": "s", "pid": -3}]}),
        json!({"sessions": [{"id": "s", "pid": 4_294_967_296u64}]}),
        json!({"sessions": [{"id": "s"}]}),
        json!({"sessions": (0..33).map(|i| json!({"id": format!("s{i}"), "pid": 100 + i})).collect::<Vec<_>>()}),
        json!({}),
    ] {
        assert_eq!(
            err_code(&h.line(2, &rpc(4, "cc.sessions.set", bad.clone()), 1500)),
            Some(code::INVALID_PARAMS),
            "{bad}"
        );
    }
    assert_eq!(h.cc_session_pid("s-1"), Ok(4242), "a refused push keeps the last list");
    h.line(2, &rpc(5, "cc.sessions.set", json!({"sessions": [{"id": "s-2", "pid": 78}]})), 1500);
    assert_eq!((h.cc_session_pid("s-1"), h.cc_session_pid("s-2")), (Err(OwnerErr::Unknown), Ok(78)), "replaced whole");
    h.disconnect(2, 2000);
    assert_eq!(h.cc_session_pid("s-2"), Err(OwnerErr::NoMain), "gone with the main assistant");
}

#[test]
fn the_main_assistants_launch_path_is_kept_from_pairing_and_shown() {
    let (mut h, _t) = host();
    assert_eq!(h.main_launch(), None, "no main assistant");
    h.connect(1, Client::default());
    let mut m = manifest(MAIN, "Pusula", &ALL_MAIN);
    m["launch"] = json!(r"C:\Pusula\pusula.exe");
    h.line(1, &rpc(1, "hello", m), 0);
    let req = h.consent_get(0).unwrap().request_id.parse().unwrap();
    h.consent_respond(req, true, None, true, false, GUARD_MS).unwrap();
    assert_eq!(h.main_launch(), Some(r"C:\Pusula\pusula.exe"));
    assert_eq!(h.plugin_list(0)[0].launch.as_deref(), Some(r"C:\Pusula\pusula.exe"));
    h.set_main(None).unwrap();
    assert_eq!(h.main_launch(), None, "only the main assistant's");
}
