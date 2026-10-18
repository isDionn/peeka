//! Ctrl+K's Windows-settings and files groups (Wave 4). Settings: a fixed list of `ms-settings:` pages with English
//! names; the page can open only these (by id, never a URI it sends). Files: one read-only `SELECT` against the
//! Windows Search index (`SystemIndex`), built here so the escaping is tested: the owner's words are reduced to
//! letters, digits and `. - _` before they go inside `CONTAINS('"…*"')`, so nothing typed can end the string or add
//! a statement. The query runs in `notch-win::winsearch` with a timeout.

use crate::clip::secret::fold_tr;

/// (URI, name, extra words to match). Ctrl+K's pages: `search_open` opens one only if Notch listed it in the
/// last results or recents. The strip's fixed links are the separate `fidelity::SETTINGS_URIS`.
pub const SETTINGS: &[(&str, &str, &str)] = &[
    ("ms-settings:", "Settings", "windows settings"),
    ("ms-settings:display", "Display", "brightness resolution scale monitor night light"),
    ("ms-settings:nightlight", "Night light", "blue light"),
    ("ms-settings:sound", "Sound", "speaker microphone output input"),
    ("ms-settings:notifications", "Notifications", "alert"),
    ("ms-settings:quiethours", "Focus / Do not disturb", "focus quiet"),
    ("ms-settings:powersleep", "Power & sleep", "battery sleep screen off"),
    ("ms-settings:batterysaver", "Battery saver", "battery charge"),
    ("ms-settings:storagesense", "Storage", "disk space cleanup"),
    ("ms-settings:multitasking", "Multitasking", "window snap"),
    ("ms-settings:clipboard", "Clipboard", "copy paste history"),
    ("ms-settings:about", "About", "pc name version system"),
    ("ms-settings:bluetooth", "Bluetooth & devices", "headset mouse keyboard"),
    ("ms-settings:printers", "Printers & scanners", "printer"),
    ("ms-settings:mousetouchpad", "Mouse", "cursor touchpad"),
    ("ms-settings:network-status", "Network & internet", "network internet connection"),
    ("ms-settings:network-wifi", "Wi-Fi", "wireless wifi"),
    ("ms-settings:network-vpn", "VPN", "virtual private network"),
    ("ms-settings:personalization", "Personalization", "theme"),
    ("ms-settings:personalization-background", "Background", "wallpaper"),
    ("ms-settings:colors", "Colors", "dark mode light"),
    ("ms-settings:lockscreen", "Lock screen", "lock"),
    ("ms-settings:taskbar", "Taskbar", "task bar"),
    ("ms-settings:fonts", "Fonts", "font"),
    ("ms-settings:appsfeatures", "Installed apps", "uninstall program"),
    ("ms-settings:defaultapps", "Default apps", "browser open"),
    ("ms-settings:startupapps", "Startup apps", "startup boot"),
    ("ms-settings:yourinfo", "Your info", "user account"),
    ("ms-settings:signinoptions", "Sign-in options", "password pin windows hello"),
    ("ms-settings:dateandtime", "Date & time", "time zone"),
    ("ms-settings:regionlanguage", "Language & region", "language keyboard"),
    ("ms-settings:gaming-gamebar", "Gaming", "game bar"),
    ("ms-settings:easeofaccess", "Accessibility", "text size magnifier"),
    ("ms-settings:privacy", "Privacy & security", "permission"),
    ("ms-settings:privacy-microphone", "Microphone permissions", "microphone privacy"),
    ("ms-settings:privacy-webcam", "Camera permissions", "camera privacy"),
    ("ms-settings:windowsdefender", "Windows Security", "virus defender"),
    ("ms-settings:windowsupdate", "Windows Update", "updates"),
    ("ms-settings:backup", "Backup", "onedrive"),
    ("ms-settings:troubleshoot", "Troubleshoot", "fix repair"),
    ("ms-settings:recovery", "Recovery", "reset"),
    ("ms-settings:developers", "For developers", "developer mode"),
];

