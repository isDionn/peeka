//! The Windows notification mirror (Wave 6, owner decisions 3, 14, 17):
//! optional, off by default, only for owners with Developer Mode on. Other apps' toasts (WhatsApp, Teams…) are read
//! with `UserNotificationListener`, which needs package identity: a sparse package registered by the owner
//! (`src-tauri/identity/`). Here: whether it can be on and why not, the poll diff, the mapping to a card and the
//! in-memory list. Nothing in this file (or in `notch-win/src/notifications.rs`, `src-tauri/src/mirror.rs`) writes
//! a file or a log line: notification bodies live in memory only (a test below checks the sources).
//!
//! Inspired by HeyyCzer/windows-dynamic-island (ideas only; no code copied).

use std::collections::HashSet;

use serde::Serialize;
use serde_json::Value;

use crate::clip::vault::Secret;

/// Must match `src-tauri/identity/AppxManifest.xml` and the `<msix>` element of `src-tauri/notch.manifest`
/// (a test checks both). A rename means the owner unregisters and registers again.
pub const PACKAGE_NAME: &str = "Notch.Mirror";
pub const PUBLISHER: &str = "CN=Notch";
pub const APPLICATION_ID: &str = "Notch";

/// The card's one button instead of Windows's "Yanıtla" (no API reaches a toast's inline reply).
pub const OPEN_LABEL: &str = "Uygulamayı aç";
pub const MAX_ITEMS: usize = 20;
/// A wake-up from sleep can deliver a pile of toasts in one poll; only this many of the latest turn into cards.
pub const MAX_BURST: usize = 3;
pub const POLL_MS: u64 = 1_000;
const MAX_TITLE: usize = 120;
const MAX_BODY: usize = 300;
const MAX_APP: usize = 64;
const MAX_AUMID: usize = 512;

/// `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock\AllowDevelopmentWithoutDevLicense`: a DWORD,
/// non-zero = Developer Mode on. Missing (or not a DWORD) = off.
pub fn dev_mode(value: Option<u32>) -> bool {
    value.is_some_and(|v| v != 0)
}

/// Windows's answer to `UserNotificationListener::RequestAccessAsync` / `GetAccessStatus`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Access {
    /// Not asked yet, or no package identity to ask with.
    #[default]
    Unknown,
    Allowed,
    /// Off in Settings › Privacy › Notifications (`ms-settings:privacy-notifications`).
    Denied,
    /// Windows has no answer yet (not asked, or the prompt was closed): the switch may ask again.
    Unspecified,
}

/// Why the mirror cannot be on, first one wins. The page words it (texts suggested in the Wave 6 report).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Blocker {
    /// Developer Mode is off (`ms-settings:developers`): an unsigned sparse package cannot be registered.
    DevModeOff,
    /// No package identity: the owner has not run `identity\register.ps1`, or has not restarted Notch since.
    NotRegistered,
    /// Windows said no: Settings › Privacy › Notifications (`ms-settings:privacy-notifications`).
    AccessDenied,
}

/// `mirror_state`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorState {
    pub dev_mode: bool,
    pub registered: bool,
    pub access: Access,
    /// The owner's switch (`Settings::mirror`).
    pub enabled: bool,
    /// Actually mirroring now.
    pub on: bool,
    pub blocker: Option<Blocker>,
}

pub fn state(dev_mode: bool, registered: bool, access: Access, enabled: bool) -> MirrorState {
    let blocker = if !dev_mode {
        Some(Blocker::DevModeOff)
    } else if !registered {
        Some(Blocker::NotRegistered)
    } else if access == Access::Denied {
        Some(Blocker::AccessDenied)
    } else {
        None
    };
    let on = enabled && blocker.is_none() && access == Access::Allowed;
    MirrorState { dev_mode, registered, access, enabled, on, blocker }
}

/// One toast as Windows gave it.
#[derive(Clone, Debug, Default)]
pub struct RawToast {
    pub id: u32,
    pub app: String,
    pub aumid: String,
    pub texts: Vec<String>,
}

