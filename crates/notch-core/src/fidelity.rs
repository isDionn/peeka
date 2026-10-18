//! Fidelity 3 (the mock-up audit): the small rules behind the commands the UI fixers coded against fakes
//! (`ui/src/fidelity-api.ts`, `fidelity-cards-api.ts`, bridge.ts "FIDELITY BLOCK"). Pure, so `cargo test --lib`
//! covers them; the Windows calls are in `notch-win`, the thin commands in `crates/notch-app/src/commands.rs`.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::plugins::host::{AttachKind, Attachment, OwnerErr};

/// The only ms-settings pages `open_windows_settings` opens: exactly the strip's and panels' fixed links, taken
/// straight from the page with no search behind them (nothing else, no prefix match). Ctrl+K has its own, larger
/// list (`search::SETTINGS`), opened only after Notch listed the page.
pub const SETTINGS_URIS: [&str; 9] = [
    "ms-settings:",
    "ms-settings:network-wifi",
    "ms-settings:bluetooth",
    "ms-settings:quiethours",
    // The low-battery protrusion's "Battery saver settings" (Wave 5).
    "ms-settings:batterysaver",
    "ms-settings:developers",
    "ms-settings:privacy-notifications",
    // Fidelity 3: "Windows notification settings".
    "ms-settings:notifications",
    // About > "Check for updates": opens the releases page in the browser; Peeka itself makes no request.
    "https://github.com/isDionn/peeka/releases/latest",
];

pub fn settings_uri(uri: &str) -> Option<&'static str> {
    SETTINGS_URIS.iter().copied().find(|u| *u == uri)
}

/// Ctrl+Shift+A / `island_hide`: an hour, or until pressed again.
pub const HIDE_MS: u64 = 3_600_000;

pub fn island_hidden(until: Option<u64>, now: u64) -> bool {
    until.is_some_and(|u| now < u)
}

/// `recent_files`: at most this many rows (the Start panel shows 4).
pub const RECENT_MAX: usize = 8;

/// fidelity-api.ts `RecentItem` (no `icon`: the "Frequent" app rows have no source yet).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RecentItem {
    pub id: String,
    pub name: String,
    pub sub: String,
    pub kind: &'static str,
}

/// Plain relative age; no clock time ("Yesterday 17:40" would need the local time zone, which std does not have).
pub fn ago(ms: u64) -> String {
    let min = ms / 60_000;
    match min {
        0 => "Just now".into(),
        1..=59 => format!("{min}m ago"),
        60..=1439 => format!("{}h ago", min / 60),
        1440..=2879 => "Yesterday".into(),
        _ => format!("{}d ago", min / 1440),
    }
}

pub fn recent_kind(name: &str) -> &'static str {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "pdf" => "pdf",
        "mp4" | "mkv" | "mov" | "avi" | "webm" | "wmv" => "video",
        "xlsx" | "xls" | "csv" | "ods" => "sheet",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "heic" | "svg" => "image",
        _ => "other",
    }
}

/// The Recent folder's shortcuts (`slides.pdf.lnk`, modified Unix ms) -> the newest `RECENT_MAX` file rows and the
/// `.lnk` paths by the same index (`open_recent` takes only those ids). A shortcut whose name has no extension
/// is a folder or a shell item and is left out.
pub fn recent(mut lnks: Vec<(PathBuf, u64)>, now: u64) -> (Vec<RecentItem>, Vec<PathBuf>) {
    lnks.sort_by_key(|(_, t)| std::cmp::Reverse(*t));
    let mut rows = vec![];
    let mut paths = vec![];
    for (p, t) in lnks {
        let is_lnk = p.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk"));
        let Some(name) = p.file_stem().and_then(|s| s.to_str()).filter(|_| is_lnk) else { continue };
        if Path::new(name).extension().is_none() {
            continue;
        }
        rows.push(RecentItem {
            id: format!("r{}", rows.len()),
            name: name.into(),
            sub: ago(now.saturating_sub(t)),
            kind: recent_kind(name),
        });
        paths.push(p);
        if rows.len() == RECENT_MAX {
            break;
        }
    }
    (rows, paths)
}

/// `open_recent {id}`: only an id the last `recent_files` sent.
pub fn recent_target<'a>(paths: &'a [PathBuf], id: &str) -> Option<&'a Path> {
    let i: usize = id.strip_prefix('r')?.parse().ok()?;
    (id == format!("r{i}")).then(|| paths.get(i).map(PathBuf::as_path)).flatten()
}

