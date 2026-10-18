//! The decisions inside `crates/notch-app/src/commands.rs`, pulled out so `cargo test --lib` covers them (the bin crate is
//! never tested). Each command stays a thin wrapper: it reads Notch's state, calls one of these, then calls Windows.
//! `CmdError` is bridge.ts `CmdError`; the `From`s are the one place each domain error becomes a page error.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::apps::{AppError, AppItem, Hit, Pin};
use crate::clip::ClipErr;
use crate::plugins::host::OwnerErr;
use crate::shelf::CopyErr;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CmdError {
    Unknown,
    Refused,
    Invalid,
    Io,
    Unsupported,
    Denied,
    Missing,
    NotYet,
    /// Within ~300 ms of the prompt appearing: the click was ignored, the prompt stays.
    Ignored,
    /// No main assistant connected (the UI says "Assistant not connected").
    NotConnected,
}

impl From<AppError> for CmdError {
    fn from(e: AppError) -> Self {
        match e {
            AppError::Unknown => Self::Unknown,
            AppError::Refused => Self::Refused,
            AppError::Elevated => Self::Denied,
        }
    }
}

impl From<OwnerErr> for CmdError {
    fn from(e: OwnerErr) -> Self {
        match e {
            OwnerErr::Unknown => Self::Unknown,
            OwnerErr::Ignored => Self::Ignored,
            OwnerErr::Invalid => Self::Invalid,
            OwnerErr::NoMain => Self::NotConnected,
            OwnerErr::Io => Self::Io,
            OwnerErr::NotYet => Self::NotYet,
        }
    }
}

impl From<ClipErr> for CmdError {
    fn from(e: ClipErr) -> Self {
        match e {
            ClipErr::Unknown => Self::Unknown,
            // Locked, or not for a password item: the page says "locked" / hides the button.
            ClipErr::Locked | ClipErr::Password | ClipErr::Risky => Self::Denied,
            ClipErr::Missing => Self::Missing,
            ClipErr::Kind => Self::Invalid,
            ClipErr::Io => Self::Io,
        }
    }
}

impl From<CopyErr> for CmdError {
    fn from(e: CopyErr) -> Self {
        match e {
            CopyErr::Password => Self::Denied,
            CopyErr::NotFile | CopyErr::TooBig => Self::Invalid,
            CopyErr::Io => Self::Io,
        }
    }
}

/// Every command that sends the owner's content to a plugin (or takes it for one), or shows it somewhere new
/// (opens a clip, puts it on the shelf, previews it, copies a code, opens a download): `denied` while Notch is locked.
/// The list is `SENDS_OWNER_CONTENT`, held to it by a test.
pub fn unlocked(locked: bool) -> Result<(), CmdError> {
    if locked {
        Err(CmdError::Denied)
    } else {
        Ok(())
    }
}

/// The commands in `crates/notch-app/src/commands.rs` that must start with `cmd::unlocked`.
pub const SENDS_OWNER_CONTENT: [&str; 16] = [
    "composer_scan",
    "composer_attach_file",
    "composer_submit",
    "share_open",
    "mirror_ask",
    "shelf_ask",
    "shelf_memory",
    "shelf_suggest",
    "clip_share",
    "search_ask",
    "clip_open",
    "clip_to_shelf",
    "clip_preview",
    "download_open",
    "download_show_in_folder",
    "notif_copy_code",
];

/// shortcut: at most 64 pins; a bigger row would not fit any strip.
pub const MAX_PINS: usize = 64;

/// `set_pins`: the new order. Each id must already be pinned or be in Notch's last strip list; no repeats.
pub fn pins_order(current: &[Pin], items: &[AppItem], ids: &[String]) -> Result<Vec<Pin>, CmdError> {
    if ids.len() > MAX_PINS {
        return Err(CmdError::Invalid);
    }
    let mut pins: Vec<Pin> = Vec::with_capacity(ids.len());
    for id in ids {
        if pins.iter().any(|p| &p.app_id == id) {
            return Err(CmdError::Invalid);
        }
        let known = current.iter().find(|p| &p.app_id == id).cloned().or_else(|| {
            items.iter().find(|i| &i.app_id == id).map(|i| Pin { app_id: i.app_id.clone(), name: i.name.clone() })
        });
        pins.push(known.ok_or(CmdError::Unknown)?);
    }
    Ok(pins)
}