/// A mirrored notification: a card in the top-right of the island only (decision 17), never a strip ripple.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    /// `win.<Windows id>`.
    pub id: String,
    pub app: String,
    pub title: String,
    pub body: Option<String>,
    /// The sender's icon as a PNG data URL; the page draws its alpha only, in one colour (decision 14). "" = none
    /// (the page draws the initial tile).
    pub tile: String,
    /// Always true: notification list tiles are single-colour, whatever `colorIcons` says (decision 14).
    pub tile_mono: bool,
    /// Always false: a Windows notification never ripples the strip (decision 17).
    pub ripple: bool,
    /// "Uygulamayı aç".
    pub open_label: &'static str,
    /// The sender has an app id Notch can open.
    pub can_open: bool,
    pub at: u64,
    /// The notification holds a one-time code (a verification code). The code itself is not here: only
    /// `notif_copy_code` can put it on the clipboard.
    pub has_code: bool,
    #[serde(skip)]
    aumid: String,
    #[serde(skip)]
    code: Option<Code>,
}

/// Words that say "a one-time code follows" (matched on lower-cased text, so "KODUNUZ" and "Doğrulama" count).
const CODE_WORDS: &[&str] = &["kod", "code", "doğrulama", "dogrulama", "verification", "verify", "otp"];
/// A code must sit within this many characters of one of `CODE_WORDS`.
const CODE_NEAR: usize = 40;
/// How long a copied code stays on the clipboard (only if the clipboard still holds it).
pub const CODE_CLEAR_MS: u64 = 60_000;

/// A one-time code kept beside its notification. `Debug` never prints it, it is never serialised, and the only way out
/// is `Store::code` (the "Kodu kopyala" command).
#[derive(Clone, PartialEq)]
struct Code(String);

impl std::fmt::Debug for Code {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Code(..)")
    }
}

fn lower(chars: &[char]) -> Vec<char> {
    chars.iter().map(|c| c.to_lowercase().next().unwrap_or(*c)).collect()
}

/// Char ranges of every `CODE_WORDS` occurrence.
fn word_spans(lowered: &[char]) -> Vec<(usize, usize)> {
    let mut out = vec![];
    for w in CODE_WORDS {
        let w: Vec<char> = w.chars().collect();
        out.extend((0..lowered.len().saturating_sub(w.len() - 1)).filter(|&i| lowered[i..i + w.len()] == w[..]).map(|i| (i, i + w.len())));
    }
    out
}