/// What `composer_submit` resolves from a page attachment that carries only its kind (`fidelity-cards-api.ts`
/// `ComposerKind`). `window_image` stays `not_yet` (no "this window" capture), so it is not offered.
pub const COMPOSER_KINDS: [&str; 4] = ["screen_image", "file", "clipboard_link", "shelf"];

/// A file the owner picked may be copied into the share folder up to this size (the main assistant reads only that folder).
pub const ATTACH_MAX_BYTES: u64 = 50 * 1024 * 1024;

/// The copy's extension in the share folder: the original's if short and plain, else `bin`.
pub fn share_ext(name: &str) -> String {
    let ext = Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase();
    if (1..=10).contains(&ext.len()) && ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        ext
    } else {
        "bin".into()
    }
}

/// fidelity-cards-api.ts `Attached`: what the page shows as a chip (never the path).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Attached {
    pub kind: &'static str,
    pub label: String,
}

/// A Ctrl+Space attachment as the page sends it: only its kind, never a path (Rust resolves it).
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UiAttachKind {
    WindowImage,
    ScreenImage,
    File,
    ClipboardLink,
    Shelf,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
pub struct UiAttachment {
    pub kind: UiAttachKind,
}

/// The page's kinds -> the host's attachments: a screenshot or file the owner made with `composer_scan` /
/// `composer_attach_file` (taken from `pending` in order), the newest clipboard link, every shelf file (once).
/// `NotYet` for `window_image`; `Invalid` when a kind has nothing behind it.
pub fn resolve(
    asked: &[UiAttachment],
    pending: &mut Vec<Attachment>,
    link: Option<&str>,
    shelf: &[String],
) -> Result<Vec<Attachment>, OwnerErr> {
    let mut out = vec![];
    let mut shelf_done = false;
    for a in asked {
        let mut take = |kind: AttachKind| {
            let i = pending.iter().position(|p| p.kind == kind).ok_or(OwnerErr::Invalid)?;
            Ok(pending.remove(i))
        };
        match a.kind {
            UiAttachKind::WindowImage => return Err(OwnerErr::NotYet),
            UiAttachKind::ScreenImage => out.push(take(AttachKind::Screenshot)?),
            UiAttachKind::File => out.push(take(AttachKind::File)?),
            UiAttachKind::ClipboardLink => {
                let text = link.ok_or(OwnerErr::Invalid)?.to_string();
                out.push(Attachment { kind: AttachKind::Clip, path: None, text: Some(text) });
            }
            UiAttachKind::Shelf if shelf_done => {}
            UiAttachKind::Shelf => {
                shelf_done = true;
                if shelf.is_empty() {
                    return Err(OwnerErr::Invalid);
                }
                let files =
                    shelf.iter().map(|p| Attachment { kind: AttachKind::Rack, path: Some(p.clone()), text: None });
                out.extend(files);
            }
        }
    }
    Ok(out)
}

/// The newest clipboard text that is a plain web link (the plugin view: never a password item).
pub fn newest_link(items: &[crate::plugins::host::ClipItem]) -> Option<&str> {
    items
        .iter()
        .filter(|i| i.kind == "text" && !i.password)
        .filter_map(|i| i.text.as_deref())
        .map(str::trim)
        .find(|t| crate::alerts::web_link(&serde_json::Value::String((*t).into())).is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_settings_allowlist_is_exact() {
        assert_eq!(settings_uri("ms-settings:notifications"), Some("ms-settings:notifications"));
        assert_eq!(settings_uri("ms-settings:notifications-x"), None);
        assert_eq!(settings_uri("ms-settings:notification"), None);
        assert_eq!(settings_uri("https://example.com"), None);
        assert_eq!(settings_uri("MS-SETTINGS:"), None);
    }

    #[test]
    fn hidden_for_an_hour() {
        assert!(!island_hidden(None, 5));
        assert!(island_hidden(Some(HIDE_MS), HIDE_MS - 1));
        assert!(!island_hidden(Some(HIDE_MS), HIDE_MS));
    }

    #[test]
    fn ages_in_plain_english() {
        assert_eq!(ago(30_000), "Just now");
        assert_eq!(ago(5 * 60_000), "5m ago");
        assert_eq!(ago(3 * 3_600_000), "3h ago");
        assert_eq!(ago(30 * 3_600_000), "Yesterday");
        assert_eq!(ago(4 * 86_400_000), "4d ago");
    }

    #[test]
    fn recent_rows_newest_first_files_only_and_known_ids() {
        let p = |s: &str| PathBuf::from(format!("C:\\R\\{s}"));
        let lnks = vec![
            (p("old.xlsx.lnk"), 1_000),
            (p("Belgeler.lnk"), 9_000), // a folder: no extension in the name
            (p("slides.pdf.lnk"), 8_000),
            (p("not-a-link.txt"), 9_500),
        ];
        let (rows, paths) = recent(lnks, 8_000 + 120_000);
        assert_eq!(rows.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["slides.pdf", "old.xlsx"]);
        assert_eq!((rows[0].kind, rows[0].sub.as_str(), rows[1].kind), ("pdf", "2m ago", "sheet"));
        assert_eq!(recent_target(&paths, "r1"), Some(p("old.xlsx.lnk").as_path()));
        for bad in ["r2", "r01", "r-1", "x0", "", "r", "../r0"] {
            assert_eq!(recent_target(&paths, bad), None, "{bad}");
        }
        let many: Vec<_> = (0..20).map(|i| (p(&format!("{i}.png.lnk")), i)).collect();
        assert_eq!(recent(many, 100).0.len(), RECENT_MAX);
    }

    #[test]
    fn share_copy_extension() {
        assert_eq!(share_ext("rapor.XLSX"), "xlsx");
        assert_eq!(share_ext("noext"), "bin");
        assert_eq!(share_ext("x.tar.gz"), "gz");
        assert_eq!(share_ext("x.p n g"), "bin");
        assert_eq!(share_ext("x.verylongextension"), "bin");
    }

    #[test]
    fn composer_kinds_resolve_in_rust_never_from_a_page_path() {
        let shot = |p: &str| Attachment { kind: AttachKind::Screenshot, path: Some(p.into()), text: None };
        let file = Attachment { kind: AttachKind::File, path: Some("s-b.xlsx".into()), text: None };
        let mut pending = vec![shot("s-1.png"), file.clone(), shot("s-2.png")];
        let ask = |k| UiAttachment { kind: k };
        let shelf = vec!["shelf-a.pdf".to_string(), "shelf-b.pdf".to_string()];
        let asked = [
            ask(UiAttachKind::ScreenImage),
            ask(UiAttachKind::File),
            ask(UiAttachKind::Shelf),
            ask(UiAttachKind::Shelf),
        ];
        let got = resolve(&asked, &mut pending, None, &shelf).unwrap();
        assert_eq!(got[0], shot("s-1.png"), "in order");
        assert_eq!((got[1].clone(), got.len()), (file, 4), "shelf files once");
        assert_eq!(pending, [shot("s-2.png")]);
        assert_eq!(resolve(&[ask(UiAttachKind::File)], &mut pending, None, &[]), Err(OwnerErr::Invalid), "none picked");
        assert_eq!(resolve(&[ask(UiAttachKind::WindowImage)], &mut pending, None, &[]), Err(OwnerErr::NotYet));
        assert_eq!(resolve(&[ask(UiAttachKind::ClipboardLink)], &mut pending, None, &[]), Err(OwnerErr::Invalid));
        let l = resolve(&[ask(UiAttachKind::ClipboardLink)], &mut pending, Some("https://x.test/a"), &[]).unwrap();
        assert_eq!(l[0].text.as_deref(), Some("https://x.test/a"));
        // A page that sends a path anyway: serde drops the field, the path never reaches the plugin.
        let a: UiAttachment = serde_json::from_str(r#"{"kind":"file","path":"x/secret.txt"}"#).unwrap();
        assert_eq!(a, ask(UiAttachKind::File));
        assert!(serde_json::from_str::<UiAttachment>(r#"{"kind":"rack"}"#).is_err(), "only the page's kinds");
    }

    #[test]
    fn the_newest_link_skips_passwords_and_non_links() {
        use crate::plugins::host::ClipItem;
        let t = |s: &str, password: bool| ClipItem { kind: "text".into(), text: Some(s.into()), path: None, password };
        let items = [
            t("https://secret.test/x", true),
            t("hello", false),
            t(" https://ok.test/y ", false),
            t("https://z.test", false),
        ];
        assert_eq!(newest_link(&items), Some("https://ok.test/y"));
        assert_eq!(newest_link(&[t("javascript:alert(1)", false)]), None);
    }
}