/// `composer_scan`'s window: the topmost app window that is not minimised and not Notch's own (`own_exe`, compared
/// case-insensitively). `denied` when that window is a sensitive app (password manager, bank, Windows security: the
/// clipboard's `clip::secret` lists); the next window down is never taken instead, the owner meant this one.
pub fn scan_target(windows: &[crate::apps::RawWindow], own_exe: &str) -> Result<isize, CmdError> {
    use crate::clip::secret::{sensitive_exe, sensitive_title};
    let own = |w: &crate::apps::RawWindow| !own_exe.is_empty() && w.exe_path.eq_ignore_ascii_case(own_exe);
    let w =
        windows.iter().find(|w| crate::apps::is_app_window(w) && !w.minimized && !own(w)).ok_or(CmdError::Missing)?;
    if sensitive_exe(&w.exe_path) || sensitive_title(&w.title) {
        return Err(CmdError::Denied);
    }
    Ok(w.hwnd)
}

/// `path` is `dir` or inside it, the Windows way: case-insensitive, `/` or `\`, whole components only. Ctrl+K hides
/// Notch's own files with it (Windows Search's `ItemUrl` casing need not match `%LOCALAPPDATA%`).
pub fn inside_dir(path: &str, dir: &Path) -> bool {
    let norm = |s: &str| s.replace('/', "\\").trim_end_matches('\\').to_lowercase();
    let (p, d) = (norm(path), norm(&dir.to_string_lossy()));
    !d.is_empty() && (p == d || p.starts_with(&format!("{d}\\")))
}

/// What a Ctrl+K id opens (`search_open`).
#[derive(Debug, PartialEq, Eq)]
pub enum Route<'a> {
    /// One of `search::SETTINGS`' pages that Notch listed.
    Setting(&'static str),
    /// A file row Notch listed (last search or recents).
    File(&'a str),
    /// (plugin id, row id): the plugin is asked, nothing is opened here.
    Plugin(&'a str, &'a str),
    Hit(Hit),
}

/// `listed` = the id is in Notch's last search or its recents; a file or a settings page opens only then (an id the
/// page made up is `unknown`). A page must also be in `search::SETTINGS`, so the URI handed to Windows is ours.
pub fn search_route(id: &str, listed: bool) -> Result<Route<'_>, CmdError> {
    if let Some(uri) = id.strip_prefix("set:") {
        listed.then(|| crate::search::setting_uri(uri)).flatten().map(Route::Setting).ok_or(CmdError::Unknown)
    } else if let Some(path) = id.strip_prefix("file:") {
        listed.then_some(Route::File(path)).ok_or(CmdError::Unknown)
    } else if let Some(rest) = id.strip_prefix("plg:") {
        let (plugin, row) = rest.split_once(':').ok_or(CmdError::Invalid)?;
        Ok(Route::Plugin(plugin, row))
    } else {
        Hit::parse(id).map(Route::Hit).ok_or(CmdError::Invalid)
    }
}

/// The shelf's one-shot copies (`shelf_copy` per id), made only once the main assistant is there. `main` is
/// `Host::main_holds`: Err = nobody to send to (nothing copied), Ok(false) = it lacks the scope asked (nothing
/// copied, nothing sent). The first refused file stops the lot.
pub fn shelf_copies<'a>(
    main: Result<bool, OwnerErr>,
    ids: impl IntoIterator<Item = &'a str>,
    copy: impl FnMut(&str) -> Result<String, CmdError>,
) -> Result<Vec<String>, CmdError> {
    if !main? {
        return Ok(vec![]);
    }
    ids.into_iter().map(copy).collect()
}

/// `composer_attach_file`, before the picked file is read: `denied` for a password-class name (the shelf copy's
/// check), `invalid` over `ATTACH_MAX_BYTES`. The copy's extension comes from its name.
pub fn attach_ext(size: u64, name: &str) -> Result<String, CmdError> {
    if crate::shelf::password_name(name) {
        return Err(CmdError::Denied);
    }
    if size > crate::fidelity::ATTACH_MAX_BYTES {
        return Err(CmdError::Invalid);
    }
    Ok(crate::fidelity::share_ext(name))
}

/// `composer_attach_file`, once read: `denied` for text that holds a secret (the shelf copy's check).
pub fn attach_bytes(bytes: &[u8]) -> Result<(), CmdError> {
    if crate::shelf::password_text(bytes) {
        Err(CmdError::Denied)
    } else {
        Ok(())
    }
}