/// Pages whose name or words contain every typed word (folded, Turkish-aware), at most `max`.
pub fn settings(query: &str, max: usize) -> Vec<(&'static str, &'static str)> {
    let words: Vec<String> = fold_tr(query).split_whitespace().map(str::to_string).collect();
    if words.is_empty() {
        return vec![];
    }
    SETTINGS
        .iter()
        .filter(|(uri, name, extra)| {
            let hay = format!("{} {} {}", fold_tr(name), extra, uri);
            words.iter().all(|w| hay.contains(w.as_str()))
        })
        .take(max)
        .map(|(u, n, _)| (*u, *n))
        .collect()
}

/// The URI of a page Notch listed; None for anything else.
pub fn setting_uri(uri: &str) -> Option<&'static str> {
    SETTINGS.iter().find(|(u, _, _)| *u == uri).map(|(u, _, _)| *u)
}

/// At most this many words go into the query, each at most this long.
const MAX_WORDS: usize = 5;
const MAX_WORD: usize = 40;

/// The `SystemIndex` query for the owner's words, or None when nothing searchable is left. File names only,
/// prefix match on each word, newest first, `max` rows.
pub fn files_sql(query: &str, max: u32) -> Option<String> {
    let words: Vec<String> = query
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .filter(|w| w.chars().any(char::is_alphanumeric))
        .take(MAX_WORDS)
        .map(|w| w.chars().take(MAX_WORD).collect())
        .collect();
    if words.is_empty() {
        return None;
    }
    let cond: Vec<String> = words.iter().map(|w| format!("CONTAINS(System.FileName, '\"{w}*\"')")).collect();
    Some(format!(
        "SELECT TOP {max} System.ItemUrl FROM SystemIndex WHERE SCOPE='file:' AND {} ORDER BY System.DateModified DESC",
        cond.join(" AND ")
    ))
}

/// `file:C:/Users/x/a.txt` (Windows Search's ItemUrl) -> `C:\Users\x\a.txt`; anything else is not a local file.
pub fn url_to_path(url: &str) -> Option<String> {
    let rest = url.strip_prefix("file:")?;
    let path = rest.replace('/', "\\");
    (path.get(1..3) == Some(":\\") || path.starts_with("\\\\")).then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_match_names_and_words() {
        let hits = settings("bright", 5);
        assert_eq!(hits[0], ("ms-settings:display", "Display"));
        assert!(settings("TASK bar", 5).iter().any(|(u, _)| *u == "ms-settings:taskbar"));
        assert!(settings("", 5).is_empty());
        assert_eq!(setting_uri("ms-settings:sound"), Some("ms-settings:sound"));
        assert_eq!(setting_uri("ms-settings:sound;calc.exe"), None, "only the listed URIs open");
    }

    #[test]
    fn the_file_query_is_one_read_only_select_whatever_is_typed() {
        for q in [
            "rapor 2026",
            "x' OR 1=1 --",
            "a'); DROP TABLE SystemIndex; --",
            "\"*\" OR SCOPE='file:C:/Windows'",
            "invoice\u{0}hidden",
            "../../etc",
        ] {
            let Some(sql) = files_sql(q, 20) else { continue };
            assert!(sql.starts_with("SELECT TOP 20 System.ItemUrl FROM SystemIndex WHERE SCOPE='file:' AND "));
            assert_eq!(sql.matches('\'').count() % 2, 0, "every string closes: {sql}");
            assert!(!sql.contains(';') && !sql.contains("--") && !sql.contains("OR 1") && !sql.contains('\0'), "{sql}");
            assert_eq!(sql.matches("SCOPE=").count(), 1, "the owner cannot widen the scope: {sql}");
        }
        assert_eq!(
            files_sql("Report march.pdf", 5).unwrap(),
            "SELECT TOP 5 System.ItemUrl FROM SystemIndex WHERE SCOPE='file:' AND CONTAINS(System.FileName, '\"Report*\"') \
             AND CONTAINS(System.FileName, '\"march.pdf*\"') ORDER BY System.DateModified DESC"
        );
        assert_eq!(files_sql("'; --", 5), None, "nothing searchable left");
    }

    #[test]
    fn item_urls_become_local_paths_only() {
        assert_eq!(url_to_path("file:C:/Users/a/b.txt").as_deref(), Some(r"C:\Users\a\b.txt"));
        assert_eq!(url_to_path("mapi://x"), None);
        assert_eq!(url_to_path("file:relative/x"), None);
    }
}