/// Digit candidates a code could be: 4 to 8 digits in a row, or 3 + 3 digits split by one space or dash. Returns
/// (start, end, digits) in chars. Rejected: part of a longer number, glued to letters, a decimal or date piece, a
/// price, a phone number, a year (1900-2100).
fn digit_candidates(c: &[char]) -> Vec<(usize, usize, String)> {
    let digit = |i: usize| c.get(i).is_some_and(char::is_ascii_digit);
    let mut out = vec![];
    let mut i = 0;
    while i < c.len() {
        if !c[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let start = i;
        while digit(i) {
            i += 1;
        }
        let first = i - start;
        // 3 + 3 split by one separator; the second half must stand alone (a phone number goes on in groups).
        let split = first == 3 && matches!(c.get(i), Some(' ' | '-')) && digit(i + 1);
        let end = if split {
            let mut j = i + 1;
            while digit(j) {
                j += 1;
            }
            if j - (i + 1) != 3 || (matches!(c.get(j), Some(' ' | '-')) && digit(j + 1)) {
                continue;
            }
            j
        } else {
            i
        };
        let len = end - start;
        if !split && !(4..=8).contains(&len) {
            continue;
        }
        let before = start.checked_sub(1).map(|b| c[b]);
        let after = c.get(end).copied();
        let glued = before.is_some_and(char::is_alphabetic) || after.is_some_and(char::is_alphabetic);
        let decimal_or_date = |ch: Option<char>, next: Option<char>| {
            matches!(ch, Some('.' | ',' | '/' | ':')) && next.is_some_and(|n| n.is_ascii_digit())
        };
        let after_is = decimal_or_date(after, c.get(end + 1).copied());
        let before_is = decimal_or_date(before, start.checked_sub(2).map(|b| c[b]));
        let price = matches!(before, Some('$' | '€' | '£' | '₺')) || matches!(after, Some('$' | '€' | '£' | '₺'))
            || c[end..].iter().take(4).collect::<String>().trim_start().to_lowercase().starts_with("tl")
            || c[end..].iter().take(5).collect::<String>().trim_start().to_lowercase().starts_with("usd");
        let phone = before == Some('+') || (matches!(before, Some(' ' | '-')) && start >= 2 && c[start - 2].is_ascii_digit());
        let digits: String = c[start..end].iter().filter(|ch| ch.is_ascii_digit()).collect();
        let year = !split && len == 4 && (1900..=2100).contains(&digits.parse::<u32>().unwrap_or(0));
        if !(glued || after_is || before_is || price || phone || year) {
            out.push((start, end, digits));
        }
    }
    out
}

/// The one-time code in a notification's texts (title and body together), or None. Conservative on purpose: a code
/// word (`CODE_WORDS`) must stand within `CODE_NEAR` characters of the digits, and when two different candidates are
/// equally near, none is offered. A 4-digit year-like code (2024) is therefore never offered: a known miss.
pub fn find_code(texts: &[&str]) -> Option<String> {
    let chars: Vec<char> = texts.join(" ").chars().collect();
    let words = word_spans(&lower(&chars));
    let gap = |(s, e): (usize, usize)| words.iter().map(|&(ws, we)| if e <= ws { ws - e } else { s.saturating_sub(we) }).min();
    let mut near: Vec<(usize, String)> = digit_candidates(&chars)
        .into_iter()
        .filter_map(|(s, e, d)| gap((s, e)).filter(|g| *g <= CODE_NEAR).map(|g| (g, d)))
        .collect();
    near.sort();
    let (best, code) = near.first()?.clone();
    near.iter().take_while(|(g, _)| *g == best).all(|(_, d)| *d == code).then_some(code)
}

/// Digits that look like a code, hidden: what the assistant gets of a notification that has one ("Asistan yanıtlasın"
/// must not carry a code to a plugin).
fn hide_codes(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::new();
    let mut at = 0;
    for (s, e, _) in digit_candidates(&chars) {
        out.extend(&chars[at..s]);
        out.push_str("[kod gizlendi]");
        at = e;
    }
    out.extend(&chars[at..]);
    out
}

fn clean(s: &str, limit: usize) -> Option<String> {
    crate::alerts::text(&Value::String(s.to_string()), limit)
}

/// An AUMID that is safe behind `shell:AppsFolder\`: Windows's own shapes (`Pkg_hash!App`, `{GUID}\x.exe`,
/// `Vendor.App`), no control characters, quotes, drive colons or `..`.
fn aumid_ok(a: &str) -> bool {
    !a.is_empty()
        && a.len() <= MAX_AUMID
        && !a.chars().any(|c| c.is_control() || matches!(c, '"' | ':' | '/' | '<' | '>' | '|' | '*' | '?'))
        && !a.contains("..")
}

impl Notice {
    /// None = nothing to show, or Notch's own.
    pub fn from_raw(raw: &RawToast, tile: String, now: u64) -> Option<Self> {
        let app = clean(&raw.app, MAX_APP).unwrap_or_default();
        if app == crate::PRODUCT_NAME || app == "Notch" || raw.aumid.starts_with(PACKAGE_NAME) {
            return None;
        }
        let texts: Vec<String> = raw.texts.iter().filter_map(|t| clean(t, MAX_BODY)).collect();
        let title = texts.first().map(|t| t.chars().take(MAX_TITLE).collect()).or_else(|| clean(&app, MAX_TITLE))?;
        let rest: Vec<&str> = texts.iter().skip(1).map(String::as_str).collect();
        let body = (!rest.is_empty()).then(|| rest.join(" · ").chars().take(MAX_BODY).collect());
        let aumid = if aumid_ok(&raw.aumid) { raw.aumid.clone() } else { String::new() };
        let code = find_code(&texts.iter().map(String::as_str).collect::<Vec<_>>()).map(Code);
        Some(Self {
            id: format!("win.{}", raw.id),
            app,
            title,
            body,
            tile,
            tile_mono: true,
            ripple: false,
            open_label: OPEN_LABEL,
            can_open: !aumid.is_empty(),
            at: now,
            has_code: code.is_some(),
            aumid,
            code,
        })
    }
}

/// The poll's record of toast ids already seen. The first poll only records them (whatever already sits in the
/// Notification Center is not shown again); later polls give back the latest `MAX_BURST` new ids (oldest first)
/// and the ids that vanished.
#[derive(Default)]
pub struct Seen {
    known: Option<HashSet<u32>>,
}

impl Seen {
    /// `present`: (id, creation time) of every toast Windows lists now.
    pub fn step(&mut self, present: &[(u32, i64)]) -> (Vec<u32>, Vec<u32>) {
        let now: HashSet<u32> = present.iter().map(|p| p.0).collect();
        let Some(known) = self.known.as_mut() else {
            self.known = Some(now);
            return (vec![], vec![]);
        };
        let mut arrived: Vec<(u32, i64)> = present.iter().copied().filter(|p| !known.contains(&p.0)).collect();
        arrived.sort_by_key(|p| p.1);
        let skip = arrived.len().saturating_sub(MAX_BURST);
        let mut gone: Vec<u32> = known.difference(&now).copied().collect();
        gone.sort_unstable();
        *known = now;
        (arrived.into_iter().skip(skip).map(|p| p.0).collect(), gone)
    }
}

/// `notifications_changed` / `mirror_list`: newest first. `quiet` = Notch's DND is on: the list stays, no card
/// opens by itself.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MirrorView {
    pub items: Vec<Notice>,
    pub quiet: bool,
}

