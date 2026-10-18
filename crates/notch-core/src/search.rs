//! Ctrl+K's Windows-settings and files groups (Wave 4). Settings: a fixed list of `ms-settings:` pages with Turkish
//! names; the page can open only these (by id, never a URI it sends). Files: one read-only `SELECT` against the
//! Windows Search index (`SystemIndex`), built here so the escaping is tested: the owner's words are reduced to
//! letters, digits and `. - _` before they go inside `CONTAINS('"…*"')`, so nothing typed can end the string or add
//! a statement. The query runs in `notch-win::winsearch` with a timeout.

use crate::clip::secret::fold_tr;

/// (URI, Turkish name, extra words to match). Ctrl+K's pages: `search_open` opens one only if Notch listed it in the
/// last results or recents. The strip's fixed links are the separate `fidelity::SETTINGS_URIS`.
pub const SETTINGS: &[(&str, &str, &str)] = &[
    ("ms-settings:", "Ayarlar", "windows ayarlari"),
    ("ms-settings:display", "Ekran", "parlaklik cozunurluk olcek monitor gece isigi"),
    ("ms-settings:nightlight", "Gece ışığı", "mavi isik"),
    ("ms-settings:sound", "Ses", "hoparlor mikrofon cikis giris"),
    ("ms-settings:notifications", "Bildirimler", "uyari"),
    ("ms-settings:quiethours", "Odak / Rahatsız etmeyin", "odaklanma sessiz"),
    ("ms-settings:powersleep", "Güç ve uyku", "pil uyku ekran kapanma"),
    ("ms-settings:batterysaver", "Pil tasarrufu", "batarya sarj"),
    ("ms-settings:storagesense", "Depolama", "disk alan temizlik"),
    ("ms-settings:multitasking", "Çoklu görev", "pencere yaslama"),
    ("ms-settings:clipboard", "Pano", "kopyala yapistir gecmis"),
    ("ms-settings:about", "Hakkında", "bilgisayar adi surum sistem"),
    ("ms-settings:bluetooth", "Bluetooth ve cihazlar", "kulaklik fare klavye"),
    ("ms-settings:printers", "Yazıcılar ve tarayıcılar", "yazici"),
    ("ms-settings:mousetouchpad", "Fare", "imlec dokunmatik"),
    ("ms-settings:network-status", "Ağ ve internet", "ag internet baglanti"),
    ("ms-settings:network-wifi", "Wi-Fi", "kablosuz wifi"),
    ("ms-settings:network-vpn", "VPN", "sanal ozel ag"),
    ("ms-settings:personalization", "Kişiselleştirme", "tema"),
    ("ms-settings:personalization-background", "Arka plan", "duvar kagidi"),
    ("ms-settings:colors", "Renkler", "karanlik mod koyu acik"),
    ("ms-settings:lockscreen", "Kilit ekranı", "kilit"),
    ("ms-settings:taskbar", "Görev çubuğu", "taskbar"),
    ("ms-settings:fonts", "Yazı tipleri", "font"),
    ("ms-settings:appsfeatures", "Yüklü uygulamalar", "kaldir program"),
    ("ms-settings:defaultapps", "Varsayılan uygulamalar", "tarayici acilis"),
    ("ms-settings:startupapps", "Başlangıç uygulamaları", "acilista baslat"),
    ("ms-settings:yourinfo", "Hesap bilgileri", "kullanici hesap"),
    ("ms-settings:signinoptions", "Oturum açma seçenekleri", "parola pin windows hello"),
    ("ms-settings:dateandtime", "Tarih ve saat", "saat dilimi"),
    ("ms-settings:regionlanguage", "Dil ve bölge", "dil klavye turkce"),
    ("ms-settings:gaming-gamebar", "Oyun", "game bar"),
    ("ms-settings:easeofaccess", "Erişilebilirlik", "metin boyutu buyutec"),
    ("ms-settings:privacy", "Gizlilik ve güvenlik", "izin"),
    ("ms-settings:privacy-microphone", "Mikrofon izinleri", "mikrofon gizlilik"),
    ("ms-settings:privacy-webcam", "Kamera izinleri", "kamera gizlilik"),
    ("ms-settings:windowsdefender", "Windows Güvenliği", "virus defender"),
    ("ms-settings:windowsupdate", "Windows Update", "guncelleme"),
    ("ms-settings:backup", "Yedekleme", "yedek onedrive"),
    ("ms-settings:troubleshoot", "Sorun giderme", "onar"),
    ("ms-settings:recovery", "Kurtarma", "sifirla"),
    ("ms-settings:developers", "Geliştiriciler için", "gelistirici modu"),
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
    fn settings_match_turkish_names_and_words() {
        let hits = settings("parlak", 5);
        assert_eq!(hits[0], ("ms-settings:display", "Ekran"));
        assert!(settings("GÖREV çub", 5).iter().any(|(u, _)| *u == "ms-settings:taskbar"));
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
            "fatura\u{0}gizli",
            "../../etc",
        ] {
            let Some(sql) = files_sql(q, 20) else { continue };
            assert!(sql.starts_with("SELECT TOP 20 System.ItemUrl FROM SystemIndex WHERE SCOPE='file:' AND "));
            assert_eq!(sql.matches('\'').count() % 2, 0, "every string closes: {sql}");
            assert!(!sql.contains(';') && !sql.contains("--") && !sql.contains("OR 1") && !sql.contains('\0'), "{sql}");
            assert_eq!(sql.matches("SCOPE=").count(), 1, "the owner cannot widen the scope: {sql}");
        }
        assert_eq!(
            files_sql("Rapor şubat.pdf", 5).unwrap(),
            "SELECT TOP 5 System.ItemUrl FROM SystemIndex WHERE SCOPE='file:' AND CONTAINS(System.FileName, '\"Rapor*\"') \
             AND CONTAINS(System.FileName, '\"şubat.pdf*\"') ORDER BY System.DateModified DESC"
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