/// `assistant_start`: the main assistant's manifest `launch`, checked again (the stored file may have been edited)
/// and present on disk. Never built from the page.
pub fn assistant_start_target(launch: Option<&str>, is_file: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    launch.filter(|l| crate::plugins::manifest::launch_path(l)).map(PathBuf::from).filter(|p| is_file(p))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn notchs_own_files_are_found_whatever_the_casing() {
        let data = Path::new(r"C:\Users\Ali\AppData\Local\notch");
        assert!(inside_dir(r"c:\users\ali\appdata\local\NOTCH\clipboard\img\a.png", data));
        assert!(inside_dir("C:/Users/Ali/AppData/Local/notch/plugins.json", data));
        assert!(!inside_dir(r"C:\Users\Ali\AppData\Local\notchy\a.txt", data), "a whole component only");
        assert!(!inside_dir(r"C:\Users\Ali\Belgeler\notch.txt", data));
    }

    #[test]
    fn scan_skips_notchs_own_windows_and_refuses_a_sensitive_app() {
        let w = |hwnd: isize, exe: &str, title: &str| crate::apps::RawWindow {
            hwnd,
            title: title.into(),
            class: "Chrome_WidgetWin_1".into(),
            visible: true,
            exe_path: exe.into(),
            ..Default::default()
        };
        let own = r"C:\Program Files\Peeka\peeka.exe";
        let notch = w(1, r"c:\program files\peeka\PEEKA.EXE", "Notch");
        let editor = w(2, r"C:\Windows\notepad.exe", "Rapor - Not Defteri");
        assert_eq!(scan_target(&[notch.clone(), editor.clone()], own), Ok(2), "Notch's own window is skipped");
        let vault = w(3, r"C:\Users\u\AppData\Local\Programs\Bitwarden\Bitwarden.exe", "Kasa");
        assert_eq!(
            scan_target(&[notch.clone(), vault, editor.clone()], own),
            Err(CmdError::Denied),
            "not the next one"
        );
        let bank = w(4, r"C:\Program Files\Google\Chrome\chrome.exe", "Ziraat Bank Online - Chrome");
        assert_eq!(scan_target(&[bank, editor.clone()], own), Err(CmdError::Denied), "a bank by its title");
        let small = crate::apps::RawWindow { minimized: true, ..editor.clone() };
        assert_eq!(scan_target(&[notch, small], own), Err(CmdError::Missing));
        assert_eq!(scan_target(&[editor], ""), Ok(2));
    }

    #[test]
    fn errors_reach_the_page_as_its_names() {
        let name = |e: CmdError| serde_json::to_value(e).unwrap();
        assert_eq!(name(OwnerErr::NoMain.into()), "not_connected");
        assert_eq!(name(CmdError::NotYet), "not_yet");
        assert_eq!(CmdError::from(ClipErr::Locked), CmdError::Denied, "locked");
        assert_eq!(CmdError::from(ClipErr::Password), CmdError::Denied, "a password item");
        assert_eq!(CmdError::from(CopyErr::Password), CmdError::Denied, "a password shelf file");
        assert_eq!(CmdError::from(CopyErr::TooBig), CmdError::Invalid);
        assert_eq!(CmdError::from(AppError::Unknown), CmdError::Unknown);
        assert_eq!(CmdError::from(OwnerErr::Ignored), CmdError::Ignored);
    }

    #[test]
    fn locked_refuses() {
        assert_eq!(unlocked(true), Err(CmdError::Denied));
        assert_eq!(unlocked(false), Ok(()));
    }

    #[test]
    fn every_command_that_sends_owner_content_checks_the_lock_first() {
        // shortcut: reads the bin crate's source (never compiled under `--lib`); a renamed command fails here.
        let src = include_str!("../../../crates/notch-app/src/commands.rs");
        for name in SENDS_OWNER_CONTENT {
            let at = [format!("pub fn {name}("), format!("pub async fn {name}(")]
                .iter()
                .find_map(|sig| src.find(sig.as_str()))
                .unwrap_or_else(|| panic!("{name} not in commands.rs"));
            let body = &src[at..];
            let body = &body[body.find(" {").expect("body")..]; // not " {\n": CI checks out CRLF
            let first = body.lines().nth(1).unwrap_or_default().trim();
            assert_eq!(first, "cmd::unlocked(crate::plugins::locked(&app))?;", "{name}");
        }
    }

    #[test]
    fn pins_only_from_what_notch_knows_once_each_and_capped() {
        let pin = |id: &str| Pin { app_id: id.into(), name: id.to_uppercase() };
        let item = AppItem {
            app_id: "exe:c:\\b.exe".into(),
            name: "B".into(),
            pinned: false,
            exe: "b.exe".into(),
            windows: vec![],
        };
        let ids = |s: &[&str]| s.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        let current = [pin("aumid:a")];
        let got = pins_order(&current, std::slice::from_ref(&item), &ids(&["exe:c:\\b.exe", "aumid:a"])).unwrap();
        assert_eq!(got, [Pin { app_id: "exe:c:\\b.exe".into(), name: "B".into() }, pin("aumid:a")]);
        assert_eq!(pins_order(&current, &[], &ids(&[])), Ok(vec![]), "unpin all");
        assert_eq!(pins_order(&current, &[], &ids(&["exe:c:\\windows\\system32\\cmd.exe"])), Err(CmdError::Unknown));
        assert_eq!(pins_order(&current, &[], &ids(&["aumid:a", "aumid:a"])), Err(CmdError::Invalid), "a repeat");
        let many: Vec<String> = (0..=MAX_PINS).map(|_| "aumid:a".into()).collect();
        assert_eq!(pins_order(&current, &[], &many), Err(CmdError::Invalid), "over the cap");
    }

    #[test]
    fn a_ctrl_k_id_opens_only_what_notch_listed() {
        assert_eq!(search_route("set:ms-settings:display", true), Ok(Route::Setting("ms-settings:display")));
        assert_eq!(search_route("set:ms-settings:display", false), Err(CmdError::Unknown), "a page Notch did not list");
        for bad in ["set:ms-settings:display-x", "set:https://x.test", "set:C:\\Windows\\System32\\cmd.exe"] {
            assert_eq!(search_route(bad, true), Err(CmdError::Unknown), "{bad}");
        }
        assert_eq!(search_route("file:C:\\u\\rapor.pdf", true), Ok(Route::File("C:\\u\\rapor.pdf")));
        assert_eq!(search_route("file:C:\\Windows\\System32\\cmd.exe", false), Err(CmdError::Unknown), "a page path");
        assert_eq!(search_route("plg:ornek:r1", false), Ok(Route::Plugin("ornek", "r1")));
        assert_eq!(search_route("plg:ornek", false), Err(CmdError::Invalid));
        assert_eq!(search_route("app:x", false), Ok(Route::Hit(Hit::App("x".into()))));
        assert_eq!(search_route("win:-7", false), Ok(Route::Hit(Hit::Window(-7))));
        assert_eq!(search_route("C:\\x.exe", true), Err(CmdError::Invalid));
    }

    #[test]
    fn shelf_copies_are_made_only_for_a_main_assistant_and_stop_at_a_refusal() {
        let calls = Cell::new(0);
        let copy = |id: &str| {
            calls.set(calls.get() + 1);
            if id == "kasa" {
                Err(CmdError::from(CopyErr::Password))
            } else {
                Ok(format!("share\\{id}.pdf"))
            }
        };
        assert_eq!(shelf_copies(Err(OwnerErr::NoMain), ["a"], copy), Err(CmdError::NotConnected));
        assert_eq!(calls.get(), 0, "no main assistant: nothing copied");
        assert_eq!(shelf_copies(Ok(false), ["a"], copy), Ok(vec![]));
        assert_eq!(calls.get(), 0, "wrong scope: nothing copied");
        assert_eq!(shelf_copies(Ok(true), ["a", "b"], copy), Ok(vec!["share\\a.pdf".into(), "share\\b.pdf".into()]));
        calls.set(0);
        assert_eq!(shelf_copies(Ok(true), ["kasa", "b"], copy), Err(CmdError::Denied), "a password file");
        assert_eq!(calls.get(), 1, "stops at the first refusal");
    }

    #[test]
    fn an_attached_file_is_capped_before_it_is_read() {
        let max = crate::fidelity::ATTACH_MAX_BYTES;
        assert_eq!(attach_ext(max, "Rapor.PDF"), Ok("pdf".into()));
        assert_eq!(attach_ext(max + 1, "Rapor.PDF"), Err(CmdError::Invalid));
        for name in ["kasa.kdbx", "id_rsa", ".env"] {
            assert_eq!(attach_ext(1, name), Err(CmdError::Denied), "{name}");
        }
        assert_eq!(attach_bytes(b"hello"), Ok(()));
        let key = concat!("anahtar: sk-ant-api03-abcdefghijklmnop", "qrstuvwxyz012345").as_bytes(); // allow-secret
        assert_eq!(attach_bytes(key), Err(CmdError::Denied), "a secret inside a text file");
        assert_eq!(attach_bytes(&[0xff, 0x00, 0x9c]), Ok(()), "binary is not judged");
    }

    #[test]
    fn the_assistant_starts_only_from_a_valid_existing_launch_path() {
        let exe = r"C:\Ornek\ornek.exe";
        assert_eq!(assistant_start_target(Some(exe), |_| true), Some(PathBuf::from(exe)));
        assert_eq!(assistant_start_target(Some(exe), |_| false), None, "not on disk: missing");
        assert_eq!(assistant_start_target(None, |_| true), None, "no launch declared");
        assert_eq!(assistant_start_target(Some("ornek.exe"), |_| true), None, "relative");
        assert_eq!(assistant_start_target(Some(r"C:\a\x.cmd"), |_| true), None, "not an exe");
    }
}