/// The clipboard clear after "Kodu kopyala": the clipboard's change counter right after the write, and when to look
/// again. If the counter is unchanged at the deadline the clipboard still holds the code and is emptied; any other copy
/// in between changed the counter and is left alone. In memory only, like the list.
#[derive(Debug, Default)]
pub struct CodeClear {
    pending: Option<(u32, u64)>,
}

impl CodeClear {
    /// The code was just copied: `seq` is the clipboard counter after the write. A second copy replaces the first.
    pub fn arm(&mut self, seq: u32, now: u64) {
        self.pending = Some((seq, now + CODE_CLEAR_MS));
    }

    /// The 1 s tick: the counter to check once the 60 s are up (taken, so it is asked once).
    pub fn due(&mut self, now: u64) -> Option<u32> {
        self.pending.filter(|(_, at)| *at <= now).and_then(|_| self.take())
    }

    /// Notch is closing: the counter to check right now, if a code is still waiting.
    pub fn take(&mut self) -> Option<u32> {
        self.pending.take().map(|(seq, _)| seq)
    }
}

/// The in-memory list. There is no load or save: it is empty after every start.
#[derive(Default)]
pub struct Store {
    items: Vec<Notice>,
}

impl Store {
    pub fn put(&mut self, n: Notice) {
        self.items.retain(|x| x.id != n.id);
        self.items.insert(0, n);
        self.items.truncate(MAX_ITEMS);
    }

    pub fn remove(&mut self, id: &str) -> bool {
        let before = self.items.len();
        self.items.retain(|x| x.id != id);
        before != self.items.len()
    }

    /// Windows ids that left the Notification Center (dismissed there, or by the app).
    pub fn gone(&mut self, ids: &[u32]) -> bool {
        let before = self.items.len();
        self.items.retain(|x| !ids.iter().any(|i| x.id == format!("win.{i}")));
        before != self.items.len()
    }

    pub fn clear(&mut self) -> bool {
        let had = !self.items.is_empty();
        self.items.clear();
        had
    }

    pub fn view(&self, quiet: bool) -> MirrorView {
        MirrorView { items: self.items.clone(), quiet }
    }

    /// What "Uygulamayı aç" hands `ShellExecute`: only for a listed id with a checked app id.
    pub fn open_target(&self, id: &str) -> Option<String> {
        let n = self.items.iter().find(|x| x.id == id)?;
        n.can_open.then(|| format!("shell:AppsFolder\\{}", n.aumid))
    }

    /// The text "Asistan yanıtlasın" sends, once, to the main assistant only (the caller uses `composer_submit`). A
    /// notification with a one-time code goes with the digits hidden.
    pub fn ask_text(&self, id: &str) -> Option<String> {
        let n = self.items.iter().find(|x| x.id == id)?;
        let app = if n.app.is_empty() { "bir uygulama" } else { n.app.as_str() };
        let mut text = format!("Windows bildirimi ({app}): {}", n.title);
        if let Some(b) = &n.body {
            text.push('\n');
            text.push_str(b);
        }
        Some(if n.has_code { hide_codes(&text) } else { text })
    }

    /// "Kodu kopyala": the one-time code of a listed notification, as a secret that zeroes itself. Only the copy
    /// command asks for it.
    pub fn code(&self, id: &str) -> Option<Secret> {
        let n = self.items.iter().find(|x| x.id == id)?;
        n.code.as_ref().map(|c| Secret::new(c.0.clone().into_bytes()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(id: u32, app: &str, aumid: &str, texts: &[&str]) -> RawToast {
        RawToast { id, app: app.into(), aumid: aumid.into(), texts: texts.iter().map(|t| t.to_string()).collect() }
    }

    #[test]
    fn developer_mode_and_why_the_mirror_cannot_be_on() {
        assert!(!dev_mode(None) && !dev_mode(Some(0)) && dev_mode(Some(1)) && dev_mode(Some(2)));
        let s = state(false, true, Access::Allowed, true);
        assert_eq!((s.blocker, s.on), (Some(Blocker::DevModeOff), false), "Developer Mode first, even if registered");
        assert_eq!(state(true, false, Access::Unknown, true).blocker, Some(Blocker::NotRegistered));
        assert_eq!(state(true, true, Access::Denied, true).blocker, Some(Blocker::AccessDenied));
        let s = state(true, true, Access::Unspecified, false);
        assert_eq!((s.blocker, s.on), (None, false), "no answer yet is not a no");
        let s = state(true, true, Access::Unknown, false);
        assert_eq!((s.blocker, s.on), (None, false), "not asked yet: the switch can be turned on");
        assert!(!state(true, true, Access::Allowed, false).on, "off by default: the owner's switch");
        assert!(state(true, true, Access::Allowed, true).on);
        let json = serde_json::to_value(state(false, false, Access::Unknown, false)).unwrap();
        assert_eq!((json["devMode"].as_bool(), json["blocker"].as_str()), (Some(false), Some("dev_mode_off")));
    }

    #[test]
    fn a_toast_becomes_a_quiet_mono_card_with_open_app() {
        let n = Notice::from_raw(
            &raw(
                7,
                "WhatsApp",
                "5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App",
                &["Ayşe", "Akşam\u{202E} geliyor musun?", "  "],
            ),
            "data:image/png;base64,AA".into(),
            1_000,
        )
        .unwrap();
        assert_eq!(
            (n.id.as_str(), n.title.as_str(), n.body.as_deref()),
            ("win.7", "Ayşe", Some("Akşam geliyor musun?"))
        );
        assert!(n.tile_mono && !n.ripple && n.can_open);
        assert_eq!(n.open_label, "Uygulamayı aç");
        let json = serde_json::to_value(&n).unwrap();
        assert_eq!((json["tileMono"].as_bool(), json["ripple"].as_bool()), (Some(true), Some(false)));
        assert_eq!(json["openLabel"].as_str(), Some("Uygulamayı aç"));
        assert!(json.get("aumid").is_none(), "the app id stays in Rust");

        let only_app = Notice::from_raw(&raw(8, "Teams", "", &[]), String::new(), 0).unwrap();
        assert_eq!((only_app.title.as_str(), only_app.body, only_app.can_open), ("Teams", None, false));
        assert!(Notice::from_raw(&raw(9, "", "", &[" "]), String::new(), 0).is_none());
        assert!(Notice::from_raw(&raw(10, "Peeka", "", &["x"]), String::new(), 0).is_none(), "Peeka's own");
        let three = Notice::from_raw(&raw(11, "Mail", "Mail", &["a", "b", "c"]), String::new(), 0).unwrap();
        assert_eq!(three.body.as_deref(), Some("b · c"));
    }

    #[test]
    fn open_app_only_for_listed_ids_and_safe_app_ids() {
        let mut s = Store::default();
        for (id, aumid) in
            [(1, "Microsoft.Office.OUTLOOK.EXE.15"), (2, r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\cmd.exe")]
        {
            s.put(Notice::from_raw(&raw(id, "x", aumid, &["t"]), String::new(), 0).unwrap());
        }
        for (id, bad) in [(3, r"..\..\x"), (4, r"C:\evil.exe"), (5, "a\"b"), (6, "https://x")] {
            s.put(Notice::from_raw(&raw(id, "x", bad, &["t"]), String::new(), 0).unwrap());
        }
        assert_eq!(s.open_target("win.1").as_deref(), Some(r"shell:AppsFolder\Microsoft.Office.OUTLOOK.EXE.15"));
        assert!(s.open_target("win.2").is_some());
        assert!((3..=6).all(|i| s.open_target(&format!("win.{i}")).is_none()));
        assert_eq!(s.open_target("win.99"), None);
    }

    #[test]
    fn the_list_is_capped_newest_first_and_follows_the_notification_center() {
        let mut s = Store::default();
        for i in 0..25 {
            s.put(Notice::from_raw(&raw(i, "a", "", &["t"]), String::new(), i as u64).unwrap());
        }
        let v = s.view(true);
        assert_eq!((v.items.len(), v.items[0].id.as_str(), v.quiet), (MAX_ITEMS, "win.24", true));
        assert!(s.gone(&[24, 23]) && !s.gone(&[1]));
        assert!(s.remove("win.22") && !s.remove("win.22"));
        assert!(s.clear() && !s.clear() && s.view(false).items.is_empty());
    }

    #[test]
    fn the_poll_does_not_replay_and_caps_bursts() {
        let mut seen = Seen::default();
        assert_eq!(seen.step(&[(1, 10), (2, 20)]), (vec![], vec![]), "first look only remembers");
        assert_eq!(seen.step(&[(1, 10), (2, 20), (3, 30)]), (vec![3], vec![]));
        let burst: Vec<(u32, i64)> = (10..16).map(|i| (i, 100 - i as i64)).collect();
        assert_eq!(seen.step(&burst), (vec![12, 11, 10], vec![1, 2, 3]), "newest three by time, oldest first");
        assert_eq!(seen.step(&[]).1, (10..16).collect::<Vec<_>>());
    }

    #[test]
    fn ask_text_is_just_this_one_notification() {
        let mut s = Store::default();
        s.put(Notice::from_raw(&raw(1, "WhatsApp", "", &["Ayşe", "Geliyor musun?"]), String::new(), 0).unwrap());
        s.put(Notice::from_raw(&raw(2, "Teams", "", &["Toplantı"]), String::new(), 0).unwrap());
        assert_eq!(s.ask_text("win.1").as_deref(), Some("Windows bildirimi (WhatsApp): Ayşe\nGeliyor musun?"));
        assert_eq!(s.ask_text("win.2").as_deref(), Some("Windows bildirimi (Teams): Toplantı"));
        assert_eq!(s.ask_text("win.3"), None);
    }

    fn code_of(texts: &[&str]) -> Option<String> {
        find_code(texts)
    }

    #[test]
    fn a_verification_code_is_found_only_beside_a_code_word() {
        assert_eq!(code_of(&["G-482913 is your Google verification code."]).as_deref(), Some("482913"));
        assert_eq!(code_of(&["Doğrulama kodunuz: 7381"]).as_deref(), Some("7381"));
        assert_eq!(code_of(&["KOD: 123 456 (5 dk geçerli)"]).as_deref(), Some("123456"), "3 + 3 digits");
        assert_eq!(code_of(&["Your code is 123456. Valid for 10 minutes."]).as_deref(), Some("123456"));
        assert_eq!(code_of(&["Banka", "Tek kullanımlık şifre kodu 90871234"]).as_deref(), Some("90871234"));
        assert_eq!(code_of(&["Doğrulama", "Kodunuz 553311"]).as_deref(), Some("553311"), "word in the title, digits in the body");
        assert_eq!(code_of(&["Toplantı 1234 numaralı odada, saat 15:30"]), None, "no code word, no code");
        assert_eq!(code_of(&["Siparişiniz 884412 yola çıktı"]), None);
    }

    #[test]
    fn numbers_that_are_not_codes_are_left_alone_even_beside_a_code_word() {
        for t in [
            "kod: 1500 TL tutarında ödeme",
            "code costs $4500 today",
            "kod için +90 532 123 45 67 numarasını ara",
            "kod 3.14159 sürümü",
            "kod 12/05/2024 tarihinde",
            "kod 2024 yılı",
            "kod 1234567890123 barkod",
            "kod abc123456def",
            "verification 12:3456",
        ] {
            assert_eq!(code_of(&[t]), None, "{t}");
        }
        assert_eq!(code_of(&["kod 123456 ya da 654321"]).as_deref(), Some("123456"), "the nearer one");
        assert_eq!(code_of(&["123456 kod 654321"]), None, "two equally near, different: none offered");
    }

    #[test]
    fn the_code_never_leaves_except_through_the_copy_secret() {
        let toast = raw(5, "Google", "Pkg!App", &["Doğrulama kodu", "Kodunuz 482913. Kimseyle paylaşmayın."]);
        let n = Notice::from_raw(&toast, String::new(), 0).unwrap();
        assert!(n.has_code);
        let json = serde_json::to_value(&n).unwrap();
        assert_eq!(json["hasCode"].as_bool(), Some(true));
        assert!(json.get("code").is_none() && json.get("aumid").is_none(), "no code field on the wire");
        let dbg = format!("{:?}", n.code);
        assert!(!dbg.contains("482913"), "Debug of the stored code: {dbg}");
        let plain = Notice::from_raw(&raw(6, "Teams", "", &["Toplantı", "Saat 3'te"]), String::new(), 0).unwrap();
        assert!(!plain.has_code && serde_json::to_value(&plain).unwrap()["hasCode"].as_bool() == Some(false));

        let mut s = Store::default();
        s.put(n);
        s.put(plain);
        assert_eq!(s.code("win.5").unwrap().bytes(), b"482913");
        assert!(s.code("win.6").is_none(), "no code in that one");
        assert!(s.code("win.404").is_none());
    }

    #[test]
    fn what_the_assistant_gets_to_answer_has_the_code_hidden() {
        let mut s = Store::default();
        s.put(Notice::from_raw(&raw(1, "Bank", "", &["Doğrulama kodu", "Kod: 482913 veya 111 222"]), String::new(), 0).unwrap());
        let text = s.ask_text("win.1").unwrap();
        assert!(!text.contains("482913") && !text.contains("111 222"), "{text}");
        assert!(text.contains("[kod gizlendi]") && text.contains("Doğrulama kodu"));
        s.put(Notice::from_raw(&raw(2, "WhatsApp", "", &["Ayşe", "Saat 1234 gibi"]), String::new(), 0).unwrap());
        assert!(s.ask_text("win.2").unwrap().contains("1234"), "a notification without a code goes as it is");
    }

    #[test]
    fn the_copied_code_is_cleared_after_a_minute_only_if_nothing_else_was_copied() {
        let mut c = CodeClear::default();
        assert_eq!(c.due(0), None);
        c.arm(41, 1_000);
        assert_eq!(c.due(60_999), None, "not yet");
        assert_eq!(c.due(61_000), Some(41), "the counter to check");
        assert_eq!(c.due(61_001), None, "asked once");
        c.arm(50, 0);
        c.arm(51, 10_000);
        assert_eq!(c.take(), Some(51), "a newer copy replaces the older; quitting asks for it now");
        assert_eq!(c.take(), None);
    }

    /// Bodies never reach the disk or a log: the three files that touch them have no file or log calls at all.
    #[test]
    fn the_mirror_is_memory_only() {
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
        let banned = [
            ["std", "::fs"].concat(),
            ["fs", "::write"].concat(),
            ["File", "::"].concat(),
            ["OpenOptions"].concat(),
            ["eprint", "ln!"].concat(),
            ["print", "ln!"].concat(),
            ["notice", "("].concat(),
            ["fn ", "save"].concat(),
            ["fn ", "load"].concat(),
        ];
        for file in
            ["crates/notch-core/src/mirror.rs", "crates/notch-win/src/notifications.rs", "src-tauri/src/mirror.rs"]
        {
            let src = std::fs::read_to_string(root.join(file)).unwrap_or_else(|_| panic!("{file} missing"));
            let code = src.split("#[cfg(test)]").next().unwrap();
            for b in &banned {
                assert!(!code.contains(b.as_str()), "{file} contains {b}");
            }
        }
        let settings = serde_json::to_string(&crate::settings::Settings::default()).unwrap();
        assert!(settings.contains("\"mirror\":false"), "only the switch is saved, off by default");
    }

    #[test]
    fn package_names_match_the_manifests() {
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..").join("src-tauri");
        let appx = std::fs::read_to_string(root.join("identity/AppxManifest.xml")).unwrap();
        let exe = std::fs::read_to_string(root.join("notch.manifest")).unwrap();
        assert!(appx.contains(&format!(r#"Name="{PACKAGE_NAME}" Publisher="{PUBLISHER}""#)));
        assert!(appx.contains(&format!(r#"<Application Id="{APPLICATION_ID}""#)));
        assert!(appx.contains("userNotificationListener") && appx.contains("<uap10:AllowExternalContent>true"));
        assert!(exe.contains(&format!(
            r#"publisher="{PUBLISHER}" packageName="{PACKAGE_NAME}" applicationId="{APPLICATION_ID}""#
        )));
    }
}
